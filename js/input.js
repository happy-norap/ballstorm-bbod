// 入力処理と操作設定。
// 操作モード：
//   'lock'   … Pointer Lock API。クリックでマウスをロックし、movementX（相対移動量）でパドルを動かす。
//              カーソルが画面外に出ないので、端でマウスを動かし続けても操作が途切れない。
//   'cursor' … 従来方式。カーソル位置にパドルが追従する。
// タッチ操作（スマホ）：
//   ゲーム画面か画面下の操作バーを指でなぞるとパドルがその位置に追従（ポインターロックは使わない）。
//   ゲーム画面のタップで 発射 / 再開 / リスタート。操作バーのボタンで 一時停止・BGM・分裂。
//   タッチ用の表示（body.touch-ui）は、タッチ主体の端末では最初から、タッチ対応PCでは最初にタッチした時に有効になる。
//   マウス・キーボードの処理はタッチとは別経路で、従来どおり。
'use strict';

const TAP_MAX_MOVE = 12;   // これ以上指が動いたらタップではなくドラッグ（CSS px）
const TAP_MAX_TIME = 400;  // これより長く押していたらタップではない（ミリ秒）

const SETTINGS_KEY = 'endlessBreakout.settings';

class InputController {
  constructor(game, canvas, audio) {
    this.game = game;
    this.canvas = canvas;
    this.audio = audio;
    this.locked = false;
    this.skipNextMove = false;  // ロック直後の1回目の移動量は異常値になりやすいので捨てる
    this.lastUnlockAt = -1e9;
    this.settingsOpen = false;
    this.settings = this.loadSettings();
    this.lockSupported = 'requestPointerLock' in canvas;
    if (!this.lockSupported) this.settings.mode = 'cursor';
    // タッチ操作の状態
    this.touchUi = false;      // タッチ用のボタン・表示を出しているか
    this.dragId = null;        // パドルを動かしている指の pointerId
    this.tap = null;           // タップ判定中の指 { id, x, y, t }
    this.touchUiCache = '';    // ボタン表示の更新を変化時だけにするため
    this.syncUi();
    this.bind();
    try {
      if (window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches) this.enableTouchUi();
    } catch (e) { /* 判定できない環境では最初のタッチで有効化 */ }
  }

  // タッチ用の表示を有効にする（一度有効にしたらそのページを開いている間は維持）
  enableTouchUi() {
    if (this.touchUi) return;
    this.touchUi = true;
    document.body.classList.add('touch-ui');
    this.syncUi();
    window.dispatchEvent(new Event('resize')); // 操作バーの分だけゲーム画面を縮める
  }

  // ---------- 設定 ----------
  loadSettings() {
    const C = CONFIG;
    const s = { mode: C.CONTROL_MODE_DEFAULT, sensitivity: C.MOUSE_SENSITIVITY_DEFAULT };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (saved.mode === 'lock' || saved.mode === 'cursor') s.mode = saved.mode;
      if (typeof saved.sensitivity === 'number') s.sensitivity = saved.sensitivity;
    } catch (e) { /* 保存できない環境では既定値 */ }
    s.sensitivity = clamp(s.sensitivity, C.MOUSE_SENSITIVITY_MIN, C.MOUSE_SENSITIVITY_MAX);
    return s;
  }

  saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* 無視 */ }
  }

  setMode(mode) {
    if (mode === 'lock' && !this.lockSupported) mode = 'cursor';
    this.settings.mode = mode;
    if (mode === 'cursor' && this.locked) document.exitPointerLock();
    this.saveSettings();
    this.syncUi();
  }

  setSensitivity(v) {
    const C = CONFIG;
    this.settings.sensitivity = Math.round(clamp(v, C.MOUSE_SENSITIVITY_MIN, C.MOUSE_SENSITIVITY_MAX) * 10) / 10;
    this.saveSettings();
    this.syncUi();
  }

  // 描画側（操作説明の表示）と設定パネルに現在の状態を反映
  syncUi() {
    this.game.ui = { mode: this.settings.mode, locked: this.locked, sensitivity: this.settings.sensitivity, touch: this.touchUi && this.lastInputTouch !== false };
    this.canvas.style.cursor = this.settings.mode === 'cursor' ? 'none' : 'pointer';
    const panel = document.getElementById('settings');
    if (!panel) return;
    panel.hidden = !this.settingsOpen;
    for (const r of panel.querySelectorAll('input[name="mode"]')) r.checked = r.value === this.settings.mode;
    const lockRadio = panel.querySelector('input[value="lock"]');
    if (lockRadio) lockRadio.disabled = !this.lockSupported;
    const slider = document.getElementById('sensitivity');
    slider.value = this.settings.sensitivity;
    document.getElementById('sensitivityValue').textContent = this.settings.sensitivity.toFixed(1);
  }

  openSettings() {
    this.settingsOpen = true;
    if (this.locked) document.exitPointerLock();
    this.game.pause('settings');
    this.syncUi();
  }

  closeSettings() {
    this.settingsOpen = false;
    this.syncUi(); // ゲームは一時停止のまま。クリックで再開（ロックモードならロックも同時に開始）
  }

  // ---------- ポインターロック ----------
  requestLock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => this.onLockError());
    } catch (e) {
      this.onLockError();
    }
  }

  onLockChange(locked) {
    this.locked = locked;
    const g = this.game;
    if (locked) {
      this.skipNextMove = true;
      this.lockFailures = 0;
      // ロック解除・設定で止めていた場合は、再ロックで再開
      if (g.state === 'paused' && g.pauseReason !== 'user') g.resume();
    } else {
      this.lastUnlockAt = performance.now();
      g.pause('unlock');
    }
    this.syncUi();
  }

  onLockError() {
    // Chrome は Esc で解除した直後（約1秒）の再ロックを拒否するため、1回の失敗ではモードを変えない。
    // 連続で失敗する環境（iframe 内など）だけ、このセッション中はカーソル追従に切り替える（設定は保存しない）。
    const now = performance.now();
    if (now - (this.lastLockErrorAt || -1e9) < 200) return; // Promise の失敗と pointerlockerror の二重通知を1回に数える
    this.lastLockErrorAt = now;
    this.lockFailures = (this.lockFailures || 0) + 1;
    const g = this.game;
    if (this.lockFailures >= 3) {
      this.settings.mode = 'cursor';
      this.syncUi();
      g.popup(g.W / 2, g.H * 0.45, 'マウスロックが使えないため、カーソル追従で操作します', '#ffd36b', 14);
    } else {
      g.popup(g.W / 2, g.H * 0.45, 'マウスロックを開始できませんでした。少し待ってもう一度クリック', '#ffd36b', 14);
    }
  }

  // ---------- イベント ----------
  bind() {
    const canvas = this.canvas;
    document.addEventListener('pointerlockchange', () => this.onLockChange(document.pointerLockElement === canvas));
    document.addEventListener('pointerlockerror', () => this.onLockError());

    // ロック中：相対移動量で動かす
    document.addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.applyMovement(e.movementX);
    });

    // 非ロック時：カーソル追従モード（またはタッチ）だけ絶対位置で動かす。
    // ロックモードでロックしていない時は無視するので、ロック解除後にパドルが飛ばない。
    window.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') { this.onTouchMove(e); return; }
      if (this.locked || this.settingsOpen) return;
      if (this.settings.mode === 'cursor') this.game.setPointerX(this.toGameX(e.clientX));
    });
    window.addEventListener('pointerup', e => this.onTouchEnd(e, true));
    window.addEventListener('pointercancel', e => this.onTouchEnd(e, false));

    canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    window.addEventListener('keydown', e => this.onKeyDown(e));

    // ---- タッチ用 ----
    const bar = document.getElementById('touchBar');
    // 操作バーの空いている所をなぞってもパドルを動かせる（指でゲーム画面を隠さずに操作できる）
    if (bar) bar.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') this.onTouchDown(e, false); });
    // スクロール・ダブルタップ拡大・長押しメニュー・マウス互換イベントを止める（設定パネルは対象外）
    for (const el of [canvas, bar]) {
      if (el) el.addEventListener('touchstart', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    }
    document.addEventListener('gesturestart', e => e.preventDefault()); // iOS のピンチ拡大
    document.addEventListener('dblclick', e => e.preventDefault());
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.bindButton('btnSplit', () => this.game.activateSplit());
    this.bindButton('btnPause', () => {
      const g = this.game;
      if (this.settingsOpen) return;
      if (g.state === 'playing') g.pause('user');
      else if (g.state === 'paused') g.resume();
    });
    this.bindButton('btnBgm', () => this.audio.toggleBgm());

    // タブが裏に回ったら一時停止
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.game.pause('hidden'); });

    // 設定パネル
    const gear = document.getElementById('settingsButton');
    if (gear) gear.addEventListener('click', () => (this.settingsOpen ? this.closeSettings() : this.openSettings()));
    const panel = document.getElementById('settings');
    if (panel) {
      for (const r of panel.querySelectorAll('input[name="mode"]')) r.addEventListener('change', () => this.setMode(r.value));
      document.getElementById('sensitivity').addEventListener('input', e => this.setSensitivity(Number(e.target.value)));
      document.getElementById('settingsClose').addEventListener('click', () => this.closeSettings());
    }
  }

  applyMovement(mx) {
    if (this.skipNextMove) { this.skipNextMove = false; return; }
    if (!mx || Math.abs(mx) > CONFIG.MOVEMENT_SPIKE_LIMIT) return;
    // 画面上の見かけの移動量をゲーム座標に換算し、感度を掛ける
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width > 0 ? CONFIG.WIDTH / rect.width : 1;
    this.game.movePointer(mx * k * this.settings.sensitivity);
  }

  toGameX(clientX) {
    const rect = this.canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * CONFIG.WIDTH;
  }
  toGameY(clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return ((clientY - rect.top) / rect.height) * CONFIG.HEIGHT;
  }

  // ---------- タッチ ----------
  // onCanvas：ゲーム画面で触れたか（false は操作バーの空き部分）
  onTouchDown(e, onCanvas) {
    const g = this.game;
    if (this.lastInputTouch === false) { this.lastInputTouch = true; this.syncUi(); } // 案内文をタッチ用に戻す
    this.enableTouchUi();
    this.audio.unlock();
    if (e.cancelable) e.preventDefault();
    if (this.settingsOpen) { this.closeSettings(); return; }
    const gx = this.toGameX(e.clientX);
    // 従来からある操作：HUD の分裂ストック部分のタップで分裂（パドルは動かさない）
    if (onCanvas && this.toGameY(e.clientY) < CONFIG.HUD_HEIGHT && gx > 350 && gx < 460) { g.activateSplit(); return; }
    if (this.dragId === null) { this.dragId = e.pointerId; g.setPointerX(gx); }
    if (onCanvas) this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  }

  onTouchMove(e) {
    if (this.tap && this.tap.id === e.pointerId &&
        Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > TAP_MAX_MOVE) this.tap = null;
    if (e.pointerId !== this.dragId || this.settingsOpen) return;
    this.game.setPointerX(this.toGameX(e.clientX)); // 指を離しても最後の位置に留まる
  }

  onTouchEnd(e, isUp) {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.dragId) this.dragId = null;
    const tap = this.tap;
    if (!tap || tap.id !== e.pointerId) return;
    this.tap = null;
    if (!isUp || performance.now() - tap.t > TAP_MAX_TIME || this.settingsOpen) return;
    // タップ：発射 / リスタート / 再開（プレイ中のタップは何もしない）
    const g = this.game;
    if (g.state === 'ready') g.launch();
    else if (g.state === 'gameover') g.reset();
    else if (g.state === 'paused') g.resume();
  }

  // 操作バーのボタン：押した瞬間に1回だけ実行（長押しでも連続しない）。パドル移動・タップ判定には渡さない
  bindButton(id, fn) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.pointerType === 'touch') this.enableTouchUi();
      this.audio.unlock();
      fn();
      this.updateTouchUi(true);
    });
    el.addEventListener('click', e => e.preventDefault());
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  // 毎フレーム呼ぶ：ボタンの表示（使用可否・ストック数・一時停止/再開・BGM）を状態に合わせる
  updateTouchUi(force) {
    if (!this.touchUi) return;
    const g = this.game;
    const canSplit = g.state === 'playing' && g.canSplit;
    const pausable = g.state === 'playing' || g.state === 'paused';
    const key = `${canSplit}|${g.splitStock}|${g.state}|${pausable}|${this.audio.bgmOn}`;
    if (!force && key === this.touchUiCache) return;
    this.touchUiCache = key;
    const split = document.getElementById('btnSplit');
    if (split) {
      split.textContent = `SPLIT ×${g.splitStock}`;
      split.classList.toggle('disabled', !canSplit);
      split.setAttribute('aria-disabled', String(!canSplit));
    }
    const pause = document.getElementById('btnPause');
    if (pause) {
      pause.textContent = g.state === 'paused' ? '▶' : 'II';
      pause.setAttribute('aria-label', g.state === 'paused' ? '再開' : '一時停止');
      pause.classList.toggle('disabled', !pausable);
    }
    const bgm = document.getElementById('btnBgm');
    if (bgm) {
      bgm.textContent = this.audio.bgmOn ? '♪ ON' : '♪ OFF';
      bgm.classList.toggle('off', !this.audio.bgmOn);
    }
  }

  onPointerDown(e) {
    const g = this.game;
    if (e.pointerType === 'touch') { this.onTouchDown(e, true); return; }
    // タッチ対応PCでマウスに持ち替えた時は、画面の案内文をマウス用に戻す（ボタン表示はそのまま）
    if (this.touchUi && this.lastInputTouch !== false) { this.lastInputTouch = false; this.syncUi(); }
    this.audio.unlock();
    if (this.settingsOpen) { this.closeSettings(); return; }
    // 以下はマウス・ペン（タッチは onTouchDown で処理する）

    // ロックモードで未ロック：このクリックはロック開始専用（発射はしない）
    if (this.settings.mode === 'lock' && !this.locked) {
      this.requestLock();
      if (g.state === 'gameover') g.reset(); // リスタートは発射ではないので同時に行う
      return;
    }

    if (!this.locked) {
      g.setPointerX(this.toGameX(e.clientX));
      // HUDの分裂ストック部分をタップしたら分裂（スマホ操作用）
      if (this.toGameY(e.clientY) < CONFIG.HUD_HEIGHT) {
        const x = this.toGameX(e.clientX);
        if (x > 350 && x < 460) { g.activateSplit(); return; }
      }
    }

    if (g.state === 'ready') g.launch();
    else if (g.state === 'gameover') g.reset();
    else if (g.state === 'paused') g.resume();
  }

  onKeyDown(e) {
    const g = this.game;
    this.audio.unlock();
    const lockWaiting = this.settings.mode === 'lock' && !this.locked;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (g.state === 'ready') { if (!lockWaiting) g.launch(); }
        else g.activateSplit();
        break;
      case 'Escape':
        if (this.locked) { document.exitPointerLock(); break; }        // 解除 → pointerlockchange で一時停止
        // ブラウザのロック解除と同じEscを二重処理しない
        if (this.settings.mode === 'lock' && performance.now() - this.lastUnlockAt < 400) break;
        if (this.settingsOpen) { this.closeSettings(); break; }
        if (g.state === 'paused' && lockWaiting) break;                 // ロック待ちの間は再開しない（クリックで再開）
        g.togglePause();
        break;
      case 'KeyP':
        if (g.state === 'paused' && lockWaiting) break;
        g.togglePause();
        break;
      case 'KeyR': g.reset(); break;
      case 'KeyM': this.audio.toggleBgm(); break;
      case 'KeyO': this.settingsOpen ? this.closeSettings() : this.openSettings(); break;
      default:
        if (CONFIG.DEV_KEYS_ENABLED) this.onDevKey(e);
    }
  }

  // 開発用キー（公開版では CONFIG.DEV_KEYS_ENABLED = false で無効）
  onDevKey(e) {
    const g = this.game;
    // 100万点イベント用：誤操作しにくいよう Ctrl+Shift+ファンクションキー
    if (e.ctrlKey && e.shiftKey) {
      if (e.code === 'F8') { e.preventDefault(); g.debugSetScoreNearMillion(); g.popup(g.W / 2, g.H * 0.6, 'DEBUG: SCORE 999,900', '#7dffa8', 14); }
      else if (e.code === 'F9') { e.preventDefault(); g.debugTriggerMillionaire(); }
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    switch (e.code) {
      case 'KeyD': g.debug = !g.debug; break;
      case 'Digit1': if (g.state === 'playing') g.debugGive(ITEM.SPLIT); break;
      case 'Digit2': if (g.state === 'playing') g.debugGive(ITEM.ROTOR); break;
      case 'Digit3': if (g.state === 'playing') g.debugGive(ITEM.PIERCE); break;
      case 'Digit4': if (g.state === 'playing') g.debugGive(ITEM.GRAVITY); break;
      case 'KeyB': g.debugAddBalls(e.shiftKey ? 1000 : 100); break;
    }
  }
}
