# -*- coding: utf-8 -*-
import os
import time
from datetime import timedelta

from flask import Flask, jsonify, redirect, request, session, url_for

from helpers import close_db

# コンテナ起動時刻を静的ファイルのキャッシュバスティング用バージョン文字列として使う。
# docker compose up --build のたびに変わるため、再ビルド後はブラウザが新しいCSS/JSを取得する。
_STATIC_VERSION = str(int(time.time()))


def create_app():
    app = Flask(__name__)
    app.secret_key = os.environ.get('SECRET_KEY', 'dev-insecure-key-change-me')
    app.permanent_session_lifetime = timedelta(days=30)

    @app.context_processor
    def inject_static_version():
        return {'static_v': _STATIC_VERSION}

    @app.teardown_appcontext
    def _close_db(e=None):
        close_db(e)

    @app.before_request
    def require_login():
        if request.endpoint in ('auth.login', 'static') or session.get('authenticated'):
            return
        if request.path.startswith('/api/'):
            return jsonify({'error': '認証が必要です'}), 401
        return redirect(url_for('auth.login', next=request.path))

    from blueprints.auth import auth_bp
    from blueprints.people import people_bp
    from blueprints.export import export_bp
    from blueprints.senders import senders_bp
    from blueprints.correspondence import correspondence_bp
    from blueprints.mailings import mailings_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(people_bp)
    app.register_blueprint(export_bp)
    app.register_blueprint(senders_bp)
    app.register_blueprint(correspondence_bp)
    app.register_blueprint(mailings_bp)

    @app.route('/')
    def index():
        return redirect(url_for('people.people_list'))

    return app


app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)
