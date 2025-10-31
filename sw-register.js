// sw-register.js — v1.5.2（サブパス対応 / 更新バナー / ユーザー主導適用）
(() => {
  if (!('serviceWorker' in navigator)) return;

  // ▼必要に応じて上げる（sw.js の VERSION を上げた時に合わせる）
  const SW_VERSION = '1.5.2';
  const SW_URL     = `./sw.js?v=${encodeURIComponent(SW_VERSION)}`; // キャッシュバスト
  const SW_SCOPE   = './';                                          // /repo/ 配下のみ制御

  // --- UI: 既存の ↻ ボタンをハイライト（互換維持） ---
  const markUpdate = () => {
    const btn = document.getElementById('btnHardRefresh');
    if (btn) {
      btn.classList.add('update');
      btn.title = '新しいバージョンがあります。押して更新';
    }
    if (typeof window.showToast === 'function') {
      try { showToast('新しいバージョンがあります。↻で更新'); } catch (_) {}
    }
  };

  // --- UI: 画面下に小さな更新バナー（今すぐ更新／あとで） ---
  const BANNER_ID = 'tp-update-banner';
  const showBanner = (onConfirm) => {
    if (document.getElementById(BANNER_ID)) return;
    const el = document.createElement('div');
    el.id = BANNER_ID;
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
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
    document.body.appendChild(el);
    el.querySelector('#tp-upd').onclick   = () => { onConfirm?.(); el.remove(); };
    el.querySelector('#tp-later').onclick = () => el.remove();
  };

  // --- 更新監視（waiting/installed を検知して UI 表示） ---
  const attachUpdateWatchers = (reg) => {
    if (!reg) return;

    // 既に waiting がいれば即表示
    if (reg.waiting) {
      markUpdate();
      showBanner(() => reg.waiting.postMessage({ type:'SKIP_WAITING' }));
    }

    // 新しい SW の検知
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // 旧コントローラが存在＝更新時（初回インストールではない）
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          markUpdate();
          showBanner(() => {
            // installed 直後は reg.waiting に切り替わる
            const w = reg.waiting || sw;
            try { w.postMessage({ type:'SKIP_WAITING' }); } catch (_) {}
          });
        }
      });
    });
  };

  // --- ユーザーが更新を明示した時だけリロード ---
  let userRequestedReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userRequestedReload) location.reload();
  });

  // 既存の ↻ ボタンでも適用可能（互換）
  const bindRefreshButton = (reg) => {
    const btn = document.getElementById('btnHardRefresh');
    if (!btn || btn._tpBound) return;
    btn._tpBound = true;
    btn.addEventListener('click', () => {
      if (reg.waiting) {
        userRequestedReload = true;
        reg.waiting.postMessage({ type:'SKIP_WAITING' });
      } else if (typeof window.hardRefresh === 'function') {
        window.hardRefresh();
      } else {
        location.reload();
      }
    });
  };

  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, {
        scope: SW_SCOPE,
        updateViaCache: 'none'
      });

      attachUpdateWatchers(reg);
      bindRefreshButton(reg);

      // 起動直後＆復帰時に軽く更新チェック
      const ping = () => reg.update().catch(()=>{});
      setTimeout(ping, 2000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });

      // 「今すぐ更新」ボタン経由のときだけ自動リロード
      document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.id === 'tp-upd') userRequestedReload = true;
      }, true);
    } catch (e) {
      console.warn('SW register failed:', e);
    }
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    register();
  } else {
    window.addEventListener('load', register);
  }
})();