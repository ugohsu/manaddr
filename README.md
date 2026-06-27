# manaddr

個人・身内向けの住所録管理 + はがき宛名印字支援 Web アプリ。

## 技術スタック

- **バックエンド**: Python / Flask
- **DB**: SQLite（`data/manaddr.db`、バージョニング方式）
- **フロントエンド**: 素の JavaScript（fetch API）、自前 CSS
- **PDF 生成**: LuaLaTeX（`jlreq` クラス + `eso-pic`）
- **デプロイ**: Docker Compose（hp-mini ホスト上）

## セットアップ

```bash
# data/ ディレクトリを先に作成（root所有になるとDBが開けなくなるため）
mkdir data

# .env を作成
echo "APP_PASSWORD=yourpassword" > .env

# 起動（初回は --build が必要）
docker compose up -d --build
```

LuaLaTeX は hp-mini ホスト側にインストール済みのものを読み取り専用でコンテナにマウントしている（`docker-compose.yml` 参照）。

## 機能

### 人物（住所録）管理

住所録の中心機能。1人 = 1 `people` レコードで、氏名・住所・電話・メール・URL・連名・タグを管理する。

- **一覧検索**: 氏名・カナ・勤務先・連名で絞り込み。status・タグでフィルタ。
- **2ペイン表示**: 左ペインで一覧、右ペインで詳細を同時表示。詳細ペインを全幅に拡大するトグルあり。
- **新規登録 / 編集**: 住所は都道府県・市区町村・町名番地・建物名を個別フィールドで管理。郵便番号入力時に zipcloud API で都道府県・市区町村・町域を自動補完。
- **履歴管理（バージョニング）**: 住所・氏名等の変更は上書きせず新バージョン行を追加（append-only）。過去のバージョンは人物詳細の履歴ビューから参照・手動削除できる。
- **status**: `active`（通常）/ `suspended`（停止）/ `declined`（先方からの申し出）/ `deceased`（死亡）の4値。
- **連名**: 人物に紐づく連名（家族等）を複数登録。姓・名を独立して持つため、異姓の連名にも対応。
- **タグ**: 任意のタグを人物に付与（多対多）。タグ管理画面でタグのCRUD、一覧のタグ絞り込みに利用。
- **一括操作**: 一覧でチェックした複数人に対して status 変更・タグ付与・タグ解除を一括実行。
- **人物削除**: 個別削除のみ（一括削除は意図的に非対応）。送付履歴で参照中の人物は削除不可。

### バッチインポート（年賀状住所更新）

年賀状の住所記載部分を AI（Gemini 等）に読み取らせ、住所更新提案 JSON としてアプリに取り込む機能。

1. AI に年賀状の写真と `static/docs/batch_import_ai_spec.md` を渡して JSON を生成
2. 「バッチインポート」画面（`/people/import`）に JSON を貼り付けてプレビュー
3. 既存人物との曖昧マッチ結果・確信度・差分を確認し、取り込む行をチェックで選別
4. 「インポート実行」で住所・氏名の新バージョンを挿入（新規人物はその場で登録フォームを開いて追加可能）

### タグ管理

サイドバー「タグ管理」（`/tags`）からタグのCRUD。タグ名・利用人数を一覧表示し、クリックでそのタグで絞り込んだ人物一覧へ遷移。

### 差出人管理

はがきに印字する差出人プロフィールの管理。

- **差出人**: ラベル・氏名・住所・連名を持つプロフィール。複数登録可能（例: 夫・妻それぞれ）。
- **デフォルト**: `is_default=1` の差出人が全人物のデフォルト。
- **人物ごとの上書き**: 特定の人物に固定で使う差出人を設定、または「この人物には差出人を印字しない」を明示設定。
- **複数差出人**: 住所が同じ差出人は1住所ブロックにまとめて印字。住所が異なる場合は別グループを横に並べて印字（自動縮小あり）。

### 宛名印字 PDF

LuaLaTeX で宛名面 PDF を生成する。

- **人物詳細からのプレビュー**: 人物詳細ページ右上の「はがき宛名面PDFプレビュー」ボタンで1人分の PDF を新規タブで確認。
- **一括生成**（`/export-postcards`）: 複数人を選択して結合 PDF（1人1ページ）を一括生成。住所が複数ある人物は右ペインで送付先を選択できる。
- **はがき種別**: 年賀状（`nengajo`）と普通はがき（`normal`）を切り替え可能。郵便番号枠・下部余白がそれぞれの実寸に対応。
- **サイズ調整**: 宛名印字ページの右ペインで、人物ごと・はがき種別ごとに氏名・住所のフォントスケールを設定・保存できる。

レイアウト概要:
- 縦書き、郵便番号は枠印字済みのはがき前提
- 受取人: 住所（都道府県〜建物名、縦書き変換）+ 氏名 + 連名
- 差出人: はがき左下の郵便番号枠（算用数字）+ 住所・氏名（縦書き）

### エクスポート（ラクスル CSV）

宛名印字ページで選択した人物をラクスルの宛名注文用 CSV（Shift-JIS、18列）に出力する（`/export-csv`）。住所1 = 都道府県+市区町村+町名番地、住所2 = 建物名、連名は最大3名。

### 送付履歴

「記録する」ボタンで、そのときの宛先・差出人スナップショットを `mailings` テーブルに記録する。

- **記録内容**: タイトル・年度・出力種別（PDFバッチ / ラクスルCSV）・はがき種別・メモ
- **履歴閲覧**（`/mailings`）: 過去の送付記録一覧。詳細では送付先ごとの氏名・住所・差出人を確認でき、当時のスナップショットから PDF を再生成できる。
- **スナップショット**: 記録時点での `person_details_id` / `address_id` / `sender_details_id` を固定参照するため、後から住所が変わっても当時の内容を正確に再現できる。

### やりとり

人物ごとに、送った文面（テキスト）・受け取った年賀状（画像）をチャット型タイムラインで記録する機能。人物詳細ページの「やりとり」リンクからアクセス。

- 送信（`sent`）/ 受信（`received`）の2方向
- エントリ種別はテキスト or 画像
- ラベルで複数エントリを分類（例: 「2026年賀状」）。ラベル単位で人物横断の一覧表示も可能（`/correspondence/labels`）

## DB スキーマ

バージョニング設計の基本方針:

- **versioned テーブル**（`person_details` / `addresses` / `phones` / `emails` / `urls` / `companions` / `sender_details` / `sender_companions`）は UPDATE せず常に INSERT のみ。削除は `is_deleted=1` のトンブストーン行。
- **現在値** = 論理キー（`person_id` + `classification` 等）ごとに `recorded_at` が最新の行（`is_deleted=0`）。`current_*` ビューで参照。
- **非 versioned テーブル**（`tags` / `person_tags` / `senders` / `person_sender_overrides` / `person_postcard_settings` 等）は通常の UPDATE で管理。

テーブル一覧:

| テーブル | 説明 |
|---|---|
| `people` | 人物の不変な識別子（id + created_at のみ） |
| `person_details` | 氏名・カナ・敬称・勤務先・status 等（versioned） |
| `addresses` | 住所（classification で自宅・勤務先等を区別、versioned） |
| `phones` / `emails` / `urls` | 電話・メール・URL（versioned） |
| `companions` | 連名（sort_order で順序管理、versioned） |
| `tags` / `person_tags` | タグ定義と人物との多対多 |
| `mailings` | 送付実績（タイトル・年度・出力種別） |
| `mailing_recipients` | 送付先スナップショット（versioned 行への固定参照） |
| `mailing_recipient_companions` | 送付時連名スナップショット |
| `senders` | 差出人の識別子（is_default フラグ） |
| `sender_details` | 差出人の氏名・住所等（versioned） |
| `sender_companions` | 差出人の連名（versioned） |
| `mailing_recipient_senders` | 送付時差出人スナップショット |
| `mailing_recipient_sender_companions` | 送付時差出人連名スナップショット |
| `person_sender_overrides` | 人物ごとの差出人上書き設定 |
| `person_postcard_settings` | 人物・はがき種別ごとの印字フォントスケール |
| `correspondence_entries` | やりとりエントリ（テキスト or 画像） |
| `correspondence_labels` | やりとりのラベル定義 |
| `correspondence_entry_labels` | エントリとラベルの多対多 |

詳細は `schema.sql` を参照。
