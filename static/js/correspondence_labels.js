let allLabels = [];
let selectedLabel = null;

// ── LOAD ──────────────────────────────────────────────────────────

async function load() {
  allLabels = await apiFetch('/api/correspondence/labels');
  renderLabels();
}

// ── LABELS ────────────────────────────────────────────────────────

function renderLabels() {
  const el = document.getElementById('labels-list');
  if (!allLabels.length) {
    el.innerHTML = '<p class="muted">ラベルがまだありません</p>';
    return;
  }
  el.innerHTML = allLabels.map((l) => `
    <div class="subitem label-item ${selectedLabel && selectedLabel.id === l.id ? 'label-item-active' : ''}"
         data-id="${l.id}" style="cursor:pointer">
      <div class="subitem-body">
        <div class="subitem-main label-name-cell">${escapeHtml(l.name)}</div>
        <div class="label-rename-form" style="display:none;margin-top:4px">
          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" class="rename-input" value="${escapeHtml(l.name)}" style="flex:1;padding:5px 8px;font-size:13px">
            <button class="btn btn-sm rename-save" type="button">保存</button>
            <button class="btn btn-text btn-sm rename-cancel" type="button">キャンセル</button>
          </div>
        </div>
      </div>
      <span class="muted" style="font-size:12px;flex:0 0 auto">${l.entry_count}件</span>
      <div class="subitem-actions">
        <button class="btn btn-secondary btn-sm rename-label"
                data-id="${l.id}" title="ラベル名を変更">編集</button>
        <button class="btn btn-danger btn-sm del-label"
                data-id="${l.id}" data-name="${escapeHtml(l.name)}" data-count="${l.entry_count}"
                title="ラベルを削除">削除</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.label-item').forEach((item) => {
    item.addEventListener('click', (ev) => {
      if (ev.target.closest('.rename-label') || ev.target.closest('.del-label') || ev.target.closest('.label-rename-form')) return;
      const id = Number(item.dataset.id);
      selectedLabel = allLabels.find((l) => l.id === id) || null;
      renderLabels();
      if (selectedLabel) loadLabelEntries(selectedLabel.name);
    });
  });

  el.querySelectorAll('.rename-label').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const item = btn.closest('.label-item');
      item.querySelector('.label-name-cell').style.display = 'none';
      item.querySelector('.label-rename-form').style.display = '';
      item.querySelector('.rename-input').focus();
    });
  });

  el.querySelectorAll('.rename-cancel').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const item = btn.closest('.label-item');
      item.querySelector('.label-name-cell').style.display = '';
      item.querySelector('.label-rename-form').style.display = 'none';
    });
  });

  el.querySelectorAll('.rename-save').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const item = btn.closest('.label-item');
      const id = Number(item.dataset.id);
      const newName = item.querySelector('.rename-input').value.trim();
      renameLabel(id, newName);
    });
  });

  el.querySelectorAll('.rename-input').forEach((input) => {
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        const item = input.closest('.label-item');
        const id = Number(item.dataset.id);
        renameLabel(id, input.value.trim());
      }
      if (ev.key === 'Escape') {
        const item = input.closest('.label-item');
        item.querySelector('.label-name-cell').style.display = '';
        item.querySelector('.label-rename-form').style.display = 'none';
      }
    });
  });

  el.querySelectorAll('.del-label').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteLabel(Number(btn.dataset.id), btn.dataset.name, Number(btn.dataset.count));
    });
  });
}

// ── ENTRIES BY LABEL ──────────────────────────────────────────────

async function loadLabelEntries(labelName) {
  const section = document.getElementById('entries-section');
  const list = document.getElementById('entries-list');
  document.getElementById('entries-label-name').textContent = `ラベル: ${labelName}`;
  section.style.display = '';
  list.innerHTML = '<p class="muted">読み込み中…</p>';

  try {
    const data = await apiFetch(`/api/correspondence/by-label/${encodeURIComponent(labelName)}`);
    renderLabelEntries(data);
  } catch (err) {
    list.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function renderLabelEntries(entries) {
  const list = document.getElementById('entries-list');
  if (!entries.length) {
    list.innerHTML = '<p class="muted">このラベルのエントリはありません</p>';
    return;
  }
  list.innerHTML = entries.map((e) => {
    const dir = e.direction === 'received' ? '受信' : '送信';
    const date = formatJstDateTime(e.recorded_at).slice(0, 16);
    let content;
    if (e.entry_type === 'image') {
      content = `<img src="/api/correspondence/entries/${e.id}/image" loading="lazy" alt="画像"
                      class="lightbox-trigger" style="max-height:160px;border-radius:8px;display:block;margin-top:6px;cursor:zoom-in">`;
    } else {
      content = `<div style="white-space:pre-wrap;margin-top:4px">${escapeHtml(e.body)}</div>`;
    }
    const memo = e.memo
      ? `<div class="chat-bubble-memo" style="margin-top:4px">${escapeHtml(e.memo)}</div>`
      : '';
    return `
      <div class="subitem">
        <div class="subitem-body">
          <div class="subitem-classification">
            <a href="/people/${e.person_id}/correspondence" style="color:var(--accent)">${escapeHtml(e.person_name)}</a>
            &nbsp;·&nbsp; ${escapeHtml(dir)} &nbsp;·&nbsp; ${escapeHtml(date)}
          </div>
          <div class="subitem-main">${content}${memo}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ── CREATE / DELETE ───────────────────────────────────────────────

async function renameLabel(id, newName) {
  if (!newName) return;
  try {
    const updated = await apiPutJson(`/api/correspondence/labels/${id}`, { name: newName });
    const idx = allLabels.findIndex((l) => l.id === id);
    if (idx !== -1) allLabels[idx] = updated;
    if (selectedLabel && selectedLabel.id === id) {
      selectedLabel = updated;
      document.getElementById('entries-label-name').textContent = `ラベル: ${updated.name}`;
    }
    renderLabels();
  } catch (err) {
    showAlert(err.message);
  }
}

document.getElementById('btn-new-label').addEventListener('click', async () => {
  const name = prompt('新しいラベル名:');
  if (!name || !name.trim()) return;
  try {
    const label = await apiPostJson('/api/correspondence/labels', { name: name.trim() });
    allLabels.push(label);
    renderLabels();
  } catch (err) {
    showAlert(err.message);
  }
});

async function deleteLabel(id, name, count) {
  const msg = count > 0
    ? `ラベル「${name}」を削除しますか？\n${count}件のエントリからラベルが外れます（エントリ自体は削除されません）。`
    : `ラベル「${name}」を削除しますか？`;
  if (!confirm(msg)) return;
  try {
    await apiFetch(`/api/correspondence/labels/${id}`, { method: 'DELETE' });
    allLabels = allLabels.filter((l) => l.id !== id);
    if (selectedLabel && selectedLabel.id === id) {
      selectedLabel = null;
      document.getElementById('entries-section').style.display = 'none';
    }
    renderLabels();
  } catch (err) {
    showAlert(err.message);
  }
}

// ── ALERT ─────────────────────────────────────────────────────────

function showAlert(msg) {
  const box = document.getElementById('alert-box');
  box.innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`;
  setTimeout(() => { box.innerHTML = ''; }, 5000);
}

// ── INIT ──────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await load();
  } catch (err) {
    showAlert(err.message);
  }
});
