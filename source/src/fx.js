import * as THREE from 'three';

const CAP = 600;

export class FX {
  constructor(parent) {
    this.parent = parent;
    this.pos = new Float32Array(CAP * 3);
    this.col = new Float32Array(CAP * 3);
    this.vel = new Float32Array(CAP * 3);
    this.life = new Float32Array(CAP);
    this.grav = new Float32Array(CAP);
    this.head = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false;
    parent.add(this.points);
    for (let i = 0; i < CAP; i++) this.pos[i * 3 + 1] = -999;
    this.bursts = [];
    this.limit = CAP;
  }

  emit(p, n, color, speed, life, grav = 9, spread = 1) {
    const c = new THREE.Color(color);
    n = Math.min(n, this.limit);
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.limit;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), s = speed * (0.3 + Math.random() * 0.7);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s * spread;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * s + speed * 0.2;
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s * spread;
      this.life[i] = life * (0.5 + Math.random() * 0.5); this.grav[i] = grav;
      const j = 0.85 + Math.random() * 0.3;
      this.col[i * 3] = c.r * j; this.col[i * 3 + 1] = c.g * j; this.col[i * 3 + 2] = c.b * j;
    }
  }

  blood(p, n = 10) { this.emit(p, n, 0x8f1212, 3.5, 0.6, 12); }
  dust(p, n = 6) { this.emit(p, n, 0xcdb27a, 2.2, 0.5, 5); }
  spark(p, n = 5) { this.emit(p, n, 0xffd27a, 3, 0.25, 4); }
  leaves(p, n = 14) { this.emit(p, n, 0x7e8a3a, 3, 1.1, 3, 1.4); }

  explosion(p, radius) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.9, depthWrite: false }));
    mesh.position.copy(p); this.parent.add(mesh);
    this.bursts.push({ mesh, t: 0, dur: 0.45, r: radius });
    this.emit(p, 60, 0xff8a2a, 11, 0.9, 6); this.emit(p, 30, 0x3a2a1a, 7, 1.2, 3); this.emit(p, 20, 0xcdb27a, 9, 1.0, 8);
  }

  update(dt) {
    for (let i = 0; i < this.limit; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3] *= 0.5; this.vel[i * 3 + 2] *= 0.5; this.vel[i * 3 + 1] = 0; }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]; b.t += dt; const k = b.t / b.dur;
      if (k >= 1) { this.parent.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); this.bursts.splice(i, 1); continue; }
      b.mesh.scale.setScalar(b.r * (0.2 + 0.8 * Math.sqrt(k))); b.mesh.material.opacity = 0.9 * (1 - k);
    }
  }
}
