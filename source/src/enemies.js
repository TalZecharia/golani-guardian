import * as THREE from 'three';
import { ARENA_R, BARR_R, FENCE_R, GATES, gateAngle } from './world.js';

export const TYPES = {
  normal: { hp: 100, speed: 2.2, dmg: 10, pts: 60, scale: 1.0 },
  fast: { hp: 60, speed: 4.7, dmg: 7, pts: 80, scale: 0.92 },
  heavy: { hp: 380, speed: 1.5, dmg: 24, pts: 150, scale: 1.3 },
  bomber: { hp: 70, speed: 3.7, dmg: 0, pts: 100, scale: 1.0 },
  miniboss: { hp: 2600, speed: 1.9, dmg: 36, pts: 800, scale: 1.9 },
  boss: { hp: 6500, speed: 2.0, dmg: 48, pts: 2000, scale: 2.2 }
};

// ---- shared geometry / materials ----
const geo = {
  leg: new THREE.BoxGeometry(0.22, 0.8, 0.24).translate(0, -0.4, 0),
  arm: new THREE.BoxGeometry(0.15, 0.62, 0.15).translate(0, -0.3, 0),
  torso: new THREE.BoxGeometry(0.56, 0.7, 0.29),
  head: new THREE.SphereGeometry(0.17, 9, 7),
  band: new THREE.CylinderGeometry(0.182, 0.182, 0.06, 10, 1, true),
  tail: new THREE.BoxGeometry(0.05, 0.2, 0.03),
  mask: new THREE.CylinderGeometry(0.178, 0.178, 0.12, 10, 1, true),
  eye: new THREE.BoxGeometry(0.04, 0.025, 0.02),
  vest: new THREE.BoxGeometry(0.6, 0.44, 0.34),
  pack: new THREE.BoxGeometry(0.12, 0.16, 0.08)
};
const M = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.9 }, o));
const mats = {
  skin: [M(0x95a67c), M(0xa3ab8a), M(0x869a72)],
  shirt: [M(0x7a8450), M(0x9a8458), M(0x5f7a78), M(0x8d6e52)],
  pants: [M(0x4a4f3a), M(0x55524a)],
  band: M(0x22d63a, { emissive: 0x0f6a1a, roughness: 0.7, side: THREE.DoubleSide }),
  mask: M(0x1b1d1a, { side: THREE.DoubleSide }),
  eye: new THREE.MeshBasicMaterial({ color: 0xffe14a }),
  eyeBoss: new THREE.MeshBasicMaterial({ color: 0xff3b2a }),
  vest: M(0x8a2a1c, { emissive: 0x3a0c06 }),
  pack: M(0xd9a21b, { emissive: 0x4a3400 }),
  bossShirt: M(0x5a3036)
};
const pick = a => a[Math.floor(Math.random() * a.length)];

function buildZombie(type, masked) {
  const def = TYPES[type];
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const shirt = type === 'boss' || type === 'miniboss' ? mats.bossShirt : pick(mats.shirt);
  const skin = pick(mats.skin), pants = pick(mats.pants);
  const mk = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = true; return m; };

  const legL = new THREE.Group(); legL.position.set(-0.14, 0.8, 0); legL.add(mk(geo.leg, pants, 0, 0, 0)); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.14, 0.8, 0); legR.add(mk(geo.leg, pants, 0, 0, 0)); body.add(legR);
  body.add(mk(geo.torso, shirt, 0, 1.15, 0));
  const armL = new THREE.Group(); armL.position.set(-0.37, 1.45, 0); armL.add(mk(geo.arm, skin, 0, 0, 0)); armL.rotation.x = -1.35; body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.37, 1.45, 0); armR.add(mk(geo.arm, skin, 0, 0, 0)); armR.rotation.x = -1.25; body.add(armR);
  const head = new THREE.Group(); head.position.set(0, 1.7, 0); body.add(head);
  head.add(mk(geo.head, skin, 0, 0, 0));
  // green headband (signature identifier) with a short tail at the back
  head.add(mk(geo.band, mats.band, 0, 0.07, 0));
  head.add(mk(geo.tail, mats.band, 0.06, -0.02, -0.19));
  head.add(mk(geo.tail, mats.band, -0.02, -0.04, -0.2));
  if (masked) head.add(mk(geo.mask, mats.mask, 0, -0.07, 0));
  const em = type === 'boss' || type === 'miniboss' ? mats.eyeBoss : mats.eye;
  head.add(mk(geo.eye, em, -0.06, 0.02, 0.165)); head.add(mk(geo.eye, em, 0.06, 0.02, 0.165));
  if (type === 'bomber') {
    body.add(mk(geo.vest, mats.vest, 0, 1.15, 0));
    body.add(mk(geo.pack, mats.pack, -0.18, 1.2, 0.2)); body.add(mk(geo.pack, mats.pack, 0.0, 1.2, 0.2)); body.add(mk(geo.pack, mats.pack, 0.18, 1.2, 0.2));
  }
  g.scale.setScalar(def.scale);
  return { g, body, legL, legR, armL, armR, head };
}

export class Enemies {
  constructor(G) { this.G = G; this.list = []; }

  clear() { for (const e of this.list) this.G.world.remove(e.group); this.list.length = 0; }
  aliveCount() { let n = 0; for (const e of this.list) if (e.state !== 'dying') n++; return n; }

  spawn(type, x, z, wave) {
    const def = TYPES[type];
    const masked = Math.random() < (type === 'normal' ? 0.35 : type === 'fast' ? 0.5 : 0.3);
    const z0 = buildZombie(type, masked);
    const hpMul = 1 + 0.12 * (wave - 1);
    const e = {
      type, def, group: z0.g, parts: z0, masked,
      hp: def.hp * hpMul, max: def.hp * hpMul,
      speed: def.speed * (0.92 + Math.random() * 0.2) * (1 + 0.015 * wave), dmg: def.dmg * (1 + 0.05 * (wave - 1)),
      state: 'walk', t: Math.random() * 6, atk: 0, flash: 0, slam: 5 + Math.random() * 2, summon: 12, dead: 0,
      big: type === 'heavy' || type === 'boss' || type === 'miniboss', growl: 2 + Math.random() * 6, knock: new THREE.Vector3()
    };
    e.group.position.set(x, 0, z);
    this.G.world.add(e.group);
    this.list.push(e);
    return e;
  }

  // Ray vs hit spheres. origin/dir in world-local coords, dir normalised.
  rayTest(origin, dir, maxDist) {
    let best = null;
    const oc = new THREE.Vector3();
    for (const e of this.list) {
      if (e.state === 'dying') continue;
      const s = e.def.scale, p = e.group.position;
      const spheres = [[1.7 * s, 0.27 * s, true], [1.15 * s, 0.4 * s, false], [0.5 * s, 0.38 * s, false]];
      for (const [h, r, isHead] of spheres) {
        oc.set(p.x - origin.x, p.y + h - origin.y, p.z - origin.z);
        const tca = oc.dot(dir); if (tca < 0) continue;
        const d2 = oc.lengthSq() - tca * tca; if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (t > maxDist) continue;
        if (!best || t < best.t || (isHead && t < best.t + 0.4 && !best.head)) {
          if (best && best.e === e && best.head && !isHead) continue;
          best = { e, t, head: isHead };
        }
      }
    }
    return best;
  }

  damage(e, amount, head) {
    if (e.state === 'dying') return false;
    e.hp -= amount; e.flash = 0.12;
    if (e.hp <= 0) { this.kill(e, head); return true; }
    return false;
  }

  kill(e, head) {
    e.state = 'dying'; e.dead = 0;
    this.G.onKill(e, head);
  }

  update(dt) {
    const G = this.G, pl = G.pp, list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i], g = e.group, p = g.position, P = e.parts;
      if (e.state === 'dying') {
        e.dead += dt;
        g.rotation.x = -Math.min(1.5, e.dead * 3.2);
        if (e.dead > 1.4) p.y -= dt * 0.5;
        if (e.dead > 2.8) { G.world.remove(g); list.splice(i, 1); }
        continue;
      }
      e.t += dt; e.atk -= dt; e.flash = Math.max(0, e.flash - dt);
      const r = Math.hypot(p.x, p.z);
      const dTree = Math.hypot(p.x, p.z);
      const dxP = pl.x - p.x, dzP = pl.z - p.z, dP = Math.hypot(dxP, dzP);
      // growl
      e.growl -= dt; if (e.growl <= 0) { e.growl = 3 + Math.random() * 6; if (G.sound && Math.random() < 0.5) G.growlAt(e); }

      // --- decide goal ---
      let gx = 0, gz = 0, chasing = false;
      const aggro = e.type === 'boss' || e.type === 'miniboss' ? 8 : 11;
      if (r > ARENA_R - 1.5) {
        const a = Math.atan2(p.z, p.x); let bi = 0, bd = 9;
        for (let k = 0; k < GATES; k++) { const d = Math.abs(Math.atan2(Math.sin(a - gateAngle(k)), Math.cos(a - gateAngle(k)))); if (d < bd) { bd = d; bi = k; } }
        gx = Math.cos(gateAngle(bi)) * (ARENA_R - 6); gz = Math.sin(gateAngle(bi)) * (ARENA_R - 6);
      } else if (dP < aggro && !G.arPlacing) { gx = pl.x; gz = pl.z; chasing = true; }
      else { gx = 0; gz = 0; }
      let dx = gx - p.x, dz = gz - p.z; const dg = Math.hypot(dx, dz) || 1; dx /= dg; dz /= dg;

      // --- barricade blocking ---
      let blocked = null;
      if (r > BARR_R - 0.3 && r < BARR_R + 3.5) {
        for (const b of G.barricades) {
          if (b.hp <= 0) continue;
          if (Math.hypot(p.x - b.x, p.z - b.z) < 3.0) { blocked = b; break; }
        }
      }
      // --- attack ranges ---
      const treeReach = FENCE_R + 0.9 * e.def.scale;
      let speedK = 1;
      if (blocked) {
        speedK = 0;
        if (e.atk <= 0) { e.atk = 1.0; G.damageBarricade(blocked, Math.max(10, e.dmg)); }
      } else if (!chasing && r < treeReach + 0.2) {
        speedK = 0;
        if (e.type === 'bomber') { this.explode(e); continue; }
        if (e.atk <= 0) { e.atk = 1.0; G.damageTree(e.dmg, e); }
      } else if (chasing && dP < 1.5 * e.def.scale) {
        speedK = 0.05;
        if (e.type === 'bomber') { this.explode(e); continue; }
        if (e.atk <= 0) { e.atk = 0.9; G.damagePlayer(e.dmg, e); }
      }
      if (e.type === 'bomber' && !blocked && dTree < FENCE_R + 2.2) { this.explode(e); continue; }

      // boss abilities
      if (e.type === 'boss' || e.type === 'miniboss') {
        e.slam -= dt;
        if (e.slam <= 0 && (dP < 10 || dTree < 11)) { e.slam = e.type === 'boss' ? 5.5 : 7; this.slamAttack(e); }
        if (e.type === 'boss') { e.summon -= dt; if (e.summon <= 0) { e.summon = 14; for (let k = 0; k < 4; k++) this.spawn('normal', p.x + (Math.random() - 0.5) * 6, p.z + (Math.random() - 0.5) * 6, G.wave); } }
      }

      // --- move ---
      let sp = e.speed * speedK * (G.slow || 1);
      let vx = dx * sp, vz = dz * sp;
      // separation
      for (let k = 0; k < list.length; k++) {
        const o = list[k]; if (o === e || o.state === 'dying') continue;
        const ox = p.x - o.group.position.x, oz = p.z - o.group.position.z; const d2 = ox * ox + oz * oz;
        const min = 0.55 * (e.def.scale + o.def.scale) * 0.6 + 0.2;
        if (d2 < min * min && d2 > 1e-4) { const d = Math.sqrt(d2); vx += (ox / d) * 1.6; vz += (oz / d) * 1.6; }
      }
      p.x += (vx + e.knock.x) * dt; p.z += (vz + e.knock.z) * dt;
      e.knock.multiplyScalar(Math.max(0, 1 - dt * 7));
      // colliders (rocks, crates, fence)
      for (const c of G.colliders) {
        const cx = p.x - c.x, cz = p.z - c.z, d = Math.hypot(cx, cz), min = c.r + 0.35 * e.def.scale;
        if (d < min && d > 1e-4) { p.x = c.x + (cx / d) * min; p.z = c.z + (cz / d) * min; }
      }
      // face movement/target
      const fa = Math.atan2(dx, dz);
      let dy = fa - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * Math.min(1, dt * 8);

      // --- animation ---
      const w = e.t * (2.2 + e.speed * 1.6) * (speedK > 0.1 ? 1 : 0.3);
      P.legL.rotation.x = Math.sin(w) * 0.8; P.legR.rotation.x = -Math.sin(w) * 0.8;
      P.armL.rotation.x = -1.3 + Math.sin(w * 0.5) * 0.15; P.armR.rotation.x = -1.2 - Math.sin(w * 0.5) * 0.15;
      if (e.atk > 0.55 && speedK <= 0.1) { P.armL.rotation.x = -2.0; P.armR.rotation.x = -2.0; }
      P.body.rotation.z = Math.sin(w * 0.5) * 0.06; P.body.position.y = Math.abs(Math.sin(w)) * 0.05;
      P.head.rotation.z = Math.sin(e.t * 1.3) * 0.12;
      const sc = e.def.scale * (1 + e.flash * 0.35);
      g.scale.setScalar(sc);
    }
  }

  explode(e) {
    const G = this.G, p = e.group.position;
    e.state = 'dying'; e.dead = 99; // removed next frame
    G.world.remove(e.group);
    const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1);
    G.explosionAt(p.clone().setY(1), 5, { player: 45, tree: 140, radius: 4.8, enemies: 0, bomber: true });
  }

  slamAttack(e) {
    const G = this.G, p = e.group.position;
    G.slamAt(p, e);
  }
}
