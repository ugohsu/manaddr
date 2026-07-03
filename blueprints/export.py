# -*- coding: utf-8 -*-
import csv
import io
import json

from flask import Blueprint, abort, render_template, request, send_file

import postcard
import printer_adjust
from blueprints.people import PRIMARY_ADDRESS_ORDER_BY
from blueprints.printer_profiles import resolve_printer_profile
from blueprints.senders import get_sender_companions_map, resolve_sender_id_for_person
from helpers import get_db

export_bp = Blueprint('export', __name__)


def _address_to_lines(address_row):
    line1 = (address_row['prefecture'] or '') + (address_row['city'] or '') + (address_row['block'] or '')
    return line1, address_row['building'] or ''


def _build_sender(sender_row, companions):
    """差出人1件（連名込み）をpostcard.render_postcard_texに渡す`sender`辞書に変換する。"""
    line1, line2 = _address_to_lines(sender_row)
    names = [{
        'last_name': sender_row['last_name'], 'first_name': sender_row['first_name'],
        'company_name': sender_row['company_name'],
    }]
    names += [{'last_name': c['last_name'], 'first_name': c['first_name']} for c in companions]
    return {'zip': sender_row['zip'], 'address_line1': line1, 'address_line2': line2, 'names': names}


def _fetch_recipient_rows(db, person_id, classification=None):
    """person_idのdetails/現在の宛名印字用住所を取得する。人物が存在しなければ(None, None)、
    住所が無ければ(details, None)を返す。classification指定時はその送付先（自宅/勤務先など）
    を明示的に使う（バッチ作成画面での人物ごとの送付先選択用）。未指定時は従来通り
    PRIMARY_ADDRESS_ORDER_BYによる既定の住所を使う。"""
    details = db.execute('SELECT * FROM current_person_details WHERE person_id=?', (person_id,)).fetchone()
    if details is None:
        return None, None
    if classification:
        address = db.execute(
            'SELECT * FROM current_addresses WHERE person_id=? AND classification=?',
            (person_id, classification)
        ).fetchone()
    else:
        address = db.execute(
            'SELECT * FROM current_addresses WHERE person_id=? ORDER BY ' + PRIMARY_ADDRESS_ORDER_BY + ' LIMIT 1',
            (person_id,)
        ).fetchone()
    return details, address


def _get_postcard_settings(db, person_id, postcard_type='nengajo'):
    """人物・はがき種別ごとの宛名印字サイズ設定（name_scale/address_scale）を取得する。
    未設定の場合はデフォルト値（1.0）を返す。"""
    row = db.execute(
        'SELECT name_scale, address_scale FROM person_postcard_settings WHERE person_id=? AND postcard_type=?',
        (person_id, postcard_type)
    ).fetchone()
    return dict(row) if row else {'name_scale': 1.0, 'address_scale': 1.0}


def _build_recipient(db, person_id, details, address, companion_ids=None, postcard_settings=None):
    """companion_ids: None=全員(最大3件), []=なし, [id,...]=指定IDのみ(最大3件)
    postcard_settings: name_scale/address_scaleを含む辞書（Noneならデフォルト1.0）"""
    companions = []
    if companion_ids is None:
        companions = db.execute(
            'SELECT * FROM current_companions WHERE person_id=? ORDER BY sort_order LIMIT 3', (person_id,)
        ).fetchall()
    elif companion_ids:
        placeholders = ','.join('?' for _ in companion_ids)
        companions = db.execute(
            f'SELECT * FROM current_companions WHERE person_id=? AND id IN ({placeholders}) ORDER BY sort_order LIMIT 3',
            [person_id] + list(companion_ids),
        ).fetchall()
    address_line1, address_line2 = _address_to_lines(address)
    settings = postcard_settings or {}
    return {
        'zip': address['zip'],
        'address_line1': address_line1,
        'address_line2': address_line2,
        'last_name': details['last_name'],
        'first_name': details['first_name'],
        'honorific': details['honorific'],
        'companions': [
            {'last_name': c['last_name'], 'first_name': c['first_name'], 'honorific': c['honorific']}
            for c in companions
        ],
        'name_scale': float(settings.get('name_scale') or 1.0),
        'address_scale': float(settings.get('address_scale') or 1.0),
    }


def _build_sender_for_id(db, sender_id):
    """現在の差出人データで sender dict を構築する（ライブ印字用）。"""
    if sender_id is None:
        return None
    sender_row = db.execute('SELECT * FROM current_sender_details WHERE sender_id=?', (sender_id,)).fetchone()
    if sender_row is None:
        return None
    companions = get_sender_companions_map(db, [sender_id]).get(sender_id, [])
    return _build_sender(sender_row, companions)


def _build_sender_for_details_id(db, sender_details_id, companion_ids):
    """特定バージョンの差出人データで sender dict を構築する（履歴再タイプセット用）。"""
    if sender_details_id is None:
        return None
    sender_row = db.execute('SELECT * FROM sender_details WHERE id=?', (sender_details_id,)).fetchone()
    if sender_row is None:
        return None
    companions = []
    if companion_ids:
        placeholders = ','.join('?' * len(companion_ids))
        companions = db.execute(
            f'SELECT * FROM sender_companions WHERE id IN ({placeholders}) ORDER BY sort_order',
            companion_ids,
        ).fetchall()
    return _build_sender(sender_row, companions)


def _resolve_postcard_type():
    postcard_type = request.values.get('postcard_type', postcard.DEFAULT_POSTCARD_TYPE)
    if postcard_type not in postcard.POSTCARD_TYPE_LAYOUT_OVERRIDES:
        postcard_type = postcard.DEFAULT_POSTCARD_TYPE
    return postcard_type


def _resolve_requested_printer_profile_id():
    """リクエストで明示的に指定されたprinter_profile_idを解釈する。
    パラメータ自体が無ければNone（resolve_printer_profile側でis_default=1のプロファイルに
    フォールバックする）。UIの「調整なし」はこれと区別するため専用の文字列'none'として送られてくる
    ——'none'は「デフォルトへのフォールバックをせず常に無調整」を明示するシグナルであり、
    Noneとは異なる（空文字をNone相当として扱うと「調整なし」と「未指定」を区別できなくなるため）。"""
    if 'printer_profile_id' not in request.values:
        return None
    raw = request.values.get('printer_profile_id', '').strip()
    if raw == 'none':
        return 'none'
    return int(raw) if raw.isdigit() else None


def _apply_printer_adjustment(db, pdf_bytes, requested_profile_id=None):
    """生成済みPDFに、指定（無指定時はデフォルト）のプリンタ調整プロファイルを適用する。
    postcard.build_postcard_pdfの出力に対してのみ後から掛けるアダプタで、
    postcard.py側のLaTeXレイアウト計算には一切関与しない。
    requested_profile_id='none'（UIの「調整なし」明示指定）のときは、デフォルトへの
    フォールバックをせず常に無調整のまま返す。"""
    if requested_profile_id == 'none':
        return pdf_bytes
    profile = resolve_printer_profile(db, requested_profile_id)
    if profile is None:
        return pdf_bytes
    return printer_adjust.apply(pdf_bytes, **profile)


@export_bp.get('/export/postcard_preview/<int:person_id>')
def postcard_preview(person_id):
    db = get_db()
    # classification/include_companionsは宛名印字バッチ作成画面（右ペイン）での
    # 人物ごとの送付先選択・連名のON/OFFをプレビューにも反映するためのクエリパラメータ。
    # 未指定時は従来通りの既定動作（既定の住所、連名は含める）。
    classification = request.args.get('classification', '').strip() or None
    companion_ids_raw = request.args.get('companion_ids')
    if companion_ids_raw is None:
        companion_ids = None
    elif companion_ids_raw.strip() == '':
        companion_ids = []
    else:
        companion_ids = [int(x) for x in companion_ids_raw.split(',') if x.strip().isdigit()]
    details, address = _fetch_recipient_rows(db, person_id, classification=classification)
    if details is None:
        abort(404)
    if address is None:
        abort(400, '宛名印字に使える住所が登録されていません')
    postcard_type = _resolve_postcard_type()
    postcard_settings = _get_postcard_settings(db, person_id, postcard_type)
    recipient = _build_recipient(db, person_id, details, address, companion_ids=companion_ids,
                                 postcard_settings=postcard_settings)

    # sender_id クエリパラメータが明示されていればそれを優先（プレビュー画面での
    # 手動指定・動作確認用）。無ければ人物ごとの差出人上書き、それも無ければ
    # デフォルトに解決する（resolve_sender_id_for_person）。
    sender_id = request.args.get('sender_id', '').strip()
    sender_id = int(sender_id) if sender_id.isdigit() else resolve_sender_id_for_person(db, person_id)
    sender = _build_sender_for_id(db, sender_id)

    try:
        pdf_bytes = postcard.build_postcard_pdf([{'recipient': recipient, 'sender': sender}], postcard_type=postcard_type)
    except RuntimeError as e:
        abort(500, str(e))
    pdf_bytes = _apply_printer_adjustment(db, pdf_bytes, _resolve_requested_printer_profile_id())

    return send_file(
        io.BytesIO(pdf_bytes), mimetype='application/pdf',
        as_attachment=False, download_name='postcard_preview.pdf',
    )


@export_bp.get('/postcards')
def postcards_batch_page():
    return render_template('postcards_batch.html')


@export_bp.post('/export/postcards_batch')
def postcards_batch():
    db = get_db()
    person_ids = request.form.getlist('person_id', type=int)
    if not person_ids:
        abort(400, '対象の人物が選択されていません')
    postcard_type = _resolve_postcard_type()

    # overrides: 右ペインで人物ごとに選んだ送付先・連名ON/OFFを
    # {"<person_id>": {"classification": str|null, "include_companions": bool}, ...} の
    # JSON文字列で受け取る（バイナリ(PDF)レスポンスのためJSON本体ではなくform内の1フィールドとして送られてくる）。
    try:
        overrides = json.loads(request.form.get('overrides') or '{}')
    except ValueError:
        overrides = {}

    items = []
    skipped_ids = []
    for person_id in person_ids:
        override = overrides.get(str(person_id)) or {}
        classification = (override.get('classification') or '').strip() or None
        raw_ids = override.get('companion_ids')
        if raw_ids is None:
            companion_ids = None
        else:
            companion_ids = [int(x) for x in raw_ids if isinstance(x, (int, float))]
        details, address = _fetch_recipient_rows(db, person_id, classification=classification)
        if details is None or address is None:
            skipped_ids.append(person_id)
            continue
        postcard_settings = _get_postcard_settings(db, person_id, postcard_type)
        recipient = _build_recipient(db, person_id, details, address, companion_ids=companion_ids,
                                     postcard_settings=postcard_settings)
        sender = _build_sender_for_id(db, resolve_sender_id_for_person(db, person_id))
        items.append({'recipient': recipient, 'sender': sender})

    if not items:
        abort(400, '宛名印字に使える住所が登録されている人物が選択されていません')

    try:
        pdf_bytes = postcard.build_postcard_pdf(items, postcard_type=postcard_type)
    except RuntimeError as e:
        abort(500, str(e))
    pdf_bytes = _apply_printer_adjustment(db, pdf_bytes, _resolve_requested_printer_profile_id())

    response = send_file(
        io.BytesIO(pdf_bytes), mimetype='application/pdf',
        as_attachment=False, download_name='postcards.pdf',
    )
    response.headers['X-Postcards-Skipped'] = ','.join(str(i) for i in skipped_ids)
    return response


# ---------- ラクスルCSVエクスポート ----------

_RAKUSUL_COLUMNS = [
    '郵便番号', '住所1', '住所2', '企業名', '支店/部署', '敬称(企業名)',
    '役職/肩書き', '氏名', '敬称(氏名)',
    '役職/肩書き1', '連名1', '敬称(連名1)',
    '役職/肩書き2', '連名2', '敬称(連名2)',
    '役職/肩書き3', '連名3', '敬称(連名3)',
]


def _build_rakusul_row(details, address, companions):
    addr1 = (address['prefecture'] or '') + (address['city'] or '') + (address['block'] or '')
    addr2 = address['building'] or ''
    dept = (details['department1'] or '')
    if details['department2']:
        dept = (dept + ' ' + details['department2']).strip()
    name = f"{details['last_name'] or ''} {details['first_name'] or ''}".strip()
    row = [
        address['zip'] or '',
        addr1,
        addr2,
        details['company_name'] or '',
        dept,
        '',  # 敬称(企業名)
        details['position'] or '',
        name,
        details['honorific'] or '',
    ]
    for i in range(3):
        if i < len(companions):
            c = companions[i]
            cname = f"{c['last_name'] or ''} {c['first_name'] or ''}".strip()
            row += ['', cname, c['honorific'] or '']
        else:
            row += ['', '', '']
    return row


@export_bp.get('/export-csv')
def export_csv_page():
    return render_template('export_csv.html')


@export_bp.post('/export/rakusul_csv')
def rakusul_csv():
    db = get_db()
    person_ids = request.form.getlist('person_id', type=int)
    if not person_ids:
        abort(400, '対象の人物が選択されていません')
    try:
        overrides = json.loads(request.form.get('overrides') or '{}')
    except ValueError:
        overrides = {}

    data_rows = []
    skipped_ids = []
    for person_id in person_ids:
        override = overrides.get(str(person_id)) or {}
        classification = (override.get('classification') or '').strip() or None
        details, address = _fetch_recipient_rows(db, person_id, classification=classification)
        if details is None or address is None:
            skipped_ids.append(person_id)
            continue
        raw_ids = override.get('companion_ids')
        if raw_ids is None:
            companions = db.execute(
                'SELECT * FROM current_companions WHERE person_id=? ORDER BY sort_order LIMIT 3',
                (person_id,)
            ).fetchall()
        elif raw_ids:
            placeholders = ','.join('?' for _ in raw_ids)
            companions = db.execute(
                f'SELECT * FROM current_companions WHERE person_id=? AND id IN ({placeholders}) ORDER BY sort_order LIMIT 3',
                [person_id] + [int(x) for x in raw_ids if isinstance(x, (int, float))],
            ).fetchall()
        else:
            companions = []
        data_rows.append(_build_rakusul_row(details, address, companions))

    if not data_rows:
        abort(400, '出力できる住所が登録されている人物が選択されていません')

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(_RAKUSUL_COLUMNS)
    writer.writerows(data_rows)
    csv_bytes = buf.getvalue().encode('cp932', errors='replace')

    response = send_file(
        io.BytesIO(csv_bytes), mimetype='text/csv',
        as_attachment=True, download_name='rakusul_atena.csv',
    )
    response.headers['X-Export-Skipped'] = ','.join(str(i) for i in skipped_ids)
    return response
