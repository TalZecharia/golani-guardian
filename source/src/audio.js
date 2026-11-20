// Fully procedural audio (Web Audio). No external assets.
const CHORDS = [
  [146.83, 174.61, 220.0],   // Dm
  [116.54, 146.83, 174.61],  // Bb
  [98.0, 116.54, 146.83],    // Gm
  [110.0, 138.59, 164.81]    // A
];

export class Sound {
  constructor() {
    this.ctx = null;
    this.vol = 0.8;
    this.intensity = 0.1;
    this.refDist = 4;
    this.musicOn = false;
  }

  init() {
    if (this.ctx) { try { this.ctx.resume(); } catch (e) {} return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    const len = ctx.sampleRate * 1.0;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  // ---- helpers ----
  _noise(dur, o = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = (o.when || ctx.currentTime);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f0 || 2000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    f.Q.value = o.q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.5, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || this.sfx);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  _tone(f0, f1, dur, o = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = (o.when || ctx.currentTime);
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f0, t);
    if (f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain || 0.3, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let last = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); last = f; }
    last.connect(g); g.connect(o.dest || this.sfx);
    osc.start(t); osc.stop(t + dur + 0.05);
    return osc;
  }

  _panner(pos) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = this.refDist; p.rolloffFactor = 1.1; p.maxDistance = 200;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.sfx);
    return p;
  }

  updateListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = cam.getWorldPosition(this._v1 || (this._v1 = cam.position.clone()));
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10], ux = e[4], uy = e[5], uz = e[6];
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(fx, fy, fz, ux, uy, uz); }
  }

  // ---- effects ----
  // layered gunshot: sharp crack + body + low thump + room tail; every shot gets a slightly different pitch
  _gun(p) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime, k = 0.93 + Math.random() * 0.14, v = 0.92 + Math.random() * 0.16;
    const skipTail = t - (this._lastTail || -9) < 0.25; if (!skipTail) this._lastTail = t; // fast auto fire: fewer audio nodes
    this._noise(p.crackD, { type: 'highpass', f0: p.crackF * k, f1: p.crackF * 0.5 * k, gain: p.crack * v, attack: 0.001, when: t });
    this._noise(p.bodyD, { type: 'bandpass', f0: p.bodyF0 * k, f1: p.bodyF1 * k, gain: p.body * v, q: 0.9, when: t });
    this._tone(p.thF0 * k, p.thF1 * k, p.thD, { gain: p.th * v, attack: 0.002, when: t });
    if (p.snap) this._tone(p.snap * k, p.snap * 0.3, 0.035, { type: 'square', gain: 0.12 * v, attack: 0.001, when: t });
    if (!skipTail) this._noise(p.tailD, { type: 'lowpass', f0: p.tailF * k, f1: 150, gain: p.tail * v, attack: 0.01, when: t + 0.02 });
  }
  shot(id) {
    if (!this.ctx) return;
    switch (id) {
      case 'pistol': this._gun({ crack: 0.5, crackD: 0.05, crackF: 3200, body: 0.5, bodyD: 0.12, bodyF0: 1800, bodyF1: 600, th: 0.45, thF0: 200, thF1: 60, thD: 0.12, snap: 1800, tail: 0.14, tailD: 0.28, tailF: 1500 }); break;
      case 'mp5': this._gun({ crack: 0.4, crackD: 0.04, crackF: 3800, body: 0.36, bodyD: 0.09, bodyF0: 2400, bodyF1: 900, th: 0.3, thF0: 240, thF1: 90, thD: 0.08, snap: 2600, tail: 0.1, tailD: 0.18, tailF: 1800 }); break;
      case 'm4': this._gun({ crack: 0.6, crackD: 0.06, crackF: 3000, body: 0.55, bodyD: 0.16, bodyF0: 3000, bodyF1: 500, th: 0.5, thF0: 150, thF1: 50, thD: 0.15, snap: 1400, tail: 0.2, tailD: 0.4, tailF: 1400 }); break;
      case 'ak': this._gun({ crack: 0.75, crackD: 0.07, crackF: 2400, body: 0.7, bodyD: 0.22, bodyF0: 2600, bodyF1: 330, th: 0.7, thF0: 120, thF1: 38, thD: 0.2, snap: 900, tail: 0.28, tailD: 0.5, tailF: 1200 }); break;
      case 'shotgun': this._gun({ crack: 0.7, crackD: 0.1, crackF: 2000, body: 1.0, bodyD: 0.4, bodyF0: 2400, bodyF1: 170, th: 0.9, thF0: 95, thF1: 28, thD: 0.34, tail: 0.4, tailD: 0.8, tailF: 900 }); break;
    }
  }
  click() { this._noise(0.04, { type: 'highpass', f0: 3000, gain: 0.25 }); }
  // trigger pulled on an empty weapon: dry metallic click-clack
  dry() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this._noise(0.03, { type: 'highpass', f0: 4200, gain: 0.35, attack: 0.001, when: t });
    this._tone(1300, 700, 0.03, { type: 'square', gain: 0.1, attack: 0.001, when: t });
    this._noise(0.05, { type: 'bandpass', f0: 1500, gain: 0.3, attack: 0.001, when: t + 0.07 });
    this._tone(520, 260, 0.05, { type: 'square', gain: 0.08, attack: 0.001, when: t + 0.07 });
  }
  // reload: magazine out, magazine in (thunk), then bolt / pump / slide depending on the weapon
  reload(dur, id) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const clk = (at, f, g) => { this._noise(0.04, { type: 'highpass', f0: f, gain: g, attack: 0.001, when: t + at }); this._tone(f * 0.35, f * 0.15, 0.04, { type: 'square', gain: g * 0.3, attack: 0.001, when: t + at }); };
    const thunk = (at, g) => { this._noise(0.09, { type: 'lowpass', f0: 900, f1: 200, gain: g, when: t + at }); this._tone(150, 60, 0.09, { gain: g * 0.8, attack: 0.002, when: t + at }); };
    if (id === 'shotgun') {
      const n = 3; for (let i = 0; i < n; i++) { const at = 0.2 + i * (dur - 0.9) / n; clk(at, 2200, 0.28); thunk(at + 0.03, 0.18); }
      const p = dur - 0.45; thunk(p, 0.4); clk(p + 0.05, 1500, 0.35); clk(p + 0.2, 2600, 0.35);
    } else {
      clk(dur * 0.18, 2400, 0.3); thunk(dur * 0.18 + 0.02, 0.15);
      thunk(dur * 0.58, 0.45); clk(dur * 0.58 + 0.02, 1800, 0.3);
      const b = dur - 0.2; clk(b, 1400, 0.4); clk(b + 0.09, 2800, 0.35);
    }
  }
  swap() { this._tone(520, 240, 0.07, { type: 'square', gain: 0.14 }); setTimeout(() => this._tone(900, 520, 0.06, { type: 'square', gain: 0.12 }), 110); }
  headshot() { this._tone(2400, 1800, 0.08, { type: 'triangle', gain: 0.26 }); this._tone(1200, 300, 0.18, { type: 'square', gain: 0.16 }); this._noise && this._noise(0.08, { type: 'highpass', f0: 3000, f1: 1500, gain: 0.2 }); }
  // flesh impact: body = dull thud, leg = thud + crack, head handled by headshot()
  thud(part) { this._tone(160, 60, 0.09, { gain: 0.3, attack: 0.002 }); this._noise(0.07, { type: 'lowpass', f0: 1200, f1: 300, gain: 0.25 }); if (part === 'leg') this._noise(0.05, { type: 'highpass', f0: 2500, gain: 0.22, when: this.ctx ? this.ctx.currentTime + 0.03 : 0 }); }
  // head kill: wet crunch + low boom
  headKill(pos) { if (!this.ctx) return; const dest = pos ? this._panner(pos) : this.sfx; this._noise(0.12, { type: 'bandpass', f0: 1800, f1: 500, gain: 0.5, dest }); this._tone(90, 30, 0.3, { gain: 0.5, dest }); }
  // tree in danger: heartbeat
  heart() { if (!this.ctx) return; const t = this.ctx.currentTime; this._tone(70, 40, 0.14, { gain: 0.6, attack: 0.01, when: t }); this._tone(60, 35, 0.16, { gain: 0.5, attack: 0.01, when: t + 0.22 }); }
  // wave start siren: rising / falling wail
  siren(boss) {
    if (!this.ctx) return; const t = this.ctx.currentTime, lo = boss ? 300 : 420, hi = boss ? 520 : 760;
    for (let i = 0; i < 2; i++) { this._tone(lo, hi, 0.55, { type: 'sawtooth', gain: 0.16, lp: 1400, attack: 0.08, when: t + i * 0.6 }); this._tone(hi, lo, 0.55, { type: 'sawtooth', gain: 0.14, lp: 1400, attack: 0.08, when: t + i * 0.6 + 0.3 }); }
  }
  // zombie crowd bed: low murmur that swells as they close in (level 0..1)
  setAmbient(level) {
    if (!this.ctx) return;
    if (!this._amb) {
      const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 180; f.Q.value = 1.2;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.35; lg.gain.value = 70; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
      const g = ctx.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(this.sfx); src.start(); this._amb = g;
    }
    this._amb.gain.setTargetAtTime(Math.min(1, Math.max(0, level)) * 0.55, this.ctx.currentTime, 0.4);
  }
  hit(head) { this._tone(head ? 1500 : 900, head ? 800 : 500, 0.07, { type: 'square', gain: head ? 0.18 : 0.12 }); }
  hurt() { this._noise(0.25, { f0: 500, f1: 120, gain: 0.7 }); this._tone(90, 50, 0.2, { gain: 0.5 }); }
  treeHit() { this._tone(110, 60, 0.18, { type: 'triangle', gain: 0.5 }); this._noise(0.12, { f0: 700, f1: 200, gain: 0.35 }); }
  wood() { this._noise(0.1, { type: 'bandpass', f0: 600, f1: 300, gain: 0.4 }); }
  ui() { this._tone(660, 880, 0.08, { type: 'triangle', gain: 0.15 }); }
  deny() { this._tone(220, 150, 0.15, { type: 'sawtooth', gain: 0.12, lp: 800 }); }
  buy() { const t = this.ctx ? this.ctx.currentTime : 0; this._tone(520, 520, 0.08, { type: 'triangle', gain: 0.15, when: t }); this._tone(780, 780, 0.12, { type: 'triangle', gain: 0.15, when: t + 0.08 }); }
  refill() { const t = this.ctx ? this.ctx.currentTime : 0; for (let i = 0; i < 3; i++) this._tone(400 + i * 150, 400 + i * 150, 0.07, { type: 'square', gain: 0.08, when: t + i * 0.07 }); }
  horn(boss) {
    const t = this.ctx ? this.ctx.currentTime : 0;
    const f = boss ? 70 : 110;
    this._tone(f, f * 0.98, 1.4, { type: 'sawtooth', gain: 0.35, lp: 500, attack: 0.15, when: t });
    this._tone(f * 1.5, f * 1.5, 1.4, { type: 'sawtooth', gain: 0.25, lp: 500, attack: 0.2, when: t });
  }
  throwG() { this._noise(0.2, { type: 'bandpass', f0: 700, f1: 1500, gain: 0.25 }); }
  explosion(pos) {
    if (!this.ctx) return;
    const dest = pos ? this._panner(pos) : this.sfx;
    this._noise(0.9, { f0: 2200, f1: 80, gain: 1.0, dest });
    this._tone(80, 25, 0.7, { gain: 0.9, dest });
  }
  growl(pos, big, loud = 1) {
    if (!this.ctx) return;
    const dest = pos ? this._panner(pos) : this.sfx;
    const base = (big ? 45 : 70) + Math.random() * 40;
    const o = this._tone(base, base * 0.7, 0.6 + Math.random() * 0.4, { type: 'sawtooth', gain: 0.18 * loud, lp: 380 + 120 * loud, dest, attack: 0.08 });
    if (o) { const lfo = this.ctx.createOscillator(); const lg = this.ctx.createGain(); lfo.frequency.value = 9 + Math.random() * 6; lg.gain.value = base * 0.25; lfo.connect(lg); lg.connect(o.frequency); lfo.start(); lfo.stop(this.ctx.currentTime + 1.2); }
    this._noise(0.4, { type: 'bandpass', f0: 500, f1: 250, gain: 0.08, dest });
  }
  die(pos, big) {
    if (!this.ctx) return;
    const dest = pos ? this._panner(pos) : this.sfx;
    const b = big ? 55 : 95;
    this._tone(b, b * 0.4, 0.7, { type: 'sawtooth', gain: 0.2, lp: 300, dest });
    this._noise(0.25, { f0: 600, f1: 150, gain: 0.25, dest });
  }
  slam(pos) {
    if (!this.ctx) return;
    const dest = pos ? this._panner(pos) : this.sfx;
    this._tone(60, 20, 0.6, { gain: 0.9, dest }); this._noise(0.5, { f0: 500, f1: 60, gain: 0.7, dest });
  }
  win() { const t = this.ctx ? this.ctx.currentTime : 0; [293.66, 369.99, 440, 587.33].forEach((f, i) => this._tone(f, f, 0.9, { type: 'triangle', gain: 0.2, when: t + i * 0.22 })); }
  lose() { const t = this.ctx ? this.ctx.currentTime : 0; [220, 185, 146.83, 110].forEach((f, i) => this._tone(f, f * 0.98, 1.0, { type: 'triangle', gain: 0.22, when: t + i * 0.35 })); }

  // ---- music ----
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true; this.step = 0; this.nextT = this.ctx.currentTime + 0.1;
    this._timer = setInterval(() => this._sched(), 90);
  }
  stopMusic() { this.musicOn = false; clearInterval(this._timer); }
  _sched() {
    if (!this.ctx || !this.musicOn) return;
    const bpm = 62 + this.intensity * 46;
    const eighth = 60 / bpm / 2;
    while (this.nextT < this.ctx.currentTime + 0.35) {
      this._step(this.step, this.nextT, eighth);
      this.nextT += eighth; this.step++;
    }
  }
  _step(s, t, eighth) {
    const I = this.intensity, m = this.music;
    if (s % 16 === 0) {
      const ch = CHORDS[Math.floor(s / 16) % CHORDS.length];
      ch.forEach((f, i) => this._tone(f, f * 1.002, eighth * 16, { type: 'triangle', gain: 0.18 + I * 0.06, lp: 420 + I * 500, attack: eighth * 5, when: t, dest: m }));
      this._tone(ch[0] / 2, ch[0] / 2, eighth * 16, { type: 'sine', gain: 0.22, attack: eighth * 3, when: t, dest: m });
    }
    if (I > 0.2 && s % 8 === 0) this._tone(95, 38, 0.25, { gain: 0.35 + I * 0.25, when: t, dest: m });
    if (I > 0.5 && s % 8 === 6) this._tone(80, 36, 0.2, { gain: 0.25, when: t, dest: m });
    if (I > 0.35 && s % 2 === 1) this._noise(0.03, { type: 'highpass', f0: 7000, gain: 0.05 + I * 0.04, when: t, dest: m });
    if (I > 0.65 && s % 16 === 10) this._tone(130, 70, 0.3, { type: 'triangle', gain: 0.3, when: t, dest: m });
    if (I < 0.3 && s % 32 === 20) this._tone(523.25, 523.25, 1.8, { type: 'sine', gain: 0.05, attack: 0.3, when: t, dest: m });
  }
}
