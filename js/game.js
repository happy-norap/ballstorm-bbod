// ゲームの状態と更新処理（物理・衝突・ルール）。描画は render.js が担当する。
'use strict';

const BLOCK = { NORMAL: 0, SPLIT: 1, CAPTURE: 2, ABSORB: 3, ARMOR: 4 };
const ITEM = { SPLIT: 'S', ROTOR: 'R', PIERCE: 'P', GRAVITY: 'G' };
const ITEM_COLORS = { S: '#ffe14a', R: '#3ef0ff', P: '#ff7a2a', G: '#ff7ad9' };

const DEG = Math.PI / 180;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
// [[しきい値, 値], ...]（しきい値の小さい順）から、count 以上で最大のしきい値の値を返す
function bandValue(bands, count) {
  let v = bands[0][1];
  for (let i = 0; i < bands.length; i++) if (count >= bands[i][0]) v = bands[i][1];
  return v;
}

class Game {
  constructor(audio) {
    this.audio = audio;
    const C = CONFIG;
    this.W = C.WIDTH;
    this.H = C.HEIGHT;
    this.colW = (C.WIDTH - C.BLOCK_SIDE_MARGIN * 2) / C.BLOCK_COLS;
    this.paddleY = C.HEIGHT - C.PADDLE_Y_FROM_BOTTOM;
    this.limitY = C.HEIGHT - C.LIMIT_LINE_FROM_BOTTOM;
    this.minVertSin = Math.sin(C.BALL_MIN_VERTICAL_DEG * DEG);
    this.minVertCos = Math.cos(C.BALL_MIN_VERTICAL_DEG * DEG);
    this.debug = C.DEBUG_DEFAULT && C.DEV_KEYS_ENABLED; // 公開版（開発用キー無効）ではデバッグ表示も出さない
    this.best = 0;
    try { this.best = Number(localStorage.getItem('endlessBreakout.best')) || 0; } catch (e) { /* 保存できない環境では無視 */ }
    this.mouseX = this.W / 2;
    this.reset();
  }

  reset() {
    const C = CONFIG;
    this.state = 'ready';          // ready / playing / paused / gameover
    this.time = 0;
    this.score = 0;
    this.balls = [];
    this.rows = [];                // rows[slot][col] = block | null（slot 0 が最上段）
    this.blockCount = 0;
    this.scroll = 0;               // 押し下げアニメーション用のYオフセット（負→0）
    this.rowsAdded = 0;            // 定期補充の列数（補充間隔の短縮に使う。増援分は数えない）
    this.hueIndex = 0;             // ブロックの色を列ごとに変えるためのカウンター
    this.rowTimer = 0;
    // 緊急増援の状態
    this.rush = { active: false, queue: 0, timer: 0, delivered: 0, cooldown: 0, count: 0, topups: 0, failed: false };
    this.flights = [];             // 落下中の増援列 { slot, row, t }
    this.pressure = 0;             // 侵入圧力（吸収ブロック出現率に影響）
    this.intruded = 0;             // 侵入で消えたブロック総数
    this.particles = [];
    this.rings = [];               // アイテム取得時の波紋エフェクト
    this.popups = [];
    this.splitStock = 0;
    this.rotorTime = 0;
    this.rotorAngle = 0;
    this.pierceTime = 0;
    this.gravityTime = 0;
    this.gravityFlash = 0;         // 急反発時のパドル発光
    this.gravityFx = 0;            // このフレームに出した反発エフェクト数
    this.gravityStats = { pulled: 0, rebounds: 0 }; // 直近フレームの吸引中ボール数と累計反発回数
    this.maxBalls = 0;
    this.destroyed = 0;
    this.destroyedArmor = 0;
    // 特別イベント「MILLIONAIRE」：done は1プレイ1回の発動済みフラグ（リスタートで戻る）
    this.millionaire = { done: false, phase: 'idle', t: 0, x: 0, y: 0, burstY: 0, msg: 0, flash: 0 };
    this.sparks = [];              // 花火の光の粒（打ち上げの火花・炸裂の粒）
    // スコア到達イベント（200万 / 500万 / 1,000万。演出のみ）：done は1プレイ1回の発動済みフラグ
    this.scoreEvents = { done: CONFIG.SCORE_EVENTS.map(() => false), clock: 0, busyUntil: 0 };
    this.shells = [];              // 打ち上げ中・待機中の花火 { delay, x, y, y0, ty, t, colors, n }
    this.waves = [];               // 衝撃波の輪 { delay, x, y, t, color }
    this.titles = [];              // 称号表示 { ev, t }（t < 0 の間は待機）
    this.eventFlash = { a: 0, color: '255,255,255' };
    this.paddle = { x: this.mouseX, vx: 0, prevX: this.mouseX };
    this.blades = [];
    this.shake = 0;
    for (let i = 0; i < C.INITIAL_ROWS; i++) this.pushRow(false);
    this.resetReadyBall();
  }

  resetReadyBall() {
    this.balls.length = 0;
    this.balls.push(this.makeBall(this.paddle.x, this.paddleY - CONFIG.PADDLE_HEIGHT / 2 - CONFIG.BALL_RADIUS, 0, -1));
  }

  // ---------- 便利関数 ----------
  get baseSpeed() {
    const C = CONFIG;
    return C.BALL_SPEED_INITIAL * Math.pow(1 + C.SPEED_UP_RATE, Math.floor(this.time / C.SPEED_UP_INTERVAL));
  }
  // 時間倍率：60秒ごとに ×1.1 の複利（上限10倍）。time は一時停止中に進まないので倍率も止まる
  get scoreMult() {
    const C = CONFIG;
    return Math.min(C.SCORE_MULT_MAX, Math.pow(1 + C.SCORE_MULT_RATE, Math.floor(this.time / C.SCORE_MULT_INTERVAL)));
  }
  // あと何個ボールを生成できるか
  get ballRoom() { return Math.max(0, CONFIG.BALL_LIMIT - this.balls.length); }
  get canSplit() { return this.splitStock > 0 && this.balls.length <= CONFIG.SPLIT_MAX_BALLS; }
  get rowInterval() {
    const C = CONFIG;
    return Math.max(C.ROW_INTERVAL_MIN, C.ROW_INTERVAL_INITIAL - this.rowsAdded * C.ROW_INTERVAL_DECAY);
  }
  blockX(col) { return CONFIG.BLOCK_SIDE_MARGIN + col * this.colW + CONFIG.BLOCK_GAP / 2; }
  blockY(slot) { return CONFIG.BLOCK_TOP + slot * CONFIG.BLOCK_ROW_HEIGHT + this.scroll + CONFIG.BLOCK_GAP / 2; }
  get blockW() { return this.colW - CONFIG.BLOCK_GAP; }
  get blockH() { return CONFIG.BLOCK_ROW_HEIGHT - CONFIG.BLOCK_GAP; }

  makeBall(x, y, dx, dy, sp) {
    const len = Math.hypot(dx, dy) || 1;
    // gcd：急反発のクールダウン、pull：吸引中の表示用タイマー、trail：吸引中の軌跡
    const b = { x, y, dx: dx / len, dy: dy / len, sp: sp || this.baseSpeed, gcd: 0, pull: 0, trail: null, armorIn: null };
    this.fixAngle(b);
    return b;
  }

  // 水平に近すぎる角度を補正（無限往復の防止）
  fixAngle(b) {
    if (Math.abs(b.dy) < this.minVertSin) {
      b.dy = (b.dy < 0 ? -1 : 1) * this.minVertSin;
      b.dx = (b.dx < 0 ? -1 : 1) * this.minVertCos;
    }
  }

  // ボールを1個追加。上限（BALL_LIMIT）に達していれば何もせず null を返す
  addBall(x, y, angle, sp) {
    if (this.balls.length >= CONFIG.BALL_LIMIT) return null;
    return this.pushBall(x, y, angle, sp);
  }
  // 上限を見ずに追加（開発用の負荷測定だけで使う）
  pushBall(x, y, angle, sp) {
    const b = this.makeBall(x, y, Math.cos(angle), Math.sin(angle), sp);
    this.balls.push(b);
    return b;
  }

  // ---------- ブロック列の生成 ----------
  // 定期補充：最上段に1列追加し、既存ブロックを1段押し下げる
  pushRow(animate) {
    const row = this.generateRow();
    for (const b of row) if (b) this.blockCount++;
    this.rows.unshift(row);
    this.rowsAdded++;
    for (const f of this.flights) f.slot++; // 落下中の増援の着地点も一緒にずらす
    if (animate) this.scroll -= CONFIG.BLOCK_ROW_HEIGHT;
  }

  // 1列分のブロックを生成（まだ盤面には置かない）
  generateRow() {
    const C = CONFIG;
    const absorbW = Math.min(C.WEIGHT_ABSORB_MAX, C.WEIGHT_ABSORB_BASE + this.pressure * C.WEIGHT_ABSORB_PER_PRESSURE);
    const total = C.WEIGHT_NORMAL + C.WEIGHT_SPLIT + C.WEIGHT_CAPTURE + absorbW;
    const hue = (this.hueIndex++ * 23) % 360;
    const row = new Array(C.BLOCK_COLS).fill(null);
    // 装甲ブロックの出現率は、この列を生成した時点のボール数で決める
    const armorRate = bandValue(C.ARMOR_RATE_BANDS, this.balls.length);
    for (let c = 0; c < C.BLOCK_COLS; c++) {
      if (Math.random() < C.ROW_EMPTY_CHANCE) continue;
      if (Math.random() < armorRate) {
        row[c] = { type: BLOCK.ARMOR, hue, item: null, hits: C.ARMOR_HP };
        continue;
      }
      let r = Math.random() * total;
      let type;
      if ((r -= C.WEIGHT_NORMAL) < 0) type = BLOCK.NORMAL;
      else if ((r -= C.WEIGHT_SPLIT) < 0) type = BLOCK.SPLIT;
      else if ((r -= C.WEIGHT_CAPTURE) < 0) type = BLOCK.CAPTURE;
      else type = BLOCK.ABSORB;
      // アイテムは通常ブロックにだけ入る（特殊ブロックの仕様は変えない）
      const item = type === BLOCK.NORMAL && Math.random() < C.ITEM_BLOCK_CHANCE ? this.rollItem() : null;
      row[c] = { type, hue, item, hits: type === BLOCK.ABSORB ? C.ABSORB_CAPACITY : 1 };
    }
    return row;
  }

  // ---------- 緊急増援（ブロック・ラッシュ） ----------
  get rushThreshold() {
    const C = CONFIG;
    const base = C.RUSH_BASELINE_BLOCKS || C.INITIAL_ROWS * C.BLOCK_COLS;
    return Math.floor(base * C.RUSH_THRESHOLD_RATIO);
  }

  // 一番下にあるブロック（盤面＋落下中の増援）の段。無ければ -1
  bottomFilledSlot() {
    let bottom = -1;
    for (let s = this.rows.length - 1; s >= 0; s--) {
      if (this.rows[s].some(b => b)) { bottom = s; break; }
    }
    for (const f of this.flights) if (f.slot > bottom) bottom = f.slot;
    return bottom;
  }

  // 押し下げ後の最終位置で、侵入ラインまで RUSH_SAFE_ROWS 列以上の余裕がある最大の段
  get rushSafeMaxSlot() {
    const C = CONFIG;
    const limit = this.limitY - C.RUSH_SAFE_ROWS * C.BLOCK_ROW_HEIGHT;
    return Math.floor((limit - C.BLOCK_TOP) / C.BLOCK_ROW_HEIGHT) - 1;
  }

  // 次の増援列の着地点を決める。置けなければ -1（押し下げが必要な時はここで1段空ける）
  // 方針：盤面の中の「丸ごと空いている段」を優先し、一番下のブロックの上から順に積み上げる
  //       （既存ブロックは動かさない）。空き段が無い時だけ押し下げ、
  //       その場合も侵入ラインに RUSH_SAFE_ROWS 列以上の余裕がある時に限る。
  reserveRushSlot(dryRun) {
    const bottom = this.bottomFilledSlot();
    if (bottom === -1) {
      // 盤面が空：これから届く列数ぶんの高さに積み上げる
      return Math.min(Math.max(this.rush.queue, 1) - 1, this.rushSafeMaxSlot);
    }
    const reserved = new Set(this.flights.map(f => f.slot));
    // 侵入ラインに近すぎる段（安全余白の内側）には置かない
    for (let s = Math.min(bottom - 1, this.rushSafeMaxSlot); s >= 0; s--) {
      if (reserved.has(s)) continue;
      const row = this.rows[s];
      if (!row || row.every(b => b === null)) return s;
    }
    // 空き段が無い → 1段押し下げて最上段を空ける
    if (bottom + 1 > this.rushSafeMaxSlot) return -1;
    if (dryRun) return 0;
    this.rows.unshift(new Array(CONFIG.BLOCK_COLS).fill(null));
    for (const f of this.flights) f.slot++;
    this.scroll -= CONFIG.BLOCK_ROW_HEIGHT;
    return 0;
  }

  startRush(rows) {
    const C = CONFIG;
    const R = this.rush;
    R.active = true;
    R.queue = Math.min(rows, C.RUSH_MAX_ROWS);
    R.delivered = 0;
    R.topups = 0;
    R.failed = false;
    R.timer = C.RUSH_NOTICE_TIME;
    R.count++;
    R.flash = 1;
    this.popup(this.W / 2, this.H * 0.42, 'INCOMING!', '#ff4d6d', 34);
    this.popup(this.W / 2, this.H * 0.42 + 32, `+${R.queue} ROWS`, '#ffb3c0', 16);
    this.audio.sfx('incoming');
  }

  updateRush(dt) {
    const C = CONFIG;
    const R = this.rush;
    if (R.cooldown > 0) R.cooldown -= dt;
    if (R.flash > 0) R.flash = Math.max(0, R.flash - dt);

    // 落下中の列を進め、着地したら盤面に置く
    let w = 0;
    for (let i = 0; i < this.flights.length; i++) {
      const f = this.flights[i];
      f.t += dt;
      if (f.t >= C.RUSH_DROP_TIME) this.landFlight(f);
      else this.flights[w++] = f;
    }
    this.flights.length = w;

    const threshold = this.rushThreshold;
    if (!R.active) {
      if (R.cooldown > 0) return;
      if (this.blockCount > threshold) return;
      if (this.reserveRushSlot(true) === -1) return; // 置き場所が無い時は通知もしない
      this.startRush(this.blockCount === 0 ? C.RUSH_ROWS_EMPTY : C.RUSH_ROWS_LOW);
      return;
    }

    // 0.15秒間隔で1列ずつ出発
    if (R.queue > 0) {
      R.timer -= dt;
      while (R.queue > 0 && R.timer <= 0) {
        const slot = this.reserveRushSlot(false);
        if (slot === -1) { R.queue = 0; R.failed = true; break; }
        this.flights.push({ slot, row: this.generateRow(), t: 0 });
        R.queue--;
        R.delivered++;
        R.timer += C.RUSH_ROW_INTERVAL;
      }
    }

    // 全列が着地した時点で、まだ閾値以下なら同じ増援の中で追加補充（上限 RUSH_MAX_ROWS まで）
    if (R.queue === 0 && this.flights.length === 0) {
      const remaining = C.RUSH_MAX_ROWS - R.delivered;
      if (!R.failed && remaining > 0 && this.blockCount <= threshold && this.reserveRushSlot(true) !== -1) {
        R.queue = Math.min(remaining, this.blockCount === 0 ? C.RUSH_ROWS_EMPTY : C.RUSH_ROWS_LOW);
        R.timer = C.RUSH_ROW_INTERVAL;
        R.topups++;
      } else {
        R.active = false;
        R.cooldown = C.RUSH_COOLDOWN;
      }
    }
  }

  landFlight(f) {
    while (this.rows.length <= f.slot) this.rows.push(new Array(CONFIG.BLOCK_COLS).fill(null));
    const row = this.rows[f.slot];
    const y = this.blockY(f.slot) + this.blockH / 2;
    for (let c = 0; c < row.length; c++) {
      if (!f.row[c] || row[c]) continue;
      row[c] = f.row[c];
      this.blockCount++;
      if (this.particles.length < CONFIG.PARTICLE_MAX) {
        this.particles.push({ x: this.blockX(c) + this.blockW / 2, y, vx: rand(-60, 60), vy: rand(-120, -40), life: 0.3, color: '#ffffff' });
      }
    }
    this.audio.sfx('land');
  }

  // ---------- 入力から呼ばれる操作 ----------
  // パドルの目標位置。常にパドルが画面内に収まる範囲に制限する
  // （範囲外に溜め込まないので、端で動かし続けた後でも逆方向へすぐ動ける）
  setPointerX(x) {
    const half = CONFIG.PADDLE_WIDTH / 2;
    this.mouseX = clamp(x, half, this.W - half);
  }
  movePointer(dx) { this.setPointerX(this.mouseX + dx); }

  launch() {
    if (this.state !== 'ready') return;
    this.state = 'playing';
    const b = this.balls[0];
    const a = -Math.PI / 2 + rand(-0.35, 0.35);
    b.dx = Math.cos(a); b.dy = Math.sin(a);
    this.audio.startBgm();
    this.audio.sfx('launch');
  }

  // reason: 'user'（Pキー） / 'unlock'（ポインターロック解除） / 'settings' / 'hidden'（タブ非表示）
  pause(reason) {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pauseReason = reason;
  }
  resume() {
    if (this.state === 'paused') this.state = 'playing';
  }
  togglePause() {
    if (this.state === 'playing') this.pause('user');
    else this.resume();
  }

  // 分裂アイテム発動：ストックをすべて消費し、全ボールを N 個にする
  // ボールが SPLIT_MAX_BALLS 個を超えている時は使えない（ストックは消費しない）。
  // 上限 BALL_LIMIT に収まらない時は、追加できる数を各ボールへ均等に割り振る
  activateSplit() {
    if (this.state !== 'playing' || this.splitStock <= 0) return false;
    const C = CONFIG;
    if (this.balls.length > C.SPLIT_MAX_BALLS) {
      this.popup(this.W / 2, this.H / 2, `SPLIT: ${C.SPLIT_MAX_BALLS}球以下で使用可`, '#aaaaaa', 18);
      return false;
    }
    const n = C.SPLIT_COUNTS[Math.min(this.splitStock, C.SPLIT_COUNTS.length - 1)];
    this.splitStock = 0;
    const spread = C.SPLIT_SPREAD_DEG * DEG;
    const full = C.SPLIT_SPREAD_DEG >= 360;
    const count = this.balls.length;
    if (count === 0) return false;
    const room = this.ballRoom;
    const extraEach = Math.min(n - 1, Math.floor(room / count));
    let extraRest = extraEach < n - 1 ? room - extraEach * count : 0; // 割り切れない余りは先頭のボールから1個ずつ
    for (let i = 0; i < count; i++) {
      const b = this.balls[i];
      const base = Math.atan2(b.dy, b.dx);
      let m = 1 + extraEach;             // このボールの分裂後の個数
      if (extraRest > 0) { m++; extraRest--; }
      for (let k = 0; k < m; k++) {
        const t = full ? k / m : (m === 1 ? 0.5 : k / (m - 1));
        const a = base + spread * (t - (full ? 0 : 0.5)) + rand(-0.03, 0.03);
        if (k === 0) {
          b.dx = Math.cos(a); b.dy = Math.sin(a); this.fixAngle(b);
        } else {
          this.addBall(b.x, b.y, a, b.sp);
        }
      }
    }
    this.shake = Math.max(this.shake, 6);
    this.audio.sfx('split');
    this.popup(this.W / 2, this.H / 2, `SPLIT ×${n}`, '#ffe14a', 26);
    return true;
  }

  // 開発用：性能測定のためにボールを大量追加
  debugAddBalls(n) {
    if (this.state === 'ready') this.launch();
    for (let i = 0; i < n; i++) {
      // 負荷測定用なので上限（BALL_LIMIT）を無視して追加する
      this.pushBall(rand(40, this.W - 40), this.paddleY - 40 - Math.random() * 200, rand(-Math.PI * 0.9, -Math.PI * 0.1));
    }
  }

  // ---------- 毎フレームの更新 ----------
  update(dt) {
    const C = CONFIG;
    // パドルはマウス位置に追従。速度は回転パドルの反射計算に使う
    const half = C.PADDLE_WIDTH / 2;
    const nx = clamp(this.mouseX, half, this.W - half);
    const instVx = (nx - this.paddle.x) / Math.max(dt, 1e-4);
    this.paddle.vx += (instVx - this.paddle.vx) * Math.min(1, dt * 20);
    this.paddle.x = nx;

    this.updateParticles(dt);

    if (this.state === 'ready') {
      const b = this.balls[0];
      b.x = this.paddle.x; b.y = this.paddleY - C.PADDLE_HEIGHT / 2 - C.BALL_RADIUS;
      return;
    }
    if (this.state !== 'playing') return;

    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 30);

    // 定期的な列の補充
    this.rowTimer += dt;
    if (this.rowTimer >= this.rowInterval) {
      this.rowTimer = 0;
      this.pushRow(true);
    }
    if (this.scroll < 0) {
      this.scroll = Math.min(0, this.scroll + (C.BLOCK_ROW_HEIGHT / C.ROW_SCROLL_TIME) * dt);
    }
    // ブロックが減った時の緊急増援
    this.updateRush(dt);
    this.checkIntrusion();
    this.pressure = Math.max(0, this.pressure - C.PRESSURE_DECAY * dt);

    // 特殊装備の時間
    if (this.rotorTime > 0) {
      this.rotorTime = Math.max(0, this.rotorTime - dt);
      this.rotorAngle += C.ROTOR_ANGULAR_SPEED * dt;
    }
    if (this.pierceTime > 0) this.pierceTime = Math.max(0, this.pierceTime - dt);
    if (this.gravityTime > 0) this.gravityTime = Math.max(0, this.gravityTime - dt);
    if (this.gravityFlash > 0) this.gravityFlash = Math.max(0, this.gravityFlash - dt);
    this.updateBlades();

    this.updateBalls(dt);

    // 100万点イベント（スコアの加算はすべてこの前に終わっているので、一度に大きく超えた場合もここで拾える）
    if (!this.millionaire.done && this.score >= C.MILLIONAIRE_SCORE) this.startMillionaire();
    this.checkScoreEvents();       // 200万点以上のイベント（演出のみ）。判定場所は MILLIONAIRE と同じ
    this.updateMillionaire(dt);
    this.updateScoreEvents(dt);

    if (this.balls.length > this.maxBalls) this.maxBalls = this.balls.length;
    // 花火の上昇中（約0.9秒）は、炸裂で32球が届くのでゲームオーバー判定を待つ
    if (this.balls.length === 0 && this.millionaire.phase !== 'rise') this.gameOver();
  }

  updateBlades() {
    const C = CONFIG;
    this.blades.length = 0;
    if (this.rotorTime <= 0) return;
    const dist = C.ROTOR_HUB_OFFSET + C.PADDLE_WIDTH / 2;
    for (let k = 0; k < C.ROTOR_BLADES; k++) {
      const a = this.rotorAngle + (k * Math.PI * 2) / C.ROTOR_BLADES;
      const ux = Math.cos(a), uy = Math.sin(a);
      this.blades.push({ cx: this.paddle.x + ux * dist, cy: this.paddleY + uy * dist, ux, uy, a });
    }
  }

  checkIntrusion() {
    const C = CONFIG;
    // 末尾の空行は削除
    while (this.rows.length && this.rows[this.rows.length - 1].every(b => b === null)) this.rows.pop();
    while (this.rows.length) {
      const slot = this.rows.length - 1;
      if (this.blockY(slot) + this.blockH <= this.limitY) break;
      const row = this.rows.pop();
      let lost = 0, penalty = 0;
      for (let c = 0; c < row.length; c++) {
        const b = row[c];
        if (!b) continue;
        lost++;
        penalty += b.type === BLOCK.NORMAL ? C.PENALTY_NORMAL : C.PENALTY_SPECIAL;
        this.burst(this.blockX(c) + this.blockW / 2, this.limitY, '#ff3355', 4);
      }
      if (lost) {
        this.blockCount -= lost;
        this.intruded += lost;
        this.pressure += lost * C.PRESSURE_PER_BLOCK;
        this.score = Math.max(0, this.score - penalty);
        this.popup(this.W / 2, this.limitY - 14, `侵入 -${penalty}`, '#ff4d6d', 20);
        this.shake = Math.max(this.shake, 4);
        this.audio.sfx('penalty');
      }
    }
  }

  updateBalls(dt) {
    const C = CONFIG;
    const r = C.BALL_RADIUS;
    const base = this.baseSpeed;
    const relax = Math.min(1, dt * C.BALL_SPEED_RELAX);
    const balls = this.balls;
    const count = balls.length; // このフレームで生まれたボールは次フレームから動く
    const pierce = this.pierceTime > 0;
    const W = this.W, H = this.H, ceil = C.HUD_HEIGHT;
    const padTop = this.paddleY - C.PADDLE_HEIGHT / 2;
    const padHalf = C.PADDLE_WIDTH / 2;
    const rotorReach = C.ROTOR_HUB_OFFSET + C.PADDLE_WIDTH + C.PADDLE_HEIGHT + r;
    const rotorReach2 = rotorReach * rotorReach;
    const blocksBottom = this.blockY(this.rows.length) + r;
    // グラビティ・リバウンド
    const grav = this.gravityTime > 0;
    const gRange = C.GRAVITY_RANGE_RATIO * H;
    const gRange2 = gRange * gRange;
    const gAccel = C.GRAVITY_ACCEL * Math.pow(base / C.BALL_SPEED_INITIAL, 2); // 速度が上がっても曲がり方が同じになるように
    const gZoneTop = padTop - C.GRAVITY_REBOUND_DEPTH;
    const gZoneHalf = padHalf + C.GRAVITY_REBOUND_MARGIN_X;
    const padBottom = this.paddleY + C.PADDLE_HEIGHT / 2;
    let pulled = 0, trails = 0;
    this.gravityFx = 0;

    for (let i = 0; i < count; i++) {
      const b = balls[i];
      if (b.dead) continue;
      b.sp += (base - b.sp) * relax;
      if (b.sp < base) b.sp = base;
      if (b.gcd > 0) b.gcd -= dt;
      if (b.pull > 0) b.pull -= dt;

      // 吸引：パドル上面の中心へ向かう引力で進行方向を曲げる（速さは変えない）。
      // 下向きに進んでいて、パドル上面より上にいるボールだけが対象。
      // 引力は常に下向き成分を持つので dy は減らず、力場内で周回したりパドルの下へ回り込んだりしない。
      if (grav && b.dy > 0 && b.y < padTop - r) {
        const ddx = this.paddle.x - b.x, ddy = padTop - b.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < gRange2) {
          const d = Math.sqrt(d2);
          const f = Math.pow(1 - d / gRange, C.GRAVITY_FALLOFF);
          const a = gAccel * f * dt / d;
          const vx = b.dx * b.sp + ddx * a, vy = b.dy * b.sp + ddy * a;
          const len = Math.hypot(vx, vy);
          b.dx = vx / len; b.dy = vy / len;
          b.pull = 0.15;
          pulled++;
          if (trails < C.GRAVITY_TRAIL_MAX) {
            trails++;
            if (!b.trail) b.trail = [];
            b.trail.push(b.x, b.y);
            if (b.trail.length > 16) b.trail.splice(0, 2);
          }
        }
      }
      if (b.trail && b.pull <= 0) b.trail = null;
      const dist = b.sp * dt;
      const steps = Math.max(1, Math.ceil(dist / C.SUBSTEP_MAX_DIST));
      const h = dist / steps;
      for (let s = 0; s < steps && !b.dead; s++) {
        b.x += b.dx * h;
        b.y += b.dy * h;
        // 壁
        if (b.x < r) { b.x = r; b.dx = Math.abs(b.dx); }
        else if (b.x > W - r) { b.x = W - r; b.dx = -Math.abs(b.dx); }
        if (b.y < ceil + r) { b.y = ceil + r; b.dy = Math.abs(b.dy); }
        // ブロック（ブロック領域にいる時だけ調べる）
        if (b.y - r < blocksBottom) {
          if (pierce) this.collideBlocksPierce(b);
          else { b.armorIn = null; this.collideBlocks(b); }
          if (b.dead) break;
        } else if (b.armorIn) b.armorIn = null;
        // 急反発：パドル直前の反発領域に入ったら、パドルに触れる前に上へ弾き返す
        if (grav && b.gcd <= 0) {
          const ax = Math.abs(b.x - this.paddle.x);
          if (b.dy > 0 && b.y < padTop && b.y + r >= gZoneTop && ax <= gZoneHalf) {
            this.gravityRebound(b, base, gZoneHalf);
          } else if (b.y >= padTop && b.y <= padBottom && ax <= padHalf + r) {
            // 吸引で横向きの勢いが付いたボールが、パドル側面から本体の高さに入り込んだ場合：
            // 上面へ持ち上げてから急反発させる（パドルの下へ抜けるのを防ぐ）
            b.y = padTop - r;
            this.gravityRebound(b, base, gZoneHalf);
          }
        }
        // パドル
        if (b.dy > 0 && b.y + r >= padTop && b.y - r <= this.paddleY + C.PADDLE_HEIGHT / 2 &&
            b.x + r >= this.paddle.x - padHalf && b.x - r <= this.paddle.x + padHalf && b.y < this.paddleY) {
          const off = clamp((b.x - this.paddle.x) / (padHalf + r), -1, 1);
          const a = off * C.PADDLE_MAX_BOUNCE_DEG * DEG;
          b.dx = Math.sin(a); b.dy = -Math.cos(a);
          b.y = padTop - r;
          this.fixAngle(b);
          this.audio.sfx('paddle');
        }
        // 回転パドル
        if (this.blades.length) {
          const ddx = b.x - this.paddle.x, ddy = b.y - this.paddleY;
          if (ddx * ddx + ddy * ddy < rotorReach2) this.collideBlades(b, base);
        }
      }
      if (b.y - r > H) b.dead = true;
    }
    this.gravityStats.pulled = pulled;

    // 死んだボールを詰める
    let w = 0;
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      if (!b.dead) balls[w++] = b;
    }
    balls.length = w;
  }

  // 急反発：基本は上向き。当たった位置で角度を付け、ボールの横の勢いとパドルの移動を少し残す
  gravityRebound(b, base, zoneHalf) {
    const C = CONFIG;
    const off = clamp((b.x - this.paddle.x) / zoneHalf, -1, 1);
    const ang = off * C.PADDLE_MAX_BOUNCE_DEG * DEG * C.GRAVITY_REBOUND_ANGLE;
    let nx = Math.sin(ang) + b.dx * C.GRAVITY_KEEP_HORIZONTAL + clamp(this.paddle.vx / base, -1, 1) * C.GRAVITY_PADDLE_INFLUENCE;
    let ny = -Math.cos(ang);
    const len = Math.hypot(nx, ny);
    nx /= len; ny /= len;
    const minUp = Math.sin(C.GRAVITY_MIN_UP_DEG * DEG);
    if (-ny < minUp) { ny = -minUp; nx = (nx < 0 ? -1 : 1) * Math.cos(C.GRAVITY_MIN_UP_DEG * DEG); }
    b.dx = nx; b.dy = ny;
    b.sp = Math.max(b.sp, base * C.GRAVITY_REBOUND_SPEED);
    b.gcd = C.GRAVITY_REBOUND_COOLDOWN;
    b.trail = null; b.pull = 0;
    this.gravityStats.rebounds++;
    this.gravityFlash = 0.18;
    this.audio.sfx('rebound');
    if (this.gravityFx < C.GRAVITY_FX_PER_FRAME) {
      this.gravityFx++;
      if (this.rings.length < 40) this.rings.push({ x: b.x, y: b.y, color: ITEM_COLORS.G, life: 0.3 });
      this.burst(b.x, b.y, ITEM_COLORS.G, 4);
    }
  }

  // 通常の衝突：最も深く重なったブロックで反射（角の引っかかり対策込み）
  collideBlocks(b) {
    const C = CONFIG;
    const r = C.BALL_RADIUS;
    const bw = this.blockW, bh = this.blockH;
    for (let iter = 0; iter < 2; iter++) {
      const rows = this.rows;
      const top = C.BLOCK_TOP + this.scroll;
      const s0 = Math.max(0, Math.floor((b.y - r - top) / C.BLOCK_ROW_HEIGHT));
      const s1 = Math.min(rows.length - 1, Math.floor((b.y + r - top) / C.BLOCK_ROW_HEIGHT));
      if (s1 < s0) return;
      const c0 = Math.max(0, Math.floor((b.x - r - C.BLOCK_SIDE_MARGIN) / this.colW));
      const c1 = Math.min(C.BLOCK_COLS - 1, Math.floor((b.x + r - C.BLOCK_SIDE_MARGIN) / this.colW));
      let best = null, bestPen = 0, bs = 0, bc = 0, bnx = 0, bny = 0, bpx = 0, bpy = 0;
      for (let s = s0; s <= s1; s++) {
        const row = rows[s];
        const by = this.blockY(s);
        for (let c = c0; c <= c1; c++) {
          const blk = row[c];
          if (!blk) continue;
          const bx = this.blockX(c);
          const px = clamp(b.x, bx, bx + bw), py = clamp(b.y, by, by + bh);
          const dx = b.x - px, dy = b.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          let nx, ny, pen;
          if (d2 > 1e-9) {
            const d = Math.sqrt(d2);
            nx = dx / d; ny = dy / d; pen = r - d;
          } else {
            // 中心がブロック内：最小の押し出し方向
            const l = b.x - bx, rr = bx + bw - b.x, t = b.y - by, bt = by + bh - b.y;
            const m = Math.min(l, rr, t, bt);
            if (m === t) { nx = 0; ny = -1; } else if (m === bt) { nx = 0; ny = 1; }
            else if (m === l) { nx = -1; ny = 0; } else { nx = 1; ny = 0; }
            pen = r + m;
          }
          if (pen > bestPen) { bestPen = pen; best = blk; bs = s; bc = c; bnx = nx; bny = ny; bpx = px; bpy = py; }
        }
      }
      if (!best) return;
      // 隣接ブロックの継ぎ目で角反射しないように法線を軸方向に揃える
      if (Math.abs(bnx) > 0.01 && Math.abs(bny) > 0.01) {
        const sx = bnx > 0 ? 1 : -1, sy = bny > 0 ? 1 : -1;
        const sideBlocked = this.getBlock(bs, bc + sx);
        const vertBlocked = this.getBlock(bs + sy, bc);
        if (sideBlocked && !vertBlocked) { bnx = 0; bny = sy; }
        else if (vertBlocked && !sideBlocked) { bnx = sx; bny = 0; }
      }
      const vn = b.dx * bnx + b.dy * bny;
      if (vn < 0) { b.dx -= 2 * vn * bnx; b.dy -= 2 * vn * bny; }
      b.x += bnx * bestPen; b.y += bny * bestPen;
      this.fixAngle(b);
      this.hitBlock(best, bs, bc, b);
      if (b.dead) return;
    }
  }

  // 貫通ボール：重なったブロックをすべて破壊して進む
  collideBlocksPierce(b) {
    const C = CONFIG;
    const r = C.BALL_RADIUS;
    const bw = this.blockW, bh = this.blockH;
    const top = C.BLOCK_TOP + this.scroll;
    const s0 = Math.max(0, Math.floor((b.y - r - top) / C.BLOCK_ROW_HEIGHT));
    const s1 = Math.min(this.rows.length - 1, Math.floor((b.y + r - top) / C.BLOCK_ROW_HEIGHT));
    const c0 = Math.max(0, Math.floor((b.x - r - C.BLOCK_SIDE_MARGIN) / this.colW));
    const c1 = Math.min(C.BLOCK_COLS - 1, Math.floor((b.x + r - C.BLOCK_SIDE_MARGIN) / this.colW));
    // 装甲ブロックは「重なり始めた時」だけ1ダメージ。重なり続けている間は毎フレーム削らない
    const prev = b.armorIn;
    let cur = null;
    for (let s = s0; s <= s1; s++) {
      const row = this.rows[s];
      const by = this.blockY(s);
      for (let c = c0; c <= c1; c++) {
        const blk = row[c];
        if (!blk) continue;
        const bx = this.blockX(c);
        const px = clamp(b.x, bx, bx + bw), py = clamp(b.y, by, by + bh);
        const dx = b.x - px, dy = b.y - py;
        if (dx * dx + dy * dy >= r * r) continue;
        if (blk.type === BLOCK.ARMOR) {
          const was = prev !== null && prev !== undefined && prev.indexOf(blk) >= 0;
          if (!was) this.hitBlock(blk, s, c, b);
          if (blk.hits > 0) (cur || (cur = [])).push(blk); // 壊れたブロックは覚えない
          continue;
        }
        this.hitBlock(blk, s, c, b);
        if (b.dead) return;
      }
    }
    b.armorIn = cur;
  }

  getBlock(s, c) {
    if (s < 0 || s >= this.rows.length || c < 0 || c >= CONFIG.BLOCK_COLS) return null;
    return this.rows[s][c];
  }

  hitBlock(blk, s, c, ball) {
    const C = CONFIG;
    const cx = this.blockX(c) + this.blockW / 2, cy = this.blockY(s) + this.blockH / 2;
    if (blk.type === BLOCK.ABSORB) {
      ball.dead = true;
      blk.hits--;
      this.burst(ball.x, ball.y, '#b04dff', 8);
      this.audio.sfx('absorb');
      if (blk.hits <= 0) this.removeBlock(s, c);
      return;
    }
    if (blk.type === BLOCK.ARMOR) {
      blk.hits--;
      if (blk.hits > 0) {
        // まだ壊れない：ひびが増える
        this.burst(ball.x, ball.y, '#c8d2dc', 3);
        this.audio.sfx('armor');
        return;
      }
      this.removeBlock(s, c);
      this.destroyed++;
      this.destroyedArmor++;
      const pts = Math.round(C.SCORE_ARMOR * this.scoreMult);
      this.score += pts;
      this.burst(cx, cy, '#dfe8f0', C.PARTICLES_PER_BLOCK + 10);
      if (this.popups.length < 20) this.popup(cx, cy, `+${pts}`, '#e8eef5', 13); // アイテム表示を押し出さない程度に
      this.shake = Math.max(this.shake, 3);
      this.audio.sfx('armorBreak');
      return;
    }
    this.removeBlock(s, c);
    this.destroyed++;
    if (blk.type === BLOCK.NORMAL) {
      this.score += Math.round(C.SCORE_NORMAL * this.scoreMult);
      this.burst(cx, cy, hueColor(blk.hue), C.PARTICLES_PER_BLOCK);
      this.audio.sfx('break');
    } else if (blk.type === BLOCK.SPLIT) {
      this.score += C.SCORE_SPLIT;
      const base = Math.atan2(ball.dy, ball.dx);
      const off = C.SPLIT_BLOCK_SPAWN_DEG * DEG * (Math.random() < 0.5 ? -1 : 1);
      this.addBall(ball.x, ball.y, base + off, ball.sp);
      this.burst(cx, cy, '#5dff8a', C.PARTICLES_PER_BLOCK + 4);
      this.audio.sfx('spawn');
    } else if (blk.type === BLOCK.CAPTURE) {
      this.score += C.SCORE_CAPTURE;
      // 閉じ込められていたボールを解放（ランダムな方向）
      this.addBall(cx, cy, rand(0, Math.PI * 2), ball.sp);
      this.burst(cx, cy, '#ffffff', C.PARTICLES_PER_BLOCK + 4);
      this.audio.sfx('spawn');
    }
    if (blk.item) this.collectItem(blk.item, cx, cy);
  }

  removeBlock(s, c) {
    if (this.rows[s][c]) { this.rows[s][c] = null; this.blockCount--; }
  }

  // 回転パドルとの衝突：羽の面の法線と、羽の移動速度（回転＋パドル移動）を反映した反射
  collideBlades(b, base) {
    const C = CONFIG;
    const r = C.BALL_RADIUS;
    const hl = C.PADDLE_WIDTH / 2, ht = C.PADDLE_HEIGHT / 2;
    const w = C.ROTOR_ANGULAR_SPEED;
    for (let k = 0; k < this.blades.length; k++) {
      const bl = this.blades[k];
      const rx = b.x - bl.cx, ry = b.y - bl.cy;
      const lu = rx * bl.ux + ry * bl.uy;
      const lv = -rx * bl.uy + ry * bl.ux;
      const cu = clamp(lu, -hl, hl), cv = clamp(lv, -ht, ht);
      const du = lu - cu, dv = lv - cv;
      const d2 = du * du + dv * dv;
      if (d2 >= r * r) continue;
      let nu, nv;
      if (d2 > 1e-9) { const d = Math.sqrt(d2); nu = du / d; nv = dv / d; }
      else { nu = 0; nv = lv >= 0 ? 1 : -1; }
      const nx = nu * bl.ux - nv * bl.uy, ny = nu * bl.uy + nv * bl.ux;
      const px = bl.cx + cu * bl.ux - cv * bl.uy, py = bl.cy + cu * bl.uy + cv * bl.ux;
      // 接触点での羽の速度
      const vsx = this.paddle.vx - w * (py - this.paddleY);
      const vsy = w * (px - this.paddle.x);
      let vx = b.dx * b.sp, vy = b.dy * b.sp;
      const relx = vx - vsx, rely = vy - vsy;
      const vn = relx * nx + rely * ny;
      if (vn < 0) {
        vx = relx - 2 * vn * nx + vsx;
        vy = rely - 2 * vn * ny + vsy;
      }
      // 押し出し
      if (d2 > 1e-9) { b.x = px + nx * (r + 0.5); b.y = py + ny * (r + 0.5); }
      else { b.x = px + nx * (r + ht + 0.5); b.y = py + ny * (r + ht + 0.5); }
      const sp = Math.hypot(vx, vy) || base;
      b.dx = vx / sp; b.dy = vy / sp;
      b.sp = clamp(sp, base, base * C.BALL_MAX_BOOST);
      this.fixAngle(b);
      if (vn < 0) this.audio.sfx('rotor');
    }
  }

  // ---------- アイテム（ブロックを壊した瞬間に自動取得） ----------
  rollItem() {
    const C = CONFIG;
    // P と G はボール数が多いほど出にくくする（生成時点のボール数で決まる。発動中の効果は弱めない）
    const pg = bandValue(C.ITEM_PG_RATE_BANDS, this.balls.length);
    const wS = C.ITEM_WEIGHT_SPLIT, wR = C.ITEM_WEIGHT_ROTOR;
    const wP = C.ITEM_WEIGHT_PIERCE * pg, wG = C.ITEM_WEIGHT_GRAVITY * pg;
    let r = Math.random() * (wS + wR + wP + wG);
    if ((r -= wS) < 0) return ITEM.SPLIT;
    if ((r -= wR) < 0) return ITEM.ROTOR;
    if ((r -= wP) < 0) return ITEM.PIERCE;
    return ITEM.GRAVITY;
  }

  collectItem(type, x, y) {
    const C = CONFIG;
    this.score += C.SCORE_ITEM;
    this.audio.sfx('item');
    const color = ITEM_COLORS[type];
    if (type === ITEM.SPLIT) {
      if (this.splitStock < C.SPLIT_STOCK_MAX) {
        this.splitStock++;
        this.popup(x, y, `分裂ストック ${this.splitStock}/${C.SPLIT_STOCK_MAX}`, color, 16);
      } else {
        // ストック超過ボーナス：ストックは増やさず固定点（時間倍率なし）。到達イベントは update の共通判定で拾う
        this.score += C.STOCK_OVERFLOW_BONUS;
        this.popup(x, y, `STOCK MAX! +${C.STOCK_OVERFLOW_BONUS.toLocaleString('en-US')}`, '#ffd24a', 18);
        this.audio.sfx('stockBonus');
      }
    } else if (type === ITEM.ROTOR) {
      this.rotorTime = C.ROTOR_DURATION;   // 効果中の再取得は残り時間を初期値に戻す
      this.popup(x, y, '回転パドル！', color, 16);
    } else if (type === ITEM.PIERCE) {
      this.pierceTime = C.PIERCE_DURATION; // 同上
      this.popup(x, y, '貫通ボール！', color, 16);
    } else {
      this.gravityTime = C.GRAVITY_DURATION; // 同上
      this.popup(x, y, 'グラビティ・リバウンド！', color, 16);
    }
    if (this.rings.length < 40) this.rings.push({ x, y, color, life: 0.45 });
    this.burst(x, y, color, 10);
  }

  // 開発用：アイテムを直接付与
  debugGive(type) { this.collectItem(type, this.paddle.x, this.paddleY - 30); }

  // ---------- 演出 ----------
  burst(x, y, color, n) {
    const C = CONFIG;
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= C.PARTICLE_MAX) return;
      const a = Math.random() * Math.PI * 2, s = rand(40, 220);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), color });
    }
  }

  popup(x, y, text, color, size) {
    if (this.popups.length > 30) this.popups.shift();
    this.popups.push({ x, y, text, color, size, life: 1.2 });
  }

  updateParticles(dt) {
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt;
      this.particles[w++] = p;
    }
    this.particles.length = w;
    w = 0;
    for (let i = 0; i < this.popups.length; i++) {
      const p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.y -= 30 * dt;
      this.popups[w++] = p;
    }
    this.popups.length = w;
    w = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const g = this.rings[i];
      g.life -= dt;
      if (g.life > 0) this.rings[w++] = g;
    }
    this.rings.length = w;
  }

  // ---------- 特別イベント「MILLIONAIRE」 ----------
  // 画面下から花火が上がり（約0.9秒）、炸裂と同時にボールを放射状に発射。メッセージは約2秒。ゲームは止めない。
  startMillionaire() {
    const C = CONFIG;
    const M = this.millionaire;
    if (M.done) return;
    M.done = true;
    M.phase = 'rise';
    M.t = 0;
    M.x = this.W / 2 + rand(-60, 60);
    M.y = this.H + 10;
    // 炸裂点：画面上半分。ブロックの塊と重なる時はその少し下へずらす（ただし画面の上半分に収める）
    const fieldBottom = this.blockY(this.rows.length) + 30;
    M.burstY = clamp(Math.max(this.H * C.MILLIONAIRE_BURST_Y_RATIO, fieldBottom), C.HUD_HEIGHT + 60, this.H * 0.5);
    this.audio.sfx('fwLaunch');
  }

  updateMillionaire(dt) {
    const C = CONFIG;
    const M = this.millionaire;
    if (M.flash > 0) M.flash = Math.max(0, M.flash - dt * 2.5);
    if (M.msg > 0) M.msg = Math.max(0, M.msg - dt);
    if (M.phase === 'rise') {
      M.t += dt;
      const p = Math.min(1, M.t / C.MILLIONAIRE_RISE_TIME);
      const ease = 1 - (1 - p) * (1 - p); // 上に行くほど減速
      M.y = this.H + 10 + (M.burstY - this.H - 10) * ease;
      // 打ち上げの火花
      if (this.sparks.length < C.MILLIONAIRE_SPARK_MAX) {
        this.sparks.push({ x: M.x + rand(-2, 2), y: M.y + 6, vx: rand(-25, 25), vy: rand(40, 110), life: 0.45, max: 0.45, color: '#ffd76a', size: 2 });
      }
      if (p >= 1) this.burstMillionaire();
    }
    // 粒子：寿命が来たら配列から消す（メモリに残さない）
    let w = 0;
    for (let i = 0; i < this.sparks.length; i++) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) continue;
      s.vx *= 1 - 1.6 * dt; s.vy *= 1 - 1.6 * dt; // 空気抵抗
      s.vy += 60 * dt;                            // ゆっくり落ちる
      s.x += s.vx * dt; s.y += s.vy * dt;
      this.sparks[w++] = s;
    }
    this.sparks.length = w;
  }

  burstMillionaire() {
    const C = CONFIG;
    const M = this.millionaire;
    M.phase = 'idle';
    M.msg = C.MILLIONAIRE_MESSAGE_TIME;
    M.flash = 1;
    const r = C.BALL_RADIUS;
    const x = clamp(M.x, r + 1, this.W - r - 1), y = M.y;
    // 金色中心の光の粒を円形に（2重の輪＋ばらつき）
    const colors = ['#ffd700', '#ffe98a', '#fff4c2', '#ffb347'];
    for (let i = 0; i < C.MILLIONAIRE_SPARKS && this.sparks.length < C.MILLIONAIRE_SPARK_MAX; i++) {
      const a = (i / C.MILLIONAIRE_SPARKS) * Math.PI * 2 * 3 + rand(-0.05, 0.05);
      const ring = i % 3;
      const sp = (ring === 0 ? 300 : ring === 1 ? 210 : 130) * rand(0.9, 1.1);
      const life = rand(1.1, 1.6);
      this.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, color: colors[i % colors.length], size: ring === 0 ? 3 : 2 });
    }
    // ボールを360度に放射。通常のボールとして追加（既存のボールはそのまま）。
    // 炸裂点がブロックに重なっていても、通常の衝突処理で押し出される
    // 真横付近（水平から BALL_MIN_VERTICAL_DEG 以内）は既存の角度補正で寄せられてしまうので、
    // 最初から上半分・下半分それぞれの許容範囲に均等に並べる
    const n = Math.min(C.MILLIONAIRE_BALLS, this.ballRoom); // 上限に収まる数だけ（均等配置は保つ）
    const sp = this.baseSpeed * C.MILLIONAIRE_BALL_SPEED;
    const minA = C.BALL_MIN_VERTICAL_DEG * DEG + 0.01;
    const span = Math.PI - 2 * minA;
    const down = Math.ceil(n / 2), up = n - down;
    for (let k = 0; k < down; k++) this.addBall(x, y, minA + ((k + 0.5) / down) * span, sp);           // 下向き
    for (let k = 0; k < up; k++) this.addBall(x, y, Math.PI + minA + ((k + 0.5) / up) * span, sp);   // 上向き
    this.shake = Math.max(this.shake, 8);
    this.audio.sfx('fwBurst');
  }

  // ---------- スコア到達イベント（200万 / 500万 / 1,000万点）：演出のみ ----------
  // 毎フレーム、すべての得点加算（ブロック・アイテム・ストック超過ボーナス）の後に呼ぶので、取りこぼしが無い。
  // 一度に複数の閾値を超えた時は、前の演出（MILLIONAIRE を含む）が終わってから順番に再生する。
  checkScoreEvents() {
    const C = CONFIG;
    const E = this.scoreEvents;
    for (let i = 0; i < C.SCORE_EVENTS.length; i++) {
      const ev = C.SCORE_EVENTS[i];
      if (E.done[i] || this.score < ev.score) continue;
      E.done[i] = true;
      // MILLIONAIRE の演出中（上昇〜メッセージ）は、その後に回す
      const M = this.millionaire;
      let busy = E.busyUntil;
      if (M.phase === 'rise') busy = Math.max(busy, E.clock + (C.MILLIONAIRE_RISE_TIME - M.t) + C.MILLIONAIRE_MESSAGE_TIME);
      else if (M.msg > 0) busy = Math.max(busy, E.clock + M.msg);
      const delay = Math.max(0, busy - E.clock) + (busy > E.clock ? C.SCORE_EVENT_GAP : 0);
      E.busyUntil = E.clock + delay + ev.time;
      this.scheduleScoreEvent(ev, delay);
    }
  }

  scheduleScoreEvent(ev, delay) {
    const C = CONFIG;
    // 称号は花火が上がりきった頃に出す
    this.titles.push({ ev, t: -(delay + C.SCORE_EVENT_SHELL_RISE * 0.6), sounded: false, delay });
    for (let k = 0; k < ev.shells; k++) {
      const x = ev.shells === 1 ? this.W / 2 : this.W * (0.18 + 0.64 * (k / (ev.shells - 1))) + rand(-20, 20);
      const ty = this.H * rand(0.16, 0.36);
      this.shells.push({ delay: delay + k * C.SCORE_EVENT_SHELL_INTERVAL, x, y: this.H + 10, y0: this.H + 10, ty, t: 0,
        colors: ev.sparkColors, n: ev.sparks, glow: ev.sparkColors[0] });
    }
    const cy = this.H * C.SCORE_EVENT_TITLE_Y_RATIO;
    for (let k = 0; k < ev.waves; k++) {
      this.waves.push({ delay: delay + C.SCORE_EVENT_SHELL_RISE * 0.6 + k * 0.16, x: this.W / 2, y: cy, t: 0,
        color: ev.sparkColors[(k + 1) % ev.sparkColors.length] });
    }
  }

  updateScoreEvents(dt) {
    const C = CONFIG;
    const E = this.scoreEvents;
    E.clock += dt;
    if (this.eventFlash.a > 0) this.eventFlash.a = Math.max(0, this.eventFlash.a - dt * 2.5);
    // 称号：待機 → 表示（開始時に効果音とフラッシュ）→ 終了で削除
    let w = 0;
    for (let i = 0; i < this.titles.length; i++) {
      const ti = this.titles[i];
      ti.t += dt;
      if (ti.t >= 0 && !ti.sounded) {
        ti.sounded = true;
        this.audio.sfx(ti.ev.sound);
        this.eventFlash.a = 1;
        this.eventFlash.color = ti.ev.flash;
      }
      if (ti.t < ti.ev.time) this.titles[w++] = ti;
    }
    this.titles.length = w;
    // 花火：上昇 → 炸裂で粒（粒の動きと削除は updateMillionaire の共通処理）
    w = 0;
    for (let i = 0; i < this.shells.length; i++) {
      const s = this.shells[i];
      if (s.delay > 0) { s.delay -= dt; this.shells[w++] = s; continue; }
      if (!s.launched) { s.launched = true; this.audio.sfx('fwLaunch'); }
      s.t += dt;
      const p = Math.min(1, s.t / C.SCORE_EVENT_SHELL_RISE);
      s.y = s.y0 + (s.ty - s.y0) * (1 - (1 - p) * (1 - p));
      if (this.sparks.length < C.SCORE_EVENT_SPARK_MAX) {
        this.sparks.push({ x: s.x + rand(-2, 2), y: s.y + 6, vx: rand(-25, 25), vy: rand(40, 110), life: 0.4, max: 0.4, color: s.glow, size: 2 });
      }
      if (p >= 1) { this.burstShell(s); continue; }
      this.shells[w++] = s;
    }
    this.shells.length = w;
    // 衝撃波
    w = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const v = this.waves[i];
      if (v.delay > 0) v.delay -= dt; else v.t += dt;
      if (v.t < C.SCORE_EVENT_WAVE_TIME) this.waves[w++] = v;
    }
    this.waves.length = w;
  }

  burstShell(s) {
    const C = CONFIG;
    const n = s.n;
    for (let i = 0; i < n && this.sparks.length < C.SCORE_EVENT_SPARK_MAX; i++) {
      const a = (i / n) * Math.PI * 2 * 3 + rand(-0.05, 0.05);
      const ring = i % 3;
      const sp = (ring === 0 ? 290 : ring === 1 ? 200 : 120) * rand(0.9, 1.1);
      const life = rand(1.0, 1.5);
      this.sparks.push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life,
        color: s.colors[i % s.colors.length], size: ring === 0 ? 3 : 2 });
    }
    this.audio.sfx('fwBurst');
  }

  // 開発用：スコアを 999,900 点にする（次のブロック破壊で 100 万点を超える）
  debugSetScoreNearMillion() { this.score = CONFIG.MILLIONAIRE_SCORE - 100; }
  // 開発用：イベントを直接発動（このプレイで未発動の時だけ）
  debugTriggerMillionaire() { if (this.state === 'playing') this.startMillionaire(); }

  gameOver() {
    this.state = 'gameover';
    this.audio.sfx('gameover');
    if (this.score > this.best) {
      this.best = this.score;
      try { localStorage.setItem('endlessBreakout.best', String(this.best)); } catch (e) { /* 無視 */ }
    }
  }
}

const _hueCache = {};
function hueColor(h) {
  return _hueCache[h] || (_hueCache[h] = `hsl(${h}, 85%, 58%)`);
}
