let detail = null;
let allTags = [];
let PERSON_ID = null;

function showAlert(message) {
  document.getElementById('alert-box-detail').innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}

function renderHistorySection(rows, lineFn) {
  if (!rows || !rows.length) return '';
  return `
    <details class="history">
      <summary>履歴を見る（${rows.length}件）</summary>
      ${rows.map(lineFn).join('')}
    </details>
  `;
}

// 履歴行1件のマークアップ。物理削除ボタン付き（mailing_recipients等から参照されている場合はAPI側で拒否される）。
function historyRowHtml(table, row, innerHtml) {
  const cls = row.is_deleted ? 'history-row is-deleted' : 'history-row';
  return `
    <div class="${cls}">
      <span>${innerHtml}</span>
      <button class="btn btn-text btn-sm" data-action="delete-history" data-table="${table}" data-id="${row.id}">削除</button>
    </div>
  `;
}

function wireHistoryDeleteButtons(scope) {
  scope.querySelectorAll('[data-action="delete-history"]').forEach((btn) => {
    btn.addEventListener('click', () => deleteHistoryRow(btn.dataset.table, btn.dataset.id));
  });
}

async function deleteHistoryRow(table, rowId) {
  if (!window.confirm('この履歴を完全に削除しますか？元に戻せません。')) return;
  try {
    await apiFetch(`/api/people/${PERSON_ID}/${table}/${rowId}`, { method: 'DELETE' });
    await loadDetail();
  } catch (err) {
    showAlert(err.message);
  }
}

// ---------- 基本情報 ----------

function renderDetailsCard() {
  const d = detail.details.current || {};
  const card = document.getElementById('card-details');
  document.getElementById('page-title').textContent =
    `${d.last_name || ''} ${d.first_name || ''}`.trim() || '(氏名未登録)';
  const rows = [
    ['カナ', `${d.last_name_kana || ''} ${d.first_name_kana || ''}`.trim()],
    ['敬称', d.honorific],
    ['生年月日', d.birthday],
    ['性別', d.gender],
    ['勤務先', [d.company_name, d.department1, d.department2, d.position].filter(Boolean).join(' / ')],
    ['メモ', d.memo],
  ].filter(([, v]) => v);
  card.innerHTML = `
    <div class="card-header">
      <h3 class="card-title">基本情報</h3>
      <div class="spacer"></div>
      <span class="badge badge-${escapeHtml(d.status)}">${escapeHtml(d.status || '')}</span>
      <button class="btn btn-secondary btn-sm" id="btn-edit-details">編集</button>
    </div>
    <div>
      ${rows.length ? rows.map(([k, v]) => `
        <div class="subitem">
          <div class="subitem-body">
            <span class="subitem-classification">${escapeHtml(k)}</span>
            <div class="subitem-main">${escapeHtml(v)}</div>
          </div>
        </div>
      `).join('') : '<p class="muted">情報がありません</p>'}
    </div>
    <div id="details-form-wrap"></div>
    ${renderHistorySection(detail.details.history, detailsHistoryLine)}
  `;
  document.getElementById('btn-edit-details').addEventListener('click', () => openDetailsForm(d));
  wireHistoryDeleteButtons(card);
}

function detailsHistoryLine(d) {
  const name = `${d.last_name || ''} ${d.first_name || ''}`.trim();
  return historyRowHtml('details', d, `${escapeHtml(formatJstDateTime(d.recorded_at))} — ${escapeHtml(name)}（${escapeHtml(d.status)}）`);
}

function openDetailsForm(d) {
  const wrap = document.getElementById('details-form-wrap');
  wrap.innerHTML = `
    <form class="inline-form" id="details-form">
      <div class="field-row">
        <div class="field"><label>姓</label><input type="text" name="last_name" value="${escapeHtml(d.last_name)}"></div>
        <div class="field"><label>名</label><input type="text" name="first_name" value="${escapeHtml(d.first_name)}"></div>
        <div class="field"><label>敬称</label><input type="text" name="honorific" value="${escapeHtml(d.honorific)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>セイ</label><input type="text" name="last_name_kana" value="${escapeHtml(d.last_name_kana)}"></div>
        <div class="field"><label>メイ</label><input type="text" name="first_name_kana" value="${escapeHtml(d.first_name_kana)}"></div>
        <div class="field">
          <label>状態</label>
          <select name="status">
            ${['active', 'suspended', 'declined', 'deceased'].map((s) =>
              `<option value="${s}" ${d.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>生年月日</label><input type="date" name="birthday" value="${escapeHtml(d.birthday)}"></div>
        <div class="field"><label>性別</label><input type="text" name="gender" value="${escapeHtml(d.gender)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>勤務先名</label><input type="text" name="company_name" value="${escapeHtml(d.company_name)}"></div>
        <div class="field"><label>勤務先カナ</label><input type="text" name="company_kana" value="${escapeHtml(d.company_kana)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>部署1</label><input type="text" name="department1" value="${escapeHtml(d.department1)}"></div>
        <div class="field"><label>部署2</label><input type="text" name="department2" value="${escapeHtml(d.department2)}"></div>
        <div class="field"><label>役職</label><input type="text" name="position" value="${escapeHtml(d.position)}"></div>
      </div>
      <div class="field"><label>メモ</label><textarea name="memo" rows="2">${escapeHtml(d.memo)}</textarea></div>
      <div class="field-row">
        <button type="submit" class="btn btn-sm">保存（新しいバージョンとして記録）</button>
        <button type="button" class="btn btn-text btn-sm" data-action="cancel">キャンセル</button>
      </div>
    </form>
  `;
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', () => { wrap.innerHTML = ''; });
  wrap.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, v] of fd.entries()) payload[k] = v || null;
    try {
      await apiPostJson(`/api/people/${PERSON_ID}/details`, payload);
      wrap.innerHTML = '';
      await loadDetail();
    } catch (err) {
      showAlert(err.message);
    }
  });
}

// ---------- 住所 ----------

function renderAddressesCard() {
  const card = document.getElementById('card-addresses');
  const current = detail.addresses.current;
  card.innerHTML = `
    <div class="card-header">
      <h3 class="card-title">住所</h3>
      <div class="spacer"></div>
      <button class="btn btn-secondary btn-sm" id="btn-add-address">＋ 追加</button>
    </div>
    <div>
      ${current.length ? current.map(addressItemHtml).join('') : '<p class="muted">住所が登録されていません</p>'}
    </div>
    <div id="address-form-wrap"></div>
    ${renderHistorySection(detail.addresses.history, addressHistoryLine)}
  `;
  document.getElementById('btn-add-address').addEventListener('click', () => openAddressForm(null));
  card.querySelectorAll('[data-action="edit-address"]').forEach((btn) => {
    btn.addEventListener('click', () => openAddressForm(current.find((a) => String(a.id) === btn.dataset.id)));
  });
  card.querySelectorAll('[data-action="delete-address"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = current.find((a) => String(a.id) === btn.dataset.id);
      if (window.confirm(`「${item.classification}」の住所を削除しますか？（履歴には残ります）`)) deleteAddress(item);
    });
  });
  wireHistoryDeleteButtons(card);
}

function addressItemHtml(a) {
  const lines = [a.zip, [a.prefecture, a.city, a.block].filter(Boolean).join(''), a.building,
    a.nearest_station ? `最寄駅: ${a.nearest_station}` : ''].filter(Boolean);
  return `
    <div class="subitem">
      <div class="subitem-body">
        <span class="subitem-classification">${escapeHtml(a.classification)}${a.priority ? ` (優先度 ${escapeHtml(a.priority)})` : ''}</span>
        <div class="subitem-main">${lines.map(escapeHtml).join('<br>')}</div>
      </div>
      <div class="subitem-actions">
        <button class="btn btn-text btn-sm" data-action="edit-address" data-id="${a.id}">編集</button>
        <button class="btn btn-danger btn-sm" data-action="delete-address" data-id="${a.id}">削除</button>
      </div>
    </div>
  `;
}

function addressHistoryLine(a) {
  const text = [a.classification, a.zip, a.prefecture, a.city, a.block, a.building].filter(Boolean).join(' / ');
  return historyRowHtml('addresses', a, `${escapeHtml(formatJstDateTime(a.recorded_at))} — ${escapeHtml(text)}${a.is_deleted ? '（削除）' : ''}`);
}

function openAddressForm(item) {
  const wrap = document.getElementById('address-form-wrap');
  const v = item || {};
  wrap.innerHTML = `
    <form class="inline-form" id="address-form">
      <div class="field-row">
        <div class="field"><label>分類</label><input type="text" name="classification" value="${escapeHtml(v.classification || '自宅')}" required></div>
        <div class="field"><label>優先度</label><input type="number" name="priority" value="${escapeHtml(v.priority)}"></div>
        <div class="field">
          <label>郵便番号</label>
          <div style="display:flex;gap:6px">
            <input type="text" name="zip" value="${escapeHtml(v.zip)}" style="flex:1">
            <button type="button" class="btn btn-secondary btn-sm" data-action="lookup-zip">住所を検索</button>
          </div>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>都道府県</label><input type="text" name="prefecture" value="${escapeHtml(v.prefecture)}"></div>
        <div class="field"><label>市区町村</label><input type="text" name="city" value="${escapeHtml(v.city)}"></div>
        <div class="field"><label>町名番地</label><input type="text" name="block" value="${escapeHtml(v.block)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>建物名・部屋番号</label><input type="text" name="building" value="${escapeHtml(v.building)}"></div>
        <div class="field"><label>最寄駅</label><input type="text" name="nearest_station" value="${escapeHtml(v.nearest_station)}"></div>
      </div>
      <div class="field-row">
        <button type="submit" class="btn btn-sm">保存</button>
        <button type="button" class="btn btn-text btn-sm" data-action="cancel">キャンセル</button>
      </div>
    </form>
  `;
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', () => { wrap.innerHTML = ''; });
  const formEl = wrap.querySelector('form');
  bindZipAutofill({
    zip: formEl.elements['zip'],
    prefecture: formEl.elements['prefecture'],
    city: formEl.elements['city'],
    block: formEl.elements['block'],
    button: formEl.querySelector('[data-action="lookup-zip"]'),
  });
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, val] of fd.entries()) payload[k] = val || null;
    if (payload.priority) payload.priority = Number(payload.priority);
    try {
      await apiPostJson(`/api/people/${PERSON_ID}/addresses`, payload);
      wrap.innerHTML = '';
      await loadDetail();
    } catch (err) {
      showAlert(err.message);
    }
  });
}

async function deleteAddress(item) {
  try {
    await apiPostJson(`/api/people/${PERSON_ID}/addresses`, { ...item, is_deleted: true });
    await loadDetail();
  } catch (err) {
    showAlert(err.message);
  }
}

// ---------- 電話・メール・URL（共通パターン） ----------

const CONTACT_LABELS = { phones: '電話', emails: 'メール', urls: 'URL' };

function renderContactCard(kind) {
  const label = CONTACT_LABELS[kind];
  const card = document.getElementById(`card-${kind}`);
  const current = detail[kind].current;
  card.innerHTML = `
    <div class="card-header">
      <h3 class="card-title">${label}</h3>
      <div class="spacer"></div>
      <button class="btn btn-secondary btn-sm" data-action="add">＋ 追加</button>
    </div>
    <div>
      ${current.length ? current.map((c) => contactItemHtml(kind, c)).join('') : `<p class="muted">${label}が登録されていません</p>`}
    </div>
    <div id="${kind}-form-wrap"></div>
    ${renderHistorySection(detail[kind].history, (c) => contactHistoryLine(kind, c))}
  `;
  card.querySelector('[data-action="add"]').addEventListener('click', () => openContactForm(kind, null));
  card.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => openContactForm(kind, current.find((c) => String(c.id) === btn.dataset.id)));
  });
  card.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = current.find((c) => String(c.id) === btn.dataset.id);
      if (window.confirm(`「${item.value}」を削除しますか？（履歴には残ります）`)) deleteContact(kind, item);
    });
  });
  wireHistoryDeleteButtons(card);
}

function contactItemHtml(kind, c) {
  return `
    <div class="subitem">
      <div class="subitem-body">
        <span class="subitem-classification">${escapeHtml(c.classification || '')}</span>
        <div class="subitem-main">${escapeHtml(c.value)}</div>
      </div>
      <div class="subitem-actions">
        <button class="btn btn-text btn-sm" data-action="edit" data-id="${c.id}">編集</button>
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${c.id}">削除</button>
      </div>
    </div>
  `;
}

function contactHistoryLine(kind, c) {
  return historyRowHtml(kind, c, `${escapeHtml(formatJstDateTime(c.recorded_at))} — ${escapeHtml(c.classification || '')}: ${escapeHtml(c.value)}${c.is_deleted ? '（削除）' : ''}`);
}

function openContactForm(kind, item) {
  const wrap = document.getElementById(`${kind}-form-wrap`);
  const v = item || {};
  wrap.innerHTML = `
    <form class="inline-form">
      <div class="field-row">
        <div class="field"><label>分類</label><input type="text" name="classification" value="${escapeHtml(v.classification)}" placeholder="携帯・自宅など"></div>
        <div class="field"><label>値</label><input type="text" name="value" value="${escapeHtml(v.value)}" required></div>
      </div>
      <div class="field-row">
        <button type="submit" class="btn btn-sm">保存</button>
        <button type="button" class="btn btn-text btn-sm" data-action="cancel">キャンセル</button>
      </div>
    </form>
  `;
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', () => { wrap.innerHTML = ''; });
  wrap.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = { classification: fd.get('classification') || null, value: fd.get('value') };
    try {
      await apiPostJson(`/api/people/${PERSON_ID}/${kind}`, payload);
      wrap.innerHTML = '';
      await loadDetail();
    } catch (err) {
      showAlert(err.message);
    }
  });
}

async function deleteContact(kind, item) {
  try {
    await apiPostJson(`/api/people/${PERSON_ID}/${kind}`, { ...item, is_deleted: true });
    await loadDetail();
  } catch (err) {
    showAlert(err.message);
  }
}

// ---------- 連名 ----------

function renderCompanionsCard() {
  const card = document.getElementById('card-companions');
  const current = detail.companions.current;
  card.innerHTML = `
    <div class="card-header">
      <h3 class="card-title">連名</h3>
      <div class="spacer"></div>
      <button class="btn btn-secondary btn-sm" id="btn-add-companion">＋ 追加</button>
    </div>
    <div>
      ${current.length ? current.map(companionItemHtml).join('') : '<p class="muted">連名が登録されていません</p>'}
    </div>
    <div id="companion-form-wrap"></div>
    ${renderHistorySection(detail.companions.history, companionHistoryLine)}
  `;
  document.getElementById('btn-add-companion').addEventListener('click', () => openCompanionForm(null));
  card.querySelectorAll('[data-action="edit-companion"]').forEach((btn) => {
    btn.addEventListener('click', () => openCompanionForm(current.find((c) => String(c.id) === btn.dataset.id)));
  });
  card.querySelectorAll('[data-action="delete-companion"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = current.find((c) => String(c.id) === btn.dataset.id);
      if (window.confirm('この連名を削除しますか？（履歴には残ります）')) deleteCompanion(item);
    });
  });
  wireHistoryDeleteButtons(card);
}

function companionItemHtml(c) {
  const name = `${c.last_name || ''} ${c.first_name || ''}`.trim();
  return `
    <div class="subitem">
      <div class="subitem-body">
        <span class="subitem-classification">順序 ${c.sort_order}</span>
        <div class="subitem-main">${escapeHtml(name)}${c.honorific ? ' ' + escapeHtml(c.honorific) : ''}</div>
      </div>
      <div class="subitem-actions">
        <button class="btn btn-text btn-sm" data-action="edit-companion" data-id="${c.id}">編集</button>
        <button class="btn btn-danger btn-sm" data-action="delete-companion" data-id="${c.id}">削除</button>
      </div>
    </div>
  `;
}

function companionHistoryLine(c) {
  const name = `${c.last_name || ''} ${c.first_name || ''}`.trim();
  return historyRowHtml('companions', c, `${escapeHtml(formatJstDateTime(c.recorded_at))} — 順序${c.sort_order}: ${escapeHtml(name)}${c.is_deleted ? '（削除）' : ''}`);
}

function openCompanionForm(item) {
  const wrap = document.getElementById('companion-form-wrap');
  const v = item || {};
  wrap.innerHTML = `
    <form class="inline-form">
      <input type="hidden" name="sort_order" value="${v.sort_order != null ? escapeHtml(v.sort_order) : ''}">
      <div class="field-row">
        <div class="field"><label>姓</label><input type="text" name="last_name" value="${escapeHtml(v.last_name)}"></div>
        <div class="field"><label>名</label><input type="text" name="first_name" value="${escapeHtml(v.first_name)}"></div>
        <div class="field"><label>敬称</label><input type="text" name="honorific" value="${escapeHtml(v.honorific)}" placeholder="様・ちゃん"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>セイ</label><input type="text" name="last_name_kana" value="${escapeHtml(v.last_name_kana)}"></div>
        <div class="field"><label>メイ</label><input type="text" name="first_name_kana" value="${escapeHtml(v.first_name_kana)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>生年月日</label><input type="date" name="birthday" value="${escapeHtml(v.birthday)}"></div>
        <div class="field"><label>性別</label><input type="text" name="gender" value="${escapeHtml(v.gender)}"></div>
      </div>
      <div class="field-row">
        <button type="submit" class="btn btn-sm">保存</button>
        <button type="button" class="btn btn-text btn-sm" data-action="cancel">キャンセル</button>
      </div>
    </form>
  `;
  wrap.querySelector('[data-action="cancel"]').addEventListener('click', () => { wrap.innerHTML = ''; });
  wrap.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const [k, val] of fd.entries()) payload[k] = val || null;
    if (payload.sort_order) payload.sort_order = Number(payload.sort_order);
    try {
      await apiPostJson(`/api/people/${PERSON_ID}/companions`, payload);
      wrap.innerHTML = '';
      await loadDetail();
    } catch (err) {
      showAlert(err.message);
    }
  });
}

async function deleteCompanion(item) {
  try {
    await apiPostJson(`/api/people/${PERSON_ID}/companions`, { ...item, is_deleted: true });
    await loadDetail();
  } catch (err) {
    showAlert(err.message);
  }
}

// ---------- タグ ----------

function renderTagsCard() {
  const card = document.getElementById('card-tags');
  const assignedIds = new Set(detail.tags.map((t) => t.id));
  card.innerHTML = `
    <div class="card-header"><h3 class="card-title">タグ</h3></div>
    <div class="chip-list" id="tag-chip-list">
      ${allTags.map((t) => `
        <span class="chip ${assignedIds.has(t.id) ? 'chip-accent' : ''}" data-action="toggle-tag" data-id="${t.id}" style="cursor:pointer">${escapeHtml(t.name)}</span>
      `).join('') || '<span class="muted">タグがまだ登録されていません</span>'}
    </div>
    <div class="field-row" style="margin-top:12px">
      <div class="field"><label>新規タグ</label><input type="text" id="new-tag-name" placeholder="例: 大学同期"></div>
      <button class="btn btn-secondary btn-sm" id="btn-add-tag" style="align-self:flex-end;margin-bottom:12px">追加</button>
    </div>
  `;
  card.querySelectorAll('[data-action="toggle-tag"]').forEach((chip) => {
    chip.addEventListener('click', () => toggleTag(Number(chip.dataset.id)));
  });
  document.getElementById('btn-add-tag').addEventListener('click', addNewTag);
}

async function toggleTag(tagId) {
  const assignedIds = new Set(detail.tags.map((t) => t.id));
  if (assignedIds.has(tagId)) {
    assignedIds.delete(tagId);
  } else {
    assignedIds.add(tagId);
  }
  try {
    await apiPutJson(`/api/people/${PERSON_ID}/tags`, { tag_ids: Array.from(assignedIds) });
    await loadDetail();
  } catch (err) {
    showAlert(err.message);
  }
}

async function addNewTag() {
  const input = document.getElementById('new-tag-name');
  const name = input.value.trim();
  if (!name) return;
  try {
    const tag = await apiPostJson('/api/tags', { name });
    if (!allTags.find((t) => t.id === tag.id)) allTags.push(tag);
    await toggleTag(tag.id);
  } catch (err) {
    showAlert(err.message);
  }
}

// ---------- 初期化 ----------

function renderAll() {
  renderDetailsCard();
  renderAddressesCard();
  renderContactCard('phones');
  renderContactCard('emails');
  renderContactCard('urls');
  renderCompanionsCard();
  renderTagsCard();
}

async function loadDetail() {
  try {
    detail = await apiFetch(`/api/people/${PERSON_ID}`);
    document.getElementById('alert-box-detail').innerHTML = '';
    renderAll();
  } catch (err) {
    showAlert(err.message);
  }
}

// 右ペインの「人物を選択してください」プレースホルダ⇄詳細コンテンツの表示切替。
// #master-detail の .detail-open は、モバイル幅で一覧/詳細のどちらを全画面表示するかをCSS側で判定するために使う。
function showDetailPane() {
  document.getElementById('md-detail-placeholder').style.display = 'none';
  document.getElementById('md-detail-content').style.display = '';
  document.getElementById('md-detail-toolbar').style.display = '';
  document.getElementById('md-detail-scroll').scrollTop = 0;
  const masterDetail = document.getElementById('master-detail');
  if (masterDetail) masterDetail.classList.add('detail-open');
}

function closeDetailPane() {
  PERSON_ID = null;
  detail = null;
  document.getElementById('md-detail-content').style.display = 'none';
  document.getElementById('md-detail-placeholder').style.display = '';
  document.getElementById('md-detail-toolbar').style.display = 'none';
  setDetailExpanded(false);
  const masterDetail = document.getElementById('master-detail');
  if (masterDetail) masterDetail.classList.remove('detail-open');
}

// 詳細を1ペインに拡大（一覧を隠す）⇄2ペインに戻す。詳細パネルの本文スクロール（.md-detail-scroll）とは
// 別の固定ツールバー（.md-detail-toolbar）にボタンを置いているので、本文をどれだけスクロールしていても押せる。
let detailExpanded = false;

function setDetailExpanded(expanded) {
  detailExpanded = expanded;
  const masterDetail = document.getElementById('master-detail');
  if (masterDetail) masterDetail.classList.toggle('detail-expanded', expanded);
  const btn = document.getElementById('btn-toggle-expand');
  if (expanded) {
    btn.textContent = '⤡';
    btn.title = '一覧を表示に戻す';
    btn.setAttribute('aria-label', '一覧を表示に戻す');
  } else {
    btn.textContent = '⤢';
    btn.title = '一覧を隠して全画面表示';
    btn.setAttribute('aria-label', '詳細を全画面表示');
  }
}

document.getElementById('btn-toggle-expand').addEventListener('click', () => {
  setDetailExpanded(!detailExpanded);
});

// 人物一覧（people_list.js）の行クリック・初期表示・popstateから呼ばれる。
// 呼び直すたびにタグ一覧も含めて読み込み直すので、別の人物に切り替えても表示内容が常に最新になる。
async function initPersonDetail(id) {
  PERSON_ID = id;
  const btnCorr = document.getElementById('btn-correspondence');
  if (btnCorr) btnCorr.href = `/people/${id}/correspondence`;
  showDetailPane();
  document.getElementById('alert-box-detail').innerHTML = '';
  try {
    allTags = await apiFetch('/api/tags');
  } catch (e) {
    // タグ一覧の読み込み失敗は詳細表示自体をブロックしない
  }
  await loadDetail();
}

document.getElementById('btn-delete-person').addEventListener('click', async () => {
  const d = (detail && detail.details.current) || {};
  const name = `${d.last_name || ''} ${d.first_name || ''}`.trim() || '(氏名未登録)';
  if (!window.confirm(`「${name}」を削除しますか？住所・連名・タグ等もすべて削除され、元に戻せません。`)) return;
  try {
    await apiFetch(`/api/people/${PERSON_ID}`, { method: 'DELETE' });
    history.pushState(null, '', '/people');
    closeDetailPane();
    if (typeof loadPeople === 'function') await loadPeople();
  } catch (err) {
    showAlert(err.message);
  }
});

document.getElementById('btn-back-to-list').addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 新規タブ等はブラウザ標準動作に任せる
  e.preventDefault();
  history.pushState(null, '', '/people');
  closeDetailPane();
  if (typeof setActiveRow === 'function') setActiveRow(null);
});
