// sw-register.js — v1.1.4
// 目的: 全ページで同一ローダー/同一バージョンに統一し、戻る遷移後の誤発火と↻適用漏れを解消
// - すべて getRegistration() ベースで ↻ を安全処理
// - バナーの「あとで」で has-update と赤ドットを確実に解除
// - 二重読込ガード（同ページで複数回読み込まれても安全）
// - BFCache/online/visibility で軽い update() チェック（Safari 向け）

(() => {
  if (!('serviceWorker' in navigator)) return;
  if (window.__tpSWBound) return;            // 二重バインド防止
  window.__tpSWBound = true;

  const SW_VERSION = '1.1.4';
  const SW_ABS_URL = new URL('./sw.js', location.href);
  SW_ABS_URL.searchParams.set('v', SW_VERSION);   // HTTPキャッシュ回避
  const SW_SCOPE = new URL('./', location.href).pathname;

  // ---- 軽量トースト ----
  function toast(msg) {
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(msg);
        return;
      }
    } catch (_) {}
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = String(msg || '');
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('show'), 1600);
  }

  // ---- UI状態切替 ----
  const hdrBtn = () => document.getElementById('btnHardRefresh');

  function markUpdate() {
    const b = hdrBtn();
    if (b) {
      b.classList.add('update');
      b.title = '新しいバージョンがあります。押して更新';
    }
    document.documentElement.classList.add('has-update');
    toast('新しいバージョンがあります。↻で更新できます');
    notifyUpdateOnly();
  }

  function clearUpdateUI() {
    const b = hdrBtn();
    if (b) b.classList.remove('update');
    document.documentElement.classList.remove('has-update');
    const bn = document.getElementById('tp-update-banner');
    if (bn) {
      try { bn.remove(); } catch (_) {}
    }
  }

  // ---- OS通知（更新検知時のみ/非表示時のみ） ----
  let notifiedOnce = false;
  function notifyUpdateOnly() {
    if (notifiedOnce) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (document.visibilityState !== 'hidden') return;
    try {
      const n = new Notification('Train Punch 更新', {
        body: '新しいバージョンの準備ができました。↻で適用できます。',
        tag: 'tp-update',
        renotify: true
      });
      n.onclick = () => {
        try { window.focus(); } catch (_) {}
        try { n.close(); } catch (_) {}
      };
      notifiedOnce = true;
    } catch (_) {}
  }

  // ---- 下部バナー ----
  const BANNER_ID = 'tp-update-banner';

  function showBanner(onConfirm) {
    if (document.getElementById(BANNER_ID)) return;

    const el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = `
      position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;
      background:#0fb6a9;color:#fff;border-radius:12px;padding:12px 14px;
      box-shadow:0 8px 30px rgba(0,0,0,.25);
      display:flex;gap:10px;align-items:center;justify-content:space-between;
      font:600 14px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Arial;
    `;
    el.innerHTML = `
      <span>新しいバージョンがあります</span>
      <span style="display:flex;gap:8px">
        <button id="tp-upd" style="appearance:none;border:none;background:#fff;color:#0b1216;font-weight:800;padding:8px 12px;border-radius:9px;cursor:pointer">今すぐ更新</button>
        <button id="tp-later" style="appearance:none;border:1px solid #ffffff66;background:transparent;color:#fff;padding:8px 12px;border-radius:9px;cursor:pointer">あとで</button>
      </span>
    `;
    (document.body || document.documentElement).appendChild(el);

    const upd = el.querySelector('#tp-upd');
    const lat = el.querySelector('#tp-later');

    if (upd) {
      upd.onclick = () => {
        try { onConfirm && onConfirm(); } finally {
          try { el.remove(); } catch (_) {}
        }
      };
    }
    if (lat) {
      lat.onclick = () => {
        clearUpdateUI();
      };
    }
  }

  // ---- 複数タブ連携 ----
  let bc = null;
  try { bc = new BroadcastChannel('tp-sw'); } catch (_) {}

  const broadcast = (type) => {
    try { bc?.postMessage({ type }); } catch (_) {}
  };

  bc && bc.addEventListener('message', (e) => {
    if (e?.data?.type === 'SW_WAITING') {
      markUpdate();
      showBanner(() => {
        navigator.serviceWorker.getRegistration().then(reg => {
          try { reg?.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
        });
      });
    }
  });

  // ---- コントローラ交代時の自動リロード（ユーザー明示時のみ） ----
  let userRequestedReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userRequestedReload) location.reload();
  });

  // ---- waiting/installed 監視 ----
  function attachUpdateWatchers(reg) {
    if (!reg) return;

    // すでに waiting がいる場合（=更新済み）
    if (reg.waiting) {
      markUpdate();
      showBanner(() => {
        try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
      });
      broadcast('SW_WAITING');
    }

    // 新しい SW が見つかった時
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          markUpdate();
          showBanner(() => {
            const w = reg.waiting || sw;
            try { w?.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
          });
          broadcast('SW_WAITING');
        }
      });
    });

    // SW 側からのメッセージ（必要なら sw.js 側で postMessage する）
    navigator.serviceWorker.addEventListener('message', (evt) => {
      if (evt?.data?.type === 'SW_WAITING') {
        markUpdate();
        showBanner(() => {
          try { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
        });
        broadcast('SW_WAITING');
      }
    });
  }

  // ---- ↻ ボタン（毎回 getRegistration() で安全適用） ----
  function bindRefreshButton() {
    const btn = document.getElementById('btnHardRefresh');
    if (!btn || btn._tpBound) return;
    btn._tpBound = true;

    let lastHandled = 0;

    const handler = async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      const now = Date.now();
      if (now - lastHandled < 250) return;
      lastHandled = now;

      let reg = null;
      try { reg = await navigator.serviceWorker.getRegistration(); } catch (_) {}

      if (reg?.waiting) {
        userRequestedReload = true;
        try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
      } else if (typeof window.__tpHardRefresh === 'function') {
        window.__tpHardRefresh();
      } else {
        location.reload();
      }
    };

    btn.addEventListener('click',    handler, { capture: true });
    btn.addEventListener('touchend', handler, { capture: true, passive: false });
  }

  // ---- 登録 ----
  async function register() {
    try {
      const reg = await navigator.serviceWorker.register(
        SW_ABS_URL.toString(),
        { scope: SW_SCOPE, updateViaCache: 'none' }
      );

      attachUpdateWatchers(reg);
      bindRefreshButton();

      // 起動直後の軽い update() チェック
      const ping = () => reg.update().catch(() => {});
      setTimeout(ping, 1200);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) ping();
      });
      window.addEventListener('online', ping);
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) ping();
      });

      // 「今すぐ更新」クリックで reload 許可
      document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.id === 'tp-upd') userRequestedReload = true;
      }, true);

      if (reg.waiting) broadcast('SW_WAITING');
    } catch (e) {
      console.warn('SW register failed:', e);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
})();