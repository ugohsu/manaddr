document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.menu-toggle');
  const app = document.querySelector('.app');
  const backdrop = document.querySelector('.backdrop');
  if (toggle && app) {
    toggle.addEventListener('click', () => app.classList.toggle('sidebar-open'));
  }
  if (backdrop && app) {
    backdrop.addEventListener('click', () => app.classList.remove('sidebar-open'));
  }

  // 検索窓のクリア（×）ボタン: 入力があるときだけ表示し、クリックで値を消してinputイベントを発火する。
  const filterQ = document.getElementById('filter-q');
  const clearBtn = document.getElementById('filter-q-clear');
  if (filterQ && clearBtn) {
    const syncClearBtn = () => { clearBtn.style.display = filterQ.value ? 'block' : 'none'; };
    syncClearBtn();
    filterQ.addEventListener('input', syncClearBtn);
    clearBtn.addEventListener('click', () => {
      filterQ.value = '';
      filterQ.dispatchEvent(new Event('input'));
      filterQ.focus();
    });
  }
});

// 共通fetchラッパー: 401（未ログイン/セッション切れ）が来たらログイン画面へ。
// 成功時はJSONを、失敗時は{error}を持つErrorをthrowする。
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
    throw new Error('認証が必要です');
  }
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    body = null;
  }
  if (!res.ok) {
    const message = (body && body.error) || `リクエストに失敗しました (${res.status})`;
    throw new Error(message);
  }
  return body;
}

function apiPostJson(url, data) {
  return apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

function apiPutJson(url, data) {
  return apiFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// テキストノードにも属性値（value="..."等）にも安全に埋め込めるようにエスケープする
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// DBの recorded_at 等は "YYYY-MM-DD HH:MM:SS" 形式のUTCで保存されている
// （schema.sqlのdatetime('now')はタイムゾーン修飾子なし＝UTC）。表示は常に日本時間にする。
function formatJstDateTime(value) {
  if (!value) return '';
  const utc = new Date(value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(utc.getTime())) return value;
  return utc.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// 全角数字・全角ハイフン等をNFKCで半角化し、ちょうど7桁の数字ならNNN-NNNNに整形する。
// 7桁にならない場合も入力自体は止めず、正規化のみした文字列を返す（ソフトバリデーション）。
function normalizeZip(raw) {
  if (!raw) return raw;
  const halfwidth = raw.normalize('NFKC');
  const digits = halfwidth.replace(/[^0-9]/g, '');
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return halfwidth.trim();
}

function zipDigits(raw) {
  if (!raw) return '';
  return raw.normalize('NFKC').replace(/[^0-9]/g, '');
}

// zipcloud（無料・認証不要の郵便番号検索API）から都道府県・市区町村・町域を取得する。
// 番地以降は郵便番号からは特定できないため返ってこない（呼び出し側で手入力欄に残す）。
async function lookupZipAddress(zip7) {
  try {
    const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zip7}`);
    const body = await res.json();
    if (body.status !== 200 || !body.results) return [];
    return body.results.map((r) => ({ prefecture: r.address1, city: r.address2, town: r.address3 }));
  } catch (e) {
    return [];
  }
}

// 郵便番号欄の隣の検索ボタンに、押下時の正規化＋住所オートフィルを紐付ける。
// prefecture/cityは常に上書き、blockは空のときだけ町域名を補完する（既存の番地入力を消さないため）。
function bindZipAutofill({ zip, prefecture, city, block, button }) {
  if (!zip || !button) return;
  const defaultLabel = button.textContent;
  button.addEventListener('click', async () => {
    zip.value = normalizeZip(zip.value) || '';
    const digits = zipDigits(zip.value);
    if (digits.length !== 7) {
      zip.focus();
      return;
    }
    button.disabled = true;
    button.textContent = '検索中…';
    const results = await lookupZipAddress(digits);
    if (results.length > 0) {
      const r = results[0];
      if (prefecture) prefecture.value = r.prefecture;
      if (city) city.value = r.city;
      if (block && !block.value) block.value = r.town;
      button.textContent = defaultLabel;
      button.disabled = false;
    } else {
      button.textContent = '見つかりませんでした';
      setTimeout(() => {
        button.textContent = defaultLabel;
        button.disabled = false;
      }, 1500);
    }
  });
}

// 画像ライトボックス（全ページ共通）
(function () {
  let overlay = null;

  function openLightbox(src) {
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.className = 'lightbox-overlay';
    overlay.innerHTML = `<img class="lightbox-img" src="${escapeHtml(src)}" alt="拡大表示">`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => { overlay.remove(); overlay = null; });
    document.addEventListener('keydown', onKey, { once: true });
  }

  function onKey(ev) {
    if (ev.key === 'Escape' && overlay) { overlay.remove(); overlay = null; }
  }

  // chat-timeline や entries-list 内の img をクリックで拡大
  document.addEventListener('click', (ev) => {
    const img = ev.target.closest('.chat-bubble-inner img, .lightbox-trigger');
    if (img) openLightbox(img.src || img.dataset.src);
  });
})();
