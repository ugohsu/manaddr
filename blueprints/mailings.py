# -*- coding: utf-8 -*-
import io
import json
from datetime import datetime

from flask import Blueprint, abort, jsonify, render_template, request, send_file

import postcard
from blueprints.export import (
    _address_to_lines,
    _build_sender_for_details_id,
    _fetch_recipient_rows,
    _get_postcard_settings,
)
from blueprints.people import PRIMARY_ADDRESS_ORDER_BY
from blueprints.senders import resolve_sender_details_id_for_person
from helpers import get_db

mailings_bp = Blueprint('mailings', __name__)

OUTPUT_TYPE_LABEL = {
    'pdf_batch': '宛名印字（PDF）',
    'rakusul_csv': 'ラクスルCSV',
}

POSTCARD_TYPE_LABEL = {
    'nengajo': '年賀状（お年玉付き）',
    'normal': '普通はがき',
}


# ---------- ページ ----------

@mailings_bp.get('/mailings')
def mailings_history_page():
    return render_template('mailings_history.html')


# ---------- API ----------

@mailings_bp.post('/api/mailings')
def create_mailing():
    """宛名印字バッチの送付実績を記録する。
    person_ids・overrides・postcard_typeはexport/postcards_batchと同じ形式で受け取り、
    バックエンドで解決してスナップショットを保存する。"""
    data = request.get_json(force=True)
    label = (data.get('label') or '').strip()
    if not label:
        abort(400, 'タイトルは必須です')
    fiscal_year = data.get('fiscal_year')
    if not fiscal_year:
        fiscal_year = datetime.now().year
    memo = (data.get('memo') or '').strip() or None
    output_type = data.get('output_type', 'pdf_batch')
    postcard_type = data.get('postcard_type') or None
    person_ids = [int(i) for i in (data.get('person_ids') or [])]
    overrides = data.get('overrides') or {}

    if not person_ids:
        abort(400, '対象の人物が選択されていません')

    db = get_db()
    cur = db.execute(
        'INSERT INTO mailings (fiscal_year, label, memo, output_type, postcard_type) VALUES (?,?,?,?,?)',
        (fiscal_year, label, memo, output_type, postcard_type),
    )
    mailing_id = cur.lastrowid

    for person_id in person_ids:
        override = overrides.get(str(person_id)) or {}
        classification = (override.get('classification') or '').strip() or None
        details, address = _fetch_recipient_rows(db, person_id, classification=classification)
        if details is None or address is None:
            continue

        raw_ids = override.get('companion_ids')
        if raw_ids is None:
            companion_rows = db.execute(
                'SELECT * FROM current_companions WHERE person_id=? ORDER BY sort_order LIMIT 3',
                (person_id,)
            ).fetchall()
            companion_ids = [r['id'] for r in companion_rows]
        elif raw_ids:
            companion_ids = [int(x) for x in raw_ids if isinstance(x, (int, float))]
        else:
            companion_ids = []

        sender_details_id = resolve_sender_details_id_for_person(db, person_id)

        cur2 = db.execute(
            'INSERT INTO mailing_recipients (mailing_id, person_id, person_details_id, address_id) VALUES (?,?,?,?)',
            (mailing_id, person_id, details['id'], address['id']),
        )
        mr_id = cur2.lastrowid

        for cid in companion_ids:
            db.execute(
                'INSERT INTO mailing_recipient_companions (mailing_recipient_id, companion_id) VALUES (?,?)',
                (mr_id, cid),
            )
        if sender_details_id is not None:
            cur3 = db.execute(
                'INSERT INTO mailing_recipient_senders (mailing_recipient_id, sender_details_id) VALUES (?,?)',
                (mr_id, sender_details_id),
            )
            mrs_id = cur3.lastrowid
            # 現在の差出人連名を sender_companion_id として固定スナップショット保存
            sender_id_row = db.execute(
                'SELECT sender_id FROM sender_details WHERE id=?', (sender_details_id,)
            ).fetchone()
            if sender_id_row:
                sc_rows = db.execute(
                    'SELECT id FROM current_sender_companions WHERE sender_id=? ORDER BY sort_order',
                    (sender_id_row['sender_id'],)
                ).fetchall()
                for sc in sc_rows:
                    db.execute(
                        'INSERT INTO mailing_recipient_sender_companions '
                        '(mailing_recipient_sender_id, sender_companion_id) VALUES (?,?)',
                        (mrs_id, sc['id']),
                    )

    db.commit()
    return jsonify({'id': mailing_id}), 201


@mailings_bp.get('/api/mailings')
def list_mailings():
    db = get_db()
    rows = db.execute(
        '''SELECT m.id, m.fiscal_year, m.label, m.memo, m.output_type, m.postcard_type, m.recorded_at,
                  COUNT(mr.id) AS recipient_count
           FROM mailings m
           LEFT JOIN mailing_recipients mr ON mr.mailing_id = m.id
           GROUP BY m.id
           ORDER BY m.recorded_at DESC'''
    ).fetchall()
    return jsonify([
        {
            'id': r['id'],
            'fiscal_year': r['fiscal_year'],
            'label': r['label'],
            'memo': r['memo'],
            'output_type': r['output_type'],
            'output_type_label': OUTPUT_TYPE_LABEL.get(r['output_type'], r['output_type']),
            'postcard_type': r['postcard_type'],
            'postcard_type_label': POSTCARD_TYPE_LABEL.get(r['postcard_type']) if r['postcard_type'] else None,
            'recorded_at': r['recorded_at'],
            'recipient_count': r['recipient_count'],
        }
        for r in rows
    ])


@mailings_bp.get('/api/mailings/<int:mailing_id>')
def get_mailing(mailing_id):
    db = get_db()
    m = db.execute('SELECT * FROM mailings WHERE id=?', (mailing_id,)).fetchone()
    if m is None:
        abort(404)

    recipient_rows = db.execute(
        '''SELECT mr.id, mr.person_id, mr.person_details_id, mr.address_id,
                  pd.last_name, pd.first_name, pd.honorific,
                  a.classification, a.prefecture, a.city, a.block, a.building
           FROM mailing_recipients mr
           JOIN person_details pd ON pd.id = mr.person_details_id
           JOIN addresses a ON a.id = mr.address_id
           WHERE mr.mailing_id = ?
           ORDER BY mr.id''',
        (mailing_id,),
    ).fetchall()

    recipients = []
    for rr in recipient_rows:
        # 連名
        comp_rows = db.execute(
            '''SELECT c.last_name, c.first_name, c.honorific
               FROM mailing_recipient_companions mrc
               JOIN companions c ON c.id = mrc.companion_id
               WHERE mrc.mailing_recipient_id = ?
               ORDER BY c.sort_order''',
            (rr['id'],),
        ).fetchall()
        # 差出人（スナップショット時点の sender_details を参照）
        sender_row = db.execute(
            '''SELECT sd.id, sd.label
               FROM mailing_recipient_senders mrs
               JOIN sender_details sd ON sd.id = mrs.sender_details_id
               WHERE mrs.mailing_recipient_id = ?''',
            (rr['id'],),
        ).fetchone()
        addr_line1 = (rr['prefecture'] or '') + (rr['city'] or '') + (rr['block'] or '')
        addr_line2 = rr['building'] or ''
        recipients.append({
            'person_id': rr['person_id'],
            'name': f"{rr['last_name'] or ''} {rr['first_name'] or ''}".strip() or '(氏名未登録)',
            'honorific': rr['honorific'],
            'companions': [
                {'name': f"{c['last_name'] or ''} {c['first_name'] or ''}".strip(), 'honorific': c['honorific']}
                for c in comp_rows
            ],
            'address': f"{addr_line1}{'　' + addr_line2 if addr_line2 else ''}",
            'address_classification': rr['classification'],
            'sender_label': sender_row['label'] if sender_row else None,
        })

    return jsonify({
        'id': m['id'],
        'fiscal_year': m['fiscal_year'],
        'label': m['label'],
        'memo': m['memo'],
        'output_type': m['output_type'],
        'output_type_label': OUTPUT_TYPE_LABEL.get(m['output_type'], m['output_type']),
        'postcard_type': m['postcard_type'],
        'postcard_type_label': POSTCARD_TYPE_LABEL.get(m['postcard_type']) if m['postcard_type'] else None,
        'recorded_at': m['recorded_at'],
        'recipients': recipients,
    })


@mailings_bp.patch('/api/mailings/<int:mailing_id>')
def update_mailing(mailing_id):
    db = get_db()
    if db.execute('SELECT 1 FROM mailings WHERE id=?', (mailing_id,)).fetchone() is None:
        abort(404)
    data = request.get_json(force=True)
    updates = {}
    if 'label' in data:
        label = (data['label'] or '').strip()
        if not label:
            abort(400, 'タイトルは必須です')
        updates['label'] = label
    if 'memo' in data:
        updates['memo'] = (data['memo'] or '').strip() or None
    if not updates:
        abort(400, '更新項目がありません')
    sets = ', '.join(f'{k}=?' for k in updates)
    db.execute(f'UPDATE mailings SET {sets} WHERE id=?', list(updates.values()) + [mailing_id])
    db.commit()
    return jsonify({'ok': True})


@mailings_bp.delete('/api/mailings/<int:mailing_id>')
def delete_mailing(mailing_id):
    db = get_db()
    if db.execute('SELECT 1 FROM mailings WHERE id=?', (mailing_id,)).fetchone() is None:
        abort(404)
    mr_ids = [r['id'] for r in db.execute(
        'SELECT id FROM mailing_recipients WHERE mailing_id=?', (mailing_id,)
    ).fetchall()]
    if mr_ids:
        placeholders = ','.join('?' * len(mr_ids))
        db.execute(f'DELETE FROM mailing_recipient_companions WHERE mailing_recipient_id IN ({placeholders})', mr_ids)
        mrs_ids = [r['id'] for r in db.execute(
            f'SELECT id FROM mailing_recipient_senders WHERE mailing_recipient_id IN ({placeholders})', mr_ids
        ).fetchall()]
        if mrs_ids:
            mrs_ph = ','.join('?' * len(mrs_ids))
            db.execute(f'DELETE FROM mailing_recipient_sender_companions WHERE mailing_recipient_sender_id IN ({mrs_ph})', mrs_ids)
        db.execute(f'DELETE FROM mailing_recipient_senders WHERE mailing_recipient_id IN ({placeholders})', mr_ids)
    db.execute('DELETE FROM mailing_recipients WHERE mailing_id=?', (mailing_id,))
    db.execute('DELETE FROM mailings WHERE id=?', (mailing_id,))
    db.commit()
    return jsonify({'ok': True})


@mailings_bp.post('/api/mailings/<int:mailing_id>/pdf')
def retypeset_mailing_pdf(mailing_id):
    """スナップショットから当時の宛名PDFを再タイプセットして返す。"""
    db = get_db()
    m = db.execute('SELECT * FROM mailings WHERE id=?', (mailing_id,)).fetchone()
    if m is None:
        abort(404)
    if m['output_type'] != 'pdf_batch':
        abort(400, 'このエントリはPDF印字ではありません')

    recipient_rows = db.execute(
        '''SELECT mr.id, mr.person_id, mr.person_details_id, mr.address_id
           FROM mailing_recipients mr
           WHERE mr.mailing_id = ?
           ORDER BY mr.id''',
        (mailing_id,),
    ).fetchall()

    if not recipient_rows:
        abort(400, '記録された宛先がありません')

    postcard_type = m['postcard_type'] or postcard.DEFAULT_POSTCARD_TYPE
    items = []
    for rr in recipient_rows:
        pd_row = db.execute('SELECT * FROM person_details WHERE id=?', (rr['person_details_id'],)).fetchone()
        addr_row = db.execute('SELECT * FROM addresses WHERE id=?', (rr['address_id'],)).fetchone()
        if pd_row is None or addr_row is None:
            continue

        comp_rows = db.execute(
            '''SELECT c.last_name, c.first_name, c.honorific, c.sort_order
               FROM mailing_recipient_companions mrc
               JOIN companions c ON c.id = mrc.companion_id
               WHERE mrc.mailing_recipient_id = ?
               ORDER BY c.sort_order''',
            (rr['id'],),
        ).fetchall()

        mrs_row = db.execute(
            'SELECT id, sender_details_id FROM mailing_recipient_senders WHERE mailing_recipient_id=?',
            (rr['id'],),
        ).fetchone()
        sender_details_id = mrs_row['sender_details_id'] if mrs_row else None
        sender_companion_ids = []
        if mrs_row:
            sc_rows = db.execute(
                'SELECT sender_companion_id FROM mailing_recipient_sender_companions WHERE mailing_recipient_sender_id=?',
                (mrs_row['id'],),
            ).fetchall()
            sender_companion_ids = [r['sender_companion_id'] for r in sc_rows]

        addr_line1, addr_line2 = _address_to_lines(addr_row)
        settings = _get_postcard_settings(db, rr['person_id'], postcard_type)
        recipient = {
            'zip': addr_row['zip'],
            'address_line1': addr_line1,
            'address_line2': addr_line2,
            'last_name': pd_row['last_name'],
            'first_name': pd_row['first_name'],
            'honorific': pd_row['honorific'],
            'companions': [
                {'last_name': c['last_name'], 'first_name': c['first_name'], 'honorific': c['honorific']}
                for c in comp_rows
            ],
            'name_scale': float(settings.get('name_scale') or 1.0),
            'address_scale': float(settings.get('address_scale') or 1.0),
        }
        sender = _build_sender_for_details_id(db, sender_details_id, sender_companion_ids)
        items.append({'recipient': recipient, 'sender': sender})

    if not items:
        abort(400, '再タイプセットできる宛先がありません（住所・人物情報が削除された可能性があります）')

    try:
        pdf_bytes = postcard.build_postcard_pdf(items, postcard_type=postcard_type)
    except RuntimeError as e:
        abort(500, str(e))

    return send_file(
        io.BytesIO(pdf_bytes), mimetype='application/pdf',
        as_attachment=False, download_name='postcards_history.pdf',
    )
