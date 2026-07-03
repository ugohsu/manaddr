const alertBox = document.getElementById('alert-box');
const tbody = document.getElementById('profiles-tbody');
const emptyMessage = document.getElementById('profiles-empty');
const formWrap = document.getElementById('profile-form-wrap');

let profiles = [];

function showError(message) {
  alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}

// ---------- フォーム（新規・編集共用、トグル展開） ----------

function profileFormHtml(p) {
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3 class="card-title">${p.id ? `プロファイルを編集（${escapeHtml(p.name)}）` : 'プロファイルを追加'}</h3></div>
      <form id="profile-form">
        <input type="hidden" id="pf-id" value="${p.id || ''}">
        <div class="field-row">
          <div class="field"><label>名前</label><input type="text" id="pf-name" placeholder="例: Canon GX7130" value="${escapeHtml(p.name || '')}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>横倍率(scale_x)</label><input type="number" step="0.001" id="pf-scale-x" value="${p.scale_x ?? 1.0}"></div>
          <div class="field"><label>縦倍率(scale_y)</label><input type="number" step="0.001" id="pf-scale-y" value="${p.scale_y ?? 1.0}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Xオフセット(mm)</label><input type="number" step="0.1" id="pf-offset-x" value="${p.offset_x_mm ?? 0.0}"></div>
          <div class="field"><label>Yオフセット(mm)</label><input type="number" step="0.1" id="pf-offset-y" value="${p.offset_y_mm ?? 0.0}"></div>
        </div>
        <div class="field"><label>メモ（測定条件など）</label><textarea id="pf-memo" rows="2">${escapeHtml(p.memo || '')}</textarea></div>
        <div class="field-row" style="align-items:flex-end">
          <button type="submit" class="btn btn-sm">${p.id ? '保存' : '追加'}</button>
          <button type="button" class="btn btn-text btn-sm" id="profile-form-cancel">キャンセル</button>
        </div>
      </form>
    </div>
  `;
}

function closeProfileForm() {
  formWrap.style.display = 'none';
  formWrap.innerHTML = '';
}

function openProfileForm(profile) {
  const p = profile || {};
  formWrap.innerHTML = profileFormHtml(p);
  formWrap.style.display = '';

  document.getElementById('profile-form-cancel').addEventListener('click', closeProfileForm);
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('pf-name').value.trim(),
      scale_x: document.getElementById('pf-scale-x').value,
      scale_y: document.getElementById('pf-scale-y').value,
      offset_x_mm: document.getElementById('pf-offset-x').value,
      offset_y_mm: document.getElementById('pf-offset-y').value,
      memo: document.getElementById('pf-memo').value.trim(),
    };
    try {
      if (p.id) {
        await apiPutJson(`/api/printer_profiles/${p.id}`, payload);
      } else {
        await apiPostJson('/api/printer_profiles', payload);
      }
      closeProfileForm();
      alertBox.innerHTML = '';
      await loadProfiles();
    } catch (err) {
      showError(err.message);
    }
  });
}

document.getElementById('btn-add-profile').addEventListener('click', () => openProfileForm(null));

// ---------- 一覧 ----------

function rowHtml(p) {
  return `
    <tr data-id="${p.id}">
      <td>${escapeHtml(p.name)}</td>
      <td class="muted">${p.scale_x}</td>
      <td class="muted">${p.scale_y}</td>
      <td class="muted">${p.offset_x_mm}</td>
      <td class="muted">${p.offset_y_mm}</td>
      <td>${p.is_default
        ? '<span class="badge badge-active">既定</span>'
        : '<button type="button" class="btn btn-text btn-sm" data-action="set-default">既定にする</button>'}
      </td>
      <td class="actions-cell">
        <button type="button" class="btn btn-text btn-sm" data-action="edit">編集</button>
        <button type="button" class="btn btn-danger btn-sm" data-action="delete">削除</button>
      </td>
    </tr>
  `;
}

function renderRows() {
  if (profiles.length === 0) {
    tbody.innerHTML = '';
    emptyMessage.style.display = 'flex';
    return;
  }
  emptyMessage.style.display = 'none';
  tbody.innerHTML = profiles.map(rowHtml).join('');
}

async function loadProfiles() {
  try {
    profiles = await apiFetch('/api/printer_profiles');
    renderRows();
  } catch (err) {
    showError(err.message);
  }
}

tbody.addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  const action = e.target.dataset.action;
  if (!tr || !action) return;
  const id = Number(tr.dataset.id);
  const profile = profiles.find((p) => p.id === id);

  if (action === 'edit') {
    openProfileForm(profile);
  } else if (action === 'set-default') {
    try {
      await apiFetch(`/api/printer_profiles/${id}/default`, { method: 'POST' });
      await loadProfiles();
    } catch (err) {
      showError(err.message);
    }
  } else if (action === 'delete') {
    if (!window.confirm(`プロファイル「${profile.name}」を削除しますか？（元に戻せません）`)) return;
    try {
      await apiFetch(`/api/printer_profiles/${id}`, { method: 'DELETE' });
      await loadProfiles();
    } catch (err) {
      showError(err.message);
    }
  }
});

loadProfiles();
