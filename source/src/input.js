import * as THREE from 'three';
import { OR, mapPt } from './orient.js';

// ---- touch controls: dynamic joystick (left), look-drag (right), buttons ----
export class Input {
  constructor() {
    this.move = { x: 0, y: 0 };
    this.fire = false;
    this.lookDX = 0; this.lookDY = 0;
    this.ev = { reload: false, grenade: false, switchW: false, action: false, ads: false };
    this.joyId = null; this.lookId = null; this.fireId = null;
    this.joyOrigin = { x: 0, y: 0 };
    this.keys = {};
    this.layer = document.getElementById('touch');
    this.base = document.getElementById('joyBase'); this.knob = document.getElementById('joyKnob');
    this.enabled = false;
    this._bind();
  }

  _bind() {
    const L = this.layer;
    L.addEventListener('pointerdown', e => {
      if (!this.enabled || document.body.classList.contains('xr')) return;
      e.preventDefault(); const P = mapPt(e.clientX, e.clientY);
      if (P.x < OR.w * 0.42 && this.joyId === null) {
        this.joyId = e.pointerId; this.joyOrigin = { x: P.x, y: P.y };
        this.base.style.left = P.x + 'px'; this.base.style.top = P.y + 'px'; this.base.classList.add('on');
        this.knob.style.transform = 'translate(-50%,-50%)';
      } else if (this.lookId === null) {
        this.lookId = e.pointerId; this._lx = P.x; this._ly = P.y;
      }
      try { L.setPointerCapture(e.pointerId); } catch (_) {}
    });
    L.addEventListener('pointermove', e => {
      const P = mapPt(e.clientX, e.clientY);
      if (e.pointerId === this.joyId) {
        const R = 55; let dx = P.x - this.joyOrigin.x, dy = P.y - this.joyOrigin.y;
        const d = Math.hypot(dx, dy); if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
        this.move.x = dx / R; this.move.y = -dy / R;
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (e.pointerId === this.lookId) {
        this.lookDX += P.x - this._lx; this.lookDY += P.y - this._ly; this._lx = P.x; this._ly = P.y;
      }
    });
    const up = e => {
      if (e.pointerId === this.joyId) { this.joyId = null; this.move.x = 0; this.move.y = 0; this.base.classList.remove('on'); }
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    L.addEventListener('pointerup', up); L.addEventListener('pointercancel', up);

    // fire button also acts as a look surface so you can aim while firing
    const fb = document.getElementById('btnFire');
    fb.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.fireId = e.pointerId; this.fire = true; { const P = mapPt(e.clientX, e.clientY); this._fx = P.x; this._fy = P.y; } try { fb.setPointerCapture(e.pointerId); } catch (_) {} fb.classList.add('down'); });
    fb.addEventListener('pointermove', e => { if (e.pointerId === this.fireId) { const P = mapPt(e.clientX, e.clientY); this.lookDX += P.x - this._fx; this.lookDY += P.y - this._fy; this._fx = P.x; this._fy = P.y; } });
    const fu = e => { if (e.pointerId === this.fireId) { this.fire = false; this.fireId = null; fb.classList.remove('down'); } };
    fb.addEventListener('pointerup', fu); fb.addEventListener('pointercancel', fu);

    const tap = (id, key) => {
      const b = document.getElementById(id);
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.ev[key] = true; b.classList.add('down'); });
      const rel = () => b.classList.remove('down');
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
    };
    tap('btnReload', 'reload'); tap('btnGren', 'grenade'); tap('btnSwitch', 'switchW'); tap('btnAct', 'action'); tap('btnAds', 'ads');

    // Test/dev keyboard (not part of the product): enabled with ?debug
    if (/debug/.test(location.search)) {
      addEventListener('keydown', e => { this.keys[e.code] = true; if (e.code === 'KeyR') this.ev.reload = true; if (e.code === 'KeyG') this.ev.grenade = true; if (e.code === 'KeyQ') this.ev.switchW = true; if (e.code === 'KeyE') this.ev.action = true; if (e.code === 'Space') this.fire = true; });
      addEventListener('keyup', e => { this.keys[e.code] = false; if (e.code === 'Space') this.fire = false; });
      addEventListener('mousemove', e => { if (e.buttons) { this.lookDX += e.movementX; this.lookDY += e.movementY; } });
    }
  }

  getMove() {
    let x = this.move.x, y = this.move.y;
    if (this.keys.KeyW) y += 1; if (this.keys.KeyS) y -= 1; if (this.keys.KeyA) x -= 1; if (this.keys.KeyD) x += 1;
    const d = Math.hypot(x, y); if (d > 1) { x /= d; y /= d; }
    return { x, y };
  }
  takeLook() { const r = { dx: this.lookDX, dy: this.lookDY }; this.lookDX = 0; this.lookDY = 0; return r; }
  take(k) { const v = this.ev[k]; this.ev[k] = false; return v; }
  reset() { this.fire = false; this.move.x = this.move.y = 0; this.lookDX = this.lookDY = 0; for (const k in this.ev) this.ev[k] = false; this.joyId = this.lookId = this.fireId = null; this.base.classList.remove('on'); }
}

// ---- gyro ----
const zee = new THREE.Vector3(0, 0, 1), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
export class Gyro {
  constructor() { this.has = false; this.alpha = 0; this.beta = 0; this.gamma = 0; this.last = 0; this.listening = false; this.euler = new THREE.Euler(); this.q0 = new THREE.Quaternion(); this.quat = new THREE.Quaternion(); }
  async request() {
    try {
      const D = window.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function') { const r = await D.requestPermission(); if (r !== 'granted') return false; }
    } catch (e) { return false; }
    if (!this.listening) {
      this.listening = true;
      addEventListener('deviceorientation', e => {
        if (e.alpha === null && e.beta === null) return;
        this.alpha = e.alpha || 0; this.beta = e.beta || 0; this.gamma = e.gamma || 0; this.has = true; this.last = performance.now();
      });
    }
    return true;
  }
  get active() { return this.has && performance.now() - this.last < 1500; }
  quaternion() {
    const orient = (((screen.orientation && screen.orientation.angle) || window.orientation || 0) + OR.rot) * Math.PI / 180;
    const d = Math.PI / 180;
    this.euler.set(this.beta * d, this.alpha * d, -this.gamma * d, 'YXZ');
    this.quat.setFromEuler(this.euler);
    this.quat.multiply(q1);
    this.quat.multiply(this.q0.setFromAxisAngle(zee, -orient));
    return this.quat;
  }
}
