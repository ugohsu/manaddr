# -*- coding: utf-8 -*-
import sqlite3

from flask import Blueprint, abort, jsonify, render_template, request

from helpers import get_db, normalize_zip

senders_bp = Blueprint('senders', __name__)

SENDER_DETAIL_FIELDS = [
    'label', 'last_name', 'first_name', 'last_name_kana', 'first_name_kana',
    'zip', 'prefecture', 'city', 'block', 'building', 'memo', 'company_name',
]
SENDER_COMPANION_FIELDS = ['last_name', 'first_name', 'last_name_kana', 'first_name_kana']


def resolve_sender_id_for_person(db, person_id):
    """人物の論理的な差出人 sender_id を返す（無ければ None）。
    優先順位: person_sender_overrides > senders.is_default。
    overrides に sender_id=NULL がある場合は「差出人なし」という明示的な指定を意味する。"""
    override_row = db.execute(
        'SELECT sender_id FROM person_sender_overrides WHERE person_id=?', (person_id,)
    ).fetchone()
    if override_row is not None:
        return override_row['sender_id']
    default_sender = db.execute('SELECT id FROM senders WHERE is_default=1').fetchone()
    return default_sender['id'] if default_sender else None


def resolve_sender_details_id_for_person(db, person_id):
    """人物に対する現在の sender_details_id を返す（差出人なし・未設定の場合は None）。
    送付履歴スナップショット記録時に使う（論理 sender_id ではなくバージョン固定の ID）。"""
    sender_id = resolve_sender_id_for_person(db, person_id)
    if sender_id is None:
        return None
    row = db.execute(
        'SELECT id FROM current_sender_details WHERE sender_id=?', (sender_id,)
    ).fetchone()
    return row['id'] if row else None


def get_sender_companions_map(db, sender_ids):
    """sender_id -> [{'last_name':..,'first_name':..}, ...] の辞書を返す（現在値）。
    export.py が宛名印字用の差出人氏名列を組み立てる際に使う。"""
    if not sender_ids:
        return {}
    rows = db.execute(
        f"SELECT * FROM current_sender_companions WHERE sender_id IN ({','.join('?' for _ in sender_ids)}) "
        'ORDER BY sender_id, sort_order', sender_ids,
    ).fetchall()
    out = {}
    for r in rows:
        out.setdefault(r['sender_id'], []).append(dict(r))
    return out


def _shape_companion(row):
    return {'id': row['id'], 'sort_order': row['sort_order'], **{f: row[f] for f in SENDER_COMPANION_FIELDS}}


def _update_sender_companions(db, sender_id, new_companions):
    """差出人連名を versioned 方式で更新する。
    削除されたスロット: is_deleted=1 行を挿入。
    追加/変更されたスロット: 新行を挿入。"""
    current_rows = db.execute(
        'SELECT sort_order FROM current_sender_companions WHERE sender_id=?', (sender_id,)
    ).fetchall()
    current_orders = {r['sort_order'] for r in current_rows}
    new_companions = list(new_companions or [])
    new_orders = set(range(len(new_companions)))

    for order in current_orders - new_orders:
        db.execute(
            'INSERT INTO sender_companions (sender_id, sort_order, is_deleted) VALUES (?,?,1)',
            (sender_id, order),
        )
    for i, c in enumerate(new_companions):
        db.execute(
            'INSERT INTO sender_companions '
            '(sender_id, sort_order, last_name, first_name, last_name_kana, first_name_kana) '
            'VALUES (?,?,?,?,?,?)',
            (sender_id, i, c.get('last_name'), c.get('first_name'),
             c.get('last_name_kana'), c.get('first_name_kana')),
        )


# ---------- ページ ----------

@senders_bp.get('/senders')
def senders_manage():
    return render_template('senders_manage.html')


# ---------- API: 差出人（個別プロフィール、連名込み） ----------

def _sender_json(db, sender_row):
    """senders 行と current_sender_details / current_sender_companions を結合して返す。"""
    detail = db.execute(
        'SELECT * FROM current_sender_details WHERE sender_id=?', (sender_row['id'],)
    ).fetchone()
    companions = db.execute(
        'SELECT * FROM current_sender_companions WHERE sender_id=? ORDER BY sort_order',
        (sender_row['id'],)
    ).fetchall()
    d = dict(detail) if detail else {}
    return {
        'id': sender_row['id'],
        'is_default': sender_row['is_default'],
        **{f: d.get(f) for f in SENDER_DETAIL_FIELDS},
        'companions': [_shape_companion(c) for c in companions],
    }


@senders_bp.get('/api/senders')
def api_senders_list():
    db = get_db()
    # current_sender_details に行がある senders だけ返す（soft-delete された差出人は除外）
    rows = db.execute(
        'SELECT s.* FROM senders s '
        'WHERE EXISTS (SELECT 1 FROM current_sender_details csd WHERE csd.sender_id = s.id) '
        'ORDER BY s.id'
    ).fetchall()
    return jsonify([_sender_json(db, r) for r in rows])


@senders_bp.post('/api/senders')
def api_senders_create():
    data = request.json or {}
    label = (data.get('label') or '').strip()
    if not label:
        return jsonify({'error': 'ラベルは必須です'}), 400
    data = dict(data)
    data['label'] = label
    data['zip'] = normalize_zip(data.get('zip'))
    db = get_db()
    cur = db.execute('INSERT INTO senders DEFAULT VALUES')
    sender_id = cur.lastrowid
    db.execute(
        f"INSERT INTO sender_details (sender_id, {','.join(SENDER_DETAIL_FIELDS)}) "
        f"VALUES (?,{','.join('?' for _ in SENDER_DETAIL_FIELDS)})",
        [sender_id] + [data.get(f) for f in SENDER_DETAIL_FIELDS],
    )
    _update_sender_companions(db, sender_id, data.get('companions'))
    db.commit()
    row = db.execute('SELECT * FROM senders WHERE id=?', (sender_id,)).fetchone()
    return jsonify(_sender_json(db, row))


@senders_bp.put('/api/senders/<int:sender_id>')
def api_senders_update(sender_id):
    db = get_db()
    if db.execute('SELECT 1 FROM senders WHERE id=?', (sender_id,)).fetchone() is None:
        abort(404)
    data = request.json or {}
    label = (data.get('label') or '').strip()
    if not label:
        return jsonify({'error': 'ラベルは必須です'}), 400
    data = dict(data)
    data['label'] = label
    data['zip'] = normalize_zip(data.get('zip'))
    # 新バージョン行を挿入（UPDATE ではなく INSERT）
    db.execute(
        f"INSERT INTO sender_details (sender_id, {','.join(SENDER_DETAIL_FIELDS)}) "
        f"VALUES (?,{','.join('?' for _ in SENDER_DETAIL_FIELDS)})",
        [sender_id] + [data.get(f) for f in SENDER_DETAIL_FIELDS],
    )
    if 'companions' in data:
        _update_sender_companions(db, sender_id, data.get('companions'))
    db.commit()
    row = db.execute('SELECT * FROM senders WHERE id=?', (sender_id,)).fetchone()
    return jsonify(_sender_json(db, row))


@senders_bp.delete('/api/senders/<int:sender_id>')
def api_senders_delete(sender_id):
    db = get_db()
    if db.execute('SELECT 1 FROM senders WHERE id=?', (sender_id,)).fetchone() is None:
        abort(404)
    # 送付履歴で参照されている場合は hard-delete 不可 → soft-delete（is_deleted=1 行挿入）
    referenced = db.execute(
        'SELECT 1 FROM mailing_recipient_senders mrs '
        'JOIN sender_details sd ON sd.id = mrs.sender_details_id '
        'WHERE sd.sender_id=? LIMIT 1',
        (sender_id,)
    ).fetchone()
    if referenced:
        # 現在の詳細・連名を soft-delete
        current_detail = db.execute(
            'SELECT id FROM current_sender_details WHERE sender_id=?', (sender_id,)
        ).fetchone()
        if current_detail:
            db.execute(
                'INSERT INTO sender_details (sender_id, is_deleted, label) '
                'SELECT sender_id, 1, label FROM sender_details WHERE id=?',
                (current_detail['id'],)
            )
        current_comps = db.execute(
            'SELECT sort_order FROM current_sender_companions WHERE sender_id=?', (sender_id,)
        ).fetchall()
        for c in current_comps:
            db.execute(
                'INSERT INTO sender_companions (sender_id, sort_order, is_deleted) VALUES (?,?,1)',
                (sender_id, c['sort_order']),
            )
        db.commit()
    else:
        try:
            db.execute('DELETE FROM sender_companions WHERE sender_id=?', (sender_id,))
            db.execute('DELETE FROM sender_details WHERE sender_id=?', (sender_id,))
            db.execute('DELETE FROM senders WHERE id=?', (sender_id,))
            db.commit()
        except sqlite3.IntegrityError:
            db.rollback()
            return jsonify({'error': 'この差出人は削除できません'}), 400
    return jsonify({'ok': True})


@senders_bp.get('/api/senders/<int:sender_id>/history')
def api_senders_history(sender_id):
    """差出人の変更履歴（sender_details の全バージョン）を新しい順で返す。"""
    db = get_db()
    if db.execute('SELECT 1 FROM senders WHERE id=?', (sender_id,)).fetchone() is None:
        abort(404)
    rows = db.execute(
        'SELECT id, recorded_at, is_deleted, label, last_name, first_name, '
        'zip, prefecture, city, block, building, company_name '
        'FROM sender_details WHERE sender_id=? ORDER BY recorded_at DESC, id DESC',
        (sender_id,),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@senders_bp.put('/api/sender_default')
def api_set_sender_default():
    """is_default は versioned テーブルではなく senders（identity）に持つため、普通の UPDATE で更新する。
    body: {type: 'none'} → 差出人なし  /  {type: 'sender', id: <sender_id>} → 指定差出人をデフォルトに"""
    payload = request.json or {}
    target_type = payload.get('type')
    target_id = payload.get('id')
    db = get_db()
    db.execute('UPDATE senders SET is_default=0')
    if target_type == 'none':
        pass
    elif target_type == 'sender':
        if db.execute('SELECT 1 FROM senders WHERE id=?', (target_id,)).fetchone() is None:
            abort(404)
        db.execute('UPDATE senders SET is_default=1 WHERE id=?', (target_id,))
    else:
        return jsonify({'error': "typeは'none'・'sender'のいずれかです"}), 400
    db.commit()
    return jsonify({'ok': True})


# ---------- API: 人物ごとの差出人上書き ----------

@senders_bp.get('/api/people/<int:person_id>/sender_override')
def api_person_sender_override_get(person_id):
    db = get_db()
    row = db.execute(
        'SELECT sender_id FROM person_sender_overrides WHERE person_id=?', (person_id,)
    ).fetchone()
    if row is None:
        return jsonify({'mode': 'default', 'sender_id': None})
    if row['sender_id'] is not None:
        return jsonify({'mode': 'sender', 'sender_id': row['sender_id']})
    return jsonify({'mode': 'none', 'sender_id': None})


@senders_bp.put('/api/people/<int:person_id>/sender_override')
def api_person_sender_override_set(person_id):
    data = request.json or {}
    mode = data.get('mode')
    db = get_db()
    if mode == 'default':
        db.execute('DELETE FROM person_sender_overrides WHERE person_id=?', (person_id,))
    elif mode == 'none':
        db.execute('''
            INSERT INTO person_sender_overrides (person_id, sender_id) VALUES (?, NULL)
            ON CONFLICT(person_id) DO UPDATE SET sender_id=NULL
        ''', (person_id,))
    elif mode == 'sender':
        sender_id = data.get('sender_id')
        if sender_id is None:
            return jsonify({'error': 'mode=senderにはsender_idが必要です'}), 400
        db.execute('''
            INSERT INTO person_sender_overrides (person_id, sender_id) VALUES (?, ?)
            ON CONFLICT(person_id) DO UPDATE SET sender_id=excluded.sender_id
        ''', (person_id, sender_id))
    else:
        return jsonify({'error': "modeは'default'・'none'・'sender'のいずれかです"}), 400
    db.commit()
    return jsonify({'ok': True})
