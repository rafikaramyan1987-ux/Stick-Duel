// Playgama build boot (inlined into index.html right after the Bridge CDN script by vite.config.ts): Playgama's
// required step 2 (wiki.playgama.com/playgama/bridge-sdk/api, "Required steps"): call bridge.initialize() and wait for
// it before the game starts loading its engine and assets. The game bundle is kept inert in the page
// (<script type="text/plain" data-playgama-game>) and started only once initialize() has settled; the game reads the
// outcome from window.__playgamaBridgeInit (null = initialized, otherwise the error). A failure is never silent: it
// is logged with console.error, and the game still starts without the SDK (no ads, no Bridge storage) so it stays
// playable.
(function () {
  var TAG = '[Playgama Bridge]';
  function failed(e) {
    console.error(TAG + ' bridge.initialize() failed; the game runs WITHOUT Playgama Bridge (no ads, no Bridge storage, no game_ready):', e);
    return e || new Error('bridge.initialize() rejected');
  }
  var init;
  try {
    if (!window.bridge || typeof window.bridge.initialize !== 'function') throw new Error('window.bridge is missing: the Bridge script did not load');
    var slow = setTimeout(function () {
      console.warn(TAG + ' bridge.initialize() has not finished after 15 s; still waiting (the game starts once it settles)');
    }, 15000);
    init = window.bridge.initialize().then(
      function () {
        clearTimeout(slow);
        return null;
      },
      function (e) {
        clearTimeout(slow);
        return failed(e);
      },
    );
  } catch (e) {
    init = Promise.resolve(failed(e));
  }
  window.__playgamaBridgeInit = init;
  function start() {
    var held = document.querySelectorAll('script[data-playgama-game]');
    for (var i = 0; i < held.length; i++) {
      var s = document.createElement('script');
      s.type = 'module';
      var src = held[i].getAttribute('data-src');
      if (src) s.src = src;
      else s.textContent = held[i].textContent;
      held[i].parentNode.insertBefore(s, held[i].nextSibling);
    }
  }
  init.then(function () {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });
})();
