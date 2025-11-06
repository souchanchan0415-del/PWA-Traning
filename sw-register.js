// sw-register.js — v1.6.0-refresh-stable
// 目的: ↻（更新ボタン）周りの競合/取りこぼしをなくし、iOS Safari/BFCacheでも安定適用
// - ↻ クリックの都度 navigator.serviceWorker.getRegistration() を取得して適用
// - waiting が無い時は __tpHardRefresh() → location.reload() の順にフォールバック
// - update検知は waiting / installed を監視。複数タブは BroadcastChannel 連携
// - バナー/Later で視覚状態を確実にクリア（赤ドット/has-update解除）
// - クリック二重発火（click+touch）/BFCache復帰の取りこぼし対策

(() => {
  if (!('serviceWorker' in navigator)) return;

  const SW_VERSION = '1.6.0-refresh-stable';
  const SW_ABS_URL = new URL('./sw.js', location.href);
  SW_ABS_URL.searchParams.set('v', SW_VERSION);
  const SW_SCOPE = new URL('./', location.href).pathname;
  const REFRESH_BTN_SELECTOR = '#btnHardRefresh, [data-sw-check]'; // どちらでもOK

  // ---------- 小さめトースト（アプリ内の showToast が無ければ最小限の代替） ----------
  function toast(msg) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    } catch (_) {}
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = String(msg || '');
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(() => t.classList.remove('show'), 1600);
  }

  // ---------- 背景通知：更新検知時のみ / 通知許可済み / 画面非表示 ----------
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
      n.onclick = () => { try { window.focus(); } catch(_) {} try { n.close(); } catch(_) {} };
      notifiedOnce = true;
    } catch (_) {}
  }

  // ---------- UI: 更新ドット/バナー ----------
  const setHasUpdateVisual = (on) => {
    const btn = document.querySelector(REFRESH_BTN_SELECTOR);
    if (btn) {
      btn.classList.toggle('update', !!on);
      if (on) btn.title = '新しいバージョンがあります。押して更新';
    }
    document.documentElement.classList.toggle('has-update', !!on);
  };

  const markUpdate = () => {
    setHasUpdateVisual(true);
    toast('新しいバージョンがあります。↻で更新できます');
    notifyUpdateOnly();
  };

  const BANNER_ID = 'tp-update-banner';
  const showBanner = (onConfirm) => {
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

    const cleanup = () => { try { el.remove(); } catch (_) {} };
    const upd = el.querySelector('#tp-upd');
    const lat = el.querySelector('#tp-later');
    if (upd) upd.onclick = () => { try { onConfirm && onConfirm(); } finally { cleanup(); } };
    if (lat) lat.onclick = () => { cleanup(); setHasUpdateVisual(false); }; // 視覚状態を確実に解除
  };

  // ---------- 複数タブ連携 ----------
  let bc = null; try { bc = new BroadcastChannel('tp-sw'); } catch (_) {}
  const broadcast = (type) => { try { bc?.postMessage({ type }); } catch (_) {} };
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

  // ---------- コントローラ交代時の自動リロード（“今すぐ更新”や↻押下時のみ） ----------
  let userRequestedReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userRequestedReload) location.reload();
  });

  // ---------- waiting/installed を監視して更新検知 ----------
  const attachUpdateWatchers = (reg) => {
    if (!reg) return;

    if (reg.waiting) {
      markUpdate();
      showBanner(() => { try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {} });
      broadcast('SW_WAITING');
    }

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing; if (!sw) return;
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

    navigator.serviceWorker.addEventListener('message', (evt) => {
      if (evt?.data?.type === 'SW_WAITING') {
        markUpdate();
        showBanner(() => { try { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {} });
        broadcast('SW_WAITING');
      }
    });
  };

  // ---------- ↻ ボタン：毎回 最新の reg を取得して適用（iOS の二重発火も抑止） ----------
  const bindRefreshButton = () => {
    const btn = document.querySelector(REFRESH_BTN_SELECTOR);
    if (!btn || btn._tpBound) return;
    btn._tpBound = true;

    let lastHandled = 0;
    const handler = async (e) => {
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      const now = Date.now();
      if (now - lastHandled < 250) return; // click+touch の二重発火防止
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

    btn.addEventListener('click', handler, { capture: true });
    btn.addEventListener('touchend', handler, { capture: true, passive: false });
  };

  // 動的にヘッダーが差し替わる画面向けに、出現を監視して自動バインド
  const mo = new MutationObserver(() => bindRefreshButton());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // ---------- 登録 ----------
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_ABS_URL.toString(), {
        scope: SW_SCOPE,
        updateViaCache: 'none' // SW本体のHTTPキャッシュを使わず確実に検知
      });

      attachUpdateWatchers(reg);
      bindRefreshButton();

      // 起動直後/可視化/オンライン復帰/BFCache復帰で軽く update チェック
      const ping = () => reg.update().catch(() => {});
      setTimeout(ping, 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
      window.addEventListener('online', ping);
      window.addEventListener('pageshow', (e) => { if (e.persisted) ping(); });

      // 「今すぐ更新」クリック経由での自動リロードフラグ
      document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.id === 'tp-upd') userRequestedReload = true;
      }, true);

      if (reg.waiting) broadcast('SW_WAITING');
    } catch (e) {
      console.warn('SW register failed:', e);
    }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
})();