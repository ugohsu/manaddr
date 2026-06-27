// PERSON_ID と PERSON_NAME はテンプレートで注入される

let entries = [];
let allLabels = [];
let activePopup = null;

// ── LOAD ──────────────────────────────────────────────────────────

async function load() {
  [entries, allLabels] = await Promise.all([
    apiFetch(`/api/people/${PERSON_ID}/correspondence`),
    apiFetch('/api/correspondence/labels'),
  ]);
  renderTimeline();
  renderPostLabels();
}

// ── TIMELINE ──────────────────────────────────────────────────────

function renderTimeline() {
  const el = document.getElementById('chat-timeline');
  if (!entries.length) {
    el.innerHTML = '<p class="muted" style="text-align:center;padding:20px">まだやりとりがありません</p>';
    return;
  }
  el.innerHTML = entries.map(entryHtml).join('');
  wireEntryButtons();
}

function entryHtml(e) {
  const cls = e.direction === 'received' ? 'received' : 'sent';
  const dirLabel = e.direction === 'received' ? '受信' : '送信';

  let content;
  if (e.entry_type === 'image') {
    content = `<img src="/api/correspondence/entries/${e.id}/image" loading="lazy" alt="画像" style="cursor:zoom-in">`;
  } else {
    content = `<div style="white-space:pre-wrap">${escapeHtml(e.body)}</div>`;
  }

  const memo = e.memo
    ? `<div class="chat-bubble-memo">${escapeHtml(e.memo)}</div>`
    : '';

  const labelChips = e.labels.map((l) => `
    <span class="chip">
      ${escapeHtml(l.name)}
      <button class="chip-btn chip-del-label"
              data-entry-id="${e.id}" data-label-id="${l.id}"
              title="ラベルを外す" aria-label="ラベル「${escapeHtml(l.name)}」を外す">×</button>
    </span>
  `).join('');

  const date = formatJstDateTime(e.recorded_at).slice(0, 16);

  return `
    <div class="chat-bubble ${cls}" data-entry-id="${e.id}">
      <div class="chat-bubble-inner">
        ${content}
        ${memo}
      </div>
      <div class="chat-bubble-meta">
        <span class="muted" style="font-size:11.5px">${escapeHtml(dirLabel)} · ${escapeHtml(date)}</span>
        <span class="chip-list">${labelChips}</span>
        <button class="btn btn-text btn-sm chat-add-label" data-entry-id="${e.id}">＋ラベル</button>
        <button class="btn btn-danger btn-sm chat-del-entry" data-entry-id="${e.id}">削除</button>
      </div>
    </div>
  `;
}

function wireEntryButtons() {
  document.querySelectorAll('.chip-del-label').forEach((btn) => {
    btn.addEventListener('click', () =>
      removeLabelFromEntry(Number(btn.dataset.entryId), Number(btn.dataset.labelId)));
  });
  document.querySelectorAll('.chat-del-entry').forEach((btn) => {
    btn.addEventListener('click', () => deleteEntry(Number(btn.dataset.entryId)));
  });
  document.querySelectorAll('.chat-add-label').forEach((btn) => {
    btn.addEventListener('click', (ev) =>
      showAddLabelPopup(ev.currentTarget, Number(btn.dataset.entryId)));
  });
}

// ── ラベル操作（バブル内） ─────────────────────────────────────────

async function removeLabelFromEntry(entryId, labelId) {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return;
  const newIds = entry.labels.filter((l) => l.id !== labelId).map((l) => l.id);
  try {
    entry.labels = await apiPutJson(`/api/correspondence/entries/${entryId}/labels`, { label_ids: newIds });
    renderTimeline();
  } catch (err) {
    showAlert(err.message);
  }
}

function showAddLabelPopup(btn, entryId) {
  if (activePopup) { activePopup.remove(); activePopup = null; }

  const popup = document.createElement('div');
  popup.className = 'add-label-popup';
  const datalistId = `dl-${entryId}-${Date.now()}`;
  popup.innerHTML = `
    <input list="${datalistId}" class="add-label-input" placeholder="ラベル名" autocomplete="off">
    <datalist id="${datalistId}">
      ${allLabels.map((l) => `<option value="${escapeHtml(l.name)}">`).join('')}
    </datalist>
    <button class="btn btn-sm" type="button">追加</button>
    <button class="btn btn-text btn-sm" type="button" data-cancel>キャンセル</button>
  `;
  btn.after(popup);
  activePopup = popup;

  const input = popup.querySelector('input');
  input.focus();

  popup.querySelector('[data-cancel]').addEventListener('click', () => { popup.remove(); activePopup = null; });
  popup.querySelector('.btn:not([data-cancel])').addEventListener('click', () =>
    addLabelToEntry(entryId, input.value.trim(), popup));
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); addLabelToEntry(entryId, input.value.trim(), popup); }
    if (ev.key === 'Escape') { popup.remove(); activePopup = null; }
  });
}

async function addLabelToEntry(entryId, labelName, popup) {
  if (!labelName) return;
  try {
    let label = allLabels.find((l) => l.name === labelName);
    if (!label) {
      label = await apiPostJson('/api/correspondence/labels', { name: labelName });
      allLabels.push(label);
    }
    const entry = entries.find((e) => e.id === entryId);
    if (!entry) return;
    if (entry.labels.some((l) => l.id === label.id)) { popup.remove(); activePopup = null; return; }
    const newIds = [...entry.labels.map((l) => l.id), label.id];
    entry.labels = await apiPutJson(`/api/correspondence/entries/${entryId}/labels`, { label_ids: newIds });
    popup.remove();
    activePopup = null;
    renderTimeline();
    renderPostLabels();
  } catch (err) {
    showAlert(err.message);
  }
}

async function deleteEntry(entryId) {
  if (!confirm('このエントリを削除しますか？元に戻せません。')) return;
  try {
    await apiFetch(`/api/correspondence/entries/${entryId}`, { method: 'DELETE' });
    entries = entries.filter((e) => e.id !== entryId);
    renderTimeline();
  } catch (err) {
    showAlert(err.message);
  }
}

// ── 投稿フォーム ──────────────────────────────────────────────────

function renderPostLabels() {
  const container = document.getElementById('post-labels');
  container.innerHTML = allLabels.map((l) => `
    <label class="chip chip-selectable" style="cursor:pointer;user-select:none">
      <input type="checkbox" name="label_ids" value="${l.id}" style="position:absolute;opacity:0;width:0;height:0">
      ${escapeHtml(l.name)}
    </label>
  `).join('') + `<button type="button" class="btn btn-text btn-sm" id="btn-new-post-label">＋ 新しいラベル</button>`;

  container.querySelectorAll('input[name="label_ids"]').forEach((cb) => {
    cb.addEventListener('change', () => cb.closest('.chip-selectable').classList.toggle('chip-accent', cb.checked));
  });

  document.getElementById('btn-new-post-label').addEventListener('click', async () => {
    const name = prompt('新しいラベル名:');
    if (!name || !name.trim()) return;
    try {
      const label = await apiPostJson('/api/correspondence/labels', { name: name.trim() });
      allLabels.push(label);
      renderPostLabels();
    } catch (err) {
      showAlert(err.message);
    }
  });
}

function setupPostForm() {
  const form = document.getElementById('post-form');
  const textArea = document.getElementById('post-text-area');
  const imageArea = document.getElementById('post-image-area');

  // カメラ・ライブラリ両 input を同一変数に集約
  let selectedImageFile = null;

  function onImageSelected(file) {
    if (!file) return;
    selectedImageFile = file;
    document.getElementById('post-image-filename').textContent = file.name;
  }

  document.getElementById('btn-open-camera').addEventListener('click', () => {
    document.getElementById('post-image-camera').click();
  });
  document.getElementById('btn-open-library').addEventListener('click', () => {
    document.getElementById('post-image-library').click();
  });
  document.getElementById('post-image-camera').addEventListener('change', (ev) => {
    onImageSelected(ev.target.files[0]);
  });
  document.getElementById('post-image-library').addEventListener('change', (ev) => {
    onImageSelected(ev.target.files[0]);
  });

  form.querySelectorAll('input[name="entry_type"]').forEach((r) => {
    r.addEventListener('change', () => {
      const isText = form.querySelector('input[name="entry_type"]:checked').value === 'text';
      textArea.style.display = isText ? '' : 'none';
      imageArea.style.display = isText ? 'none' : '';
    });
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = document.getElementById('post-submit');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = '投稿中…';

    try {
      const fd = new FormData();
      fd.append('direction', form.querySelector('input[name="direction"]:checked').value);
      const entryType = form.querySelector('input[name="entry_type"]:checked').value;
      fd.append('entry_type', entryType);
      const memoVal = document.getElementById('post-memo').value.trim();
      if (memoVal) fd.append('memo', memoVal);

      if (entryType === 'text') {
        fd.append('body', document.getElementById('post-body').value.trim());
      } else {
        if (!selectedImageFile) throw new Error('画像を選択してください');
        fd.append('image', selectedImageFile);
      }

      const selectedIds = [...form.querySelectorAll('input[name="label_ids"]:checked')].map((cb) => cb.value);
      fd.append('label_ids', selectedIds.join(','));

      const res = await fetch(`/api/people/${PERSON_ID}/correspondence`, { method: 'POST', body: fd });
      if (res.status === 401) {
        window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '投稿に失敗しました');

      entries.push(data);
      renderTimeline();

      document.getElementById('post-body').value = '';
      document.getElementById('post-image-camera').value = '';
      document.getElementById('post-image-library').value = '';
      document.getElementById('post-image-filename').textContent = '';
      selectedImageFile = null;
      document.getElementById('post-memo').value = '';
      form.querySelectorAll('input[name="label_ids"]:checked').forEach((cb) => {
        cb.checked = false;
        cb.closest('.chip-selectable').classList.remove('chip-accent');
      });

      document.getElementById('chat-timeline').lastElementChild?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      showAlert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

// ── ALERT ─────────────────────────────────────────────────────────

function showAlert(msg) {
  const box = document.getElementById('alert-box');
  box.innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`;
  setTimeout(() => { box.innerHTML = ''; }, 5000);
}

// ── INIT ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  setupPostForm();
  try {
    await load();
  } catch (err) {
    showAlert(err.message);
  }
});
