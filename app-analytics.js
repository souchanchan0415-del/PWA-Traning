// Train Punch analytics shim — v1.1.1
// v1.1.1 から分析ロジック本体は app.js 側に集約。
// このファイルは「app.js にある renderAnalytics() を安全に呼ぶだけ」の薄いラッパー。
// - DOM 構築後に一度だけ描画
// - 画面サイズ変更時に軽く描画し直し（Chart.js のレイアウト崩れ防止）

(() => {
  if (typeof window === 'undefined') return;

  function safeRenderAnalytics() {
    try {
      if (typeof window.renderAnalytics === 'function') {
        // app.js 内の renderAnalytics を呼び出す
        window.renderAnalytics();
      }
    } catch (e) {
      console.warn('[TP] analytics render failed:', e);
      try {
        if (typeof window.showToast === 'function') {
          window.showToast('分析タブの読み込みに失敗しました');
        }
      } catch (_) {}
    }
  }

  // 初回：DOM 構築完了後に 1 回だけ実行
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    safeRenderAnalytics();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      safeRenderAnalytics();
    }, { once: true });
  }

  // 画面サイズ変更時に再描画（Chart.js のキャンバス崩れ対策）
  const onResize = (typeof debounce === 'function')
    ? debounce(() => safeRenderAnalytics(), 200)
    : () => safeRenderAnalytics();

  window.addEventListener('resize', onResize);
})();