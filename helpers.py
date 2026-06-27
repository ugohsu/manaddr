# -*- coding: utf-8 -*-
import os
import sqlite3
import unicodedata

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from flask import g

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('DATA_DIR', os.path.join(BASE_DIR, 'data'))
DB_PATH = os.path.join(DATA_DIR, 'manaddr.db')
SCHEMA_PATH = os.path.join(BASE_DIR, 'schema.sql')


def kana_like_patterns(q):
    """検索クエリのひらがな/カタカナ変換バリアントを含むSQLite LIKE パターンリストを返す（重複除去）。
    ひらがな入力はカタカナ版も、カタカナ入力はひらがな版も追加する（双方向マッチ）。"""
    h2k = ''.join(chr(ord(c) + 0x60) if 'ぁ' <= c <= 'ゖ' else c for c in q)
    k2h = ''.join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in q)
    return [f'%{v}%' for v in dict.fromkeys([q, h2k, k2h])]


def like_any(expr, likes):
    """(expr LIKE ? OR expr LIKE ? ...) の条件文字列とパラメータリストのタプルを返す。"""
    cond = ' OR '.join(f'{expr} LIKE ?' for _ in likes)
    return f'({cond})', list(likes)


def normalize_zip(value):
    # 全角数字・全角ハイフン等をNFKCで半角化し、ちょうど7桁の数字ならNNN-NNNNに整形する。
    # 7桁にならない場合も保存自体は止めず、正規化のみした文字列をそのまま返す（ソフトバリデーション）。
    if not value:
        return value
    halfwidth = unicodedata.normalize('NFKC', value)
    digits = ''.join(ch for ch in halfwidth if ch.isdigit())
    if len(digits) == 7:
        return f'{digits[:3]}-{digits[3:]}'
    return halfwidth.strip()


# `CREATE TABLE IF NOT EXISTS`は既存DBに対しては無視される（テーブルがあれば中身の
# 列差分は反映しない）ため、すでに運用中のDBに後から列を追加した場合はここに
# `ALTER TABLE ... ADD COLUMN`を追加する。新規テーブルの追加はIF NOT EXISTSで
# 自動的に作られるので不要。
# 2026-06-25: 本番運用前のタイミングで、それまでに溜まっていたマイグレーション
# （差出人パターン廃止・merged_into_id列削除など）はhp-mini側のDBを「現在のスキーマ
# ＋現在値のみ」で作り直すことで一括解消したため、リストは空にしている。
_COLUMN_MIGRATIONS = []


def _migrate_columns(conn):
    for table, column, alter_sql in _COLUMN_MIGRATIONS:
        cols = [row[1] for row in conn.execute(f'PRAGMA table_info({table})')]
        if column not in cols:
            conn.execute(alter_sql)


def _migrate_mailings(conn):
    """mailings テーブルを旧スキーマ（exported_at列あり）から新スキーマへ移行する。"""
    cols = {row[1] for row in conn.execute('PRAGMA table_info(mailings)')}
    if 'exported_at' not in cols:
        return
    conn.execute('ALTER TABLE mailings RENAME COLUMN exported_at TO recorded_at')
    conn.execute('ALTER TABLE mailings ADD COLUMN memo TEXT')
    conn.execute("ALTER TABLE mailings ADD COLUMN output_type TEXT NOT NULL DEFAULT 'pdf_batch'")
    conn.execute('ALTER TABLE mailings ADD COLUMN postcard_type TEXT')


def get_db():
    if 'db' not in g:
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA journal_mode = WAL')
        with open(SCHEMA_PATH, encoding='utf-8') as f:
            conn.executescript(f.read())
        _migrate_columns(conn)
        _migrate_mailings(conn)
        conn.commit()
        g.db = conn
    return g.db


def close_db(e=None):
    conn = g.pop('db', None)
    if conn is not None:
        conn.close()
