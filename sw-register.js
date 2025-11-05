// Train Punch SW register — v1.5.9-fix
// 目的: 更新バナーの「今すぐ更新」が確実に反映されるようにする
// - updateViaCache:'none' で SW の HTTP キャッシュを回避
// - waiting 検出でバナー表示（既存DOMがあれば流用、無ければ最小UIを生成）
// - 「今すぐ更新」→ SKIP_WAITING → controllerchange で1回だけ reload
// - iOS Safari 対策: reg.update() を明示呼び出し（installed止まり対策）
// - 既存の ↻ ボタン(#btnHardRefresh)はそのまま。赤ドットは class "update" だけ付与/除去

(() => {
  const SW_URL = './sw.js';
  const RELOAD_FALLBACK_MS = 4000;

  let didRefresh = false;
  let currentReg = null;

  // --- helpers --------------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const hdrBtn = () => document.getElementById('btnHardRefresh');

  function markHasUpdate(onNow) {
    let bar = document.getElementById('sw-update-bar');
    let btnNow = document.getElementById('sw-update-now') || document.querySelector('[data-sw-update-now]');
    let btnLater = document.getElementById('sw-update-later') || document.querySelector('[data-sw-update-later]');

    // 既存の更新バーが無ければ最小構成で作る
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
            <button id="sw-update-now" type="button" data-sw-update-now>今すぐ更新</button>
            <button id="sw-update-later" type="button" data-sw-update-later>あとで</button>
          </div>
        </div>`;
      document.body.appendChild(bar);
      btnNow = document.getElementById('sw-update-now');
      btnLater = document.getElementById('sw-update-later');
    }

    // 下余白調整 & ↻に赤ドット
    document.documentElement.classList.add('has-update');
    hdrBtn() && hdrBtn().classList.add('update');

    // 多重bind防止（cloneで置換）
    const nowClone = btnNow.cloneNode(true);
    btnNow.parentNode.replaceChild(nowClone, btnNow);
    nowClone.addEventListener('click', onNow);

    const laterClone = btnLater.cloneNode(true);
    btnLater.parentNode.replaceChild(laterClone, btnLater);
    laterClone.addEventListener('click', () => {
      hideUpdateUI();
    });

    bar.style.display = 'block';
  }

  function hideUpdateUI() {
    const bar = document.getElementById('sw-update-bar');
    if (bar) bar.style.display = 'none';
    document.documentElement.classList.remove('has-update');
    hdrBtn() && hdrBtn().classList.remove('update');
  }

  // waiting SW を即座にアクティブ化
  function applyUpdate(waitingWorker) {
    try {
      if (waitingWorker) {
        // statechange 監視は controllerchange と二重になる可能性があるが、reload は片方だけ
        waitingWorker.addEventListener('statechange', () => {
          // 何もしない（controllerchange 側でリロード）
        });
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      } else if (currentReg) {
        // 念のため: 直後に waiting が出るケース
        currentReg.update().catch(() => {});
        setTimeout(() => {
          currentReg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        }, 200);
      }
    } catch (_) {}

    // 念のためのフォールバック
    setTimeout(() => {
      if (!didRefresh) location.reload();
    }, RELOAD_FALLBACK_MS);
  }

  // --- global events --------------------------------------------------------
  // 1回だけリロード（Safari 二重発火対策）
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (didRefresh) return;
    didRefresh = true;
    location.reload();
  });

  // --- wiring ---------------------------------------------------------------
  function wireUpdate(reg) {
    if (!reg) return;

    // 既に waiting が居たら即表示
    if (reg.waiting) {
      markHasUpdate(() => applyUpdate(reg.waiting));
    }

    // 新しい SW が見つかったら監視
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // 既存コントローラが居て installed になった＝アップデート
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          // reg.waiting が生えるまで少し待ってから UI を出す
          setTimeout(() => {
            markHasUpdate(() => applyUpdate(reg.waiting || sw));
          }, 50);
        }
      });
    });
  }

  function wireManualCheck(reg) {
    const manual = hdrBtn() || document.querySelector('[data-sw-check]');
    if (manual) {
      manual.addEventListener('click', () => {
        try { reg.update(); } catch (_) {}
      }, { passive: true });
    }
  }

  async function main() {
    if (!('serviceWorker' in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.register(SW_URL, {
        updateViaCache: 'none'
      });
      currentReg = reg;

      // iOS/Safari 対策: 明示的にチェック
      try { reg.update(); } catch (_) {}

      wireUpdate(reg);
      wireManualCheck(reg);
    } catch (_) {
      // register 失敗時は黙殺（アプリ本体はそのまま動作）
    }
  }

  // DOM 準備後でOK
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    main();
  } else {
    window.addEventListener('DOMContentLoaded', main, { once: true });
  }
})();