if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try{
      const reg = await navigator.serviceWorker.register('./sw.js');
      // 新しいSWが waiting 状態なら即時更新
      if (reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING'});

      // コントローラ変化時に一度だけリロード
      let refreshed = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshed) return;
        refreshed = true;
        location.reload();
      });
    }catch(e){
      console.warn('SW register failed', e);
    }
  });
}