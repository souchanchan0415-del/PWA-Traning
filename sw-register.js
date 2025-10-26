// sw-register.js — v1.4.3-2（サブパス対応 / ユーザー主導アップデート）
(() => {
  if (!('serviceWorker' in navigator)) return;

  const SW_URL   = 'sw.js?v=1.4.3-2'; // ← キャッシュバスト用クエリ
  const SW_SCOPE = './';              // ← /PWA-Traning/ 配下だけを制御

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

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, {
        scope: SW_SCOPE,
        updateViaCache: 'none'
      });

      // 既に waiting がいれば「更新あり」を表示
      if (reg.waiting) markUpdate();

      // 新 SW を検知 → install 完了時（旧コントローラがいる＝バックグラウンド更新完了）に表示
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) markUpdate();
        });
      });

      // ↻ クリックで即時適用（ユーザー主導のみ）
      let userRequestedReload = false;
      document.getElementById('btnHardRefresh')?.addEventListener('click', () => {
        if (reg.waiting) {
          userRequestedReload = true;
          reg.waiting.postMessage({ type: 'SKIP_WAITING' }); // sw.js 側の message で skipWaiting
        } else if (typeof window.hardRefresh === 'function') {
          window.hardRefresh(); // 既存のハードリフレッシュがあるなら利用
        } else {
          location.reload();
        }
      });

      // 自動リロードはしない。↻クリックで適用したときだけリロード
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (userRequestedReload) location.reload();
      });

      // 起動直後の軽い更新チェック
      reg.update().catch(() => {});
    } catch (e) {
      console.warn('SW register failed:', e);
    }
  });
})();
