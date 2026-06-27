# -*- coding: utf-8 -*-
import sqlite3

from flask import Blueprint, abort, jsonify, render_template, request

from helpers import get_db, kana_like_patterns, like_any, normalize_zip

people_bp = Blueprint('people', __name__)

STATUSES = ('active', 'suspended', 'declined', 'deceased')

PERSON_DETAILS_FIELDS = [
    'last_name', 'first_name', 'last_name_kana', 'first_name_kana', 'honorific',
    'birthday', 'gender', 'memo', 'company_name', 'company_kana',
    'department1', 'department2', 'position', 'customer_code', 'status',
]
ADDRESS_FIELDS = ['classification', 'priority', 'zip', 'prefecture', 'city', 'block', 'building', 'nearest_station']
CONTACT_FIELDS = ['classification', 'value']
COMPANION_FIELDS = [
    'sort_order', 'last_name', 'first_name', 'last_name_kana', 'first_name_kana',
    'honorific', 'birthday', 'gender',
]

# priority最優先 → (priority未設定なら) classification=自宅優先 → どちらも無ければ任意
PRIMARY_ADDRESS_ORDER_BY = "(priority IS NULL) ASC, priority ASC, (classification != '自宅') ASC"


def _insert_versioned(db, table, person_id, fields, data, is_deleted=False):
    if 'zip' in fields:
        data = dict(data)
        data['zip'] = normalize_zip(data.get('zip'))
    columns = ['person_id'] + fields + ['is_deleted']
    values = [person_id] + [data.get(f) for f in fields] + [1 if is_deleted else 0]
    cur = db.execute(
        f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
        values,
    )
    db.commit()
    return cur.lastrowid


def _get_person_or_404(db, person_id):
    row = db.execute('SELECT * FROM people WHERE id=?', (person_id,)).fetchone()
    if row is None:
        abort(404)
    return row


def _delete_person(db, person_id):
    for table in ('person_details', 'addresses', 'phones', 'emails', 'urls', 'companions', 'person_tags',
                  'person_sender_overrides', 'person_postcard_settings', 'correspondence_entries'):
        db.execute(f'DELETE FROM {table} WHERE person_id=?', (person_id,))
    db.execute('DELETE FROM people WHERE id=?', (person_id,))


# ---------- ページ ----------

@people_bp.get('/people')
def people_list():
    return render_template('people_list.html', initial_person_id=None)


@people_bp.get('/people/new')
def people_new():
    return render_template('person_new.html')


@people_bp.get('/people/import')
def people_import():
    return render_template('people_import.html')


@people_bp.get('/tags')
def tags_manage():
    return render_template('tags_manage.html')


@people_bp.get('/people/<int:person_id>')
def person_detail(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    return render_template('people_list.html', initial_person_id=person_id)


# ---------- API: 一覧・新規作成 ----------

@people_bp.get('/api/people')
def api_people_list():
    db = get_db()
    q = request.args.get('q', '').strip()
    tag = request.args.get('tag', '').strip()
    status = request.args.get('status', '').strip()

    sql = '''
        SELECT p.id, cpd.last_name, cpd.first_name, cpd.last_name_kana, cpd.first_name_kana,
               cpd.honorific, cpd.status,
               (SELECT GROUP_CONCAT(t.name, '、') FROM person_tags pt
                JOIN tags t ON t.id = pt.tag_id WHERE pt.person_id = p.id) AS tags,
               (SELECT COALESCE(prefecture, '') || COALESCE(city, '') || COALESCE(block, '') FROM current_addresses ca
                WHERE ca.person_id = p.id
                ORDER BY ''' + PRIMARY_ADDRESS_ORDER_BY + '''
                LIMIT 1) AS address_summary,
               (SELECT classification FROM current_addresses ca
                WHERE ca.person_id = p.id
                ORDER BY ''' + PRIMARY_ADDRESS_ORDER_BY + '''
                LIMIT 1) AS address_classification
        FROM people p
        JOIN current_person_details cpd ON cpd.person_id = p.id
        WHERE 1=1
    '''
    params = []
    if q:
        likes = kana_like_patterns(q)
        name_c, name_p = like_any("COALESCE(cpd.last_name,'') || COALESCE(cpd.first_name,'')", likes)
        kana_c, kana_p = like_any("COALESCE(cpd.last_name_kana,'') || COALESCE(cpd.first_name_kana,'')", likes)
        comp_c, comp_p = like_any('cpd.company_name', likes)
        cn_c, cn_p = like_any("COALESCE(cc.last_name,'') || COALESCE(cc.first_name,'')", likes)
        ck_c, ck_p = like_any("COALESCE(cc.last_name_kana,'') || COALESCE(cc.first_name_kana,'')", likes)
        sql += f'''
            AND ({name_c}
                 OR {kana_c}
                 OR {comp_c}
                 OR p.id IN (
                     SELECT cc.person_id FROM current_companions cc
                     WHERE {cn_c}
                        OR {ck_c}
                 ))
        '''
        params += name_p + kana_p + comp_p + cn_p + ck_p
    if status:
        sql += ' AND cpd.status = ?'
        params.append(status)
    if tag:
        sql += '''
            AND p.id IN (
                SELECT pt.person_id FROM person_tags pt
                JOIN tags t ON t.id = pt.tag_id WHERE t.name = ?
            )
        '''
        params.append(tag)
    sql += ' ORDER BY cpd.last_name_kana, cpd.first_name_kana, cpd.last_name'

    rows = db.execute(sql, params).fetchall()
    return jsonify([dict(r) for r in rows])


@people_bp.post('/api/people')
def api_people_create():
    data = request.json or {}
    last_name = (data.get('last_name') or '').strip()
    first_name = (data.get('first_name') or '').strip()
    if not last_name and not first_name:
        return jsonify({'error': '姓または名は必須です'}), 400

    details = dict(data)
    details['status'] = details.get('status') or 'active'
    if details['status'] not in STATUSES:
        return jsonify({'error': 'status が不正です'}), 400

    db = get_db()
    try:
        cur = db.execute('INSERT INTO people DEFAULT VALUES')
        person_id = cur.lastrowid
        _insert_versioned(db, 'person_details', person_id, PERSON_DETAILS_FIELDS, details)

        address = data.get('address') or {}
        if any(address.get(f) for f in ADDRESS_FIELDS if f not in ('classification', 'priority')):
            address = dict(address)
            address['classification'] = address.get('classification') or '自宅'
            _insert_versioned(db, 'addresses', person_id, ADDRESS_FIELDS, address)
    except sqlite3.IntegrityError as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400

    return jsonify({'id': person_id})


# ---------- API: 詳細 ----------

@people_bp.get('/api/people/<int:person_id>')
def api_person_detail(person_id):
    db = get_db()
    person = _get_person_or_404(db, person_id)

    current_details = db.execute(
        'SELECT * FROM current_person_details WHERE person_id=?', (person_id,)
    ).fetchone()
    details_history = db.execute(
        'SELECT * FROM person_details WHERE person_id=? ORDER BY recorded_at DESC, id DESC',
        (person_id,)
    ).fetchall()

    current_addresses = db.execute(
        'SELECT * FROM current_addresses WHERE person_id=? ORDER BY ' + PRIMARY_ADDRESS_ORDER_BY,
        (person_id,)
    ).fetchall()
    addresses_history = db.execute(
        'SELECT * FROM addresses WHERE person_id=? ORDER BY classification, recorded_at DESC, id DESC',
        (person_id,)
    ).fetchall()

    def current_and_history(view, table):
        current = db.execute(
            f'SELECT * FROM {view} WHERE person_id=? ORDER BY classification', (person_id,)
        ).fetchall()
        history = db.execute(
            f'SELECT * FROM {table} WHERE person_id=? ORDER BY classification, recorded_at DESC, id DESC',
            (person_id,)
        ).fetchall()
        return current, history

    phones_current, phones_history = current_and_history('current_phones', 'phones')
    emails_current, emails_history = current_and_history('current_emails', 'emails')
    urls_current, urls_history = current_and_history('current_urls', 'urls')

    companions_current = db.execute(
        'SELECT * FROM current_companions WHERE person_id=? ORDER BY sort_order', (person_id,)
    ).fetchall()
    companions_history = db.execute(
        'SELECT * FROM companions WHERE person_id=? ORDER BY sort_order, recorded_at DESC, id DESC',
        (person_id,)
    ).fetchall()

    tags = db.execute(
        'SELECT t.id, t.name FROM person_tags pt JOIN tags t ON t.id = pt.tag_id '
        'WHERE pt.person_id=? ORDER BY t.name',
        (person_id,)
    ).fetchall()

    return jsonify({
        'person': dict(person),
        'details': {
            'current': dict(current_details) if current_details else None,
            'history': [dict(r) for r in details_history],
        },
        'addresses': {
            'current': [dict(r) for r in current_addresses],
            'history': [dict(r) for r in addresses_history],
        },
        'phones': {
            'current': [dict(r) for r in phones_current],
            'history': [dict(r) for r in phones_history],
        },
        'emails': {
            'current': [dict(r) for r in emails_current],
            'history': [dict(r) for r in emails_history],
        },
        'urls': {
            'current': [dict(r) for r in urls_current],
            'history': [dict(r) for r in urls_history],
        },
        'companions': {
            'current': [dict(r) for r in companions_current],
            'history': [dict(r) for r in companions_history],
        },
        'tags': [dict(r) for r in tags],
    })


@people_bp.delete('/api/people/<int:person_id>')
def api_person_delete(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    try:
        _delete_person(db, person_id)
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        return jsonify({'error': 'この人物は送付履歴で使用されているため削除できません'}), 400
    return jsonify({'ok': True})


# ---------- API: versioned 更新（常にINSERT、削除はトンブストーン） ----------

@people_bp.post('/api/people/<int:person_id>/details')
def api_person_details_update(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    data = request.json or {}
    data = dict(data)
    data['status'] = data.get('status') or 'active'
    if data['status'] not in STATUSES:
        return jsonify({'error': 'status が不正です'}), 400
    new_id = _insert_versioned(db, 'person_details', person_id, PERSON_DETAILS_FIELDS, data)
    row = db.execute('SELECT * FROM person_details WHERE id=?', (new_id,)).fetchone()
    return jsonify(dict(row))


def _versioned_subresource_endpoint(table, fields, default_classification=None):
    def handler(person_id):
        db = get_db()
        _get_person_or_404(db, person_id)
        data = request.json or {}
        data = dict(data)
        if default_classification is not None:
            data['classification'] = data.get('classification') or default_classification
        is_deleted = bool(data.get('is_deleted'))
        new_id = _insert_versioned(db, table, person_id, fields, data, is_deleted=is_deleted)
        row = db.execute(f'SELECT * FROM {table} WHERE id=?', (new_id,)).fetchone()
        return jsonify(dict(row))
    return handler


people_bp.add_url_rule(
    '/api/people/<int:person_id>/addresses', endpoint='api_addresses_update', methods=['POST'],
    view_func=_versioned_subresource_endpoint('addresses', ADDRESS_FIELDS, default_classification='自宅'),
)
people_bp.add_url_rule(
    '/api/people/<int:person_id>/phones', endpoint='api_phones_update', methods=['POST'],
    view_func=_versioned_subresource_endpoint('phones', CONTACT_FIELDS),
)
people_bp.add_url_rule(
    '/api/people/<int:person_id>/emails', endpoint='api_emails_update', methods=['POST'],
    view_func=_versioned_subresource_endpoint('emails', CONTACT_FIELDS),
)
people_bp.add_url_rule(
    '/api/people/<int:person_id>/urls', endpoint='api_urls_update', methods=['POST'],
    view_func=_versioned_subresource_endpoint('urls', CONTACT_FIELDS),
)


def _delete_versioned_row_endpoint(table):
    def handler(person_id, row_id):
        db = get_db()
        _get_person_or_404(db, person_id)
        try:
            cur = db.execute(f'DELETE FROM {table} WHERE id=? AND person_id=?', (row_id, person_id))
            db.commit()
        except sqlite3.IntegrityError:
            db.rollback()
            return jsonify({'error': 'このバージョンは送付履歴で使用されているため削除できません'}), 400
        if cur.rowcount == 0:
            abort(404)
        return jsonify({'ok': True})
    return handler


for _segment, _table in [
    ('details', 'person_details'), ('addresses', 'addresses'), ('phones', 'phones'),
    ('emails', 'emails'), ('urls', 'urls'), ('companions', 'companions'),
]:
    people_bp.add_url_rule(
        f'/api/people/<int:person_id>/{_segment}/<int:row_id>',
        endpoint=f'api_{_segment}_delete', methods=['DELETE'],
        view_func=_delete_versioned_row_endpoint(_table),
    )


@people_bp.post('/api/people/<int:person_id>/companions')
def api_companions_update(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    data = request.json or {}
    data = dict(data)
    if data.get('sort_order') is None:
        next_order = db.execute(
            'SELECT COALESCE(MAX(sort_order), 0) + 1 FROM companions WHERE person_id=?', (person_id,)
        ).fetchone()[0]
        data['sort_order'] = next_order
    is_deleted = bool(data.get('is_deleted'))
    new_id = _insert_versioned(db, 'companions', person_id, COMPANION_FIELDS, data, is_deleted=is_deleted)
    row = db.execute('SELECT * FROM companions WHERE id=?', (new_id,)).fetchone()
    return jsonify(dict(row))


# ---------- API: 一括操作 ----------

@people_bp.post('/api/people/bulk/status')
def api_people_bulk_status():
    data = request.json or {}
    person_ids = data.get('person_ids') or []
    status = data.get('status')
    if status not in STATUSES:
        return jsonify({'error': 'status が不正です'}), 400
    if not person_ids:
        return jsonify({'error': '対象が指定されていません'}), 400

    db = get_db()
    updated = 0
    for person_id in person_ids:
        current = db.execute(
            'SELECT * FROM current_person_details WHERE person_id=?', (person_id,)
        ).fetchone()
        if current is None:
            continue
        details = dict(current)
        details['status'] = status
        _insert_versioned(db, 'person_details', person_id, PERSON_DETAILS_FIELDS, details)
        updated += 1
    return jsonify({'updated': updated})


@people_bp.post('/api/people/bulk/tags')
def api_people_bulk_tags_add():
    data = request.json or {}
    person_ids = data.get('person_ids') or []
    tag_id = data.get('tag_id')
    if not person_ids or not tag_id:
        return jsonify({'error': '対象またはタグが指定されていません'}), 400

    db = get_db()
    try:
        for person_id in person_ids:
            db.execute(
                'INSERT OR IGNORE INTO person_tags (person_id, tag_id) VALUES (?, ?)',
                (person_id, int(tag_id)),
            )
        db.commit()
    except (sqlite3.IntegrityError, ValueError, TypeError) as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    return jsonify({'ok': True})


@people_bp.post('/api/people/bulk/tags/remove')
def api_people_bulk_tags_remove():
    data = request.json or {}
    person_ids = data.get('person_ids') or []
    tag_id = data.get('tag_id')
    if not person_ids or not tag_id:
        return jsonify({'error': '対象またはタグが指定されていません'}), 400

    db = get_db()
    try:
        placeholders = ','.join('?' for _ in person_ids)
        db.execute(
            f'DELETE FROM person_tags WHERE tag_id=? AND person_id IN ({placeholders})',
            [int(tag_id)] + [int(pid) for pid in person_ids],
        )
        db.commit()
    except (ValueError, TypeError) as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    return jsonify({'ok': True})


# ---------- API: バッチインポート（年賀状住所からの更新提案） ----------

def _score_candidate(hint, person):
    last_name = hint.get('last_name')
    first_name = hint.get('first_name')
    last_name_kana = hint.get('last_name_kana')
    first_name_kana = hint.get('first_name_kana')
    score = 0.0
    if (last_name_kana and first_name_kana
            and person['last_name_kana'] == last_name_kana and person['first_name_kana'] == first_name_kana):
        score = max(score, 1.0)
    if last_name and first_name and person['last_name'] == last_name and person['first_name'] == first_name:
        score = max(score, 1.0)
    # 改姓等で姓が変わっている可能性を考慮し、名（＋カナ）の一致だけでも弱い候補として残す
    if first_name_kana and person['first_name_kana'] == first_name_kana:
        score = max(score, 0.6)
    if first_name and person['first_name'] == first_name:
        score = max(score, 0.5)
    return score


def _match_candidates(db, match_hint):
    if not match_hint:
        return []
    rows = db.execute('SELECT * FROM current_person_details').fetchall()
    scored = []
    for row in rows:
        score = _score_candidate(match_hint, row)
        if score > 0:
            scored.append({
                'person_id': row['person_id'],
                'last_name': row['last_name'], 'first_name': row['first_name'],
                'last_name_kana': row['last_name_kana'], 'first_name_kana': row['first_name_kana'],
                'score': round(score, 2),
            })
    scored.sort(key=lambda c: c['score'], reverse=True)
    return scored[:5]


def _best_match(candidates):
    if not candidates:
        return None
    top = candidates[0]
    if top['score'] < 0.9:
        return None
    # 2位が僅差なら自動確定せず、ユーザーに選んでもらう
    if len(candidates) > 1 and candidates[1]['score'] >= top['score'] - 0.05:
        return None
    return top


def _address_no_change(db, person_id, classification, proposed):
    current = db.execute(
        'SELECT * FROM current_addresses WHERE person_id=? AND classification=?',
        (person_id, classification)
    ).fetchone()
    if current is None:
        return False
    if (current['zip'] or None) != (normalize_zip(proposed.get('zip')) or None):
        return False
    for f in ('prefecture', 'city', 'block', 'building'):
        if (current[f] or None) != (proposed.get(f) or None):
            return False
    return True


def _name_no_change(current_details, name_update):
    if not name_update:
        return True
    for f in ('last_name', 'first_name', 'last_name_kana', 'first_name_kana', 'honorific'):
        if name_update.get(f) and name_update.get(f) != current_details[f]:
            return False
    return True


def _companions_no_change(db, person_id, proposed_companions):
    if not proposed_companions:
        return True
    current = db.execute(
        'SELECT last_name, first_name FROM current_companions WHERE person_id=?', (person_id,)
    ).fetchall()
    current_set = {(r['last_name'], r['first_name']) for r in current}
    for comp in proposed_companions:
        if (comp.get('last_name'), comp.get('first_name')) not in current_set:
            return False
    return True


@people_bp.post('/api/import/preview')
def api_import_preview():
    data = request.json or {}
    updates = data.get('address_updates')
    if not isinstance(updates, list):
        return jsonify({'error': 'address_updates は配列である必要があります'}), 400

    db = get_db()
    rows = []
    for i, u in enumerate(updates):
        errors = []
        if not u.get('zip'):
            errors.append('zip は必須です')
        match_hint = u.get('match_hint') or {}
        person_id = u.get('person_id')
        if not person_id and not match_hint:
            errors.append('person_id または match_hint のいずれかが必要です')
        if u.get('companions') is not None and not isinstance(u.get('companions'), list):
            errors.append('companions は配列である必要があります')

        candidates = []
        current_details = None
        if person_id:
            current_details = db.execute(
                'SELECT * FROM current_person_details WHERE person_id=?', (person_id,)
            ).fetchone()
            if current_details is None:
                errors.append(f'person_id {person_id} が見つかりません')

        best = {'person_id': person_id, 'score': 1.0} if person_id and current_details else None
        if not person_id and match_hint:
            candidates = _match_candidates(db, match_hint)
            best = _best_match(candidates)
            if best:
                current_details = db.execute(
                    'SELECT * FROM current_person_details WHERE person_id=?', (best['person_id'],)
                ).fetchone()

        classification = u.get('classification') or '自宅'
        no_change = False
        if best and current_details and len(errors) == 0:
            no_change = (_address_no_change(db, best['person_id'], classification, u)
                         and _name_no_change(current_details, u.get('name_update'))
                         and _companions_no_change(db, best['person_id'], u.get('companions')))

        default_checked = bool(best) and len(errors) == 0 and not no_change

        rows.append({
            'index': i,
            'input': u,
            'candidates': candidates,
            'best_match': best,
            'current': dict(current_details) if current_details else None,
            'no_change': no_change,
            'errors': errors,
            'valid': len(errors) == 0,
            'default_checked': default_checked,
        })
    return jsonify({'rows': rows})


def _insert_companions(db, person_id, companions):
    # 既存の連名は消さず、新バージョン行として追加するのみ（sort_orderは既存の続きから割り振る）
    if not companions:
        return
    next_order = db.execute(
        'SELECT COALESCE(MAX(sort_order), 0) FROM companions WHERE person_id=?', (person_id,)
    ).fetchone()[0]
    for i, comp in enumerate(companions):
        comp_data = dict(comp)
        comp_data['sort_order'] = comp.get('sort_order') or (next_order + i + 1)
        _insert_versioned(db, 'companions', person_id, COMPANION_FIELDS, comp_data)


@people_bp.post('/api/import/commit')
def api_import_commit():
    data = request.json or {}
    items = data.get('items')
    if not isinstance(items, list) or not items:
        return jsonify({'error': '対象が指定されていません'}), 400

    db = get_db()
    created = updated = 0
    try:
        for item in items:
            action = item.get('action')
            address_fields = {f: item.get(f) for f in ADDRESS_FIELDS}
            address_fields['classification'] = item.get('classification') or '自宅'
            has_address = any(item.get(f) for f in ('zip', 'prefecture', 'city', 'block', 'building'))

            if action == 'create':
                cur = db.execute('INSERT INTO people DEFAULT VALUES')
                new_person_id = cur.lastrowid
                details = {f: item.get(f) for f in PERSON_DETAILS_FIELDS}
                details['status'] = details.get('status') or 'active'
                _insert_versioned(db, 'person_details', new_person_id, PERSON_DETAILS_FIELDS, details)
                if has_address:
                    _insert_versioned(db, 'addresses', new_person_id, ADDRESS_FIELDS, address_fields)
                _insert_companions(db, new_person_id, item.get('companions'))
                created += 1
            elif action == 'update':
                person_id = item.get('person_id')
                if not person_id:
                    return jsonify({'error': '更新対象の person_id がありません'}), 400
                name_update = item.get('name_update')
                if name_update:
                    current = db.execute(
                        'SELECT * FROM current_person_details WHERE person_id=?', (person_id,)
                    ).fetchone()
                    if current is None:
                        return jsonify({'error': f'person_id {person_id} が見つかりません'}), 400
                    details = dict(current)
                    details.update({k: v for k, v in name_update.items() if v})
                    _insert_versioned(db, 'person_details', person_id, PERSON_DETAILS_FIELDS, details)
                if has_address:
                    _insert_versioned(db, 'addresses', person_id, ADDRESS_FIELDS, address_fields)
                _insert_companions(db, person_id, item.get('companions'))
                updated += 1
            else:
                return jsonify({'error': f'不明な action: {action}'}), 400
    except sqlite3.IntegrityError as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400

    return jsonify({'ok': True, 'created': created, 'updated': updated})


# ---------- API: 宛名印字サイズ設定 ----------

@people_bp.get('/api/people/<int:person_id>/postcard_settings')
def api_postcard_settings_get(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    postcard_type = request.args.get('postcard_type', 'nengajo').strip() or 'nengajo'
    row = db.execute(
        'SELECT name_scale, address_scale FROM person_postcard_settings WHERE person_id=? AND postcard_type=?',
        (person_id, postcard_type)
    ).fetchone()
    if row is None:
        return jsonify({'postcard_type': postcard_type, 'name_scale': 1.0, 'address_scale': 1.0})
    return jsonify({'postcard_type': postcard_type, **dict(row)})


@people_bp.put('/api/people/<int:person_id>/postcard_settings')
def api_postcard_settings_set(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    data = request.json or {}
    postcard_type = (data.get('postcard_type') or 'nengajo').strip() or 'nengajo'
    try:
        name_scale = float(data.get('name_scale', 1.0))
        address_scale = float(data.get('address_scale', 1.0))
    except (TypeError, ValueError):
        return jsonify({'error': 'スケール値は数値である必要があります'}), 400
    name_scale = max(0.5, min(1.5, name_scale))
    address_scale = max(0.5, min(1.5, address_scale))
    db.execute('''
        INSERT INTO person_postcard_settings (person_id, postcard_type, name_scale, address_scale)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(person_id, postcard_type)
        DO UPDATE SET name_scale=excluded.name_scale, address_scale=excluded.address_scale
    ''', (person_id, postcard_type, name_scale, address_scale))
    db.commit()
    return jsonify({'postcard_type': postcard_type, 'name_scale': name_scale, 'address_scale': address_scale})


# ---------- API: タグ ----------

@people_bp.get('/api/tags')
def api_tags_list():
    db = get_db()
    rows = db.execute('''
        SELECT t.id, t.name, COUNT(pt.person_id) AS usage_count
        FROM tags t
        LEFT JOIN person_tags pt ON pt.tag_id = t.id
        GROUP BY t.id
        ORDER BY t.name
    ''').fetchall()
    return jsonify([dict(r) for r in rows])


@people_bp.post('/api/tags')
def api_tags_create():
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'タグ名は必須です'}), 400
    db = get_db()
    db.execute('INSERT OR IGNORE INTO tags (name) VALUES (?)', (name,))
    db.commit()
    row = db.execute('SELECT id, name FROM tags WHERE name=?', (name,)).fetchone()
    return jsonify(dict(row))


@people_bp.put('/api/tags/<int:tag_id>')
def api_tags_rename(tag_id):
    db = get_db()
    if db.execute('SELECT 1 FROM tags WHERE id=?', (tag_id,)).fetchone() is None:
        abort(404)
    data = request.json or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'タグ名は必須です'}), 400
    try:
        db.execute('UPDATE tags SET name=? WHERE id=?', (name, tag_id))
        db.commit()
    except sqlite3.IntegrityError as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    row = db.execute('SELECT id, name FROM tags WHERE id=?', (tag_id,)).fetchone()
    return jsonify(dict(row))


@people_bp.delete('/api/tags/<int:tag_id>')
def api_tags_delete(tag_id):
    db = get_db()
    if db.execute('SELECT 1 FROM tags WHERE id=?', (tag_id,)).fetchone() is None:
        abort(404)
    db.execute('DELETE FROM person_tags WHERE tag_id=?', (tag_id,))
    db.execute('DELETE FROM tags WHERE id=?', (tag_id,))
    db.commit()
    return jsonify({'ok': True})


@people_bp.put('/api/people/<int:person_id>/tags')
def api_person_tags_update(person_id):
    db = get_db()
    _get_person_or_404(db, person_id)
    data = request.json or {}
    tag_ids = data.get('tag_ids') or []
    try:
        db.execute('DELETE FROM person_tags WHERE person_id=?', (person_id,))
        for tag_id in tag_ids:
            db.execute(
                'INSERT INTO person_tags (person_id, tag_id) VALUES (?, ?)', (person_id, int(tag_id))
            )
        db.commit()
    except (sqlite3.IntegrityError, ValueError, TypeError) as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400
    return jsonify({'ok': True})
