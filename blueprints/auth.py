# -*- coding: utf-8 -*-
import os
import secrets

from flask import Blueprint, redirect, render_template, request, session, url_for

auth_bp = Blueprint('auth', __name__)

APP_PASSWORD = os.environ.get('APP_PASSWORD')


def safe_next_path(value, default):
    # 同一オリジンの相対パスのみ許可し、オープンリダイレクトを防ぐ
    if not value or not value.startswith('/') or value.startswith('//'):
        return default
    return value


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('authenticated') and request.method == 'GET':
        return redirect(url_for('people.people_list'))

    next_path = safe_next_path(request.args.get('next', ''), url_for('people.people_list'))

    error = None
    if request.method == 'POST':
        password = request.form.get('password', '')
        if APP_PASSWORD and secrets.compare_digest(password, APP_PASSWORD):
            session.permanent = True
            session['authenticated'] = True
            return redirect(safe_next_path(request.form.get('next', ''), next_path))
        error = 'パスワードが正しくありません'
    return render_template('login.html', error=error, next=next_path)


@auth_bp.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('auth.login'))
