const tbody = document.getElementById('people-tbody');
const emptyMessage = document.getElementById('empty-message');
const alertBox = document.getElementById('alert-box');
const filterQ = document.getElementById('filter-q');
const filterStatus = document.getElementById('filter-status');
const filterTag = document.getElementById('filter-tag');
const selectAllVisible = document.getElementById('select-all-visible');
const bulkBar = document.getElementById('bulk-bar');
const bulkCount = document.getElementById('bulk-count');
const bulkActionsToggle = document.getElementById('bulk-actions-toggle');
const bulkActionsPanel = document.getElementById('bulk-actions-panel');
const bulkStatusSelect = document.getElementById('bulk-status');
const bulkStatusApply = document.getElementById('bulk-status-apply');
const bulkTagSelect = document.getElementById('bulk-tag');
const bulkNewTagName = document.getElementById('bulk-new-tag-name');
const bulkTagApply = document.getElementById('bulk-tag-apply');
const bulkTagRemove = document.getElementById('bulk-tag-remove');
const bulkClear = document.getElementById('bulk-clear');

const STATUS_LABEL = {
  active: 'active', suspended: 'suspended', declined: 'declined', deceased: 'deceased',
};

// 検索/フィルタの状態に関係なく維持する選択状態（id → 氏名。確認ダイアログでの表示用に氏名も保持する）。
const selectedPeople = new Map();
let currentPeople = [];

// 右ペインに現在開いている人物のid（一覧の行ハイライトに使う）。初期表示時はサーバーから渡されたINITIAL_PERSON_ID。
let activePersonId = (typeof INITIAL_PERSON_ID !== 'undefined' && INITIAL_PERSON_ID) || null;

function showError(message) {
  alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}

function personUrl(id) {
  return `/people/${id}`;
}

function personDisplayName(p) {
  return `${p.last_name || ''} ${p.first_name || ''}`.trim() || '(氏名未登録)';
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
    const kana = `${p.last_name_kana || ''} ${p.first_name_kana || ''}`.trim();
    const tags = (p.tags || '').split('、').filter(Boolean)
      .map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join(' ');
    const checked = selectedPeople.has(p.id) ? 'checked' : '';
    const active = String(p.id) === String(activePersonId) ? ' active' : '';
    return `
      <tr data-id="${p.id}" class="${active}">
        <td class="select-cell"><input type="checkbox" class="row-checkbox" data-id="${p.id}" ${checked}></td>
        <td><a class="row-link" href="${personUrl(p.id)}">${escapeHtml(name)}</a></td>
        <td class="muted">${escapeHtml(kana)}</td>
        <td class="muted">${escapeHtml(p.address_summary || '')}</td>
        <td><div class="chip-list">${tags}</div></td>
        <td><span class="badge badge-${p.status}">${STATUS_LABEL[p.status] || p.status}</span></td>
      </tr>
    `;
  }).join('');
}

function updateBulkBar() {
  const n = selectedPeople.size;
  bulkBar.style.display = n > 0 ? 'block' : 'none';
  bulkCount.textContent = `選択中: ${n}件`;
  if (n === 0) closeBulkActionsPanel();
}

function closeBulkActionsPanel() {
  bulkActionsPanel.style.display = 'none';
  bulkActionsToggle.textContent = '一括操作';
}

bulkActionsToggle.addEventListener('click', () => {
  const isOpen = bulkActionsPanel.style.display !== 'none';
  if (isOpen) {
    closeBulkActionsPanel();
  } else {
    bulkActionsPanel.style.display = '';
    bulkActionsToggle.textContent = '一括操作を閉じる';
  }
});

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

// 行クリックで右ペインをAjax差し替え（フルページ遷移しない）。URLはpushStateで/people/<id>に同期する。
function selectPerson(id) {
  if (String(id) === String(activePersonId) &&
      document.getElementById('master-detail').classList.contains('detail-open')) {
    return; // 既に開いている人物の再クリックは何もしない
  }
  history.pushState(null, '', personUrl(id));
  setActiveRow(id);
  initPersonDetail(id);
}

tbody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr || e.target.closest('button, .select-cell')) return;
  const link = e.target.closest('a.row-link');
  if (link && (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)) return; // 新規タブ等はブラウザ標準動作に任せる
  e.preventDefault();
  selectPerson(Number(tr.dataset.id));
});

window.addEventListener('popstate', () => {
  const match = window.location.pathname.match(/^\/people\/(\d+)$/);
  if (match) {
    const id = Number(match[1]);
    setActiveRow(id);
    initPersonDetail(id);
  } else {
    setActiveRow(null);
    closeDetailPane();
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
  updateBulkBar();
  updateSelectAllVisibleState();
});

selectAllVisible.addEventListener('change', () => {
  if (selectAllVisible.checked) {
    currentPeople.forEach((p) => selectedPeople.set(p.id, personDisplayName(p)));
  } else {
    currentPeople.forEach((p) => selectedPeople.delete(p.id));
  }
  renderRows(currentPeople);
  updateBulkBar();
  updateSelectAllVisibleState();
});

bulkClear.addEventListener('click', () => {
  selectedPeople.clear();
  renderRows(currentPeople);
  updateBulkBar();
  updateSelectAllVisibleState();
});

bulkStatusApply.addEventListener('click', async () => {
  const status = bulkStatusSelect.value;
  if (!status) return;
  const names = Array.from(selectedPeople.values());
  if (!window.confirm(`以下の${names.length}件を status=${status} に変更します。よろしいですか？\n\n${names.join('、')}`)) return;
  try {
    await apiPostJson('/api/people/bulk/status', { person_ids: Array.from(selectedPeople.keys()), status });
    selectedPeople.clear();
    bulkStatusSelect.value = '';
    updateBulkBar();
    await loadPeople();
  } catch (e) {
    showError(e.message);
  }
});

bulkTagApply.addEventListener('click', async () => {
  const newName = bulkNewTagName.value.trim();
  let tagId = bulkTagSelect.value;
  let tagName = bulkTagSelect.options[bulkTagSelect.selectedIndex]?.textContent;

  if (newName) {
    try {
      const tag = await apiPostJson('/api/tags', { name: newName });
      tagId = tag.id;
      tagName = tag.name;
    } catch (e) {
      showError(e.message);
      return;
    }
  }
  if (!tagId) return;

  const names = Array.from(selectedPeople.values());
  if (!window.confirm(`以下の${names.length}件にタグ「${tagName}」を追加します。よろしいですか？\n\n${names.join('、')}`)) return;
  try {
    await apiPostJson('/api/people/bulk/tags', { person_ids: Array.from(selectedPeople.keys()), tag_id: Number(tagId) });
    selectedPeople.clear();
    bulkTagSelect.value = '';
    bulkNewTagName.value = '';
    await loadTags();
    updateBulkBar();
    await loadPeople();
  } catch (e) {
    showError(e.message);
  }
});

bulkTagRemove.addEventListener('click', async () => {
  const tagId = bulkTagSelect.value;
  if (!tagId) return;
  const tagName = bulkTagSelect.options[bulkTagSelect.selectedIndex]?.textContent;
  const names = Array.from(selectedPeople.values());
  if (!window.confirm(`以下の${names.length}件からタグ「${tagName}」を外します。よろしいですか？\n\n${names.join('、')}`)) return;
  try {
    await apiPostJson('/api/people/bulk/tags/remove', { person_ids: Array.from(selectedPeople.keys()), tag_id: Number(tagId) });
    selectedPeople.clear();
    bulkTagSelect.value = '';
    updateBulkBar();
    await loadPeople();
  } catch (e) {
    showError(e.message);
  }
});

async function loadTags() {
  try {
    const tags = await apiFetch('/api/tags');
    filterTag.innerHTML = '<option value="">すべて</option>' +
      tags.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
    bulkTagSelect.innerHTML = '<option value="">タグを一括付与…</option>' +
      tags.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  } catch (e) {
    // タグ読み込み失敗は一覧表示自体をブロックしない
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
    alertBox.innerHTML = '';
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
  // タグ管理画面からの「このタグの人物一覧へ」リンク（/people?tag=...）に対応
  const tagParam = new URLSearchParams(window.location.search).get('tag');
  if (tagParam) filterTag.value = tagParam;
  const peopleLoaded = loadPeople();
  if (activePersonId) await initPersonDetail(activePersonId);
  await peopleLoaded;
})();
