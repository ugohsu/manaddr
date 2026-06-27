FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

# はがき宛名面PDFタイプセット用。texliveはイメージに含めず、ホスト側(hp-mini)の
# /usr/local/texlive を読み取り専用マウントして使う（~/host/hp-mini_config/about_server/texlive_setup.md 参照）。
ENV PATH="/usr/local/texlive/current/bin/x86_64-linux:${PATH}"
# 非rootコンテナユーザーはHOMEが書き込み不可な場合があるため、luaotfloadのフォントキャッシュ先を明示する。
ENV TEXMFVAR="/tmp/texmf-var"

EXPOSE 8000

CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "60", "app:app"]
