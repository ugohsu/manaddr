const SAMPLE = {
  address_updates: [
    {
      match_hint: { last_name: '山田', first_name: '太郎', last_name_kana: 'ヤマダ', first_name_kana: 'タロウ' },
      name_update: { last_name: '田中', first_name: '太郎', last_name_kana: 'タナカ', first_name_kana: 'タロウ', honorific: '先生' },
      classification: '自宅',
      zip: '123-4567',
      prefecture: '東京都', city: '品川区', block: '上大崎2-24-9', building: 'アイケイビル1F',
      companions: [
        { last_name: '田中', first_name: '花子', last_name_kana: 'タナカ', first_name_kana: 'ハナコ', honorific: '様' },
      ],
      _comment: '結婚して姓が変わった様子。郵便番号の最後の桁が滲んでいて読み取りにくい',
      _confidence: 0.75,
    },
  ],
};

const alertBox = document.getElementById('alert-box');
const jsonFile = document.getElementById('json-file');
const jsonInput = document.getElementById('json-input');
const sampleBtn = document.getElementById('btn-sample');
const previewBtn = document.getElementById('btn-preview');
const clearBtn = document.getElementById('btn-clear');
const stepPreview = document.getElementById('step-preview');
const summaryEl = document.getElementById('preview-summary');
const previewListEl = document.getElementById('preview-list');
const checkAllBtn = document.getElementById('btn-check-all');
const uncheckAllBtn = document.getElementById('btn-uncheck-all');
const commitBtn = document.getElementById('btn-commit');

let previewRows = [];

function showAlert(message) {
  alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
}

// ---- 入力 ----

jsonFile.addEventListener('change', () => {
  const file = jsonFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => { jsonInput.value = e.target.result; };
  reader.readAsText(file, 'utf-8');
});

sampleBtn.addEventListener('click', (e) => {
  e.preventDefault();
  jsonInput.value = JSON.stringify(SAMPLE, null, 2);
});

clearBtn.addEventListener('click', () => {
  jsonInput.value = '';
  jsonFile.value = '';
  stepPreview.style.display = 'none';
  alertBox.innerHTML = '';
  previewRows = [];
});

// ---- プレビュー ----

function initRow(row) {
  const hasMatch = !!row.best_match;
  if (hasMatch) {
    row.resolvedAction = 'update';
  } else if (row.input.person_id) {
    // person_id を明示指定していたが見つからなかった（サーバー側エラーで把握済み）
    row.resolvedAction = 'invalid_person_id';
  } else if (row.candidates.length === 0) {
    row.resolvedAction = 'create';
  } else {
    row.resolvedAction = 'unresolved';
  }
  row.selectedPersonId = hasMatch ? row.best_match.person_id : null;
  const hint = row.input.match_hint || {};
  const nameUpdate = row.input.name_update || {};
  row.newPerson = {
    last_name: nameUpdate.last_name || hint.last_name || '',
    first_name: nameUpdate.first_name || hint.first_name || '',
    last_name_kana: nameUpdate.last_name_kana || hint.last_name_kana || '',
    first_name_kana: nameUpdate.first_name_kana || hint.first_name_kana || '',
    honorific: nameUpdate.honorific || '',
  };
  row.checked = row.default_checked;
  row.serverErrors = row.errors.slice();
  recomputeRowValidity(row);
  return row;
}

function recomputeRowValidity(row) {
  const errors = row.serverErrors.slice();
  if (!row.input.zip) errors.push('zip は必須です');
  if (row.resolvedAction === 'unresolved') errors.push('マッチ先を選択してください');
  if (row.resolvedAction === 'invalid_person_id') errors.push('指定された person_id が見つかりません');
  if (row.resolvedAction === 'create' && !row.newPerson.last_name && !row.newPerson.first_name) {
    errors.push('新規登録には姓または名が必要です');
  }
  row.errors = Array.from(new Set(errors));
  row.valid = row.errors.length === 0;
  if (!row.valid) row.checked = false;
}

previewBtn.addEventListener('click', async () => {
  alertBox.innerHTML = '';
  let payload;
  try {
    payload = JSON.parse(jsonInput.value);
  } catch (err) {
    showAlert('JSON のパースに失敗しました: ' + err.message);
    return;
  }
  try {
    const res = await apiPostJson('/api/import/preview', payload);
    previewRows = res.rows.map(initRow);
    renderPreview();
    stepPreview.style.display = 'block';
  } catch (err) {
    showAlert(err.message);
  }
});

function renderPreview() {
  const total = previewRows.length;
  const validCount = previewRows.filter((r) => r.valid).length;
  summaryEl.textContent = total - validCount > 0
    ? `${total}件中 ${validCount}件が有効、${total - validCount}件にエラー`
    : `${total}件中 ${validCount}件が有効`;
  previewListEl.innerHTML = previewRows.map(rowHtml).join('');
  updateCommitSummary();
}

function updateCommitSummary() {
  const n = previewRows.filter((r) => r.checked).length;
  commitBtn.textContent = n > 0 ? `インポート実行（${n}件）` : 'インポート実行';
}

function rowHtml(row) {
  const conf = row.input._confidence;
  const lowConf = typeof conf === 'number' && conf < 0.8;
  const badges = [];
  if (!row.valid) badges.push('<span class="badge badge-declined">エラー</span>');
  if (lowConf) badges.push(`<span class="badge badge-suspended">確信度 ${Math.round(conf * 100)}%</span>`);
  if (row.no_change) badges.push('<span class="badge badge-deceased">変更なし</span>');

  return `
    <div class="card" style="margin-bottom:12px">
      <div class="card-header">
        <input type="checkbox" class="import-check" data-idx="${row.index}" ${row.checked ? 'checked' : ''} ${row.valid ? '' : 'disabled'}>
        <strong>#${row.index + 1}</strong>
        ${badges.join(' ')}
        <div class="spacer"></div>
      </div>
      ${row.input._comment ? `<p class="muted">${escapeHtml(row.input._comment)}</p>` : ''}
      ${matchSectionHtml(row)}
      ${addressFieldsHtml(row)}
      ${companionsHtml(row)}
      ${row.errors.length ? `<div class="alert alert-error">${row.errors.map(escapeHtml).join('<br>')}</div>` : ''}
    </div>
  `;
}

function matchSectionHtml(row) {
  const hint = row.input.match_hint || {};
  const hintName = [hint.last_name, hint.first_name].filter(Boolean).join(' ');
  const hintKana = [hint.last_name_kana, hint.first_name_kana].filter(Boolean).join(' ');
  const hintLine = hintName + (hintKana ? `（${hintKana}）` : '');

  let matchControlHtml;
  if (row.input.person_id) {
    matchControlHtml = `<p class="muted">person_id 指定: ${escapeHtml(row.input.person_id)}</p>`;
  } else {
    const options = ['<option value="">選択してください</option>']
      .concat(row.candidates.map((c) => `
        <option value="${c.person_id}" ${row.resolvedAction === 'update' && row.selectedPersonId === c.person_id ? 'selected' : ''}>
          ${escapeHtml(`${c.last_name || ''} ${c.first_name || ''}`.trim())}（一致度${Math.round(c.score * 100)}%）
        </option>
      `))
      .concat([`<option value="__new__" ${row.resolvedAction === 'create' ? 'selected' : ''}>新規宛先として登録</option>`]);
    matchControlHtml = `
      <div class="field">
        <label>マッチ先</label>
        <select class="import-match-select" data-idx="${row.index}">${options.join('')}</select>
      </div>
    `;
  }

  let html = `
    <div class="field-row" style="align-items:flex-start">
      <div class="field"><label>写真から読み取った氏名</label><p>${escapeHtml(hintLine || '(なし)')}</p></div>
      ${matchControlHtml}
    </div>
  `;

  if (row.resolvedAction === 'update' && row.current) {
    const currentName = `${row.current.last_name || ''} ${row.current.first_name || ''}`.trim();
    html += `<p class="muted">現在の登録: ${escapeHtml(currentName)}（person_id ${row.selectedPersonId}） <a href="/people/${row.selectedPersonId}" target="_blank">詳細を見る</a></p>`;
  }

  if (row.resolvedAction === 'create') {
    html += newPersonFieldsHtml(row);
  } else if (row.input.name_update) {
    html += nameUpdateFieldsHtml(row);
  }
  return html;
}

function newPersonFieldsHtml(row) {
  const np = row.newPerson;
  const f = (field, label) => `
    <div class="field"><label>${label}</label>
      <input type="text" class="new-person-field" data-idx="${row.index}" data-field="${field}" value="${escapeHtml(np[field])}">
    </div>
  `;
  return `
    <div class="field-row">
      ${f('last_name', '姓')}${f('first_name', '名')}${f('last_name_kana', 'セイ')}${f('first_name_kana', 'メイ')}${f('honorific', '敬称')}
    </div>
  `;
}

function nameUpdateFieldsHtml(row) {
  const nu = row.input.name_update;
  const f = (field, label) => `
    <div class="field"><label>${label}</label>
      <input type="text" class="name-update-field" data-idx="${row.index}" data-field="${field}" value="${escapeHtml(nu[field])}">
    </div>
  `;
  return `
    <p class="muted" style="margin-bottom:4px">氏名変更の提案:</p>
    <div class="field-row">
      ${f('last_name', '姓')}${f('first_name', '名')}${f('last_name_kana', 'セイ')}${f('first_name_kana', 'メイ')}${f('honorific', '敬称')}
    </div>
  `;
}

function addressFieldsHtml(row) {
  const u = row.input;
  const f = (field, label) => `
    <div class="field"><label>${label}</label>
      <input type="text" class="address-field" data-idx="${row.index}" data-field="${field}" value="${escapeHtml(u[field] || '')}">
    </div>
  `;
  return `
    <div class="field-row">
      ${f('classification', '分類')}${f('zip', '郵便番号')}
    </div>
    <div class="field-row">
      ${f('prefecture', '都道府県')}${f('city', '市区町村')}${f('block', '町名番地')}
    </div>
    <div class="field-row">
      ${f('building', '建物名・部屋番号')}
    </div>
  `;
}

function companionsHtml(row) {
  const companions = row.input.companions;
  if (!companions || !companions.length) return '';
  const lines = companions.map((c) => {
    const name = `${c.last_name || ''} ${c.first_name || ''}`.trim();
    return escapeHtml(`${name}${c.honorific ? ' ' + c.honorific : ''}`);
  });
  return `<p class="muted">連名: ${lines.join('、')}</p>`;
}

// ---- プレビュー編集イベント（イベント委譲） ----

previewListEl.addEventListener('change', (e) => {
  const idx = Number(e.target.dataset.idx);
  if (Number.isNaN(idx)) return;
  const row = previewRows[idx];

  if (e.target.classList.contains('import-check')) {
    row.checked = e.target.checked;
    updateCommitSummary();
    return;
  }
  if (e.target.classList.contains('address-field')) {
    row.input[e.target.dataset.field] = e.target.value || null;
  } else if (e.target.classList.contains('new-person-field')) {
    row.newPerson[e.target.dataset.field] = e.target.value;
  } else if (e.target.classList.contains('name-update-field')) {
    row.input.name_update = row.input.name_update || {};
    row.input.name_update[e.target.dataset.field] = e.target.value;
  } else if (e.target.classList.contains('import-match-select')) {
    const val = e.target.value;
    if (val === '__new__') {
      row.resolvedAction = 'create';
      row.selectedPersonId = null;
    } else if (val) {
      row.resolvedAction = 'update';
      row.selectedPersonId = Number(val);
      const cand = row.candidates.find((c) => c.person_id === Number(val));
      row.current = cand ? { last_name: cand.last_name, first_name: cand.first_name } : null;
    } else {
      row.resolvedAction = 'unresolved';
      row.selectedPersonId = null;
    }
  } else {
    return;
  }
  recomputeRowValidity(row);
  renderPreview();
});

// ---- 全選択 / 全解除 ----

checkAllBtn.addEventListener('click', () => {
  previewRows.forEach((r) => { if (r.valid) r.checked = true; });
  renderPreview();
});

uncheckAllBtn.addEventListener('click', () => {
  previewRows.forEach((r) => { r.checked = false; });
  renderPreview();
});

// ---- コミット ----

function rowToCommitItem(row) {
  const u = row.input;
  const base = {
    classification: u.classification || '自宅',
    zip: u.zip, prefecture: u.prefecture, city: u.city, block: u.block, building: u.building,
    companions: u.companions || null,
  };
  if (row.resolvedAction === 'create') {
    return { action: 'create', ...row.newPerson, ...base };
  }
  return { action: 'update', person_id: row.selectedPersonId, name_update: u.name_update || null, ...base };
}

commitBtn.addEventListener('click', async () => {
  const checkedRows = previewRows.filter((r) => r.checked);
  if (checkedRows.length === 0) {
    showAlert('インポートする行が選択されていません。');
    return;
  }
  if (!window.confirm(`${checkedRows.length}件をインポートします。よろしいですか？`)) return;
  try {
    const res = await apiPostJson('/api/import/commit', { items: checkedRows.map(rowToCommitItem) });
    alertBox.innerHTML = `<p>${res.created}件を新規登録、${res.updated}件を更新しました。</p>`;
    stepPreview.style.display = 'none';
    jsonInput.value = '';
    jsonFile.value = '';
    previewRows = [];
  } catch (err) {
    showAlert(err.message);
  }
});
