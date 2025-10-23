// sw-register.js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', {updateViaCache:'all'});

      // 新SWが waiting なら即有効化
      if (reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING'});

      // 有効化されたらページを1回だけリロード
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!window.__reloaded) { window.__reloaded = true; location.reload(); }
      });

      // 起動直後にも更新チェック
      reg.update();
    } catch (e) {
      console.log('SW register failed:', e);
    }
  });
}