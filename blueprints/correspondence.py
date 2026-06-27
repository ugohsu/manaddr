# -*- coding: utf-8 -*-
import io

from flask import Blueprint, abort, jsonify, render_template, request, send_file

from helpers import get_db

try:
    from PIL import Image
    _HAS_PILLOW = True
except ImportError:
    _HAS_PILLOW = False

correspondence_bp = Blueprint('correspondence', __name__)

_MAX_IMAGE_PX = 800
_JPEG_QUALITY = 40


def _compress_image(file_obj) -> bytes:
    if not _HAS_PILLOW:
        return file_obj.read()
    img = Image.open(file_obj).convert('RGB')
    img.thumbnail((_MAX_IMAGE_PX, _MAX_IMAGE_PX))
    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=_JPEG_QUALITY)
    return buf.getvalue()


def _get_person_or_404(db, person_id):
    row = db.execute('SELECT id FROM people WHERE id=?', (person_id,)).fetchone()
    if row is None:
        abort(404)


def _entry_labels(db, entry_id):
    rows = db.execute('''
        SELECT cl.id, cl.name
        FROM correspondence_labels cl
        JOIN correspondence_entry_labels cel ON cel.label_id = cl.id
        WHERE cel.entry_id = ?
        ORDER BY cl.name
    ''', (entry_id,)).fetchall()
    return [dict(r) for r in rows]


def _entry_to_dict(e, labels=None):
    return {
        'id': e['id'],
        'person_id': e['person_id'],
        'direction': e['direction'],
        'entry_type': e['entry_type'],
        'body': e['body'],
        'has_image': e['image_data'] is not None,
        'memo': e['memo'],
        'recorded_at': e['recorded_at'],
        'labels': labels or [],
    }


# ---------- ページ ----------

@correspondence_bp.get('/people/<int:person_id>/correspondence')
def correspondence_page(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    cpd = db.execute(
        'SELECT last_name, first_name FROM current_person_details WHERE person_id=?', (person_id,)
    ).fetchone()
    name = f"{cpd['last_name'] or ''} {cpd['first_name'] or ''}".strip() if cpd else '(氏名未登録)'
    return render_template('correspondence.html', person_id=person_id, person_name=name)


@correspondence_bp.get('/correspondence/labels')
def correspondence_labels_page():
    return render_template('correspondence_labels.html')


# ---------- API: エントリ ----------

@correspondence_bp.get('/api/people/<int:person_id>/correspondence')
def api_correspondence_list(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    rows = db.execute(
        'SELECT * FROM correspondence_entries WHERE person_id=? ORDER BY recorded_at ASC, id ASC',
        (person_id,)
    ).fetchall()
    return jsonify([_entry_to_dict(e, _entry_labels(db, e['id'])) for e in rows])


@correspondence_bp.post('/api/people/<int:person_id>/correspondence')
def api_correspondence_create(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)

    direction = request.form.get('direction', '').strip()
    if direction not in ('sent', 'received'):
        return jsonify({'error': 'direction は sent か received を指定してください'}), 400

    entry_type = request.form.get('entry_type', '').strip()
    if entry_type not in ('text', 'image'):
        return jsonify({'error': 'entry_type は text か image を指定してください'}), 400

    memo = request.form.get('memo', '').strip() or None
    body = None
    image_data = None

    if entry_type == 'text':
        body = request.form.get('body', '').strip()
        if not body:
            return jsonify({'error': 'テキストエントリには本文が必要です'}), 400
    else:
        file = request.files.get('image')
        if not file or not file.filename:
            return jsonify({'error': '画像ファイルを指定してください'}), 400
        try:
            image_data = _compress_image(file)
        except Exception as ex:
            return jsonify({'error': f'画像の処理に失敗しました: {ex}'}), 400

    cur = db.execute(
        '''INSERT INTO correspondence_entries
           (person_id, direction, entry_type, body, image_data, memo)
           VALUES (?, ?, ?, ?, ?, ?)''',
        (person_id, direction, entry_type, body, image_data, memo),
    )
    entry_id = cur.lastrowid

    label_ids_raw = request.form.get('label_ids', '').strip()
    if label_ids_raw:
        for raw in label_ids_raw.split(','):
            try:
                db.execute(
                    'INSERT OR IGNORE INTO correspondence_entry_labels (entry_id, label_id) VALUES (?, ?)',
                    (entry_id, int(raw.strip())),
                )
            except ValueError:
                pass

    db.commit()
    entry = db.execute('SELECT * FROM correspondence_entries WHERE id=?', (entry_id,)).fetchone()
    return jsonify(_entry_to_dict(entry, _entry_labels(db, entry_id))), 201


@correspondence_bp.delete('/api/correspondence/entries/<int:entry_id>')
def api_correspondence_delete(entry_id):
    db = get_db()
    if not db.execute('SELECT id FROM correspondence_entries WHERE id=?', (entry_id,)).fetchone():
        abort(404)
    db.execute('DELETE FROM correspondence_entry_labels WHERE entry_id=?', (entry_id,))
    db.execute('DELETE FROM correspondence_entries WHERE id=?', (entry_id,))
    db.commit()
    return '', 204


@correspondence_bp.get('/api/correspondence/entries/<int:entry_id>/image')
def api_correspondence_image(entry_id):
    db = get_db()
    row = db.execute(
        'SELECT image_data, image_mime FROM correspondence_entries WHERE id=? AND entry_type=?',
        (entry_id, 'image'),
    ).fetchone()
    if row is None or row['image_data'] is None:
        abort(404)
    return send_file(io.BytesIO(row['image_data']), mimetype=row['image_mime'])


@correspondence_bp.put('/api/correspondence/entries/<int:entry_id>/labels')
def api_entry_labels_set(entry_id):
    db = get_db()
    if not db.execute('SELECT id FROM correspondence_entries WHERE id=?', (entry_id,)).fetchone():
        abort(404)
    data = request.json or {}
    label_ids = data.get('label_ids', [])
    db.execute('DELETE FROM correspondence_entry_labels WHERE entry_id=?', (entry_id,))
    for lid in label_ids:
        db.execute(
            'INSERT OR IGNORE INTO correspondence_entry_labels (entry_id, label_id) VALUES (?, ?)',
            (entry_id, lid),
        )
    db.commit()
    return jsonify(_entry_labels(db, entry_id))


# ---------- API: ラベル ----------

@correspondence_bp.get('/api/correspondence/labels')
def api_labels_list():
    db = get_db()
    rows = db.execute('''
        SELECT cl.id, cl.name, COUNT(cel.entry_id) AS entry_count
        FROM correspondence_labels cl
        LEFT JOIN correspondence_entry_labels cel ON cel.label_id = cl.id
        GROUP BY cl.id
        ORDER BY cl.name
    ''').fetchall()
    return jsonify([dict(r) for r in rows])


@correspondence_bp.post('/api/correspondence/labels')
def api_labels_create():
    db = get_db()
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'ラベル名は必須です'}), 400
    try:
        cur = db.execute('INSERT INTO correspondence_labels (name) VALUES (?)', (name,))
        db.commit()
        return jsonify({'id': cur.lastrowid, 'name': name, 'entry_count': 0}), 201
    except Exception:
        return jsonify({'error': '同名のラベルが既に存在します'}), 409


@correspondence_bp.put('/api/correspondence/labels/<int:label_id>')
def api_labels_rename(label_id):
    db = get_db()
    if not db.execute('SELECT id FROM correspondence_labels WHERE id=?', (label_id,)).fetchone():
        abort(404)
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'ラベル名は必須です'}), 400
    try:
        db.execute('UPDATE correspondence_labels SET name=? WHERE id=?', (name, label_id))
        db.commit()
        row = db.execute('''
            SELECT cl.id, cl.name, COUNT(cel.entry_id) AS entry_count
            FROM correspondence_labels cl
            LEFT JOIN correspondence_entry_labels cel ON cel.label_id = cl.id
            WHERE cl.id = ?
            GROUP BY cl.id
        ''', (label_id,)).fetchone()
        return jsonify(dict(row))
    except Exception:
        return jsonify({'error': '同名のラベルが既に存在します'}), 409


@correspondence_bp.delete('/api/correspondence/labels/<int:label_id>')
def api_labels_delete(label_id):
    db = get_db()
    if not db.execute('SELECT id FROM correspondence_labels WHERE id=?', (label_id,)).fetchone():
        abort(404)
    db.execute('DELETE FROM correspondence_entry_labels WHERE label_id=?', (label_id,))
    db.execute('DELETE FROM correspondence_labels WHERE id=?', (label_id,))
    db.commit()
    return '', 204


@correspondence_bp.get('/api/correspondence/by-label/<label_name>')
def api_entries_by_label(label_name):
    db = get_db()
    rows = db.execute('''
        SELECT ce.id, ce.person_id, ce.direction, ce.entry_type, ce.body,
               ce.image_data, ce.memo, ce.recorded_at,
               cpd.last_name, cpd.first_name
        FROM correspondence_entries ce
        JOIN current_person_details cpd ON cpd.person_id = ce.person_id
        JOIN correspondence_entry_labels cel ON cel.entry_id = ce.id
        JOIN correspondence_labels cl ON cl.id = cel.label_id
        WHERE cl.name = ?
        ORDER BY ce.recorded_at ASC, ce.id ASC
    ''', (label_name,)).fetchall()
    result = []
    for e in rows:
        result.append({
            'id': e['id'],
            'person_id': e['person_id'],
            'person_name': f"{e['last_name'] or ''} {e['first_name'] or ''}".strip(),
            'direction': e['direction'],
            'entry_type': e['entry_type'],
            'body': e['body'],
            'has_image': e['image_data'] is not None,
            'memo': e['memo'],
            'recorded_at': e['recorded_at'],
            'labels': _entry_labels(db, e['id']),
        })
    return jsonify(result)
