// 描画処理。ゲームの状態を読み取って Canvas に描くだけで、状態は変更しない。
'use strict';

const FONT = '"Segoe UI", "Hiragino Sans", "Meiryo", sans-serif';

// 装甲ブロックのひび（ブロック内の相対座標 x0,y0,x1,y1,...）。ダメージ1回ごとに1本ずつ追加で描く
const ARMOR_CRACKS = [
  [0.30, 0.00, 0.36, 0.45, 0.28, 0.75],
  [0.36, 0.45, 0.58, 0.55, 0.70, 1.00],
  [0.58, 0.55, 0.80, 0.30, 1.00, 0.38],
  [0.28, 0.75, 0.10, 0.55, 0.00, 0.62, 0.36, 0.45, 0.50, 0.10, 0.62, 0.00],
];

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.dpr = 1;
  }

  // maxW / maxH：ゲーム画面に使える大きさ（省略時はウィンドウ全体）。縦横比は常に維持する
  resize(maxW, maxH) {
    const C = CONFIG;
    const w = maxW > 0 ? maxW : window.innerWidth, h = maxH > 0 ? maxH : window.innerHeight;
    const s = Math.min(w / C.WIDTH, h / C.HEIGHT);
    this.scale = s;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = Math.floor(C.WIDTH * s) + 'px';
    this.canvas.style.height = Math.floor(C.HEIGHT * s) + 'px';
    this.canvas.width = Math.floor(C.WIDTH * s * this.dpr);
    this.canvas.height = Math.floor(C.HEIGHT * s * this.dpr);
  }

  draw(g, stats) {
    const C = CONFIG;
    const ctx = this.ctx;
    const k = this.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);

    // 背景
    ctx.fillStyle = '#05060b';
    ctx.fillRect(0, 0, g.W, g.H);

    ctx.save();
    if (g.shake > 0) ctx.translate(rand(-g.shake, g.shake) * 0.5, rand(-g.shake, g.shake) * 0.5);

    this.drawLimitLine(g);
    this.drawFireworks(g);   // ブロックより奥に描いて「画面の奥から上がる」ように見せる
    this.drawBlocks(g);
    this.drawFlights(g);
    this.drawRushBanner(g);
    this.drawGravityField(g);
    this.drawPaddle(g);
    this.drawBalls(g);
    this.drawParticles(g);
    this.drawRings(g);
    this.drawPopups(g);
    ctx.restore();
    this.drawMillionaireMessage(g);
    this.drawScoreEventTitles(g);

    this.drawHud(g);
    if (g.debug) this.drawDebug(g, stats);
    this.drawOverlay(g);
  }

  // 花火：打ち上げ中の光の玉と、火花・炸裂の粒（加算合成で光らせ、透明度は控えめ）
  drawFireworks(g) {
    const M = g.millionaire;
    if (M.phase !== 'rise' && g.sparks.length === 0 && M.flash <= 0 && g.shells.length === 0 && g.waves.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // スコア到達イベントの衝撃波（ブロックより奥）
    const WT = CONFIG.SCORE_EVENT_WAVE_TIME;
    for (const v of g.waves) {
      if (v.delay > 0) continue;
      const p = v.t / WT;
      ctx.globalAlpha = (1 - p) * 0.55;
      ctx.strokeStyle = v.color;
      ctx.lineWidth = 6 * (1 - p) + 1;
      ctx.beginPath();
      ctx.arc(v.x, v.y, 30 + p * 380, 0, Math.PI * 2);
      ctx.stroke();
    }
    // スコア到達イベントの打ち上げ中の花火
    for (const s of g.shells) {
      if (s.delay > 0) continue;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = s.glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of g.sparks) {
      ctx.globalAlpha = Math.min(1, s.life / s.max) * 0.85;
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
    }
    if (M.phase === 'rise') {
      ctx.globalAlpha = 0.9;
      const grad = ctx.createRadialGradient(M.x, M.y, 0, M.x, M.y, 14);
      grad.addColorStop(0, 'rgba(255, 245, 200, 1)');
      grad.addColorStop(0.4, 'rgba(255, 210, 80, 0.6)');
      grad.addColorStop(1, 'rgba(255, 180, 40, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(M.x, M.y, 14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 「MILLIONAIRE!」の祝福メッセージと炸裂時の金色のフラッシュ
  drawMillionaireMessage(g) {
    const M = g.millionaire;
    const ctx = this.ctx;
    if (M.flash > 0) {
      ctx.fillStyle = `rgba(255, 215, 90, ${M.flash * 0.18})`;
      ctx.fillRect(0, 0, g.W, g.H);
    }
    if (M.msg <= 0) return;
    const total = CONFIG.MILLIONAIRE_MESSAGE_TIME;
    const q = 1 - M.msg / total;                       // 0→1
    const scale = q < 0.12 ? 0.6 + (q / 0.12) * 0.5 : 1.1 - Math.min(0.1, (q - 0.12) * 0.5);
    const alpha = Math.min(1, M.msg / 0.5) * 0.92;     // 最後の0.5秒でフェードアウト
    const cx = g.W / 2, cy = g.H * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 46px ${FONT}`;
    const grad = ctx.createLinearGradient(0, -24, 0, 24);
    grad.addColorStop(0, '#fff6c8');
    grad.addColorStop(0.5, '#ffd700');
    grad.addColorStop(1, '#e09a00');
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(80, 40, 0, 0.8)';
    ctx.strokeText('MILLIONAIRE!', 0, 0);
    ctx.fillStyle = grad;
    ctx.fillText('MILLIONAIRE!', 0, 0);
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = '#fff4c2';
    ctx.fillText(`${CONFIG.MILLIONAIRE_SCORE.toLocaleString('en-US')} POINTS  —  +${CONFIG.MILLIONAIRE_BALLS} BALLS`, 0, 38);
    ctx.restore();
  }

  // スコア到達イベント（200万 / 500万 / 1,000万点）の称号とフラッシュ。短時間・半透明で、プレイを隠しすぎない
  drawScoreEventTitles(g) {
    const ctx = this.ctx;
    const C = CONFIG;
    const F = g.eventFlash;
    if (F.a > 0) {
      ctx.fillStyle = `rgba(${F.color}, ${F.a * 0.14})`;
      ctx.fillRect(0, 0, g.W, g.H);
    }
    for (const ti of g.titles) {
      if (ti.t < 0) continue;
      const ev = ti.ev;
      const q = ti.t / ev.time;                                   // 0→1
      const scale = q < 0.1 ? 0.6 + (q / 0.1) * 0.5 : 1.1 - Math.min(0.1, (q - 0.1) * 0.5);
      const alpha = Math.min(1, (ev.time - ti.t) / 0.5) * 0.92;   // 最後の0.5秒でフェードアウト
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(g.W / 2, g.H * C.SCORE_EVENT_TITLE_Y_RATIO);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 画面幅（両端20px の余白）に収まるよう文字を縮める。スマホでも Canvas ごと縮小されるので切れない
      let size = C.SCORE_EVENT_TITLE_SIZE;
      ctx.font = `900 ${size}px ${FONT}`;
      const tw = ctx.measureText(ev.title).width * 1.1;
      if (tw > g.W - 40) size = Math.floor(size * (g.W - 40) / tw);
      ctx.scale(scale, scale);
      ctx.font = `900 ${size}px ${FONT}`;
      let fill;
      if (ev.rainbow) {
        // 虹色が横に流れる
        const w = ctx.measureText(ev.title).width;
        fill = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        const cols = ev.sparkColors;
        const shift = (ti.t * 0.6) % 1;
        for (let i = 0; i <= cols.length; i++) {
          const pos = (i / cols.length + shift) % 1;
          fill.addColorStop(pos, cols[i % cols.length]);
        }
      } else {
        fill = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
        fill.addColorStop(0, ev.textColors[0]);
        fill.addColorStop(0.5, ev.textColors[1]);
        fill.addColorStop(1, ev.textColors[2]);
      }
      ctx.lineWidth = 5;
      ctx.strokeStyle = ev.stroke;
      ctx.strokeText(ev.title, 0, 0);
      ctx.fillStyle = fill;
      ctx.fillText(ev.title, 0, 0);
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillStyle = ev.textColors[1];
      ctx.fillText(ev.sub, 0, size * 0.5 + 16);
      ctx.restore();
    }
  }

  drawLimitLine(g) {
    const ctx = this.ctx;
    // 最下段ブロックがラインに近いほど赤く光る
    const lastY = g.rows.length ? g.blockY(g.rows.length - 1) + g.blockH : 0;
    const danger = Math.max(0, 1 - (g.limitY - lastY) / 120);
    ctx.strokeStyle = `rgba(255, ${Math.floor(80 - danger * 60)}, ${Math.floor(100 - danger * 80)}, ${0.35 + danger * 0.6})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(0, g.limitY);
    ctx.lineTo(g.W, g.limitY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawBlocks(g) {
    const bh = g.blockH;
    for (let s = 0; s < g.rows.length; s++) {
      const row = g.rows[s];
      const y = g.blockY(s);
      if (y + bh < CONFIG.HUD_HEIGHT - 30) continue;
      for (let c = 0; c < row.length; c++) {
        if (row[c]) this.drawBlock(g, row[c], g.blockX(c), y, c);
      }
    }
  }

  // 増援列：HUDの裏から定位置まで降りてくる
  drawFlights(g) {
    const C = CONFIG;
    const ctx = this.ctx;
    for (const f of g.flights) {
      const p = Math.min(1, f.t / C.RUSH_DROP_TIME);
      const ease = 1 - (1 - p) * (1 - p);
      const startY = C.HUD_HEIGHT - C.BLOCK_ROW_HEIGHT * 2;
      const y = startY + (g.blockY(f.slot) - startY) * ease;
      ctx.globalAlpha = 0.5 + 0.5 * p;
      for (let c = 0; c < f.row.length; c++) {
        if (f.row[c]) this.drawBlock(g, f.row[c], g.blockX(c), y, c);
      }
    }
    ctx.globalAlpha = 1;
  }

  // 増援中：HUDの下に赤い警告帯を点滅させる
  drawRushBanner(g) {
    const R = g.rush;
    if (!R.active) return;
    const ctx = this.ctx;
    const C = CONFIG;
    const blink = 0.35 + 0.35 * Math.sin(g.time * 18);
    ctx.fillStyle = `rgba(255, 60, 90, ${blink})`;
    ctx.fillRect(0, C.HUD_HEIGHT, g.W, 3);
    if (R.flash > 0) {
      ctx.fillStyle = `rgba(255, 60, 90, ${R.flash * 0.12})`;
      ctx.fillRect(0, C.HUD_HEIGHT, g.W, g.H - C.HUD_HEIGHT);
    }
  }

  drawBlock(g, b, x, y, c) {
    const ctx = this.ctx;
    const bw = g.blockW, bh = g.blockH;
    const t = g.time;
    switch (b.type) {
      case BLOCK.NORMAL:
        ctx.fillStyle = hueColor(b.hue);
        ctx.fillRect(x, y, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(x, y, bw, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x, y + bh - 3, bw, 3);
        if (b.item) this.drawItemMark(x + bw / 2, y + bh / 2, b.item, t);
        break;
      case BLOCK.SPLIT: {
        ctx.fillStyle = '#1fbf5a';
        ctx.fillRect(x, y, bw, bh);
        ctx.strokeStyle = '#9dffbf';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
        // 「＋」マーク
        ctx.fillStyle = '#ffffff';
        const cx = x + bw / 2, cy = y + bh / 2;
        ctx.fillRect(cx - 7, cy - 1.5, 14, 3);
        ctx.fillRect(cx - 1.5, cy - 7, 3, 14);
        break;
      }
      case BLOCK.CAPTURE: {
        ctx.fillStyle = '#2a3550';
        ctx.fillRect(x, y, bw, bh);
        const cx = x + bw / 2, cy = y + bh / 2;
        // 中に閉じ込められたボール
        ctx.fillStyle = '#e8f6ff';
        ctx.beginPath();
        ctx.arc(cx, cy, CONFIG.BALL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        // 檻の格子
        ctx.fillStyle = '#9fb3d9';
        for (let i = 1; i < 5; i++) ctx.fillRect(x + (bw * i) / 5 - 1, y, 2, bh);
        ctx.strokeStyle = '#9fb3d9';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
        break;
      }
      case BLOCK.ABSORB: {
        ctx.fillStyle = '#16051f';
        ctx.fillRect(x, y, bw, bh);
        const cx = x + bw / 2, cy = y + bh / 2;
        const pulse = 0.5 + 0.5 * Math.sin(t * 6 + c);
        ctx.strokeStyle = `rgba(200, 70, 255, ${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, bw - 2, bh - 2);
        // 渦
        ctx.beginPath();
        ctx.arc(cx, cy, 4 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case BLOCK.ARMOR: {
        // 鋼板：削れるほど暗くなり、ひびが1本ずつ増える
        const dmg = CONFIG.ARMOR_HP - b.hits;
        const k = dmg / Math.max(1, CONFIG.ARMOR_HP - 1);
        const v = Math.round(150 - 55 * k);
        ctx.fillStyle = `rgb(${v}, ${v + 10}, ${v + 22})`;
        ctx.fillRect(x, y, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(x, y, bw, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(x, y + bh - 2, bw, 2);
        ctx.strokeStyle = '#e6edf5';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        // 四隅のリベット
        ctx.fillStyle = '#dfe6ee';
        ctx.fillRect(x + 3, y + 3, 2, 2); ctx.fillRect(x + bw - 5, y + 3, 2, 2);
        ctx.fillRect(x + 3, y + bh - 5, 2, 2); ctx.fillRect(x + bw - 5, y + bh - 5, 2, 2);
        if (dmg > 0) {
          ctx.strokeStyle = 'rgba(15, 18, 28, 0.9)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let i = 0; i < dmg && i < ARMOR_CRACKS.length; i++) {
            const pts = ARMOR_CRACKS[i];
            ctx.moveTo(x + pts[0] * bw, y + pts[1] * bh);
            for (let j = 2; j < pts.length; j += 2) ctx.lineTo(x + pts[j] * bw, y + pts[j + 1] * bh);
          }
          ctx.stroke();
        }
        break;
      }
    }
  }

  // アイテムを持つブロックの印（黒地のカプセルに色付き文字、ゆっくり明滅）
  drawItemMark(cx, cy, type, t) {
    const ctx = this.ctx;
    const w = 26, h = 14;
    ctx.fillStyle = '#0b0d16';
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, 7);
    ctx.fill();
    ctx.strokeStyle = ITEM_COLORS[type];
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 5 + cx);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ITEM_COLORS[type];
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(type, cx, cy + 1);
  }

  // アイテム取得時の広がる波紋
  drawRings(g) {
    const ctx = this.ctx;
    ctx.lineWidth = 3;
    for (const r of g.rings) {
      const p = 1 - r.life / 0.45;
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = r.color;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + p * 46, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawPaddle(g) {
    const C = CONFIG;
    const ctx = this.ctx;
    const pw = C.PADDLE_WIDTH, ph = C.PADDLE_HEIGHT;
    // 回転パドル（補助パドル）
    if (g.blades.length) {
      const fade = Math.min(1, g.rotorTime / 2); // 終了間際は点滅
      const blink = g.rotorTime < 3 ? (Math.sin(g.time * 20) > 0 ? 1 : 0.35) : 1;
      ctx.globalAlpha = Math.max(0.35, fade) * blink;
      ctx.fillStyle = '#20d8e8';
      for (const bl of g.blades) {
        ctx.save();
        ctx.translate(bl.cx, bl.cy);
        ctx.rotate(bl.a);
        ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(-pw / 2, -ph / 2, pw, 3);
        ctx.fillStyle = '#20d8e8';
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    // 通常パドル（青）
    const x = g.paddle.x - pw / 2, y = g.paddleY - ph / 2;
    const grad = ctx.createLinearGradient(0, y, 0, y + ph);
    grad.addColorStop(0, '#6fb6ff');
    grad.addColorStop(1, '#1f5fd6');
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, pw, ph, 6);
    ctx.fill();
    // グラビティ中はピンクの縁取り。急反発の瞬間は強く光る
    if (g.gravityTime > 0) {
      ctx.strokeStyle = ITEM_COLORS.G;
      ctx.lineWidth = 2 + g.gravityFlash * 14;
      ctx.globalAlpha = 0.6 + Math.min(0.4, g.gravityFlash * 3);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (g.blades.length) {
      ctx.fillStyle = '#e8ffff';
      ctx.beginPath();
      ctx.arc(g.paddle.x, g.paddleY, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // グラビティ・リバウンドの力場：パドル上面を中心とした半円。内側へ縮む輪で「吸い込み」を表す
  drawGravityField(g) {
    if (g.gravityTime <= 0) return;
    const C = CONFIG;
    const ctx = this.ctx;
    const cx = g.paddle.x, cy = g.paddleY - C.PADDLE_HEIGHT / 2;
    const R = C.GRAVITY_RANGE_RATIO * g.H;
    const blink = g.gravityTime < 3 ? (Math.sin(g.time * 20) > 0 ? 1 : 0.4) : 1;
    ctx.save();
    ctx.globalAlpha = blink;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grad.addColorStop(0, 'rgba(255, 122, 217, 0.22)');
    grad.addColorStop(0.6, 'rgba(255, 122, 217, 0.08)');
    grad.addColorStop(1, 'rgba(255, 122, 217, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ITEM_COLORS.G;
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const p = (g.time * 0.9 + k / 3) % 1;   // 0→1 で外側から内側へ
      ctx.globalAlpha = blink * p * 0.45;
      ctx.beginPath();
      ctx.arc(cx, cy, R * (1 - p) + 8, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    // 反発領域（パドル直前の帯）
    ctx.globalAlpha = blink * 0.18;
    ctx.fillStyle = ITEM_COLORS.G;
    const zw = C.PADDLE_WIDTH + C.GRAVITY_REBOUND_MARGIN_X * 2;
    ctx.fillRect(cx - zw / 2, cy - C.GRAVITY_REBOUND_DEPTH, zw, C.GRAVITY_REBOUND_DEPTH);
    ctx.restore();
  }

  // 吸引中のボールの軌跡（本数は game 側で GRAVITY_TRAIL_MAX に制限済み）
  drawGravityTrails(g) {
    if (g.gravityTime <= 0) return;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255, 122, 217, 0.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const b of g.balls) {
      const t = b.trail;
      if (!t || t.length < 4) continue;
      ctx.moveTo(t[0], t[1]);
      for (let i = 2; i < t.length; i += 2) ctx.lineTo(t[i], t[i + 1]);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  drawBalls(g) {
    const C = CONFIG;
    const ctx = this.ctx;
    const r = C.BALL_RADIUS;
    const balls = g.balls;
    const pierce = g.pierceTime > 0;
    const n = balls.length;
    this.drawGravityTrails(g);
    if (pierce && n < 400) {
      // 貫通中は外側に光
      ctx.fillStyle = 'rgba(255, 90, 30, 0.25)';
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const b = balls[i]; ctx.moveTo(b.x + r * 2, b.y); ctx.arc(b.x, b.y, r * 2, 0, Math.PI * 2); }
      ctx.fill();
    }
    ctx.fillStyle = pierce ? '#ff8a3a' : '#f2fbff';
    if (n >= C.BALL_RECT_RENDER_THRESHOLD) {
      // 大量時は四角形で描画（高速）
      const d = r * 1.7;
      for (let i = 0; i < n; i++) { const b = balls[i]; ctx.fillRect(b.x - d / 2, b.y - d / 2, d, d); }
    } else {
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const b = balls[i]; ctx.moveTo(b.x + r, b.y); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); }
      ctx.fill();
    }
  }

  drawParticles(g) {
    const ctx = this.ctx;
    for (const p of g.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2.5);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  drawPopups(g) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of g.popups) {
      ctx.globalAlpha = Math.min(1, p.life * 1.5);
      ctx.font = `bold ${p.size}px ${FONT}`;
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  drawHud(g) {
    const C = CONFIG;
    const ctx = this.ctx;
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(0, 0, g.W, C.HUD_HEIGHT);
    ctx.fillStyle = '#2a3366';
    ctx.fillRect(0, C.HUD_HEIGHT - 2, g.W, 2);

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const y1 = 14, y2 = 31;
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = '#8890b8';
    ctx.fillText('SCORE', 10, y1);
    ctx.fillText('TIME', 130, y1);
    ctx.fillText('BALLS', 210, y1);
    ctx.fillText('SPEED', 290, y1);
    const splitOk = g.balls.length <= C.SPLIT_MAX_BALLS;
    ctx.fillText(splitOk ? 'SPLIT [Space]' : `SPLIT ≤${C.SPLIT_MAX_BALLS}球`, 362, y1);
    // 時間倍率（得点に掛かる倍率）。SCORE ラベルの横に小さく
    ctx.font = `bold 10px ${FONT}`;
    ctx.fillStyle = g.scoreMult > 1 ? '#ffd24a' : '#5a6290';
    ctx.fillText('×' + g.scoreMult.toFixed(2), 48, y1);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = g.balls.length >= C.BALL_LIMIT ? '#ff8a6a' : '#8890b8';
    if (g.balls.length >= C.BALL_LIMIT) ctx.fillText('MAX', 245, y1);
    ctx.font = `bold 16px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(g.score), 10, y2);
    ctx.fillText(formatTime(g.time), 130, y2);
    ctx.fillText(String(g.balls.length), 210, y2);
    ctx.fillText('×' + (g.baseSpeed / C.BALL_SPEED_INITIAL).toFixed(2), 290, y2);

    // 分裂ストック（ボールが多くて使えない間は暗く表示。ストックは保持される）
    ctx.globalAlpha = splitOk ? 1 : 0.35;
    for (let i = 0; i < C.SPLIT_STOCK_MAX; i++) {
      const x = 362 + i * 22;
      ctx.fillStyle = i < g.splitStock ? '#ffe14a' : '#2a2f4a';
      roundRect(ctx, x, y2 - 8, 18, 16, 4);
      ctx.fill();
      if (i < g.splitStock) {
        ctx.fillStyle = '#111';
        ctx.font = `bold 11px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('S', x + 9, y2 + 1);
        ctx.textAlign = 'left';
      }
    }
    if (g.splitStock > 0) {
      ctx.font = `bold 11px ${FONT}`;
      ctx.fillStyle = '#ffe14a';
      ctx.fillText('×' + C.SPLIT_COUNTS[g.splitStock], 430, y2);
    }
    ctx.globalAlpha = 1;

    // 装備の残り時間
    let ex = 462;
    const bar = (label, t, max, color) => {
      ctx.font = `bold 9px ${FONT}`;
      ctx.fillStyle = color;
      ctx.fillText(label, ex, y1);
      ctx.fillStyle = '#2a2f4a';
      ctx.fillRect(ex, y2 - 4, 38, 8);
      ctx.fillStyle = color;
      ctx.fillRect(ex, y2 - 4, 38 * (t / max), 8);
      ex += 42;
    };
    if (g.rotorTime > 0) bar('ROTOR', g.rotorTime, C.ROTOR_DURATION, ITEM_COLORS.R);
    if (g.pierceTime > 0) bar('PIERCE', g.pierceTime, C.PIERCE_DURATION, ITEM_COLORS.P);
    if (g.gravityTime > 0) bar('GRAVITY', g.gravityTime, C.GRAVITY_DURATION, ITEM_COLORS.G);
  }

  drawDebug(g, st) {
    const ctx = this.ctx;
    const lines = [
      `FPS ${st.fps.toFixed(0)}`,
      `balls ${g.balls.length} (max ${g.maxBalls})`,
      `blocks ${g.blockCount}  rows ${g.rows.length}`,
      `particles ${g.particles.length}`,
      `update ${st.updateMs.toFixed(2)}ms  draw ${st.drawMs.toFixed(2)}ms`,
      `row ${g.rowInterval.toFixed(1)}s  pressure ${g.pressure.toFixed(1)}`,
      `gravity ${g.gravityTime > 0 ? g.gravityTime.toFixed(1) + 's' : 'off'} pulled ${g.gravityStats.pulled} rebounds ${g.gravityStats.rebounds}`,
      `rush ${g.rush.active ? 'ON' : 'off'} #${g.rush.count} th ${g.rushThreshold} q ${g.rush.queue} fly ${g.flights.length}`,
      `mult ×${g.scoreMult.toFixed(3)}  destroyed ${g.destroyed} (armor ${g.destroyedArmor})`,
    ];
    const x = 6, y0 = g.H - 8 - lines.length * 13;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 2, y0 - 9, 228, lines.length * 13 + 4);
    ctx.font = `11px Consolas, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7dffa8';
    lines.forEach((l, i) => ctx.fillText(l, x, y0 + i * 13));
  }

  drawOverlay(g) {
    const ctx = this.ctx;
    const cx = g.W / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ui = g.ui || { mode: 'cursor', locked: false, sensitivity: 1 };
    const touch = !!ui.touch;                                   // スマホ（タッチ操作）向けの文言にする
    const lockWaiting = !touch && ui.mode === 'lock' && !ui.locked;
    if (g.state === 'ready') {
      const y = g.H * 0.5;
      ctx.font = `bold 22px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(touch ? 'タップで発射' : lockWaiting ? 'クリックでマウス操作を開始' : 'クリックで発射', cx, y);
      if (lockWaiting) {
        ctx.font = `12px ${FONT}`;
        ctx.fillStyle = '#9aa3c7';
        ctx.fillText('カーソルが消え、画面の外でもパドルを動かせます（もう一度クリックで発射）', cx, y + 24);
      }
      this.drawControls(g, ui, y + 56);
    } else if (g.state === 'paused') {
      this.dim(g);
      ctx.font = `bold 30px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('PAUSE', cx, g.H / 2 - 20);
      ctx.font = `14px ${FONT}`;
      ctx.fillStyle = '#c3c9e6';
      let msg;
      if (touch) msg = 'タップ または ▶ で再開';
      else if (lockWaiting) msg = 'クリックで再開（マウスを再ロック）';
      else if (g.pauseReason === 'user') msg = 'P / Esc / クリックで再開';
      else msg = 'クリックで再開';
      ctx.fillText(msg, cx, g.H / 2 + 14);
      this.drawControls(g, ui, g.H / 2 + 56);
    } else if (g.state === 'gameover') {
      this.dim(g);
      ctx.font = `bold 34px ${FONT}`;
      ctx.fillStyle = '#ff4d6d';
      ctx.fillText('GAME OVER', cx, g.H / 2 - 60);
      ctx.font = `bold 20px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`SCORE ${g.score}`, cx, g.H / 2 - 16);
      ctx.font = `14px ${FONT}`;
      ctx.fillStyle = '#c3c9e6';
      ctx.fillText(`BEST ${g.best}　/　TIME ${formatTime(g.time)}`, cx, g.H / 2 + 14);
      ctx.fillText(`破壊 ${g.destroyed}　/　最大ボール数 ${g.maxBalls}　/　侵入 ${g.intruded}`, cx, g.H / 2 + 38);
      ctx.font = `bold 16px ${FONT}`;
      ctx.fillStyle = '#6fb6ff';
      ctx.fillText(touch ? 'タップでリスタート' : lockWaiting ? 'クリックでリスタート（マウスを再ロック）' : 'クリック または R でリスタート', cx, g.H / 2 + 80);
    }
  }

  // 操作方法の簡易表示
  drawControls(g, ui, y) {
    const ctx = this.ctx;
    const lines = ui.touch ? [
      '操作モード：タッチ',
      '画面か下の黒い帯を左右になぞる：パドル移動',
      'タップ：発射　SPLIT ボタン：分裂（ボール10個以下）',
      'II：一時停止　♪：BGM',
    ] : [
      ui.mode === 'lock'
        ? `操作モード：マウスロック（感度 ${ui.sensitivity.toFixed(1)}）`
        : '操作モード：カーソル追従',
      'マウス：パドル移動　クリック：発射　Space：分裂',
      'P：一時停止　R：リスタート　M：BGM',
      ui.mode === 'lock' ? 'Esc：マウスロック解除　O：設定（モード・感度）' : 'O：設定（モード・感度）',
    ];
    const w = 360, h = lines.length * 20 + 16;
    ctx.fillStyle = 'rgba(13, 16, 32, 0.85)';
    roundRect(ctx, g.W / 2 - w / 2, y - 10, w, h, 8);
    ctx.fill();
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#6fb6ff' : '#9aa3c7';
      ctx.fillText(l, g.W / 2, y + 8 + i * 20);
    });
  }

  dim(g) {
    this.ctx.fillStyle = 'rgba(0,0,0,0.6)';
    this.ctx.fillRect(0, 0, g.W, g.H);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
