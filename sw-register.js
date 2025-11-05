// Train Punch SW register — v1.5.9-fix
// 目的: 更新バナーの「今すぐ更新」が確実に反映されるようにする
// - updateViaCache:'none' でSW自体のHTTPキャッシュ回避
// - updatefound/installed → waiting 検出でバナー表示
// - SKIP_WAITING → controllerchange で1回だけ reload
// - iOS Safari対策: reg.update() 明示呼び出し / installed止まりでも拾う
(() => {
  const SW_URL = './sw.js';
  const RELOAD_FALLBACK_MS = 4000;

  let didRefresh = false;
  let currentReg = null;

  // 1回だけリロード（Safariでの二重発火対策）
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (didRefresh) return;
    didRefresh = true;
    location.reload();
  });

  // バナーの表示/配線（既存DOMがあればそれを利用。なければ最小限で生成）
  function showUpdateUI(onNow) {
    let bar = document.getElementById('sw-update-bar');
    let btnNow = document.getElementById('sw-update-now') || document.querySelector('[data-sw-update-now]');
    let btnLater = document.getElementById('sw-update-later') || document.querySelector('[data-sw-update-later]');

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sw-update-bar';
      Object.assign(bar.style, {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999,
        padding: '12px 16px', background: 'var(--card,#fff)', borderTop: '1px solid var(--line,#e5e7eb)',
        boxShadow: '0 -10px 30px rgba(0,0,0,.15)'
      });
      bar.innerHTML = `
        <div style="max-width:960px;margin:0 auto;display:flex;gap:12px;align-items:center;justify-content:space-between">
          <div style="font-weight:700">新しいバージョンがあります</div>
          <div style="display:flex;gap:8px">
            <button id="sw-update-now" type="button">今すぐ更新</button>
            <button id="sw-update-later" type="button">あとで</button>
          </div>
        </div>`;
      document.body.appendChild(bar);
      btnNow = document.getElementById('sw-update-now');
      btnLater = document.getElementById('sw-update-later');
    }

    // ヘッダーの更新ボタンに赤ドット付与（CSS .iconbtn.update を想定）
    const hdrBtn = document.getElementById('btnHardRefresh');
    hdrBtn && hdrBtn.classList.add('update');

    // 配線（多重bind防止に一旦clone）
    const nowClone = btnNow.cloneNode(true);
    btnNow.parentNode.replaceChild(nowClone, btnNow);
    nowClone.addEventListener('click', onNow);

    const laterClone = btnLater.cloneNode(true);
    btnLater.parentNode.replaceChild(laterClone, btnLater);
    laterClone.addEventListener('click', () => {
      bar.style.display = 'none';
      hdrBtn && hdrBtn.classList.remove('update');
    });

    bar.style.display = 'block';
  }

  // waiting SW に SKIP_WAITING を送ってアクティベートさせる
  function applyUpdate(waitingWorker) {
    try {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } catch (_) { /* noop */ }

    // 念のためのフォールバック（まれに controllerchange が飛ばない端末対策）
    setTimeout(() => {
      if (!didRefresh) {
        // あなたの強制更新ルーチンがあれば使う
        if (typeof window.__tpHardRefresh === 'function') {
          window.__tpHardRefresh();
        } else {
          location.reload();
        }
      }
    }, RELOAD_FALLBACK_MS);
  }

  // reg から「更新あり」を検出してUI表示
  function wireUpdate(reg) {
    if (!reg) return;

    // 既に waiting がいれば即UI
    if (reg.waiting) {
      showUpdateUI(() => applyUpdate(reg.waiting));
    }

    // 新しいSWが見つかったら監視
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // controller がいる状態で installed になった = 既存からのアップデート
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateUI(() => applyUpdate(reg.waiting || sw));
        }
      });
    });
  }

  // 手動チェック（ヘッダーの ↻ や任意要素 data-sw-check）
  function wireManualCheck(reg) {
    const manual = document.getElementById('btnHardRefresh') || document.querySelector('[data-sw-check]');
    manual && manual.addEventListener('click', () => {
      // 見かけ上の「更新」ボタンは従来どおり機能 + SW更新チェック
      try { reg.update(); } catch (_) {}
    }, { passive: true });
  }

  async function main() {
    if (!('serviceWorker' in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.register(SW_URL, {
        updateViaCache: 'none' // SWのHTTPキャッシュを使わない（更新検知の信頼性UP）
      });
      currentReg = reg;

      // 初回でも念のため明示的に更新チェック（Safariでinstalled止まりを起こしにくくする）
      try { reg.update(); } catch (_) {}

      wireUpdate(reg);
      wireManualCheck(reg);
    } catch (e) {
      // 失敗してもアプリ自体は動かしたいので黙殺
      // console.warn('SW register failed', e);
    }
  }

  // DOMContentLoaded 以前に呼んでもOKだが、UI生成の都合でload後が安全
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    main();
  } else {
    window.addEventListener('DOMContentLoaded', main, { once: true });
  }
})();