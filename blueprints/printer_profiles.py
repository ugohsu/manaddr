# -*- coding: utf-8 -*-
"""プリンタ調整プロファイル（printer_adjust.pyへ渡す補正値）のCRUD管理。

senders(差出人)のis_defaultパターンを踏襲: is_default=1の行が「現在使っているプリンタ」
の既定プロファイルになる。versioning(履歴管理)は不要な単純な数値設定なので、
sender/sender_detailsのような分離はせずprinter_profilesテーブル1つで完結する。
"""
import sqlite3

from flask import Blueprint, abort, jsonify, render_template, request

from helpers import get_db

printer_profiles_bp = Blueprint('printer_profiles', __name__)

PROFILE_FIELDS = ['name', 'scale_x', 'scale_y', 'offset_x_mm', 'offset_y_mm', 'memo']
_NUMERIC_FIELDS = ('scale_x', 'scale_y', 'offset_x_mm', 'offset_y_mm')


def resolve_printer_profile(db, requested_id=None):
    """printer_adjust.applyへそのまま渡せる補正値の辞書、またはNone(調整なし)を返す。

    requested_id指定時はその行を優先する（見つからなければNoneではなくデフォルトへ
    フォールバック——存在しないIDが古いブックマーク等から送られてきても印字自体は
    継続できるようにするため）。requested_id未指定、またはフォールバック先も無い
    場合はis_default=1の行、それも無ければNone（=調整なし）。
    """
    row = None
    if requested_id:
        row = db.execute('SELECT * FROM printer_profiles WHERE id=?', (requested_id,)).fetchone()
    if row is None:
        row = db.execute('SELECT * FROM printer_profiles WHERE is_default=1').fetchone()
    if row is None:
        return None
    return {field: row[field] for field in _NUMERIC_FIELDS}


def _parse_profile_payload(data):
    name = (data.get('name') or '').strip()
    if not name:
        return None, ('プロファイル名は必須です', 400)
    values = {}
    for field in _NUMERIC_FIELDS:
        raw = data.get(field)
        try:
            values[field] = float(raw) if raw not in (None, '') else (1.0 if 'scale' in field else 0.0)
        except (TypeError, ValueError):
            return None, (f'{field}は数値で入力してください', 400)
    values['name'] = name
    values['memo'] = (data.get('memo') or '').strip() or None
    return values, None


@printer_profiles_bp.get('/printer_profiles')
def printer_profiles_page():
    return render_template('printer_profiles.html')


@printer_profiles_bp.get('/api/printer_profiles')
def api_printer_profiles_list():
    db = get_db()
    rows = db.execute('SELECT * FROM printer_profiles ORDER BY is_default DESC, name').fetchall()
    return jsonify([dict(r) for r in rows])


@printer_profiles_bp.post('/api/printer_profiles')
def api_printer_profiles_create():
    data = request.json or {}
    values, error = _parse_profile_payload(data)
    if error:
        return jsonify({'error': error[0]}), error[1]
    db = get_db()
    make_default = bool(data.get('is_default'))
    # 最初の1件は自動的にデフォルト扱いにする（未設定のままだと調整なしのまま気づきにくいため）。
    if db.execute('SELECT COUNT(*) AS n FROM printer_profiles').fetchone()['n'] == 0:
        make_default = True
    if make_default:
        db.execute('UPDATE printer_profiles SET is_default=0')
    db.execute(
        'INSERT INTO printer_profiles (name, scale_x, scale_y, offset_x_mm, offset_y_mm, memo, is_default) '
        'VALUES (:name, :scale_x, :scale_y, :offset_x_mm, :offset_y_mm, :memo, :is_default)',
        {**values, 'is_default': 1 if make_default else 0},
    )
    db.commit()
    row = db.execute('SELECT * FROM printer_profiles WHERE id=last_insert_rowid()').fetchone()
    return jsonify(dict(row))


@printer_profiles_bp.put('/api/printer_profiles/<int:profile_id>')
def api_printer_profiles_update(profile_id):
    db = get_db()
    if db.execute('SELECT 1 FROM printer_profiles WHERE id=?', (profile_id,)).fetchone() is None:
        abort(404)
    data = request.json or {}
    values, error = _parse_profile_payload(data)
    if error:
        return jsonify({'error': error[0]}), error[1]
    try:
        db.execute(
            'UPDATE printer_profiles SET name=:name, scale_x=:scale_x, scale_y=:scale_y, '
            "offset_x_mm=:offset_x_mm, offset_y_mm=:offset_y_mm, memo=:memo, updated_at=datetime('now') "
            'WHERE id=:id',
            {**values, 'id': profile_id},
        )
        db.commit()
    except sqlite3.IntegrityError as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    row = db.execute('SELECT * FROM printer_profiles WHERE id=?', (profile_id,)).fetchone()
    return jsonify(dict(row))


@printer_profiles_bp.delete('/api/printer_profiles/<int:profile_id>')
def api_printer_profiles_delete(profile_id):
    db = get_db()
    if db.execute('SELECT 1 FROM printer_profiles WHERE id=?', (profile_id,)).fetchone() is None:
        abort(404)
    db.execute('DELETE FROM printer_profiles WHERE id=?', (profile_id,))
    db.commit()
    return jsonify({'ok': True})


@printer_profiles_bp.post('/api/printer_profiles/<int:profile_id>/default')
def api_printer_profiles_set_default(profile_id):
    db = get_db()
    if db.execute('SELECT 1 FROM printer_profiles WHERE id=?', (profile_id,)).fetchone() is None:
        abort(404)
    db.execute('UPDATE printer_profiles SET is_default=0')
    db.execute('UPDATE printer_profiles SET is_default=1 WHERE id=?', (profile_id,))
    db.commit()
    row = db.execute('SELECT * FROM printer_profiles WHERE id=?', (profile_id,)).fetchone()
    return jsonify(dict(row))
