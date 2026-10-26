// 入力処理と操作設定。
// 操作モード：
//   'lock'   … Pointer Lock API。クリックでマウスをロックし、movementX（相対移動量）でパドルを動かす。
//              カーソルが画面外に出ないので、端でマウスを動かし続けても操作が途切れない。
//   'cursor' … 従来方式。カーソル位置にパドルが追従する。
// タッチ操作は常にカーソル追従方式で扱う（将来のスマホ対応用）。
'use strict';

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
    this.syncUi();
    this.bind();
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
    this.game.ui = { mode: this.settings.mode, locked: this.locked, sensitivity: this.settings.sensitivity };
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
      if (this.locked || this.settingsOpen) return;
      if (this.settings.mode === 'cursor' || e.pointerType === 'touch') this.game.setPointerX(this.toGameX(e.clientX));
    });

    canvas.addEventListener('pointerdown', e => this.onPointerDown(e));
    window.addEventListener('keydown', e => this.onKeyDown(e));

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

  onPointerDown(e) {
    const g = this.game;
    this.audio.unlock();
    if (this.settingsOpen) { this.closeSettings(); return; }
    const touch = e.pointerType === 'touch';

    // ロックモードで未ロック：このクリックはロック開始専用（発射はしない）
    if (this.settings.mode === 'lock' && !this.locked && !touch) {
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
