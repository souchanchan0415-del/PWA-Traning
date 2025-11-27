// app.js

(() => {
  const STORAGE_KEYS = ['trainPunchLogs', 'train-punch-logs', 'TRAIN_PUNCH_LOGS'];

  function tryParseArray(raw) {
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : null;
    } catch (_) {
      return null;
    }
  }

  function loadLogs() {
    // 既存キーを優先で読む
    for (const key of STORAGE_KEYS) {
      const logs = tryParseArray(localStorage.getItem(key));
      if (logs) return logs;
    }
    return [];
  }

  function saveLogs(logs) {
    localStorage.setItem(STORAGE_KEYS[0], JSON.stringify(logs));
  }

  function setToday(dateInput) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    dateInput.value = `${y}-${m}-${d}`;
  }

  function renderLogs(logs) {
    const tbody = document.getElementById('logBody');
    const emptyState = document.getElementById('emptyState');
    if (!tbody || !emptyState) return;

    tbody.innerHTML = '';

    if (!logs.length) {
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';

    logs.forEach((log, index) => {
      const tr = document.createElement('tr');

      const tdDate = document.createElement('td');
      tdDate.textContent = log.date || '';
      tr.appendChild(tdDate);

      const tdEx = document.createElement('td');
      tdEx.textContent = log.exercise || '';
      tr.appendChild(tdEx);

      const tdWeight = document.createElement('td');
      tdWeight.textContent =
        log.weight !== undefined && log.weight !== null && log.weight !== ''
          ? `${log.weight}kg`
          : '';
      tr.appendChild(tdWeight);

      const tdSets = document.createElement('td');
      tdSets.textContent =
        log.sets !== undefined && log.sets !== null && log.sets !== ''
          ? `${log.sets}セット`
          : '';
      tr.appendChild(tdSets);

      const tdReps = document.createElement('td');
      tdReps.textContent =
        log.reps !== undefined && log.reps !== null && log.reps !== ''
          ? `${log.reps}回`
          : '';
      tr.appendChild(tdReps);

      const tdRpe = document.createElement('td');
      tdRpe.textContent =
        log.rpe !== undefined && log.rpe !== null && log.rpe !== ''
          ? String(log.rpe)
          : '';
      tr.appendChild(tdRpe);

      const tdMemo = document.createElement('td');
      tdMemo.textContent = log.memo || '';
      tr.appendChild(tdMemo);

      const tdDel = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-row-delete';
      btn.textContent = '×';
      btn.dataset.index = String(index);
      tdDel.appendChild(btn);
      tr.appendChild(tdDel);

      tbody.appendChild(tr);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('logForm');
    const dateInput = document.getElementById('date');
    const exerciseInput = document.getElementById('exercise');
    const weightInput = document.getElementById('weight');
    const setsInput = document.getElementById('sets');
    const repsInput = document.getElementById('reps');
    const rpeInput = document.getElementById('rpe');
    const memoInput = document.getElementById('memo');
    const message = document.getElementById('message');
    const clearAllBtn = document.getElementById('clearAll');
    const tbody = document.getElementById('logBody');

    let logs = loadLogs();
    renderLogs(logs);

    if (dateInput && !dateInput.value) {
      setToday(dateInput);
    }

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!dateInput || !exerciseInput || !weightInput || !repsInput) return;

        const date = dateInput.value;
        const exercise = exerciseInput.value.trim();
        const weight = weightInput.value !== '' ? Number(weightInput.value) : '';
        const sets = setsInput && setsInput.value !== '' ? Number(setsInput.value) : '';
        const reps = repsInput.value !== '' ? Number(repsInput.value) : '';
        const rpe = rpeInput && rpeInput.value !== '' ? Number(rpeInput.value) : '';
        const memo = memoInput ? memoInput.value.trim() : '';

        if (!exercise) {
          message.textContent = '種目を選択してください。';
          return;
        }

        if (weight === '' || Number.isNaN(weight) || reps === '' || Number.isNaN(reps)) {
          message.textContent = '重量と回数を入力してください。';
          return;
        }

        const newLog = { date, exercise, weight, reps, memo };
        if (sets !== '' && !Number.isNaN(sets)) newLog.sets = sets;
        if (rpe !== '' && !Number.isNaN(rpe)) newLog.rpe = rpe;

        logs.push(newLog);
        saveLogs(logs);
        renderLogs(logs);

        if (memoInput) memoInput.value = '';
        repsInput.value = '';
        if (setsInput) setsInput.value = '';
        if (rpeInput) rpeInput.value = '';
        message.textContent = '保存しました。';
      });
    }

    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        if (!confirm('本当に全部削除しますか？')) return;
        logs = [];
        // 互換用に全部のキーをクリア
        STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
        saveLogs(logs);
        renderLogs(logs);
      });
    }

    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.classList.contains('btn-row-delete')) return;

        const index = Number(target.dataset.index);
        if (Number.isNaN(index)) return;

        logs.splice(index, 1);
        saveLogs(logs);
        renderLogs(logs);
      });
    }
  });
})();