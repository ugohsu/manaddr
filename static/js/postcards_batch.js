const tbody = document.getElementById('people-tbody');
const emptyMessage = document.getElementById('empty-message');
const alertBox = document.getElementById('alert-box');
const filterQ = document.getElementById('filter-q');
const filterStatus = document.getElementById('filter-status');
const filterTag = document.getElementById('filter-tag');
const selectAllVisible = document.getElementById('select-all-visible');
const selectedCountLabel = document.getElementById('selected-count');
const btnGenerate = document.getElementById('btn-generate');
const btnClearSelection = document.getElementById('btn-clear-selection');
const postcardType = document.getElementById('postcard-type');
const printerProfile = document.getElementById('printer-profile');

const STATUS_LABEL = {
  active: 'active', suspended: 'suspended', declined: 'declined', deceased: 'deceased',
};

// 検索/フィルタの状態に関係なく維持する選択状態（id → 氏名。スキップ通知での表示用に氏名も保持する）。
const selectedPeople = new Map();
// 右ペインで人物ごとに選んだワンショット印字設定（id → {classification, companionIds, includeCompany}）。
// 右ペインを一度開いた人物についてだけ遅延的に作られる。companionIds=null は連名全員を含める
// （デフォルト）、配列の場合はそのIDの連名だけを含める。includeCompanyはまだ印字に反映しない。
const personOverrides = new Map();
let currentPeople = [];
let activePersonId = null;

// 差出人一覧（初期化時に取得）
let allSenders = [];
// 右ペインで表示中の人物のDB保存設定（差出人・スケール）
let currentSenderOverride = { mode: 'default', sender_id: null };
let currentPostcardSettings = { name_scale: 1.0, address_scale: 1.0 };

function showError(message) {
  alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}

function showDetailError(message) {
  document.getElementById('pc-detail-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}

function personDisplayName(p) {
  return `${p.last_name || ''} ${p.first_name || ''}`.trim() || '(氏名未登録)';
}

function destinationLabel(p) {
  const override = personOverrides.get(p.id);
  return (override && override.classification) || p.address_classification || '—';
}

function renderRows(people) {
  if (people.length === 0) {
    tbody.innerHTML = '';
    emptyMessage.style.display = 'flex';
    return;
  }
  emptyMessage.style.display = 'none';
  tbody.innerHTML = people.map((p) => {
    const name = personDisplayName(p);
    const tags = (p.tags || '').split('、').filter(Boolean)
      .map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join(' ');
    const checked = selectedPeople.has(p.id) ? 'checked' : '';
    const active = String(p.id) === String(activePersonId) ? ' active' : '';
    return `
      <tr data-id="${p.id}" class="${active}">
        <td class="select-cell"><input type="checkbox" class="row-checkbox" data-id="${p.id}" ${checked}></td>
        <td>${escapeHtml(name)}</td>
        <td class="muted">${escapeHtml(destinationLabel(p))}</td>
        <td class="muted">${escapeHtml(p.address_summary || '')}</td>
        <td><div class="chip-list">${tags}</div></td>
        <td><span class="badge badge-${p.status}">${STATUS_LABEL[p.status] || p.status}</span></td>
      </tr>
    `;
  }).join('');
}

const btnRecord = document.getElementById('btn-record');

function updateSelectionUi() {
  const n = selectedPeople.size;
  selectedCountLabel.textContent = `選択中: ${n}件`;
  btnGenerate.disabled = n === 0;
  btnRecord.disabled = n === 0;
}

function updateSelectAllVisibleState() {
  if (currentPeople.length === 0) {
    selectAllVisible.checked = false;
    selectAllVisible.indeterminate = false;
    return;
  }
  const allChecked = currentPeople.every((p) => selectedPeople.has(p.id));
  const someChecked = currentPeople.some((p) => selectedPeople.has(p.id));
  selectAllVisible.checked = allChecked;
  selectAllVisible.indeterminate = !allChecked && someChecked;
}

// 一覧の行ハイライトと右ペインの表示を、IDに紐づけて同期させる。
function setActiveRow(id) {
  activePersonId = id;
  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.classList.toggle('active', id != null && String(tr.dataset.id) === String(id));
  });
}

function selectPerson(id) {
  if (id === activePersonId) return;
  setActiveRow(id);
  openDetailPane(id);
}

tbody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr || e.target.closest('.select-cell')) return;
  selectPerson(Number(tr.dataset.id));
});

tbody.addEventListener('change', (e) => {
  const checkbox = e.target.closest('.row-checkbox');
  if (!checkbox) return;
  const id = Number(checkbox.dataset.id);
  if (checkbox.checked) {
    const person = currentPeople.find((p) => p.id === id);
    selectedPeople.set(id, person ? personDisplayName(person) : `ID:${id}`);
  } else {
    selectedPeople.delete(id);
  }
  updateSelectionUi();
  updateSelectAllVisibleState();
});

selectAllVisible.addEventListener('change', () => {
  if (selectAllVisible.checked) {
    currentPeople.forEach((p) => selectedPeople.set(p.id, personDisplayName(p)));
  } else {
    currentPeople.forEach((p) => selectedPeople.delete(p.id));
  }
  renderRows(currentPeople);
  updateSelectionUi();
  updateSelectAllVisibleState();
});

btnClearSelection.addEventListener('click', () => {
  selectedPeople.clear();
  renderRows(currentPeople);
  updateSelectionUi();
  updateSelectAllVisibleState();
});

// 一括PDF生成はバイナリ(PDF)を返すため、JSON前提のapiFetchは使わずfetchを直接扱う。
// 同期待ち（README確定方針）でlualatexの処理が終わるまでボタンを無効化して待つ。
btnGenerate.addEventListener('click', async () => {
  if (selectedPeople.size === 0) return;
  const originalLabel = btnGenerate.textContent;
  btnGenerate.disabled = true;
  btnGenerate.textContent = '生成中…（しばらくお待ちください）';
  alertBox.innerHTML = '';
  try {
    const body = new URLSearchParams();
    Array.from(selectedPeople.keys()).forEach((id) => body.append('person_id', id));
    body.set('postcard_type', postcardType.value);
    if (printerProfile.value) body.set('printer_profile_id', printerProfile.value);
    // 右ペインで人物ごとに選んだ送付先・連名設定を、選択中の人物分だけ送る
    // （includeCompanyはまだバックエンドに配線していないため送らない）。
    const overrides = {};
    selectedPeople.forEach((_, id) => {
      const o = personOverrides.get(id);
      if (o) overrides[id] = { classification: o.classification, companion_ids: o.companionIds };
    });
    body.set('overrides', JSON.stringify(overrides));
    const res = await fetch('/export/postcards_batch', { method: 'POST', body });
    if (res.status === 401) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `生成に失敗しました (${res.status})`);
    }
    const skippedIds = (res.headers.get('X-Postcards-Skipped') || '')
      .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    const blob = await res.blob();
    const dlUrl = URL.createObjectURL(blob);
    window.open(dlUrl, '_blank');
    const dlAnchor = document.createElement('a');
    dlAnchor.href = dlUrl;
    dlAnchor.download = 'postcards.pdf';
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    document.body.removeChild(dlAnchor);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 10000);
    if (skippedIds.length > 0) {
      const names = skippedIds.map((id) => selectedPeople.get(id) || `ID:${id}`);
      showError(`以下の${names.length}件は宛名印字に使える住所が登録されていないためスキップしました: ${names.join('、')}`);
    }
  } catch (e) {
    showError(e.message);
  } finally {
    btnGenerate.disabled = selectedPeople.size === 0;
    btnGenerate.textContent = originalLabel;
  }
});

// ---------- 固定設定（DB保存）: 差出人・スケール ----------

function defaultSenderLabel() {
  const def = allSenders.find((s) => s.is_default);
  return def ? def.label : '差出人を印字しない';
}

function renderSenderSelect(override) {
  const selectedValue = override.mode === 'sender' ? `sender:${override.sender_id}` : override.mode;
  const select = document.getElementById('pc-sender-select');
  select.innerHTML = [
    `<option value="default" ${selectedValue === 'default' ? 'selected' : ''}>デフォルトを使用（${escapeHtml(defaultSenderLabel())}）</option>`,
    `<option value="none" ${selectedValue === 'none' ? 'selected' : ''}>差出人を印字しない</option>`,
    ...allSenders.map((s) => `<option value="sender:${s.id}" ${selectedValue === `sender:${s.id}` ? 'selected' : ''}>${escapeHtml(s.label)}</option>`),
  ].join('');
}

function renderScaleSliders(settings) {
  const nameScale = (settings && settings.name_scale != null) ? settings.name_scale : 1.0;
  const addressScale = (settings && settings.address_scale != null) ? settings.address_scale : 1.0;
  document.getElementById('pc-name-scale').value = nameScale;
  document.getElementById('pc-name-scale-value').textContent = Number(nameScale).toFixed(2);
  document.getElementById('pc-address-scale').value = addressScale;
  document.getElementById('pc-address-scale-value').textContent = Number(addressScale).toFixed(2);
}

document.getElementById('pc-sender-select').addEventListener('change', async (e) => {
  if (!activePersonId) return;
  const value = e.target.value;
  let payload;
  if (value === 'default' || value === 'none') {
    payload = { mode: value };
  } else {
    payload = { mode: 'sender', sender_id: Number(value.split(':')[1]) };
  }
  try {
    await apiPutJson(`/api/people/${activePersonId}/sender_override`, payload);
    currentSenderOverride = { mode: payload.mode, sender_id: payload.sender_id || null };
  } catch (err) {
    document.getElementById('pc-settings-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    renderSenderSelect(currentSenderOverride);
  }
});

document.getElementById('pc-name-scale').addEventListener('input', (e) => {
  document.getElementById('pc-name-scale-value').textContent = Number(e.target.value).toFixed(2);
});

document.getElementById('pc-address-scale').addEventListener('input', (e) => {
  document.getElementById('pc-address-scale-value').textContent = Number(e.target.value).toFixed(2);
});

async function savePostcardSettings() {
  if (!activePersonId) return;
  const nameScale = Number(document.getElementById('pc-name-scale').value);
  const addressScale = Number(document.getElementById('pc-address-scale').value);
  try {
    currentPostcardSettings = await apiPutJson(`/api/people/${activePersonId}/postcard_settings`, {
      postcard_type: postcardType.value,
      name_scale: nameScale,
      address_scale: addressScale,
    });
    document.getElementById('pc-settings-alert').innerHTML = '';
  } catch (err) {
    document.getElementById('pc-settings-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

document.getElementById('pc-name-scale').addEventListener('change', savePostcardSettings);
document.getElementById('pc-address-scale').addEventListener('change', savePostcardSettings);

// はがき種別が変わったとき、右ペインが開いていれば対応するスケール設定を再取得して表示を切り替える。
postcardType.addEventListener('change', async () => {
  if (!activePersonId) return;
  try {
    const settings = await apiFetch(
      `/api/people/${activePersonId}/postcard_settings?postcard_type=${encodeURIComponent(postcardType.value)}`
    );
    currentPostcardSettings = settings;
    renderScaleSliders(settings);
    document.getElementById('pc-settings-alert').innerHTML = '';
  } catch (e) {
    // スケール取得失敗は無視（既存の表示を維持）
  }
});

// ---------- 右ペイン（人物ごとの印字設定・単体プレビュー） ----------

// 右ペインを初めて開く人物について、一覧から取得済みの既定の送付先（address_classification）を
// 初期値として遅延的に設定を作る。以後はここを書き換えていく。
function ensureOverride(person) {
  if (!personOverrides.has(person.id)) {
    personOverrides.set(person.id, {
      classification: person.address_classification || null,
      companionIds: null,
      includeCompany: false,
    });
  }
  return personOverrides.get(person.id);
}

function showDetailPane() {
  document.getElementById('md-detail-placeholder').style.display = 'none';
  document.getElementById('md-detail-content').style.display = '';
  document.getElementById('md-detail-toolbar').style.display = '';
  document.getElementById('md-detail-scroll').scrollTop = 0;
  const masterDetail = document.getElementById('master-detail');
  if (masterDetail) masterDetail.classList.add('detail-open');
}

function closeDetailPane() {
  activePersonId = null;
  setActiveRow(null);
  document.getElementById('md-detail-content').style.display = 'none';
  document.getElementById('md-detail-placeholder').style.display = '';
  document.getElementById('md-detail-toolbar').style.display = 'none';
  setDetailExpanded(false);
  const masterDetail = document.getElementById('master-detail');
  if (masterDetail) masterDetail.classList.remove('detail-open');
}

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

document.getElementById('btn-back-to-list').addEventListener('click', () => {
  closeDetailPane();
});

function renderDetailPane(id, detail) {
  const d = detail.details.current || {};
  document.getElementById('pc-detail-name').textContent = personDisplayName(d);

  const listed = currentPeople.find((p) => p.id === id) || { id, address_classification: null };
  const override = ensureOverride(listed);

  const addresses = detail.addresses.current || [];
  const destSelect = document.getElementById('pc-destination-select');
  if (addresses.length === 0) {
    destSelect.innerHTML = '<option value="">（住所未登録）</option>';
    destSelect.disabled = true;
  } else {
    destSelect.disabled = false;
    destSelect.innerHTML = addresses.map((a) => {
      const summary = [a.prefecture, a.city, a.block].filter(Boolean).join('');
      return `<option value="${escapeHtml(a.classification)}">${escapeHtml(a.classification)}${summary ? `（${escapeHtml(summary)}）` : ''}</option>`;
    }).join('');
    if (!override.classification || !addresses.some((a) => a.classification === override.classification)) {
      override.classification = addresses[0].classification;
    }
    destSelect.value = override.classification;
  }

  const companions = detail.companions.current || [];
  const container = document.getElementById('pc-companions-container');
  if (companions.length === 0) {
    container.innerHTML = '<span class="muted" style="font-size:14px">（連名なし）</span>';
  } else {
    const checkedIds = override.companionIds;
    container.innerHTML = `<div class="field" style="margin-bottom:0"><label>連名</label><div style="padding-left:16px">${
      companions.map((c) => {
        const name = `${c.last_name || ''} ${c.first_name || ''}`.trim() || '(氏名未登録)';
        const isChecked = checkedIds === null || checkedIds.includes(c.id);
        return `<label style="display:flex;align-items:center;gap:6px;font-weight:normal;font-size:14px;margin-bottom:4px"><input type="checkbox" class="companion-checkbox" data-id="${c.id}" ${isChecked ? 'checked' : ''}> ${escapeHtml(name)}</label>`;
      }).join('')
    }</div></div>`;
  }

  document.getElementById('pc-include-company').checked = override.includeCompany;

  renderRows(currentPeople);
}

document.getElementById('pc-destination-select').addEventListener('change', (e) => {
  const override = personOverrides.get(activePersonId);
  if (!override) return;
  override.classification = e.target.value || null;
  renderRows(currentPeople);
});

document.getElementById('pc-companions-container').addEventListener('change', (e) => {
  const cb = e.target.closest('.companion-checkbox');
  if (!cb) return;
  const override = personOverrides.get(activePersonId);
  if (!override) return;
  const checkboxes = document.querySelectorAll('#pc-companions-container .companion-checkbox');
  override.companionIds = Array.from(checkboxes).filter((c) => c.checked).map((c) => Number(c.dataset.id));
});

document.getElementById('pc-include-company').addEventListener('change', (e) => {
  const override = personOverrides.get(activePersonId);
  if (override) override.includeCompany = e.target.checked;
});

document.getElementById('pc-btn-preview').addEventListener('click', () => {
  if (!activePersonId) return;
  const override = personOverrides.get(activePersonId) || {};
  const params = new URLSearchParams();
  params.set('postcard_type', postcardType.value);
  if (printerProfile.value) params.set('printer_profile_id', printerProfile.value);
  if (override.classification) params.set('classification', override.classification);
  if (override.companionIds !== null && override.companionIds !== undefined) {
    params.set('companion_ids', (override.companionIds || []).join(','));
  }
  window.open(`/export/postcard_preview/${activePersonId}?${params.toString()}`, '_blank', 'noopener');
});

async function openDetailPane(id) {
  activePersonId = id;
  showDetailPane();
  document.getElementById('pc-detail-alert').innerHTML = '';
  document.getElementById('pc-settings-alert').innerHTML = '';
  document.getElementById('pc-detail-name').textContent = '読み込み中…';
  try {
    const [detail, senderOverride, postcardSettings] = await Promise.all([
      apiFetch(`/api/people/${id}`),
      apiFetch(`/api/people/${id}/sender_override`),
      apiFetch(`/api/people/${id}/postcard_settings?postcard_type=${encodeURIComponent(postcardType.value)}`),
    ]);
    currentSenderOverride = senderOverride;
    currentPostcardSettings = postcardSettings;
    renderDetailPane(id, detail);
    renderSenderSelect(senderOverride);
    renderScaleSliders(postcardSettings);
  } catch (e) {
    showDetailError(e.message);
  }
}

// ---------- 一覧の読み込み ----------

async function loadTags() {
  try {
    const tags = await apiFetch('/api/tags');
    filterTag.innerHTML = '<option value="">すべて</option>' +
      tags.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
  } catch (e) {
    // タグ読み込み失敗は一覧表示自体をブロックしない
  }
}

async function loadSenders() {
  try {
    allSenders = await apiFetch('/api/senders');
  } catch (e) {
    // 差出人一覧の読み込み失敗は一覧表示自体をブロックしない
  }
}

// プリンタ調整プロファイル一覧を読み込み、既定（is_default）のプロファイルを
// 初期選択にする（無ければ「調整なし」のまま）。
async function loadPrinterProfiles() {
  try {
    const profileList = await apiFetch('/api/printer_profiles');
    const defaultProfile = profileList.find((p) => p.is_default);
    printerProfile.innerHTML = '<option value="">調整なし</option>' +
      profileList.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    if (defaultProfile) printerProfile.value = String(defaultProfile.id);
  } catch (e) {
    // プリンタ調整プロファイルの読み込み失敗は一覧表示自体をブロックしない（「調整なし」のまま使える）
  }
}

let loadTimer = null;
async function loadPeople() {
  const params = new URLSearchParams();
  if (filterQ.value.trim()) params.set('q', filterQ.value.trim());
  if (filterStatus.value) params.set('status', filterStatus.value);
  if (filterTag.value) params.set('tag', filterTag.value);
  try {
    currentPeople = await apiFetch('/api/people?' + params.toString());
    renderRows(currentPeople);
    updateSelectAllVisibleState();
  } catch (e) {
    showError(e.message);
  }
}

function scheduleLoad() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(loadPeople, 200);
}

filterQ.addEventListener('input', scheduleLoad);
filterStatus.addEventListener('change', loadPeople);
filterTag.addEventListener('change', loadPeople);

// ---------- 記録モーダル ----------

const recordModalOverlay = document.getElementById('record-modal-overlay');
const recordLabel = document.getElementById('record-label');
const recordFiscalYear = document.getElementById('record-fiscal-year');
const recordMemo = document.getElementById('record-memo');
const recordSummary = document.getElementById('record-summary');
const recordModalAlert = document.getElementById('record-modal-alert');

function openRecordModal() {
  const n = selectedPeople.size;
  recordSummary.textContent = `選択中の ${n} 件を記録します（はがき種別: ${postcardType.options[postcardType.selectedIndex].text}）`;
  recordFiscalYear.value = new Date().getFullYear();
  recordLabel.value = '';
  recordMemo.value = '';
  recordModalAlert.innerHTML = '';
  recordModalOverlay.style.display = 'flex';
  recordLabel.focus();
}

function closeRecordModal() {
  recordModalOverlay.style.display = 'none';
}

btnRecord.addEventListener('click', openRecordModal);
document.getElementById('record-modal-close').addEventListener('click', closeRecordModal);
document.getElementById('record-modal-cancel').addEventListener('click', closeRecordModal);
recordModalOverlay.addEventListener('click', (e) => {
  if (e.target === recordModalOverlay) closeRecordModal();
});

document.getElementById('record-modal-submit').addEventListener('click', async () => {
  const label = recordLabel.value.trim();
  if (!label) {
    recordModalAlert.innerHTML = '<div class="alert alert-error">タイトルは必須です</div>';
    recordLabel.focus();
    return;
  }
  const submitBtn = document.getElementById('record-modal-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = '記録中…';
  recordModalAlert.innerHTML = '';

  const overrides = {};
  selectedPeople.forEach((_, id) => {
    const o = personOverrides.get(id);
    if (o) overrides[id] = { classification: o.classification, companion_ids: o.companionIds };
  });

  try {
    await apiFetch('/api/mailings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        fiscal_year: Number(recordFiscalYear.value) || new Date().getFullYear(),
        memo: recordMemo.value.trim() || null,
        output_type: 'pdf_batch',
        postcard_type: postcardType.value,
        person_ids: Array.from(selectedPeople.keys()),
        overrides,
      }),
    });
    closeRecordModal();
    alertBox.innerHTML = '<div class="alert alert-success">送付を記録しました</div>';
    setTimeout(() => { alertBox.innerHTML = ''; }, 4000);
  } catch (e) {
    recordModalAlert.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '記録する';
  }
});

(async () => {
  await Promise.all([loadTags(), loadSenders(), loadPrinterProfiles()]);
  await loadPeople();
  updateSelectionUi();
})();
