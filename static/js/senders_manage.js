const alertBox = document.getElementById('alert-box');
const sendersTbody = document.getElementById('senders-tbody');
const sendersEmpty = document.getElementById('senders-empty');

let senders = [];

function showError(message) {
  alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}

function addressSummary(s) {
  return [s.prefecture, s.city, s.block, s.building].filter(Boolean).join('');
}

function companionSummary(s) {
  return (s.companions || []).map((c) => [c.last_name, c.first_name].filter(Boolean).join(' ')).join('、');
}

// ---------- 差出人フォーム（新規・編集共用、トグル展開） ----------

function companionRowHtml(c = {}) {
  return `
    <div class="field-row companion-row" style="align-items:flex-end">
      <div class="field"><label>姓</label><input type="text" class="cc-last-name" value="${escapeHtml(c.last_name)}"></div>
      <div class="field"><label>名</label><input type="text" class="cc-first-name" value="${escapeHtml(c.first_name)}"></div>
      <div class="field"><label>セイ</label><input type="text" class="cc-last-kana" value="${escapeHtml(c.last_name_kana)}"></div>
      <div class="field"><label>メイ</label><input type="text" class="cc-first-kana" value="${escapeHtml(c.first_name_kana)}"></div>
      <button type="button" class="btn btn-text btn-sm" data-action="remove-companion">✕</button>
    </div>
  `;
}

function senderFormHtml(s) {
  const companions = s.companions || [];
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3 class="card-title">${s.id ? `差出人を編集（${escapeHtml(s.label)}）` : '差出人を追加'}</h3></div>
      <form id="sender-form">
        <input type="hidden" id="sf-id" value="${s.id || ''}">
        <div class="field-row">
          <div class="field"><label>ラベル</label><input type="text" id="sf-label" placeholder="例: 夫(新姓)" value="${escapeHtml(s.label)}"></div>
          <div class="field"><label>姓</label><input type="text" id="sf-last-name" value="${escapeHtml(s.last_name)}"></div>
          <div class="field"><label>名</label><input type="text" id="sf-first-name" value="${escapeHtml(s.first_name)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>セイ</label><input type="text" id="sf-last-kana" value="${escapeHtml(s.last_name_kana)}"></div>
          <div class="field"><label>メイ</label><input type="text" id="sf-first-kana" value="${escapeHtml(s.first_name_kana)}"></div>
        </div>
        <div class="field"><label>勤務先名（指定すると宛名面の氏名の上に印字されます）</label><input type="text" id="sf-company-name" value="${escapeHtml(s.company_name)}"></div>
        <div class="field-row">
          <div class="field">
            <label>郵便番号</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="sf-zip" placeholder="123-4567" style="flex:1" value="${escapeHtml(s.zip)}">
              <button type="button" class="btn btn-secondary btn-sm" id="sf-zip-lookup">住所を検索</button>
            </div>
          </div>
          <div class="field"><label>都道府県</label><input type="text" id="sf-prefecture" value="${escapeHtml(s.prefecture)}"></div>
          <div class="field"><label>市区町村</label><input type="text" id="sf-city" value="${escapeHtml(s.city)}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>町名番地</label><input type="text" id="sf-block" value="${escapeHtml(s.block)}"></div>
          <div class="field"><label>建物名・部屋番号</label><input type="text" id="sf-building" value="${escapeHtml(s.building)}"></div>
        </div>
        <div class="field"><label>メモ</label><textarea id="sf-memo" rows="2">${escapeHtml(s.memo)}</textarea></div>
        <div class="field">
          <label>連名（同じ住所に併記する人）</label>
          <div id="sf-companions-list">${companions.map((c) => companionRowHtml(c)).join('')}</div>
          <button type="button" class="btn btn-text btn-sm" id="sf-add-companion">+ 連名を追加</button>
        </div>
        <div class="field-row" style="align-items:flex-end">
          <button type="submit" class="btn btn-sm">${s.id ? '保存' : '追加'}</button>
          <button type="button" class="btn btn-text btn-sm" id="sender-form-cancel">キャンセル</button>
        </div>
      </form>
    </div>
  `;
}

function closeSenderForm() {
  const wrap = document.getElementById('sender-form-wrap');
  wrap.style.display = 'none';
  wrap.innerHTML = '';
}

function openSenderForm(sender) {
  const s = sender || {};
  const wrap = document.getElementById('sender-form-wrap');
  wrap.innerHTML = senderFormHtml(s);
  wrap.style.display = '';

  bindZipAutofill({
    zip: document.getElementById('sf-zip'),
    prefecture: document.getElementById('sf-prefecture'),
    city: document.getElementById('sf-city'),
    block: document.getElementById('sf-block'),
    button: document.getElementById('sf-zip-lookup'),
  });

  document.getElementById('sf-add-companion').addEventListener('click', () => {
    document.getElementById('sf-companions-list').insertAdjacentHTML('beforeend', companionRowHtml());
  });
  document.getElementById('sf-companions-list').addEventListener('click', (e) => {
    if (e.target.dataset.action === 'remove-companion') {
      e.target.closest('.companion-row').remove();
    }
  });
  document.getElementById('sender-form-cancel').addEventListener('click', closeSenderForm);
  document.getElementById('sender-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const companions = [...document.querySelectorAll('#sf-companions-list .companion-row')].map((row) => ({
      last_name: row.querySelector('.cc-last-name').value.trim(),
      first_name: row.querySelector('.cc-first-name').value.trim(),
      last_name_kana: row.querySelector('.cc-last-kana').value.trim(),
      first_name_kana: row.querySelector('.cc-first-kana').value.trim(),
    })).filter((c) => c.last_name || c.first_name || c.last_name_kana || c.first_name_kana);
    const payload = {
      label: document.getElementById('sf-label').value.trim(),
      last_name: document.getElementById('sf-last-name').value.trim(),
      first_name: document.getElementById('sf-first-name').value.trim(),
      last_name_kana: document.getElementById('sf-last-kana').value.trim(),
      first_name_kana: document.getElementById('sf-first-kana').value.trim(),
      company_name: document.getElementById('sf-company-name').value.trim(),
      zip: document.getElementById('sf-zip').value.trim(),
      prefecture: document.getElementById('sf-prefecture').value.trim(),
      city: document.getElementById('sf-city').value.trim(),
      block: document.getElementById('sf-block').value.trim(),
      building: document.getElementById('sf-building').value.trim(),
      memo: document.getElementById('sf-memo').value.trim(),
      companions,
    };
    try {
      if (s.id) {
        await apiPutJson(`/api/senders/${s.id}`, payload);
      } else {
        await apiPostJson('/api/senders', payload);
      }
      closeSenderForm();
      await loadAll();
    } catch (err) {
      showError(err.message);
    }
  });
  document.getElementById('sf-label').focus();
}

document.getElementById('btn-add-sender').addEventListener('click', () => openSenderForm());

// ---------- 差出人一覧テーブル ----------

function renderSenders() {
  if (senders.length === 0) {
    sendersTbody.innerHTML = '';
    sendersEmpty.style.display = 'flex';
    return;
  }
  sendersEmpty.style.display = 'none';
  sendersTbody.innerHTML = senders.map((s) => `
    <tr data-id="${s.id}">
      <td>${escapeHtml(s.label)}</td>
      <td>${escapeHtml([s.last_name, s.first_name].filter(Boolean).join(' '))}${s.company_name ? `<br><span class="muted">${escapeHtml(s.company_name)}</span>` : ''}</td>
      <td class="muted">${escapeHtml(companionSummary(s))}</td>
      <td class="muted">${escapeHtml(addressSummary(s))}</td>
      <td class="actions-cell">
        <button class="btn btn-text btn-sm" data-action="edit">編集</button>
        <button class="btn btn-text btn-sm" data-action="history">履歴</button>
        <button class="btn btn-danger btn-sm" data-action="delete">削除</button>
      </td>
    </tr>
  `).join('');
}

sendersTbody.addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-id]');
  const action = e.target.dataset.action;
  if (!tr || !action) return;
  const id = Number(tr.dataset.id);
  const sender = senders.find((s) => s.id === id);
  if (action === 'edit') {
    openSenderForm(sender);
  } else if (action === 'history') {
    openHistoryModal(id, sender.label);
  } else if (action === 'delete') {
    if (!window.confirm(`差出人「${sender.label}」を削除しますか？`)) return;
    try {
      await apiFetch(`/api/senders/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      showError(err.message);
    }
  }
});

// ---------- デフォルト指定 ----------

function currentDefaultValue() {
  const defaultSender = senders.find((s) => s.is_default);
  return defaultSender ? `sender:${defaultSender.id}` : 'none';
}

function renderDefaultSection() {
  const current = currentDefaultValue();
  const list = document.getElementById('default-sender-list');
  const senderOptions = senders.map((s) => {
    const value = `sender:${s.id}`;
    const companionNote = (s.companions || []).length ? `＋連名${s.companions.length}名` : '';
    return `
      <div class="subitem">
        <label><input type="radio" name="default-target" value="${value}" ${current === value ? 'checked' : ''}>
          ${escapeHtml(s.label)}（${escapeHtml([s.last_name, s.first_name].filter(Boolean).join(' '))}${companionNote}）
        </label>
      </div>
    `;
  }).join('');
  list.innerHTML = `
    <div class="subitem">
      <label><input type="radio" name="default-target" value="none" ${current === 'none' ? 'checked' : ''}> 差出人を印字しない</label>
    </div>
    ${senderOptions}
  `;
  list.querySelectorAll('input[name="default-target"]').forEach((radio) => {
    radio.addEventListener('change', async (e) => {
      const value = e.target.value;
      const payload = value === 'none'
        ? { type: 'none' }
        : { type: value.split(':')[0], id: Number(value.split(':')[1]) };
      try {
        await apiPutJson('/api/sender_default', payload);
        await loadAll();
      } catch (err) {
        showError(err.message);
        await loadAll();
      }
    });
  });
}

// ---------- 変更履歴モーダル ----------

const historyModalOverlay = document.getElementById('history-modal-overlay');
const historyTbody = document.getElementById('history-tbody');

function closeHistoryModal() {
  historyModalOverlay.style.display = 'none';
}

document.getElementById('history-modal-close').addEventListener('click', closeHistoryModal);
historyModalOverlay.addEventListener('click', (e) => {
  if (e.target === historyModalOverlay) closeHistoryModal();
});

async function openHistoryModal(senderId, label) {
  document.getElementById('history-modal-title').textContent = `変更履歴: ${label}`;
  historyTbody.innerHTML = '<tr><td colspan="4" class="muted">読み込み中…</td></tr>';
  historyModalOverlay.style.display = 'flex';
  try {
    const rows = await apiFetch(`/api/senders/${senderId}/history`);
    if (rows.length === 0) {
      historyTbody.innerHTML = '<tr><td colspan="4" class="muted">履歴がありません</td></tr>';
      return;
    }
    historyTbody.innerHTML = rows.map((r, i) => {
      const addr = [r.prefecture, r.city, r.block, r.building].filter(Boolean).join('');
      const name = [r.last_name, r.first_name].filter(Boolean).join(' ');
      const isCurrent = i === 0 && !r.is_deleted;
      return `<tr${r.is_deleted ? ' class="muted"' : ''}>
        <td style="white-space:nowrap">${escapeHtml(formatJstDateTime(r.recorded_at))}${isCurrent ? ' <span class="badge">現在</span>' : ''}${r.is_deleted ? ' <span class="muted">（削除）</span>' : ''}</td>
        <td>${escapeHtml(r.label)}</td>
        <td>${escapeHtml(name || '—')}</td>
        <td>${escapeHtml(addr || '—')}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    historyTbody.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(e.message)}</td></tr>`;
  }
}

// ---------- 読み込み ----------

async function loadAll() {
  try {
    senders = await apiFetch('/api/senders');
    alertBox.innerHTML = '';
    renderSenders();
    renderDefaultSection();
  } catch (err) {
    showError(err.message);
  }
}

loadAll();
