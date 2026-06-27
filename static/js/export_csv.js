const tbody = document.getElementById('people-tbody');
const emptyMessage = document.getElementById('empty-message');
const alertBox = document.getElementById('alert-box');
const filterQ = document.getElementById('filter-q');
const filterStatus = document.getElementById('filter-status');
const filterTag = document.getElementById('filter-tag');
const selectAllVisible = document.getElementById('select-all-visible');
const selectedCountLabel = document.getElementById('selected-count');
const btnExport = document.getElementById('btn-export');
const btnRecord = document.getElementById('btn-record');
const btnClearSelection = document.getElementById('btn-clear-selection');

const STATUS_LABEL = {
  active: 'active', suspended: 'suspended', declined: 'declined', deceased: 'deceased',
};

const selectedPeople = new Map();
// 右ペインで人物ごとに選んだ設定（id → {classification, companionIds}）。
// companionIds=null は連名全員を含める（デフォルト）。
const personOverrides = new Map();
let currentPeople = [];
let activePersonId = null;

function showError(msg) {
  alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`;
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

function updateSelectionUi() {
  const n = selectedPeople.size;
  selectedCountLabel.textContent = `選択中: ${n}件`;
  btnExport.disabled = n === 0;
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

// ---------- チェックボックス操作 ----------

function setActiveRow(id) {
  activePersonId = id;
  tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
    tr.classList.toggle('active', id != null && String(tr.dataset.id) === String(id));
  });
}

tbody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr || e.target.closest('.select-cell')) return;
  const id = Number(tr.dataset.id);
  if (id !== activePersonId) {
    setActiveRow(id);
    openDetailPane(id);
  }
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

document.getElementById('filter-q-clear').addEventListener('click', () => {
  filterQ.value = '';
  scheduleLoad();
});

// ---------- CSV エクスポート ----------

btnExport.addEventListener('click', async () => {
  if (selectedPeople.size === 0) return;
  const originalLabel = btnExport.textContent;
  btnExport.disabled = true;
  btnExport.textContent = '出力中…';
  alertBox.innerHTML = '';
  try {
    const body = new URLSearchParams();
    Array.from(selectedPeople.keys()).forEach((id) => body.append('person_id', id));
    const overrides = {};
    selectedPeople.forEach((_, id) => {
      const o = personOverrides.get(id);
      if (o) overrides[id] = { classification: o.classification, companion_ids: o.companionIds };
    });
    body.set('overrides', JSON.stringify(overrides));
    const res = await fetch('/export/rakusul_csv', { method: 'POST', body });
    if (res.status === 401) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    if (!res.ok) {
      throw new Error(await res.text() || `エラー (${res.status})`);
    }
    const skippedIds = (res.headers.get('X-Export-Skipped') || '')
      .split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    const blob = await res.blob();
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = 'rakusul_atena.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 10000);
    if (skippedIds.length > 0) {
      const names = skippedIds.map((id) => selectedPeople.get(id) || `ID:${id}`);
      showError(`以下の${names.length}件は住所が登録されていないためスキップしました: ${names.join('、')}`);
    }
  } catch (e) {
    showError(e.message);
  } finally {
    btnExport.disabled = selectedPeople.size === 0;
    btnExport.textContent = originalLabel;
  }
});

// ---------- 記録モーダル ----------

const recordModalOverlay = document.getElementById('record-modal-overlay');
const recordLabel = document.getElementById('record-label');
const recordFiscalYear = document.getElementById('record-fiscal-year');
const recordMemo = document.getElementById('record-memo');
const recordModalAlert = document.getElementById('record-modal-alert');

function openRecordModal() {
  document.getElementById('record-summary').textContent =
    `選択中の ${selectedPeople.size} 件を記録します（ラクスルCSV）`;
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
  try {
    const overrides = {};
    selectedPeople.forEach((_, id) => {
      const o = personOverrides.get(id);
      if (o) overrides[id] = { classification: o.classification, companion_ids: o.companionIds };
    });
    await apiFetch('/api/mailings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        fiscal_year: Number(recordFiscalYear.value) || new Date().getFullYear(),
        memo: recordMemo.value.trim() || null,
        output_type: 'rakusul_csv',
        postcard_type: null,
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

// ---------- 右ペイン ----------

function ensureOverride(person) {
  if (!personOverrides.has(person.id)) {
    personOverrides.set(person.id, {
      classification: person.address_classification || null,
      companionIds: null,
    });
  }
  return personOverrides.get(person.id);
}

function showDetailPane() {
  document.getElementById('md-detail-placeholder').style.display = 'none';
  document.getElementById('md-detail-content').style.display = '';
  document.getElementById('md-detail-toolbar').style.display = '';
  document.getElementById('md-detail-scroll').scrollTop = 0;
  document.getElementById('master-detail').classList.add('detail-open');
}

function closeDetailPane() {
  activePersonId = null;
  setActiveRow(null);
  document.getElementById('md-detail-content').style.display = 'none';
  document.getElementById('md-detail-placeholder').style.display = '';
  document.getElementById('md-detail-toolbar').style.display = 'none';
  setDetailExpanded(false);
  document.getElementById('master-detail').classList.remove('detail-open');
}

let detailExpanded = false;
function setDetailExpanded(expanded) {
  detailExpanded = expanded;
  document.getElementById('master-detail').classList.toggle('detail-expanded', expanded);
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
  document.getElementById('ec-detail-name').textContent = personDisplayName(d);

  const listed = currentPeople.find((p) => p.id === id) || { id, address_classification: null };
  const override = ensureOverride(listed);

  const addresses = detail.addresses.current || [];
  const destSelect = document.getElementById('ec-destination-select');
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
  const container = document.getElementById('ec-companions-container');
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

  renderRows(currentPeople);
}

document.getElementById('ec-destination-select').addEventListener('change', (e) => {
  const override = personOverrides.get(activePersonId);
  if (!override) return;
  override.classification = e.target.value || null;
  renderRows(currentPeople);
});

document.getElementById('ec-companions-container').addEventListener('change', (e) => {
  const cb = e.target.closest('.companion-checkbox');
  if (!cb) return;
  const override = personOverrides.get(activePersonId);
  if (!override) return;
  const checkboxes = document.querySelectorAll('#ec-companions-container .companion-checkbox');
  override.companionIds = Array.from(checkboxes).filter((c) => c.checked).map((c) => Number(c.dataset.id));
});

async function openDetailPane(id) {
  activePersonId = id;
  showDetailPane();
  document.getElementById('ec-detail-alert').innerHTML = '';
  document.getElementById('ec-detail-name').textContent = '読み込み中…';
  try {
    const detail = await apiFetch(`/api/people/${id}`);
    renderDetailPane(id, detail);
  } catch (e) {
    document.getElementById('ec-detail-alert').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  }
}

// ---------- フィルタ・人物一覧 ----------

async function loadTags() {
  try {
    const tags = await apiFetch('/api/tags');
    filterTag.innerHTML = '<option value="">すべて</option>' +
      tags.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  } catch (_) {}
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

(async () => {
  await loadTags();
  await loadPeople();
  updateSelectionUi();
})();
