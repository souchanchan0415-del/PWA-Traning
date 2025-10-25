// sw-register.js (safe: no auto reload, user-triggered apply)
(() => {
  if (!('serviceWorker' in navigator)) return;

  const markUpdate = () => {
    const btn = document.getElementById('btnHardRefresh');
    if (btn) {
      btn.classList.add('update');              // 視覚ヒント（CSS下に記載）
      btn.title = '新しいバージョンがあります。押して更新';
    }
    // 可能ならトーストも
    if (typeof window.showToast === 'function') {
      try { showToast('新しいバージョンがあります。↻で更新'); } catch (_) {}
    }
  };

  window.addEventListener('load', async () => {
    try {
      // 重要：'none' にしてHTTPキャッシュ越しの古いSWを避ける
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });

      // 既に waiting なら「更新あり」を示す
      if (reg.waiting) markUpdate();

      // 新しいSW検知 → install完了（installed）で通知
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            // 旧コントローラがいる＝バックグラウンド更新完了
            markUpdate();
          }
        });
      });

      // ↻ボタンで「今すぐ更新」を適用（ユーザー主導）
      document.getElementById('btnHardRefresh')?.addEventListener('click', () => {
        // 新SWが待機中なら即時有効化を要求
        reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
        // あとは app.js の hardRefresh() が SW unregister + cache clear + reload を実行
        // （app.js の既存ハンドラでOK。ここでは何もしない）
      });

      // ★自動リロードはしない（不安定化の元）
      // navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());

      // 起動直後の軽い更新チェック
      reg.update().catch(()=>{});
    } catch (e) {
      console.warn('SW register failed:', e);
    }
  });
})();