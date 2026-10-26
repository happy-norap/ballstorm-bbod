// 効果音（WebAudioで合成）とBGM。大量破壊時でも鳴りすぎないよう間引く。
'use strict';

class AudioManager {
  constructor() {
    this.ctx = null;
    this.last = {};
    this.bgm = new Audio('assets/bgm/bgm_main.mp3');
    this.bgm.loop = true;
    this.bgm.volume = CONFIG.BGM_VOLUME;
    this.bgmOn = true;
  }

  // ブラウザの自動再生制限のため、最初のユーザー操作で呼ぶ
  unlock() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  startBgm() {
    if (this.bgmOn && this.bgm.paused) this.bgm.play().catch(() => {});
  }

  toggleBgm() {
    this.bgmOn = !this.bgmOn;
    if (this.bgmOn) this.bgm.play().catch(() => {});
    else this.bgm.pause();
  }

  sfx(name) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const min = name === 'break' ? CONFIG.SFX_MIN_INTERVAL : 0.06;
    if (this.last[name] && now - this.last[name] < min) return;
    this.last[name] = now;
    switch (name) {
      case 'break': this.tone('square', 520 + Math.random() * 500, 0.05, 0.5); break;
      case 'paddle': this.tone('triangle', 260, 0.07, 0.9); break;
      case 'rotor': this.tone('triangle', 380, 0.06, 0.8); break;
      case 'launch': this.tone('triangle', 440, 0.1, 0.9, 880); break;
      case 'spawn': this.tone('sine', 700, 0.1, 0.9, 1200); break;
      case 'item': this.tone('square', 660, 0.12, 0.6, 1320); break;
      case 'split': this.tone('sawtooth', 200, 0.35, 0.7, 1600); break;
      case 'absorb': this.tone('sine', 180, 0.18, 1.0, 60); break;
      case 'penalty': this.tone('sawtooth', 120, 0.22, 0.7, 80); break;
      case 'incoming': this.tone('square', 520, 0.12, 0.6, 1040); this.tone('square', 780, 0.24, 0.5, 1560); break;
      // 装甲ブロック：削れた時は硬い金属音、破壊時は低い響き＋破砕ノイズ
      case 'armor': this.tone('square', 1500, 0.04, 0.35, 1100); break;
      case 'armorBreak': this.noise(0.25, 0.4, 1600); this.tone('triangle', 220, 0.25, 0.6, 90); break;
      case 'rebound': this.tone('sine', 300, 0.12, 0.8, 900); this.tone('triangle', 600, 0.08, 0.4, 1400); break;
      // 花火：打ち上げは上昇する笛の音、炸裂はノイズの破裂音＋低い響き（どちらも控えめの音量）
      case 'fwLaunch': this.tone('sine', 380, 0.85, 0.35, 1500); this.noise(0.85, 0.12, 2500); break;
      case 'fwBurst': this.noise(0.9, 0.55, 1800); this.tone('sine', 140, 0.6, 0.7, 45); this.tone('triangle', 1200, 0.5, 0.18, 600); break;
      case 'land': this.tone('triangle', 150, 0.06, 0.7, 90); break;
      case 'gameover': this.tone('sawtooth', 300, 0.9, 0.8, 60); break;
    }
  }

  // ホワイトノイズを低域フィルタに通した破裂音
  noise(dur, vol, cutoff) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 1.0);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(200, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(CONFIG.SFX_VOLUME * vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone(type, freq, dur, vol, freqEnd) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    gain.gain.setValueAtTime(CONFIG.SFX_VOLUME * vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}
