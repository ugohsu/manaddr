const alertBox = document.getElementById('alert-box');
const tbody = document.getElementById('mailings-tbody');
const emptyMessage = document.getElementById('empty-message');

let currentMailings = [];
let activeMailing = null;

function showAlert(msg, type = 'error') {
  alertBox.innerHTML = `<div class="alert alert-${type}">${escapeHtml(msg)}</div>`;
  if (type !== 'error') setTimeout(() => { alertBox.innerHTML = ''; }, 4000);
}

function showDetailAlert(msg, type = 'error') {
  document.getElementById('mh-alert').innerHTML = `<div class="alert alert-${type}">${escapeHtml(msg)}</div>`;
}

// ---------- 一覧 ----------

function renderList(mailings) {
  if (mailings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">履歴がありません</td></tr>';
    emptyMessage.style.display = '';
    return;
  }
  emptyMessage.style.display = 'none';
  tbody.innerHTML = mailings.map((m) => `
    <tr data-id="${m.id}" class="${activeMailing?.id === m.id ? 'active' : ''}">
      <td>${escapeHtml(String(m.fiscal_year))}</td>
      <td>${escapeHtml(m.label)}</td>
      <td>${escapeHtml(m.output_type_label)}</td>
      <td>${m.recipient_count}件</td>
      <td>${escapeHtml(formatJstDateTime(m.recorded_at))}</td>
    </tr>
  `).join('');
}

tbody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  openDetail(Number(tr.dataset.id));
});

async function loadMailings() {
  try {
    currentMailings = await apiFetch('/api/mailings');
    renderList(currentMailings);
  } catch (e) {
    showAlert(e.message);
  }
}

// ---------- 詳細ペイン ----------

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

function closeDetail() {
  activeMailing = null;
  renderList(currentMailings);
  document.getElementById('md-detail-content').style.display = 'none';
  document.getElementById('md-detail-placeholder').style.display = '';
  document.getElementById('md-detail-toolbar').style.display = 'none';
  setDetailExpanded(false);
  document.getElementById('master-detail').classList.remove('detail-open');
}

document.getElementById('btn-back-to-list').addEventListener('click', closeDetail);

function renderDetail(m) {
  document.getElementById('mh-title').textContent = m.label;
  document.getElementById('mh-label-display').textContent = m.label;
  document.getElementById('mh-fiscal-year').textContent = `${m.fiscal_year}年度`;
  document.getElementById('mh-output-type').textContent = m.output_type_label;
  document.getElementById('mh-postcard-type').textContent = m.postcard_type_label || '—';
  document.getElementById('mh-recorded-at').textContent = formatJstDateTime(m.recorded_at);
  document.getElementById('mh-count').textContent = `${m.recipients.length}件`;

  const memoDisplay = document.getElementById('mh-memo-display');
  memoDisplay.textContent = m.memo || '（備考なし）';
  memoDisplay.style.color = m.memo ? '' : '#999';

  document.getElementById('mh-pdf-card').style.display =
    m.output_type === 'pdf_batch' ? '' : 'none';

  const recipientsTbody = document.getElementById('mh-recipients-tbody');
  if (m.recipients.length === 0) {
    recipientsTbody.innerHTML = '<tr><td colspan="4" class="muted">記録なし</td></tr>';
  } else {
    recipientsTbody.innerHTML = m.recipients.map((r) => {
      const companions = r.companions.map((c) =>
        `${escapeHtml(c.name)}${c.honorific ? ' ' + escapeHtml(c.honorific) : ''}`
      ).join('、');
      return `<tr>
        <td>${escapeHtml(r.name)}${r.honorific ? ' ' + escapeHtml(r.honorific) : ''}</td>
        <td>${companions || '—'}</td>
        <td>${escapeHtml(r.address)}<br><span class="muted" style="font-size:12px">${escapeHtml(r.address_classification)}</span></td>
        <td>${escapeHtml(r.sender_label || '—')}</td>
      </tr>`;
    }).join('');
  }

  document.getElementById('mh-alert').innerHTML = '';
  cancelMemoEdit();
  document.getElementById('btn-edit-memo').style.display = '';
}

async function openDetail(id) {
  activeMailing = currentMailings.find((m) => m.id === id) || null;
  renderList(currentMailings);
  document.getElementById('master-detail').classList.add('detail-open');
  document.getElementById('md-detail-toolbar').style.display = '';
  document.getElementById('md-detail-placeholder').style.display = 'none';
  document.getElementById('md-detail-content').style.display = '';
  document.getElementById('mh-title').textContent = '読み込み中…';
  document.getElementById('mh-recipients-tbody').innerHTML = '<tr><td colspan="4" class="muted">読み込み中…</td></tr>';

  try {
    const m = await apiFetch(`/api/mailings/${id}`);
    activeMailing = m;
    renderDetail(m);
  } catch (e) {
    showDetailAlert(e.message);
  }
}

// ---------- 備考編集 ----------

document.getElementById('btn-edit-memo').addEventListener('click', () => {
  document.getElementById('mh-memo-display').style.display = 'none';
  document.getElementById('btn-edit-memo').style.display = 'none';
  const editArea = document.getElementById('mh-memo-edit');
  editArea.value = activeMailing?.memo || '';
  editArea.style.display = '';
  document.getElementById('btn-save-memo').style.display = '';
  document.getElementById('btn-cancel-memo').style.display = '';
  editArea.focus();
});

function cancelMemoEdit() {
  document.getElementById('mh-memo-display').style.display = '';
  document.getElementById('mh-memo-edit').style.display = 'none';
  document.getElementById('btn-save-memo').style.display = 'none';
  document.getElementById('btn-cancel-memo').style.display = 'none';
  document.getElementById('btn-edit-memo').style.display = '';
}

document.getElementById('btn-cancel-memo').addEventListener('click', cancelMemoEdit);

document.getElementById('btn-save-memo').addEventListener('click', async () => {
  const memo = document.getElementById('mh-memo-edit').value.trim() || null;
  const btn = document.getElementById('btn-save-memo');
  btn.disabled = true;
  try {
    await apiFetch(`/api/mailings/${activeMailing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memo }),
    });
    activeMailing.memo = memo;
    const display = document.getElementById('mh-memo-display');
    display.textContent = memo || '（備考なし）';
    display.style.color = memo ? '' : '#999';
    cancelMemoEdit();
    // 一覧のメモも更新
    const listItem = currentMailings.find((m) => m.id === activeMailing.id);
    if (listItem) listItem.memo = memo;
  } catch (e) {
    showDetailAlert(e.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- 削除 ----------

document.getElementById('btn-delete-mailing').addEventListener('click', async () => {
  if (!activeMailing) return;
  if (!confirm(`「${activeMailing.label}」を削除してよいですか？この操作は取り消せません。`)) return;
  try {
    await apiFetch(`/api/mailings/${activeMailing.id}`, { method: 'DELETE' });
    currentMailings = currentMailings.filter((m) => m.id !== activeMailing.id);
    closeDetail();
    showAlert('削除しました', 'success');
  } catch (e) {
    showDetailAlert(e.message);
  }
});

// ---------- PDF再生成 ----------

document.getElementById('btn-retypeset').addEventListener('click', async () => {
  if (!activeMailing) return;
  const btn = document.getElementById('btn-retypeset');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = '生成中…（しばらくお待ちください）';
  document.getElementById('mh-alert').innerHTML = '';
  try {
    const res = await fetch(`/api/mailings/${activeMailing.id}/pdf`, { method: 'POST' });
    if (res.status === 401) {
      window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname);
      return;
    }
    if (!res.ok) {
      throw new Error(await res.text() || `エラー (${res.status})`);
    }
    const blob = await res.blob();
    const dlUrl = URL.createObjectURL(blob);
    window.open(dlUrl, '_blank');
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = `postcards_${activeMailing.id}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(dlUrl), 10000);
  } catch (e) {
    showDetailAlert(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

// ---------- 初期化 ----------

loadMailings();
