# -*- coding: utf-8 -*-
"""印刷結果のズレをプリンタ機種ごとに補正するアダプタ。

postcard.py が生成するPDFは、はがき実寸(100mm×148mm)にきっちり収まる「フチなし前提」の
座標で組版されている。ところが、はがきサイズで真のフチなし印刷に対応していないプリンタ
（例: Canon GX7130）では、プリンタ側が確保している印刷可能領域に収めるため、送られてきた
データ全体を自動的に縮小・再配置してしまうことがある(2026-07-03、実機の印刷結果を実測して
確認。原因の切り分けレポート参照)。

このモジュールは postcard.py のレイアウト計算には一切関与せず、生成済みのPDFページ全体に
対して単純な拡大縮小(scale_x/scale_y)と平行移動(offset_x_mm/offset_y_mm)を後から適用する
だけの「アダプタ」。プリンタの入れ替えや複数プリンタの使い分けは、postcard.py 側を触らずに
ここへ渡すパラメータ（= printer_profiles テーブルの1行）を差し替えるだけで対応できる。

補正値の決め方（キャリブレーション手順の目安）:
1. postcard_type='normal'（または実際に使う種別）でテスト用のPDFを1枚作り、実機で印刷する。
2. 印刷結果をスキャン・撮影し、郵便番号枠など基準になる印刷済みガイド線に対して、印字された
   文字がどれだけ・どちら向きにズレているかをmm単位で測る（はがき上端に近い場所ほどズレが
   大きく出るので、そこで測るのが分かりやすい）。
3. ズレが用紙中心から離れるほど大きくなる（＝原点に近いところはズレが小さい）なら拡大率
   (scale_x/scale_y)の補正、用紙全体が一様に同じ向き・同じ量だけズレるなら平行移動
   (offset_x_mm/offset_y_mm)の補正、というように切り分けて少しずつ追い込む。
"""
import io

import fitz  # PyMuPDF

MM_TO_PT = 72.0 / 25.4


def _is_identity(scale_x, scale_y, offset_x_mm, offset_y_mm):
    return scale_x == 1.0 and scale_y == 1.0 and offset_x_mm == 0.0 and offset_y_mm == 0.0


def apply(pdf_bytes, scale_x=1.0, scale_y=1.0, offset_x_mm=0.0, offset_y_mm=0.0):
    """pdf_bytesの各ページ全体を(scale_x, scale_y)倍に拡大縮小し、
    (offset_x_mm, offset_y_mm)だけページ左上を基準に平行移動して返す。

    等倍・オフセット0（調整なし）のときはfitzを介さずそのまま返す。
    """
    if _is_identity(scale_x, scale_y, offset_x_mm, offset_y_mm):
        return pdf_bytes

    offset_x_pt = offset_x_mm * MM_TO_PT
    offset_y_pt = offset_y_mm * MM_TO_PT

    src = fitz.open(stream=pdf_bytes, filetype='pdf')
    out = fitz.open()
    for page in src:
        w, h = page.rect.width, page.rect.height
        new_page = out.new_page(width=w, height=h)
        target = fitz.Rect(
            offset_x_pt, offset_y_pt,
            offset_x_pt + w * scale_x, offset_y_pt + h * scale_y,
        )
        new_page.show_pdf_page(target, src, page.number)
    result = out.tobytes()
    out.close()
    src.close()
    return result
