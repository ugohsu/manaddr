-- manaddr DB schema
-- README.md の「DB 設計」セクションをそのままSQL化したもの。
-- 実装上の差異: ドラフトの companions の `order` 列はSQLiteの予約語のため `sort_order`
-- にリネームしている（意味は同じ）。sender_presets/sender_preset_members は
-- 2026-06-25にパターン機能廃止に伴い削除済み（README.md「機能: 差出人管理」の追記参照）。
-- people.merged_into_id（重複統合(merge)機能用）も2026-06-25に機能見送りに伴い削除済み。
--
-- versioned テーブル（person_details/addresses/phones/emails/urls/companions）は
-- UPDATEせず常にINSERTのみで運用する。削除は is_deleted=1 の新バージョン行（トンブストーン）。

PRAGMA foreign_keys = ON;

-- ---------- people（本人の不変な識別子） ----------

CREATE TABLE IF NOT EXISTS people (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- person_details（versioned） ----------

CREATE TABLE IF NOT EXISTS person_details (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id         INTEGER NOT NULL REFERENCES people(id),
    recorded_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted        INTEGER NOT NULL DEFAULT 0,
    last_name         TEXT,
    first_name        TEXT,
    last_name_kana    TEXT,
    first_name_kana   TEXT,
    honorific         TEXT,
    birthday          TEXT,
    gender            TEXT,
    memo              TEXT,
    company_name      TEXT,
    company_kana      TEXT,
    department1       TEXT,
    department2       TEXT,
    position          TEXT,
    customer_code     TEXT,
    status            TEXT NOT NULL DEFAULT 'active'
                      CHECK(status IN ('active','suspended','declined','deceased'))
);
CREATE INDEX IF NOT EXISTS idx_person_details_person_id ON person_details(person_id);

-- ---------- addresses（住所、versioned） ----------

CREATE TABLE IF NOT EXISTS addresses (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id       INTEGER NOT NULL REFERENCES people(id),
    classification  TEXT    NOT NULL DEFAULT '自宅',
    priority        INTEGER,
    recorded_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    zip             TEXT,
    prefecture      TEXT,
    city            TEXT,
    block           TEXT,
    building        TEXT,
    nearest_station TEXT
);
CREATE INDEX IF NOT EXISTS idx_addresses_person_id ON addresses(person_id);

-- ---------- phones / emails / urls（versioned、固定5件制限なし） ----------

CREATE TABLE IF NOT EXISTS phones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id       INTEGER NOT NULL REFERENCES people(id),
    classification  TEXT,
    recorded_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    value           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phones_person_id ON phones(person_id);

CREATE TABLE IF NOT EXISTS emails (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id       INTEGER NOT NULL REFERENCES people(id),
    classification  TEXT,
    recorded_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    value           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emails_person_id ON emails(person_id);

CREATE TABLE IF NOT EXISTS urls (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id       INTEGER NOT NULL REFERENCES people(id),
    classification  TEXT,
    recorded_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    value           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_urls_person_id ON urls(person_id);

-- ---------- companions（連名、versioned） ----------

CREATE TABLE IF NOT EXISTS companions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id         INTEGER NOT NULL REFERENCES people(id),
    sort_order        INTEGER NOT NULL,
    recorded_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted        INTEGER NOT NULL DEFAULT 0,
    last_name         TEXT,
    first_name        TEXT,
    last_name_kana    TEXT,
    first_name_kana   TEXT,
    honorific         TEXT,
    birthday          TEXT,
    gender            TEXT
);
CREATE INDEX IF NOT EXISTS idx_companions_person_id ON companions(person_id);

-- ---------- tags / person_tags（非versioned、多対多） ----------

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS person_tags (
    person_id INTEGER NOT NULL REFERENCES people(id),
    tag_id    INTEGER NOT NULL REFERENCES tags(id),
    PRIMARY KEY (person_id, tag_id)
);

-- ---------- mailings（送付実績） ----------

CREATE TABLE IF NOT EXISTS mailings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    fiscal_year   INTEGER NOT NULL,
    label         TEXT    NOT NULL,
    memo          TEXT,
    output_type   TEXT    NOT NULL DEFAULT 'pdf_batch'
                  CHECK(output_type IN ('pdf_batch', 'rakusul_csv')),
    postcard_type TEXT,
    recorded_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);


CREATE TABLE IF NOT EXISTS mailing_recipients (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    mailing_id          INTEGER NOT NULL REFERENCES mailings(id),
    person_id           INTEGER NOT NULL REFERENCES people(id),
    person_details_id   INTEGER NOT NULL REFERENCES person_details(id),
    address_id          INTEGER NOT NULL REFERENCES addresses(id)
);
CREATE INDEX IF NOT EXISTS idx_mailing_recipients_mailing_id ON mailing_recipients(mailing_id);

CREATE TABLE IF NOT EXISTS mailing_recipient_companions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    mailing_recipient_id  INTEGER NOT NULL REFERENCES mailing_recipients(id),
    companion_id          INTEGER NOT NULL REFERENCES companions(id)
);

-- ---------- senders（差出人） ----------
-- senders は identity のみ。is_default はデフォルト選択の設定であり versioning 不要なのでここに置く。
-- 差出人の実データ（氏名・住所など）は versioned テーブル sender_details に分離している。

CREATE TABLE IF NOT EXISTS senders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sender_details (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id        INTEGER NOT NULL REFERENCES senders(id),
    recorded_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted       INTEGER NOT NULL DEFAULT 0,
    label            TEXT    NOT NULL,
    last_name        TEXT,
    first_name       TEXT,
    last_name_kana   TEXT,
    first_name_kana  TEXT,
    zip              TEXT,
    prefecture       TEXT,
    city             TEXT,
    block            TEXT,
    building         TEXT,
    memo             TEXT,
    company_name     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sender_details_sender_id ON sender_details(sender_id);

-- 差出人の連名（versioned）。honorific/birthday/gender は差出人側に持たない設計のため省略。
CREATE TABLE IF NOT EXISTS sender_companions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id        INTEGER NOT NULL REFERENCES senders(id),
    sort_order       INTEGER NOT NULL DEFAULT 0,
    recorded_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    is_deleted       INTEGER NOT NULL DEFAULT 0,
    last_name        TEXT,
    first_name       TEXT,
    last_name_kana   TEXT,
    first_name_kana  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sender_companions_sender_id ON sender_companions(sender_id);

-- 送付履歴スナップショット: 記録時点の sender_details を固定参照する。
CREATE TABLE IF NOT EXISTS mailing_recipient_senders (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    mailing_recipient_id  INTEGER NOT NULL REFERENCES mailing_recipients(id),
    sender_details_id     INTEGER NOT NULL REFERENCES sender_details(id)
);

-- 送付履歴スナップショット: 記録時点の連名（sender_companions 特定バージョン）を固定参照する。
CREATE TABLE IF NOT EXISTS mailing_recipient_sender_companions (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    mailing_recipient_sender_id INTEGER NOT NULL REFERENCES mailing_recipient_senders(id),
    sender_companion_id         INTEGER NOT NULL REFERENCES sender_companions(id)
);

-- 人物ごとの差出人上書き。行が無ければデフォルト（senders.is_default）を使う。
-- 行があってsender_idがNULLなら「この人物には差出人を印字しない」という明示的な
-- 上書き（デフォルトに何が設定されていても無視する）。
CREATE TABLE IF NOT EXISTS person_sender_overrides (
    person_id  INTEGER PRIMARY KEY REFERENCES people(id),
    sender_id  INTEGER REFERENCES senders(id) ON DELETE CASCADE
);

-- 人物・はがき種別ごとの宛名印字サイズ設定。宛名印字ページの右ペインから設定・DB保存される。
-- name_scale: 受取人氏名のフォントサイズ倍率、address_scale: 受取人住所のフォントサイズ倍率。
-- PKは(person_id, postcard_type)複合キー。postcard_typeは 'nengajo'/'normal' を想定。
-- デフォルト1.0（変更なし）。行が無ければ1.0として扱う。
CREATE TABLE IF NOT EXISTS person_postcard_settings (
    person_id     INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    postcard_type TEXT    NOT NULL DEFAULT 'nengajo',
    name_scale    REAL    NOT NULL DEFAULT 1.0,
    address_scale REAL    NOT NULL DEFAULT 1.0,
    PRIMARY KEY (person_id, postcard_type)
);

-- ---------- プリンタ調整プロファイル ----------
-- 家庭用プリンタ（例: Canon GX7130）がはがきサイズの真のフチなし印刷に対応しておらず、
-- 印刷可能領域に収めるためデータ全体を自動で縮小・再配置してしまう機種がある
-- （2026-07-03、実機の印刷結果を実測して確認。詳細は同日のレポート参照）。
-- postcard.py側のLaTeXレイアウトは一切変更せず、生成済みPDFの各ページ全体に対して
-- 単純な拡大縮小(scale_x/scale_y)と平行移動(offset_x_mm/offset_y_mm)を後から適用する
-- ことで打ち消す（printer_adjust.py参照）。versioning不要の単純な設定値なので、
-- senders/sender_detailsのような分離はせずこの1テーブルで完結させる。
-- is_default=1の行が「現在使っているプリンタ」の既定プロファイル。行が無い/デフォルトが
-- 無い場合は調整なし（等倍・オフセット0）として扱う。複数プロファイルを登録しておけば、
-- 複数プリンタを使い分ける場合や将来の買い替え時にも印字画面のプルダウンから選ぶだけで済む。
CREATE TABLE IF NOT EXISTS printer_profiles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    scale_x     REAL    NOT NULL DEFAULT 1.0,
    scale_y     REAL    NOT NULL DEFAULT 1.0,
    offset_x_mm REAL    NOT NULL DEFAULT 0.0,
    offset_y_mm REAL    NOT NULL DEFAULT 0.0,
    memo        TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------- やりとり（correspondence） ----------

CREATE TABLE IF NOT EXISTS correspondence_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id   INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    direction   TEXT NOT NULL CHECK(direction IN ('sent', 'received')),
    entry_type  TEXT NOT NULL CHECK(entry_type IN ('text', 'image')),
    body        TEXT,
    image_data  BLOB,
    image_mime  TEXT NOT NULL DEFAULT 'image/jpeg',
    memo        TEXT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_correspondence_entries_person_id ON correspondence_entries(person_id);

CREATE TABLE IF NOT EXISTS correspondence_labels (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS correspondence_entry_labels (
    entry_id INTEGER NOT NULL REFERENCES correspondence_entries(id) ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES correspondence_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, label_id)
);

-- ---------- 「現在値」ビュー ----------
-- 論理キーごとに recorded_at が最新（同値ならid最大）の行を1件返し、
-- その行が is_deleted=1（トンブストーン）であれば current から除外する。

DROP VIEW IF EXISTS current_person_details;
CREATE VIEW current_person_details AS
SELECT id, person_id, recorded_at, is_deleted, last_name, first_name, last_name_kana,
       first_name_kana, honorific, birthday, gender, memo, company_name, company_kana,
       department1, department2, position, customer_code, status
FROM (
    SELECT pd.*, ROW_NUMBER() OVER (
        PARTITION BY person_id ORDER BY recorded_at DESC, id DESC
    ) AS rn
    FROM person_details pd
) WHERE rn = 1 AND is_deleted = 0;

DROP VIEW IF EXISTS current_addresses;
CREATE VIEW current_addresses AS
SELECT id, person_id, classification, priority, recorded_at, is_deleted, zip,
       prefecture, city, block, building, nearest_station
FROM (
    SELECT a.*, ROW_NUMBER() OVER (
        PARTITION BY person_id, classification ORDER BY recorded_at DESC, id DESC
    ) AS rn
    FROM addresses a
) WHERE rn = 1 AND is_deleted = 0;

DROP VIEW IF EXISTS current_phones;
CREATE VIEW current_phones AS
SELECT id, person_id, classification, recorded_at, is_deleted, value
FROM (
    SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY person_id, classification ORDER BY recorded_at DESC, id DESC
    ) AS rn
    FROM phones p
) WHERE rn = 1 AND is_deleted = 0;

DROP VIEW IF EXISTS current_emails;
CREATE VIEW current_emails AS
SELECT id, person_id, classification, recorded_at, is_deleted, value
FROM (
    SELECT e.*, ROW_NUMBER() OVER (
        PARTITION BY person_id, classification ORDER BY recorded_at DESC, id DESC
    ) AS rn
    FROM emails e
) WHERE rn = 1 AND is_deleted = 0;

DROP VIEW IF EXISTS current_urls;
CREATE VIEW current_urls AS
SELECT id, person_id, classification, recorded_at, is_deleted, value
FROM (
    SELECT u.*, ROW_NUMBER() OVER (
        PARTITION BY person_id, classification ORDER BY recorded_at DESC, id DESC
    ) AS rn
    FROM urls u
) WHERE rn = 1 AND is_deleted = 0;

DROP VIEW IF EXISTS current_companions;
CREATE VIEW current_companions AS
SELECT id, person_id, sort_order, recorded_at, is_deleted, last_name, first_name,
       last_name_kana, first_name_kana, honorific, birthday, gender
FROM (
    SELECT c.*, ROW_NUMBER() OVER (
        PARTITION BY person_id, sort_order ORDER BY recorded_at DESC, id DESC
    ) AS rn
    FROM companions c
) WHERE rn = 1 AND is_deleted = 0;

DROP VIEW IF EXISTS current_sender_details;
CREATE VIEW current_sender_details AS
SELECT id, sender_id, recorded_at, is_deleted, label, last_name, first_name,
       last_name_kana, first_name_kana, zip, prefecture, city, block, building,
       memo, company_name
FROM (
    SELECT sd.*, ROW_NUMBER() OVER (
        PARTITION BY sender_id ORDER BY recorded_at DESC, id DESC
    ) AS rn
    FROM sender_details sd
) WHERE rn = 1 AND is_deleted = 0;

DROP VIEW IF EXISTS current_sender_companions;
CREATE VIEW current_sender_companions AS
SELECT id, sender_id, sort_order, recorded_at, is_deleted, last_name, first_name,
       last_name_kana, first_name_kana
FROM (
    SELECT sc.*, ROW_NUMBER() OVER (
        PARTITION BY sender_id, sort_order ORDER BY recorded_at DESC, id DESC
    ) AS rn
    FROM sender_companions sc
) WHERE rn = 1 AND is_deleted = 0;
