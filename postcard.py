# -*- coding: utf-8 -*-
"""はがき宛名面のLaTeX(jlreq)組版エンジン。

レイアウトの実測値の根拠:
- 受取人用郵便番号枠の位置・寸法は日本郵便公式マニュアル「郵便番号枠」
  (https://www.post.japanpost.jp/zipcode/zipmanual/p05.html、図2: 定形郵便物用)
  の値（上端12.0mm/右端8.0mm、許容誤差±1.5mm、枠サイズ8.0mm×5.7mm、ピッチ7.0mm）を
  既定値として使用。実際のはがき現物に印刷済みの赤枠に対する誤差は要実機確認。
- 差出人用郵便番号枠（はがき左下）は同マニュアルに記載が無く、根拠となる公式資料が
  見つからなかった（2026-06-25追加。README.md「機能: 差出人管理」の追記参照）。
  代わりに、ユーザー提供の実際のラクスル発注ドラフトPDF（`past_operation/2025宛名面.pdf`）
  にガイド線として実在する枠の座標を実測して採用した。ラクスルの印刷代行サービス用
  テンプレートの値であり、本アプリの自宅プリンタ直接印刷とは出力経路が異なる点に注意
  （実際の自宅プリンタでの印刷結果との一致は別途要実機確認）。
- 印刷可能領域の安全マージンはCanon GX7130相当機種(GX7030公式FAQ)の値
  （README.md「機能: エクスポート」要確認#7参照）。
- 郵便番号枠は受取人・差出人とも、現物では3桁目と4桁目の間に住所の「123-4567」の
  ハイフンに相当する余分な隙間があり、単純な均等ピッチではない（`hyphen_gap_mm`）。
  受取人側は2026-07-03、実際の印刷結果（GX7130、`ohta_rslt_02.pdf`）の枠の罫線位置を
  ピクセル解析し、他の桁間の区切りに比べて3-4桁目間だけ約0.6〜0.7mm広いことを確認した
  （ユーザー指摘により発覚。README.md該当箇所の追記参照）。差出人側は元々
  ラクスル発注ドラフトPDFの実測で約1mmと分かっていたが、従来は簡略化のため
  未実装だった。両者ともここで初めて反映し、値は0.7mmを暫定の共通既定値として使う
  （実機での見え方次第で今後調整可能）。
"""
import os
import subprocess
import tempfile

import jinja2

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LATEX_TEMPLATE_DIR = os.path.join(BASE_DIR, 'latex')

PAGE_WIDTH_MM = 100.0
PAGE_HEIGHT_MM = 148.0

ZIP_BOX_DEFAULTS = {
    'top_mm': 12.0,
    'right_mm': 8.0,
    'cell_width_mm': 5.7,
    'cell_height_mm': 8.0,
    'pitch_mm': 7.0,
    'font_pt': 15,
    # 3桁目と4桁目の間だけに入る余分な隙間（2026-07-03実測、要確認#後述）。
    'hyphen_gap_mm': 0.7,
}

# 差出人用郵便番号枠（はがき左下）。2026-06-25、ユーザー提供の実際のラクスル発注
# ドラフトPDF（`past_operation/2025宛名面.pdf`、45件分の宛名面プレビュー、年賀状用）に
# ガイド線（赤色、印刷はされないラクスル側のレイアウト参考表示）として実在する
# ことを確認し、その座標を実測して採用した（PyMuPDFでベクター図形のrect座標を
# 抽出。3桁目と4桁目の間に約1mmのハイフン用の隙間があり、2026-07-03、受取人側と
# 合わせてhyphen_gap_mmとして反映した）。これは年賀状（お年玉付き
# 年賀はがき）の場合の位置（`top_mm`）。普通はがきは下記`SENDER_ZIP_BOX_TYPE_OVERRIDES`
# で位置が異なる（後述）。
# ただし、これはラクスルの印刷代行サービス用テンプレートの値であり、本アプリの
# 自宅プリンタ直接印刷とは出力経路が異なる。実際の自宅プリンタでの印刷結果が
# 現物のはがきの枠（もしあれば）と一致するかは別途実機確認が必要。
SENDER_ZIP_BOX_DEFAULTS = {
    'top_mm': 122.6,
    'left_mm': 5.66,
    'cell_width_mm': 4.0,
    'cell_height_mm': 6.5,
    'pitch_mm': 4.17,
    'font_pt': 10,
    'hyphen_gap_mm': 0.7,
}

# 2026-06-25追記: 上記`SENDER_ZIP_BOX_DEFAULTS['top_mm']`(122.6mm)は年賀状用の値で、
# 普通はがきでは位置が異なる。普通はがきには「お年玉番号エリア」（年賀状下部の
# 大きな点線矩形）が無く、その分この枠自体がはがき下端側にずれる。日本郵政公式の
# 通常はがき画像（`past_operation/pic_normal_new_0[12].jpg`、2点とも同一）をピクセル
# 解析した結果、top_mm=137.3mm（年賀状版より約14.7mm下）と実測した（left_mm等は
# 変化なし）。当初「位置は両方の型で共通」と判断したのは誤りで、ユーザー指摘により
# 実測し直して訂正した（README.md「② はがき宛名面 PDF タイプセット」の追記参照）。
SENDER_ZIP_BOX_TYPE_OVERRIDES = {
    'normal': {'top_mm': 137.3},
}

# 各値は要確認#4・#7と同様、プレビューUIでの調整可能パラメータとして扱う想定（既定値）。
# 位置関係・大きさの比率は jletteraddress（https://github.com/ueokande/jletteraddress、
# 同じ100mm×148mmはがきを対象とするLaTeXクラス）の jletteraddress.cls 内 \addaddress を参考にした
# （クラスそのものは使わず、座標・フォントサイズの考え方だけを流用）。
# 同クラスでは郵便番号枠の右に住所列、さらに左に大きな氏名列という右→左の並びで、
# 住所の文字サイズは郵便番号の数字とほぼ同じ、氏名はその1.8倍前後。本実装ではこの考え方を踏襲しつつ、
# 連名（companions）のための左側の余白を確保している。
LAYOUT_DEFAULTS = {
    'recipient_address_x_mm': 83.0,
    'recipient_address_top_mm': 28.0,
    # recipient_address_height_mm は、はがき種別（年賀状/普通はがき）で値が異なるため
    # ここには置かず、POSTCARD_TYPE_LAYOUT_OVERRIDES側で型ごとに定義する（後述）。
    'recipient_address_font_pt': 14,
    'recipient_name_x_mm': 48.0,
    'recipient_name_top_mm': 28.0,
    'recipient_name_height_mm': 95.0,
    'recipient_name_font_pt': 26,
    # 連名どうしの列の間隔（「行間」）。2026-06-24、ユーザーから「もう少し広めに、
    # 増分は0.2zwくらい」との指摘があり、既定フォントサイズ(26pt)での0.2zw分
    # （0.2*26pt*0.3528mm/pt≈1.83mm）を元の9.0mmに加えた。
    'companion_pitch_mm': 10.83,
    # 氏名の文字間隔（同じ部分内の文字どうし、例: 「田」「中」の間）。姓・名・敬称間の
    # \\hskip1zwより狭くする（2026-06-24、ユーザー指摘。さらに広げてよいとの追加指摘あり）。
    'recipient_name_char_spacing_zw': 0.35,
    # 住所が複数行（住所1/住所2）になるとき、2行目以降を全角文字何文字分
    # 下げるか（2026-06-24、ユーザー指摘の「2行目以降は全角4文字ほどインデント」）。
    'address_continuation_indent_zw': 4.0,
    'sender_address_x_mm': 26.0,
    # 2026-06-25、住所・氏名それぞれ固定top_mmで上辺を揃える方式から、共通の下辺
    # （sender_bottom_mm）に揃える方式に変更した（ユーザー指摘:「上辺を揃えると、
    # 住所より短い氏名が浮いて見える。下辺で揃えたほうが綺麗」）。住所・氏名それぞれの
    # 実際の縦方向の長さ（内容依存、_max_column_extent_mm/_name_block_extent_mm参照）
    # をPython側で計算し、top_mm = sender_bottom_mm - 実際の長さ、として動的に求める。
    # `sender_bottom_mm`は差出人用郵便番号枠の位置に応じて値が変わるため、はがき種別
    # ごとに`POSTCARD_TYPE_LAYOUT_OVERRIDES`側で定義する（後述）。
    'sender_address_font_pt': 10,
    # `sender_address_height_mm`（列を折り返すまでの高さ予算）について:
    # 下辺揃え方式（直上の説明）になった結果、実際の表示位置は常に`sender_bottom_mm`
    # からの逆算（top = bottom - 実際の長さ）になり、列の実際の高さがどれだけあっても
    # `sender_bottom_mm`より下に出ることは構造的に無い。そのため、この値を小さくして
    # 差出人用郵便番号枠との重なりを避ける必要は無くなった（上辺固定方式だった時の
    # 名残りで一時的に65→40に縮小していたが、不要と判明したため65に戻した。後述）。
    # **重要**: 逆にこの値を小さくしすぎると、列数が増えて連名がページ左端からあふれる
    # （実機コンパイルで確認、夫婦2名+2行住所という最もよくある構成でも発生した）ため、
    # 今後調整する場合は連名2名以上のケースで必ず確認すること。
    'sender_address_height_mm': 65.0,
    # 住所列(住所1/住所2が`\\`で複数列になりうる)の実際の左端から氏名列までの余白
    # （住所列の右端からの距離ではない。実際の左端は実行時に計算する）。
    'sender_address_name_gap_mm': 2.0,
    'sender_name_height_mm': 65.0,
    'sender_name_font_pt': 12,
    'sender_name_pitch_mm': 6.0,
    # 差出人の勤務先名（任意）。氏名列の上に小さめのフォントで1行追加する
    # （氏名側のnameYZero centeringとは独立に、氏名の上端=sender_name_top_mmから
    # 一定の余白を空けた位置に下端を揃えるだけのシンプルな配置）。
    'sender_company_name_font_pt': 9,
    'sender_company_name_gap_mm': 2.0,
}

# はがき種別（年賀状=お年玉付き年賀はがき／普通はがき）によるレイアウトの差分。
# 2026-06-25、ユーザー提供の実発注ドラフトPDF（`past_operation/2025宛名面.pdf`）と
# 日本郵政公式の通常はがき画像（`past_operation/pic_normal_new_0[12].jpg`）を比較し、
# はがき下部の「お年玉番号エリア」の有無が型による差分と確定した
# （README.md「② はがき宛名面 PDF タイプセット」の追記参照）。
# **訂正（同日）**: 当初「受取人・差出人の郵便番号枠の位置は両方の型で共通」と判断したが、
# 誤りだった。普通はがきにはお年玉番号エリアが無いため、差出人用郵便番号枠（および、
# それに合わせて配置している差出人住所・氏名欄）自体がはがき下端側にずれる
# （`SENDER_ZIP_BOX_TYPE_OVERRIDES`参照）。受取人用郵便番号枠の位置のみ、両方の型で
# 共通であることは実測で確認済み（変更なし）。
# このエリアは年賀状のみに存在し、受取人住所の最大高さを制限する
# （`recipient_address_height_mm`）。普通はがきはこの制約が無いため、より大きい高さ
# 予算（縮小前の既定値）を使える。
# なお、はがき上部〜左側（切手意匠周辺）の記入禁止エリアは型によって差を設けず、常に
# （年賀状基準の広めの）同じ制約を適用する方針のため、ここには含めない（現状の実装は
# そもそもこの領域に何も配置していない）。
DEFAULT_POSTCARD_TYPE = 'nengajo'
POSTCARD_TYPE_LAYOUT_OVERRIDES = {
    'nengajo': {
        'recipient_address_height_mm': 100.0,
        'sender_bottom_mm': 120.0,
    },
    'normal': {
        'recipient_address_height_mm': 110.0,
        # 差出人用郵便番号枠のtop_mmが137.3mm（年賀状版122.6mmより約14.7mm下）になる分、
        # sender_bottom_mmも同じ2.6mmの余白を保って追従させる（120.0は122.6-2.6）。
        'sender_bottom_mm': 134.7,
    },
}

_KANJI_NUMERAL_MAP = {
    '0': '〇', '1': '一', '2': '二', '3': '三', '4': '四',
    '5': '五', '6': '六', '7': '七', '8': '八', '9': '九',
    '０': '〇', '１': '一', '２': '二', '３': '三', '４': '四',
    '５': '五', '６': '六', '７': '七', '８': '八', '９': '九',
    '-': '－', '－': '－', '‐': '－', '−': '－',
}

_PT_TO_MM = 0.3528  # 1pt = 1/72.27 inch（TeXのpt）をmmに変換する近似値


def to_kanji_numerals(text):
    """半角/全角数字とハイフン類を縦書き表示用に漢数字・全角ハイフンへ置換する。
    住所表記の数字は「16」→「十六」のような数量表現ではなく桁ごとの読みなので、
    文字単位の置換（「16」→「一六」）にしている。"""
    if not text:
        return text
    return ''.join(_KANJI_NUMERAL_MAP.get(ch, ch) for ch in text)


def _wrap_text_to_lines(text, font_pt, height_mm, indent_zw, first_chunk_indented):
    """1行の文字数が高さ予算(height_mm)に収まらない場合、複数列に事前分割する。
    LaTeXの自動折り返しに任せると、折り返された列にはインデントが掛からない
    （`\\`による明示的な改行でないため）。すべての列をこちらで明示的に切り出し、
    テンプレート側の「先頭列以外はインデント」処理を全列に一律適用させることで、
    改行の種類（明示的か自動折り返しか）を問わずぶら下げインデントを実現する。
    2列目以降（および`first_chunk_indented=True`のときの1列目）はインデント分だけ
    使える高さが減るため、列ごとに収容文字数を変える。`first_chunk_indented`は、
    この文字列自体が（例えば住所1の次に続く住所2のように）全体の中で最初の行では
    なくテンプレート側で既にインデントされる立場かどうかを示す——この行の最初の
    チャンクの収容文字数を、インデント無し(cap_first)とインデント有り(cap_continuation)
    のどちらで計算すべきか、を呼び出し側から伝えるためのフラグ。"""
    char_mm = font_pt * _PT_TO_MM
    cap_first = max(1, int(height_mm / char_mm))
    cap_continuation = max(1, int((height_mm - indent_zw * char_mm) / char_mm))
    lines = []
    remaining = text
    cap = cap_continuation if first_chunk_indented else cap_first
    while remaining:
        lines.append(remaining[:cap])
        remaining = remaining[cap:]
        cap = cap_continuation
    return lines


def _expand_address_lines(raw_lines, font_pt, height_mm, indent_zw):
    """住所1・住所2それぞれを漢数字変換した上で、必要なら`_wrap_text_to_lines`で
    複数列に事前分割し、最終的にテンプレートへ渡す1本の列リストに展開する。
    全体の中で最初に出力する行（テンプレート側でインデントしない唯一の行）以外は、
    その行自身の最初のチャンクから既にインデント対象になる点に注意。"""
    expanded = []
    for raw in raw_lines:
        if not raw:
            continue
        first_chunk_indented = len(expanded) > 0
        expanded.extend(_wrap_text_to_lines(
            to_kanji_numerals(raw), font_pt, height_mm, indent_zw, first_chunk_indented,
        ))
    return expanded


_LATEX_SPECIAL_CHARS = {
    '\\': r'\textbackslash{}',
    '{': r'\{',
    '}': r'\}',
    '&': r'\&',
    '%': r'\%',
    '$': r'\$',
    '#': r'\#',
    '_': r'\_',
    '~': r'\textasciitilde{}',
    '^': r'\textasciicircum{}',
}


def escape_latex(text):
    if text is None:
        return ''
    return ''.join(_LATEX_SPECIAL_CHARS.get(ch, ch) for ch in str(text))


_env = jinja2.Environment(
    loader=jinja2.FileSystemLoader(LATEX_TEMPLATE_DIR),
    variable_start_string='\\VAR{',
    variable_end_string='}',
    block_start_string='\\BLOCK{',
    block_end_string='}',
    comment_start_string='\\#{',
    comment_end_string='}',
    trim_blocks=True,
    lstrip_blocks=True,
)
_env.filters['texesc'] = escape_latex


def zip_digits(zip_value):
    if not zip_value:
        return ''
    return ''.join(ch for ch in str(zip_value) if ch.isdigit())


def _digit_cells(left_edge_mm, cell_width_mm, pitch_mm, digits, hyphen_gap_mm=0.0):
    """7桁分のセル位置を返す。郵便番号枠は現物では3桁目と4桁目の間に、住所表記の
    「123-4567」のハイフンに相当する余分な隙間が空いており、4〜7桁目（インデックス
    3以降）はその分だけ均等ピッチの計算より右にずれる（`hyphen_gap_mm`で加算する）。"""
    cells = []
    for i in range(7):
        cell_left = left_edge_mm + i * pitch_mm + (hyphen_gap_mm if i >= 3 else 0.0)
        cells.append({
            'x_mm': cell_left + cell_width_mm / 2,
            'digit': digits[i] if i < len(digits) else '',
        })
    return cells


def _recipient_zip_cells(zip_box, zip_value):
    """受取人用郵便番号枠（はがき右上、右端基準）のセル位置を計算する。
    右端（7桁目の右端）を`right_mm`に固定したまま3-4桁目間にhyphen_gap_mmを
    挿入するため、全体の幅がその分広がり、左端はその分だけ左に伸びる。"""
    total_width = (7 * zip_box['cell_width_mm'] + 6 * (zip_box['pitch_mm'] - zip_box['cell_width_mm'])
                   + zip_box['hyphen_gap_mm'])
    left_edge = PAGE_WIDTH_MM - zip_box['right_mm'] - total_width
    return _digit_cells(left_edge, zip_box['cell_width_mm'], zip_box['pitch_mm'], zip_digits(zip_value),
                         hyphen_gap_mm=zip_box['hyphen_gap_mm'])


def _sender_zip_cells(zip_box, zip_value):
    """差出人用郵便番号枠（はがき左下、左端基準）のセル位置を計算する。
    左端（1桁目の左端）が基準のため、hyphen_gap_mmは4〜7桁目側にそのまま加算するだけでよい。"""
    return _digit_cells(zip_box['left_mm'], zip_box['cell_width_mm'], zip_box['pitch_mm'], zip_digits(zip_value),
                         hyphen_gap_mm=zip_box['hyphen_gap_mm'])


def _name_segments(person, default_honorific=None):
    """姓と「名+敬称」を分離して返す。姓の有無に関わらず名の書き出し位置を揃えるため、
    テンプレート側で姓を縦方向終端基準（名の開始位置）に、名+敬称を同じ位置から開始する
    形で別々に配置する（連名の名が本人の名と同じ高さから始まる、という宛名の慣習に合わせるため）。"""
    last = (person.get('last_name') or '').strip()
    first = (person.get('first_name') or '').strip()
    honorific = None
    if default_honorific is not None:
        honorific = (person.get('honorific') or default_honorific).strip()
    suffix_parts = [p for p in (first, honorific) if p]
    if not last and not suffix_parts:
        suffix_parts = ['']
    return {'last_name': last, 'suffix_parts': suffix_parts}


def _name_columns(main_person, companions, x_mm, pitch_mm, font_pt, default_honorific='様'):
    people = [main_person] + list(companions or [])
    return [
        {'x_mm': x_mm - i * pitch_mm, 'font_pt': font_pt, **_name_segments(p, default_honorific)}
        for i, p in enumerate(people)
    ]


def _max_column_extent_mm(lines, font_pt, indent_zw):
    """`address_block`マクロで実際に描画される列のうち、最も長い列の縦方向の
    長さ(mm)を返す（先頭列はインデント無し、2列目以降は`indent_zw`分のインデントが
    入る分だけ長くなる、というテンプレート側の`\\BLOCK{if not loop.first}`の挙動と
    対応させている）。差出人の住所・氏名を下辺で揃えるための実際の高さ計算に使う。"""
    if not lines:
        return 0.0
    char_mm = font_pt * _PT_TO_MM
    return max(
        (indent_zw * char_mm if i > 0 else 0.0) + len(line) * char_mm
        for i, line in enumerate(lines)
    )


def _name_block_extent_mm(name_columns):
    """`name_block`マクロ（差出人側、文字間隔char_spacing_zw=0前提）で実際に
    描画される内容の縦方向の長さ(mm)を返す。マクロ内の`\\nameYZero`（列0の
    last_nameの実寸、前に1zwの余白込み）と、各列のsuffix_parts（差出人は
    default_honorific=Noneなので実質「名」のみ、各パーツの前に1zwの余白込み）の
    うち最も長いものを合算する、というLaTeX側の配置ロジックと対応させている。"""
    if not name_columns:
        return 0.0

    def segment_mm(text, font_pt):
        return (1 + len(text)) * font_pt * _PT_TO_MM if text else 0.0

    name_y_zero = segment_mm(name_columns[0]['last_name'], name_columns[0]['font_pt'])
    max_suffix = max(
        sum(segment_mm(part, col['font_pt']) for part in col['suffix_parts'])
        for col in name_columns
    )
    return name_y_zero + max_suffix


def _build_sender_context(sender, layout):
    """差出人（連名込み、住所1つ）をテンプレート用コンテキストに変換する。
    郵便番号は専用枠（sender_zip_cells）に印字するため、ここで組み立てる住所には含めない。"""
    address_font_pt = layout['sender_address_font_pt']
    name_font_pt = layout['sender_name_font_pt']
    address_col_width = address_font_pt * 1.6 * _PT_TO_MM
    name_col_width = name_font_pt * _PT_TO_MM

    address_x = layout['sender_address_x_mm']
    address_lines = _expand_address_lines(
        (sender.get('address_line1') or '', sender.get('address_line2') or ''),
        address_font_pt, layout['sender_address_height_mm'], layout['address_continuation_indent_zw'],
    )
    address_left_edge = address_x - (len(address_lines) - 1) * address_col_width - address_col_width / 2
    name_x = address_left_edge - layout['sender_address_name_gap_mm'] - name_col_width / 2

    names = sender.get('names') or []
    name_columns = _name_columns(
        {'last_name': names[0].get('last_name'), 'first_name': names[0].get('first_name')},
        names[1:],
        name_x, layout['sender_name_pitch_mm'], name_font_pt,
        default_honorific=None,
    )
    # 勤務先名は連名（companion）には無く、差出人本人にのみ持たせられる属性なので、
    # namesの各要素（companionはcompany_nameキーを持たない）から該当する列にだけ
    # 合流させる。nameYZeroによる氏名側の頭位置揃えとは独立した配置なので、
    # _name_columns側のロジックには手を入れずここで後付けする。
    for col, person in zip(name_columns, names):
        if person.get('company_name'):
            col['company_name'] = person['company_name']
            col['company_name_font_pt'] = layout['sender_company_name_font_pt']

    # 住所・氏名それぞれの実際の縦方向の長さを求め、共通の下辺(sender_bottom_mm)に
    # 揃うように個別のtop_mmを動的に計算する（上辺で揃えるとお互いの長さの違いで
    # 下端がバラついて見えるため、2026-06-25にユーザー指摘を受けて下辺基準に変更）。
    address_extent_mm = _max_column_extent_mm(
        address_lines, address_font_pt, layout['address_continuation_indent_zw'],
    )
    name_extent_mm = _name_block_extent_mm(name_columns)
    address_top_mm = layout['sender_bottom_mm'] - address_extent_mm
    name_top_mm = layout['sender_bottom_mm'] - name_extent_mm

    return {
        'address_lines': address_lines,
        'address_x_mm': address_x,
        'address_top_mm': address_top_mm,
        'address_font_pt': address_font_pt,
        'name_top_mm': name_top_mm,
        'name_columns': name_columns,
    }


def _build_page_context(recipient, sender, layout, zip_box, sender_zip_box):
    """1件（1ページ分）のrecipient/senderをテンプレート用コンテキストに変換する。
    recipient に name_scale/address_scale が含まれている場合、それぞれのフォントサイズに
    掛け合わせる（人物ごとの氏名・住所サイズ調整）。"""
    name_scale = float(recipient.get('name_scale') or 1.0)
    address_scale = float(recipient.get('address_scale') or 1.0)
    name_font_pt = layout['recipient_name_font_pt'] * name_scale
    address_font_pt = layout['recipient_address_font_pt'] * address_scale

    companions = recipient.get('companions') or []
    # name_scale に応じて列間隔も等比で縮小する（縮小した文字サイズに合わせた行間になるよう）。
    companion_pitch_mm = layout['companion_pitch_mm'] * name_scale
    # 連名があるときは、本人+連名で作る列のまとまり全体の中心がはがきの中心(幅の半分)に
    # 来るように本人の列のx座標を計算する（列はすべて同じフォントサイズ・等間隔なので、
    # 中心は本人列から連名側へ companion_pitch_mm の半分ずつシフトした位置になる）。
    if companions:
        recipient_name_x_mm = PAGE_WIDTH_MM / 2 + len(companions) / 2 * companion_pitch_mm
    else:
        recipient_name_x_mm = layout['recipient_name_x_mm']
    recipient_name_columns = _name_columns(
        recipient, companions,
        recipient_name_x_mm, companion_pitch_mm, name_font_pt,
        default_honorific='様',
    )
    return {
        'zip_cells': _recipient_zip_cells(zip_box, recipient.get('zip')),
        'sender_zip_cells': _sender_zip_cells(sender_zip_box, sender.get('zip')) if sender else [],
        'recipient': {
            'address_lines': _expand_address_lines(
                (recipient.get('address_line1') or '', recipient.get('address_line2') or ''),
                address_font_pt, layout['recipient_address_height_mm'],
                layout['address_continuation_indent_zw'],
            ),
            'address_font_pt': address_font_pt,
            'name_columns': recipient_name_columns,
        },
        'sender': _build_sender_context(sender, layout) if sender else None,
    }


def render_postcard_tex(recipients, zip_box=None, sender_zip_box=None, layout=None,
                         postcard_type=DEFAULT_POSTCARD_TYPE):
    """recipientsの各要素（1件=1ページ）からLaTeXソース文字列を生成する。

    recipients = [{'recipient': {...}, 'sender': {...}|None}, ...]
    recipient = {
        'zip': '123-4567', 'address_line1': str, 'address_line2': str|None,
        'last_name': str, 'first_name': str, 'honorific': str|None,
        'companions': [{'last_name':..,'first_name':..,'honorific':..}, ...] (先頭3件まで想定)
    }
    sender = None または {
        'zip': str, 'address_line1': str, 'address_line2': str|None,
        'names': [{'last_name':..,'first_name':..,'company_name':..}, ...]  # 本人+連名
    }
    postcard_type = 'nengajo'（既定、お年玉付き年賀はがき）または'normal'（普通はがき）。
    バッチ内の全ページに対して1つだけ適用する（ページごとに型を変える運用は想定しない）。
    POSTCARD_TYPE_LAYOUT_OVERRIDESにより、型に応じたレイアウト差分を適用する。
    """
    zip_box = {**ZIP_BOX_DEFAULTS, **(zip_box or {})}
    sender_zip_type_overrides = SENDER_ZIP_BOX_TYPE_OVERRIDES.get(postcard_type, {})
    sender_zip_box = {**SENDER_ZIP_BOX_DEFAULTS, **sender_zip_type_overrides, **(sender_zip_box or {})}
    type_overrides = POSTCARD_TYPE_LAYOUT_OVERRIDES.get(postcard_type, POSTCARD_TYPE_LAYOUT_OVERRIDES[DEFAULT_POSTCARD_TYPE])
    layout = {**LAYOUT_DEFAULTS, **type_overrides, **(layout or {})}

    pages = [
        _build_page_context(item['recipient'], item.get('sender'), layout, zip_box, sender_zip_box)
        for item in recipients
    ]

    template = _env.get_template('postcard_address.tex.jinja')
    return template.render(
        page={'width_mm': PAGE_WIDTH_MM, 'height_mm': PAGE_HEIGHT_MM},
        zip_box=zip_box,
        zip_text_y_mm=zip_box['top_mm'] + zip_box['cell_height_mm'] / 2,
        sender_zip_box=sender_zip_box,
        sender_zip_text_y_mm=sender_zip_box['top_mm'] + sender_zip_box['cell_height_mm'] / 2,
        pages=pages,
        layout=layout,
    )


def compile_tex_to_pdf(tex_source, timeout=30):
    """LaTeXソースをコンパイルしてPDFバイト列を返す。失敗時はRuntimeErrorにログ末尾を含める。
    成功時もタイプセットログを標準出力に流す（同期実行中の進行状況確認用）。"""
    with tempfile.TemporaryDirectory(prefix='postcard_') as workdir:
        tex_path = os.path.join(workdir, 'postcard.tex')
        with open(tex_path, 'w', encoding='utf-8') as f:
            f.write(tex_source)
        result = subprocess.run(
            ['lualatex', '-interaction=nonstopmode', '-halt-on-error',
             '-output-directory', workdir, tex_path],
            cwd=workdir, capture_output=True, text=True, timeout=timeout,
        )
        print(result.stdout)
        pdf_path = os.path.join(workdir, 'postcard.pdf')
        if result.returncode != 0 or not os.path.exists(pdf_path):
            log_tail = '\n'.join(result.stdout.splitlines()[-60:])
            raise RuntimeError(f'LaTeXのコンパイルに失敗しました:\n{log_tail}')
        with open(pdf_path, 'rb') as f:
            return f.read()


def build_postcard_pdf(recipients, zip_box=None, sender_zip_box=None, layout=None,
                        postcard_type=DEFAULT_POSTCARD_TYPE):
    tex_source = render_postcard_tex(
        recipients, zip_box=zip_box, sender_zip_box=sender_zip_box, layout=layout,
        postcard_type=postcard_type,
    )
    # 件数が多いバッチほどlualatexの処理時間が伸びるため、件数に応じてtimeoutを延ばす
    # （1件あたり既定の単発タイムアウト30秒のうち余裕を見て5秒/件を加算する目安）。
    timeout = max(30, 5 * len(recipients))
    return compile_tex_to_pdf(tex_source, timeout=timeout)
