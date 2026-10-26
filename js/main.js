// 起動とメインループ（requestAnimationFrame、経過時間ベース）。入力は input.js が担当。
'use strict';

(function () {
  const canvas = document.getElementById('game');
  const audio = new AudioManager();
  const game = new Game(audio);
  const renderer = new Renderer(canvas);
  const input = new InputController(game, canvas, audio);
  const stats = { fps: 60, updateMs: 0, drawMs: 0 };
  window.game = game;   // 開発・テスト用
  window.input = input; // 開発・テスト用

  // 画面サイズに合わせてゲーム画面を拡大縮小する。
  // タッチ操作の時は、セーフエリア（body の padding）と下の操作バーの分を除いた範囲に収める
  const bar = document.getElementById('touchBar');
  function layout() {
    if (!input.touchUi) { renderer.resize(); return; }
    const body = document.body;
    body.style.height = window.innerHeight + 'px'; // スマホのアドレスバー分を含めない実際の表示高さ
    const cs = getComputedStyle(body);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const barH = bar ? bar.offsetHeight : 0;
    renderer.resize(window.innerWidth - padX, window.innerHeight - padY - barH);
    if (bar) bar.style.width = canvas.style.width; // 操作バーの幅をゲーム画面に揃える
    input.updateTouchUi(true);
  }
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 300)); // 回転直後はサイズが古いことがある

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(CONFIG.DT_MAX, (now - last) / 1000);
    last = now;
    if (dt > 0) stats.fps += (1 / Math.max(dt, 1e-3) - stats.fps) * 0.05;

    const t0 = performance.now();
    game.update(dt);
    const t1 = performance.now();
    renderer.draw(game, stats);
    input.updateTouchUi(false);
    const t2 = performance.now();
    stats.updateMs += (t1 - t0 - stats.updateMs) * 0.1;
    stats.drawMs += (t2 - t1 - stats.drawMs) * 0.1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
