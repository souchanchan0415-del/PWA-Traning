// Train Punch の保存キー
const STORAGE_KEY = 'train_punch_logs_v0.1';

function loadLogs() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to parse logs', e);
    return [];
  }
}

function saveLogs(logs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
}

function createId() {
  return 'log_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

function renderLogs() {
  const logs = loadLogs().sort((a, b) => {
    // 新しい順
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  const tbody = document.getElementById('logBody');
  const empty = document.getElementById('emptyState');

  tbody.innerHTML = '';

  if (logs.length === 0) {
    empty.style.display = 'block';
    return;
  } else {
    empty.style.display = 'none';
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');

    const tdDate = document.createElement('td');
    tdDate.textContent = log.date || '';
    tr.appendChild(tdDate);

    const tdEx = document.createElement('td');
    tdEx.textContent = log.exercise || '';
    tr.appendChild(tdEx);

    const tdW = document.createElement('td');
    tdW.textContent = log.weight != null ? `${log.weight}kg` : '';
    tr.appendChild(tdW);

    const tdR = document.createElement('td');
    tdR.textContent = log.reps != null ? `${log.reps}回` : '';
    tr.appendChild(tdR);

    const tdRpe = document.createElement('td');
    tdRpe.textContent = log.rpe != null && log.rpe !== '' ? log.rpe : '';
    tr.appendChild(tdRpe);

    const tdMemo = document.createElement('td');
    tdMemo.textContent = log.memo || '';
    tr.appendChild(tdMemo);

    const tdDel = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.className = 'btn-row-delete';
    btn.addEventListener('click', () => {
      const ok = confirm('この記録を削除しますか？');
      if (!ok) return;
      const newLogs = loadLogs().filter(x => x.id !== log.id);
      saveLogs(newLogs);
      renderLogs();
    });
    tdDel.appendChild(btn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });
}

function setTodayDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.getElementById('date').value = `${yyyy}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('logForm');
  const msg = document.getElementById('message');
  const clearAllBtn = document.getElementById('clearAll');

  setTodayDate();
  renderLogs();

  form.addEventListener('submit', e => {
    e.preventDefault();
    msg.textContent = '';

    const date = document.getElementById('date').value;
    const exercise = document.getElementById('exercise').value.trim();
    const weight = document.getElementById('weight').value;
    const reps = document.getElementById('reps').value;
    const rpe = document.getElementById('rpe').value;
    const memo = document.getElementById('memo').value.trim();

    if (!date || !exercise || !weight || !reps) {
      msg.textContent = '必須項目を入力してください。';
      msg.style.color = '#ffb3b3';
      return;
    }

    const logs = loadLogs();

    logs.push({
      id: createId(),
      date,
      exercise,
      weight: parseFloat(weight),
      reps: parseInt(reps, 10),
      rpe: rpe !== '' ? parseFloat(rpe) : '',
      memo,
      createdAt: new Date().toISOString()
    });

    saveLogs(logs);
    renderLogs();

    // 入力欄リセット（一部だけ）
    document.getElementById('exercise').value = '';
    document.getElementById('weight').value = '';
    document.getElementById('reps').value = '';
    document.getElementById('rpe').value = '';
    document.getElementById('memo').value = '';
    document.getElementById('exercise').focus();

    msg.textContent = '保存しました ✅';
    msg.style.color = '#a0f0a0';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  });

  clearAllBtn.addEventListener('click', () => {
    const ok = confirm('本当に全部削除しますか？\n（この端末の Train Punch データが完全に消えます）');
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    renderLogs();
  });
});