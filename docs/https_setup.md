# mkcert + nginx で HTTPS を有効にする手順

hp-mini 上の manaddr に HTTPS を設定する手順。
HTTP では Chrome がダウンロードをブロックしたり、`Content-Disposition` ヘッダが無視されてファイル名が「未確認」になることがある。HTTPS にすることで解消できる。

## 前提

- OS: hp-mini（Ubuntu/Debian 系を想定）
- アクセス元: LAN 内のブラウザ（`http://hp-mini.local:5002` または IP アドレス）
- Docker Compose 構成は既存の `docker-compose.yml` を変更する

---

## 1. mkcert を hp-mini にインストール

```bash
# Homebrew 経由（macOS の場合）— hp-mini が Linux の場合は下記のバイナリインストールを使う
# Linux: GitHub Releases からバイナリをダウンロード
MKCERT_VER=$(curl -s https://api.github.com/repos/FiloSottile/mkcert/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
curl -Lo /usr/local/bin/mkcert "https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VER}/mkcert-${MKCERT_VER}-linux-amd64"
chmod +x /usr/local/bin/mkcert
```

バージョン確認：

```bash
mkcert -version
```

---

## 2. ローカル CA を作成・信頼させる

```bash
mkcert -install
```

このコマンドで `rootCA.pem` が生成され、OS のトラストストアに登録される。
**ブラウザ側の信頼** については後述（§5）。

CA ファイルの場所を確認しておく（後でブラウザへインポートする際に使う）：

```bash
mkcert -CAROOT
# 例: /root/.local/share/mkcert  または  /home/<user>/.local/share/mkcert
```

---

## 3. 証明書を生成

アクセスに使うホスト名・IP アドレスを指定して証明書を作る。
`hp-mini.local` と LAN の IP アドレス両方を含めておくと便利。

```bash
# 例: certs ディレクトリを作り、そこに生成する
mkdir -p ~/host/apps/manaddr/certs
cd ~/host/apps/manaddr/certs

mkcert hp-mini.local 192.168.x.x localhost 127.0.0.1
# 生成されるファイル:
#   hp-mini.local+3.pem       <- 証明書
#   hp-mini.local+3-key.pem   <- 秘密鍵
```

> **Note**: `192.168.x.x` は実際の hp-mini の LAN 側 IP に置き換える。

---

## 4. nginx 設定を更新

### 4-1. `nginx/nginx.conf`

```nginx
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/nginx/certs/cert.pem;
    ssl_certificate_key /etc/nginx/certs/key.pem;

    client_max_body_size 20M;

    location / {
        proxy_pass         http://app:8000;
        proxy_set_header   Host             $host;
        proxy_set_header   X-Real-IP        $remote_addr;
        proxy_set_header   X-Forwarded-For  $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
    }
}
```

### 4-2. `docker-compose.yml`

nginx サービスにポートと証明書マウントを追加する：

```yaml
  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "5002:80"
      - "5003:443"          # HTTPS ポート（5003 は空き番号。pjkeep=5000, wbhist=5001 の次）
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs/hp-mini.local+3.pem:/etc/nginx/certs/cert.pem:ro
      - ./certs/hp-mini.local+3-key.pem:/etc/nginx/certs/key.pem:ro
    depends_on:
      - app
```

> ファイル名（`hp-mini.local+3.pem` など）は §3 で生成した実際のファイル名に合わせる。

---

## 5. Docker コンテナを再起動

```bash
cd ~/host/apps/manaddr
docker compose up -d --build
```

---

## 6. ブラウザに CA を信頼させる

mkcert の CA はその OS の証明書ストアには登録されるが、**別のマシンのブラウザには別途インポートが必要**。

### Chrome / Edge（Windows・Mac）

1. `mkcert -CAROOT` で出てきたパスの `rootCA.pem` を、アクセス元 PC へコピーする
2. Chrome の設定 → プライバシーとセキュリティ → セキュリティ → 証明書の管理
3. 「信頼されたルート証明機関」タブ → インポート → `rootCA.pem` を選択
4. ブラウザを再起動

### Firefox（独自の証明書ストアを持つ）

1. 設定 → プライバシーとセキュリティ → 証明書を表示 → 認証局 タブ → インポート
2. `rootCA.pem` を選択 → 「このCAをWebサイトの識別に信頼する」にチェック

### iPhone / iPad（iOS）

1. `rootCA.pem` を AirDrop やメール等で転送
2. 設定 → 一般 → VPNとデバイス管理 → インストールされたプロファイルから信頼を有効化
3. 設定 → 一般 → 情報 → 証明書信頼設定 → ルート証明書を完全に信頼

---

## 7. アクセス確認

`https://hp-mini.local:5003` または `https://192.168.x.x:5003` でアクセスする。
鍵アイコンが表示され、PDF ダウンロード時のブロック警告が出なければ設定完了。

---

## 補足: certs/ ディレクトリの扱い

`certs/` は `.gitignore` に加えること（秘密鍵を Git に入れない）。
`rsync` による `/workspace/sandbox/manaddr/ → ~/host/apps/manaddr/` 同期には含まれないため、
**証明書ファイルは hp-mini 上で直接生成・管理する**。
