const tbody = document.getElementById('tags-tbody');
const emptyMessage = document.getElementById('empty-message');
const alertBox = document.getElementById('alert-box');
const newTagName = document.getElementById('new-tag-name');

function showError(message) {
  alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}

function rowHtml(t) {
  return `
    <tr data-id="${t.id}" data-name="${escapeHtml(t.name)}">
      <td>
        <span class="tag-name-display">${escapeHtml(t.name)}</span>
        <input type="text" class="tag-name-input" value="${escapeHtml(t.name)}" style="display:none">
      </td>
      <td class="muted">${t.usage_count}人</td>
      <td class="actions-cell">
        <button class="btn btn-text btn-sm" data-action="rename">名前を変更</button>
        <button class="btn btn-sm" data-action="save" style="display:none">保存</button>
        <button class="btn btn-text btn-sm" data-action="cancel" style="display:none">キャンセル</button>
        <button class="btn btn-danger btn-sm" data-action="delete">削除</button>
      </td>
    </tr>
  `;
}

function renderRows(tags) {
  if (tags.length === 0) {
    tbody.innerHTML = '';
    emptyMessage.style.display = 'flex';
    return;
  }
  emptyMessage.style.display = 'none';
  tbody.innerHTML = tags.map(rowHtml).join('');
}

tbody.addEventListener('click', (e) => {
  if (e.target.closest('button, input')) return;
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  window.location.href = `/people?tag=${encodeURIComponent(tr.dataset.name)}`;
});

async function loadTags() {
  try {
    const tags = await apiFetch('/api/tags');
    alertBox.innerHTML = '';
    renderRows(tags);
  } catch (err) {
    showError(err.message);
  }
}

document.getElementById('btn-add-tag').addEventListener('click', async () => {
  const name = newTagName.value.trim();
  if (!name) return;
  try {
    await apiPostJson('/api/tags', { name });
    newTagName.value = '';
    await loadTags();
  } catch (err) {
    showError(err.message);
  }
});

tbody.addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  const action = e.target.dataset.action;
  if (!tr || !action) return;
  const tagId = tr.dataset.id;

  if (action === 'rename') {
    tr.querySelector('.tag-name-display').style.display = 'none';
    tr.querySelector('.tag-name-input').style.display = '';
    tr.querySelector('[data-action="rename"]').style.display = 'none';
    tr.querySelector('[data-action="delete"]').style.display = 'none';
    tr.querySelector('[data-action="save"]').style.display = '';
    tr.querySelector('[data-action="cancel"]').style.display = '';
    tr.querySelector('.tag-name-input').focus();
  } else if (action === 'cancel') {
    await loadTags();
  } else if (action === 'save') {
    const name = tr.querySelector('.tag-name-input').value.trim();
    if (!name) return;
    try {
      await apiPutJson(`/api/tags/${tagId}`, { name });
      await loadTags();
    } catch (err) {
      showError(err.message);
    }
  } else if (action === 'delete') {
    const tagName = tr.querySelector('.tag-name-display').textContent;
    const usageCount = tr.children[1].textContent;
    if (!window.confirm(`タグ「${tagName}」を削除しますか？（${usageCount}から外れます。元に戻せません）`)) return;
    try {
      await apiFetch(`/api/tags/${tagId}`, { method: 'DELETE' });
      await loadTags();
    } catch (err) {
      showError(err.message);
    }
  }
});

loadTags();
