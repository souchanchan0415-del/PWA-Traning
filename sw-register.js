// sw-register.js — v1.5.5-hotfix1
// ・サブパス対応（GitHub Pages 等）
// ・更新ドット / 画面下バナー
// ・ユーザーが明示した時だけ適用＆リロード
(() => {
  if (!('serviceWorker' in navigator)) return;

  // sw.js の更新に合わせて上げる（キャッシュバスト目的）
  const SW_VERSION = '1.5.5-hotfix1';

  // サブパスでも壊れない絶対URLを生成
  const SW_ABS_URL = new URL('./sw.js', location.href);
  SW_ABS_URL.searchParams.set('v', SW_VERSION);

  // 現ディレクトリ配下のみを制御（/repo-name/ 配下）
  const SW_SCOPE = new URL('./', location.href).pathname;

  // ---- UI: 更新ドット（↻ボタンを強調） ----
  const markUpdate = () => {
    const btn = document.getElementById('btnHardRefresh');
    if (btn) {
      btn.classList.add('update');
      btn.title = '新しいバージョンがあります。押して更新';
    }
    toast('新しいバージョンがあります。↻で更新できます');
  };

  // ---- UI: 下部に更新バナー（今すぐ更新／あとで）----
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
    document.body.appendChild(el);
    el.querySelector('#tp-upd').onclick   = () => { onConfirm?.(); el.remove(); };
    el.querySelector('#tp-later').onclick = () => el.remove();
  };

  // ---- 軽量トースト（app.js の showToast が無い環境のフォールバック）----
  function toast(msg){
    if (typeof window.showToast === 'function') {
      try { window.showToast(msg); return; } catch(_){}
    }
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tid);
    t._tid = setTimeout(()=> t.classList.remove('show'), 1600);
  }

  // ---- 更新検知（waiting/installed を監視）----
  const attachUpdateWatchers = (reg) => {
    if (!reg) return;

    // すでに waiting がいれば即通知
    if (reg.waiting) {
      markUpdate();
      showBanner(() => reg.waiting.postMessage({ type:'SKIP_WAITING' }));
    }

    // 新しい SW のインストールを検知
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        // 旧コントローラが存在＝更新時（初回は除外）
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          markUpdate();
          showBanner(() => {
            // installed 直後は reg.waiting に切り替わる
            const w = reg.waiting || sw;
            try { w.postMessage({ type:'SKIP_WAITING' }); } catch(_){}
          });
        }
      });
    });
  };

  // ---- 複数タブ連携：BroadcastChannel で「更新あり」を周知 ----
  let bc = null;
  try { bc = new BroadcastChannel('tp-sw'); } catch(_) {}
  const broadcast = (type) => { try { bc?.postMessage({ type }); } catch(_) {} };
  bc && bc.addEventListener('message', (e) => {
    if (e?.data?.type === 'SW_WAITING') {
      markUpdate();
      showBanner(() => {
        // 他タブで SKIP_WAITING をトリガー
        navigator.serviceWorker.getRegistration().then(reg=>{
          const w = reg?.waiting;
          if (w) w.postMessage({ type:'SKIP_WAITING' });
        });
      });
    }
  });

  // ---- 「今すぐ更新」を押したタブだけリロード ----
  let userRequestedReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userRequestedReload) location.reload();
  });

  // ↻ボタンでも更新適用（互換）
  const bindRefreshButton = (reg) => {
    const btn = document.getElementById('btnHardRefresh');
    if (!btn || btn._tpBound) return;
    btn._tpBound = true;
    btn.addEventListener('click', () => {
      if (reg.waiting) {
        userRequestedReload = true;
        reg.waiting.postMessage({ type:'SKIP_WAITING' });
      } else if (typeof window.__tpHardRefresh === 'function') {
        // index.html のフォールバック関数
        window.__tpHardRefresh();
      } else {
        location.reload();
      }
    });
  };

  // ---- 登録本体 ----
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_ABS_URL.toString(), {
        scope: SW_SCOPE,
        updateViaCache: 'none'
      });

      attachUpdateWatchers(reg);
      bindRefreshButton(reg);

      // 起動直後＆復帰時＆オンライン復帰で軽く update チェック
      const ping = () => reg.update().catch(()=>{});
      setTimeout(ping, 1200);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
      window.addEventListener('online', ping);

      // 「今すぐ更新」経由のときだけ自動リロード
      document.addEventListener('click', (e) => {
        const t = e.target;
        if (t && t.id === 'tp-upd') userRequestedReload = true;
      }, true);

      // reg.waiting を他タブにも伝える（SW からの postMessage が無い場合の保険）
      if (reg.waiting) broadcast('SW_WAITING');

      // SW 側からの任意メッセージに対応（オプショナル）
      navigator.serviceWorker.addEventListener('message', (evt) => {
        if (evt?.data?.type === 'SW_WAITING') {
          markUpdate();
          showBanner(() => reg.waiting?.postMessage({ type:'SKIP_WAITING' }));
          broadcast('SW_WAITING');
        }
      });
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