import * as THREE from 'three';
import { Sound } from './audio.js';
import { FX } from './fx.js';
import { Input, Gyro } from './input.js';
import { Enemies, TYPES } from './enemies.js';
import { buildWorld, placeBarricades, GATES, gateAngle, ARENA_R, BARR_R, FENCE_R } from './world.js';
import { WEAPONS, WEAPON_ORDER, buildGun, buildGrenadeMesh } from './weapons.js';
import { AR, AR_SCALE } from './ar.js';
import { loadAssets, A } from './assets.js';
import { $, t, settings, saveSettings, applyLang, toast, banner, story, hideStory, show, hide, hitmark, vignette } from './ui.js';

const TOTAL_WAVES = 10;
const EYE = 1.65;

// ---------------- renderer / scene ----------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, alpha: true, powerPreference: 'high-performance' });
renderer.setClearColor(0xe8d3a0, 1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const FOG = new THREE.FogExp2(0xe6d09c, 0.0042);
scene.fog = FOG; scene.background = new THREE.Color(0xe6d09c);
const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 600);
scene.add(camera);
const world = new THREE.Group(); scene.add(world);

const G = window.__game = {
  THREE, renderer, scene, camera, world, mode: 'normal', state: 'menu', paused: false,
  colliders: [], barricades: [], crates: [], tree: { hp: 1000, max: 1000, mesh: null },
  pp: { x: 9, z: 6 }, eyeY: EYE, wave: 0, points: 0, score: 0, slow: 1, arPlacing: false, quality: 'med',
  player: { hp: 100, max: 100, lastHit: -99 }, arOff: { x: 0, z: 0 }, arBase: new THREE.Vector3(), spawnR: ARENA_R + 8
};
const sound = G.sound = new Sound();
const input = new Input();
const gyro = new Gyro();
const ar = new AR(G);
buildWorld(G);
const fx = G.fx = new FX(world);
const enemies = G.enemies = new Enemies(G);

// ---------------- inventory ----------------
const inv = G.inv = { owned: ['pistol'], cur: 'pistol', mag: {}, res: {}, lvl: {}, gren: 2 };
const wstat = id => { const b = WEAPONS[id], L = inv.lvl[id] || 0; return Object.assign({}, b, { dmg: b.dmg * (1 + 0.2 * L), mag: Math.round(b.mag * (1 + 0.2 * L)), rate: b.rate * (1 - 0.06 * L) }); };
const maxRes = id => wstat(id).mag * WEAPONS[id].reserveMul;
function resetInv() {
  inv.owned = ['pistol']; inv.cur = 'pistol'; inv.lvl = {}; inv.gren = 2; inv.mag = {}; inv.res = {};
  inv.mag.pistol = wstat('pistol').mag; inv.res.pistol = maxRes('pistol');
}
resetInv();

// ---------------- viewmodel ----------------
const gunRoot = new THREE.Group(); camera.add(gunRoot);
const gunLight = new THREE.PointLight(0xfff0d0, 2.2, 3, 1.5); gunLight.position.set(0.1, 0.25, -0.1); camera.add(gunLight);
gunRoot.position.set(0.15, -0.19, -0.42);
let gunMesh = null, muzzle = null;
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const GUN_LEN = { pistol: 0.22, mp5: 0.5, m4: 0.85, ak: 0.88, shotgun: 1.0 };
function customGun(id) {
  const aw = A.weapons[id]; if (!aw) return null;
  const g = new THREE.Group(), o = aw.obj.clone(true), c = aw.cfg;
  o.rotation.set(...(c.rot || [0, 0, 0]).map(d => d * Math.PI / 180)); g.add(o); g.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(g); const len = box.max.z - box.min.z || 1;
  o.scale.multiplyScalar((c.length || GUN_LEN[id]) / len); g.updateMatrixWorld(true); box.setFromObject(g);
  const pos = c.pos || [0, 0, 0];
  o.position.set(-(box.min.x + box.max.x) / 2 + pos[0], -box.max.y + 0.05 + pos[1], -box.max.z + 0.12 + pos[2]);
  g.userData.muzzleZ = (box.min.z - box.max.z) + 0.12 + (c.muzzleOffset || 0);
  o.traverse(m => { if (m.isMesh) { m.castShadow = false; m.frustumCulled = false; } });
  return g;
}
function equipModel() {
  if (gunMesh) gunRoot.remove(gunMesh);
  gunMesh = customGun(inv.cur) || buildGun(inv.cur);
  muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  muzzle.position.set(0, 0.0, gunMesh.userData.muzzleZ - 0.05); muzzle.visible = false;
  const m2 = muzzle.clone(); m2.rotation.y = Math.PI / 2; muzzle.add(m2);
  gunMesh.add(muzzle);
  gunRoot.add(gunMesh);
}
equipModel();

// ---------------- state ----------------
let cd = 0, reloading = 0, reloadDur = 0, latch = false, equipT = 0, flashT = 0, kickZ = 0, kickRot = 0, camKick = 0, shake = 0;
let yaw = 0, pitch = 0, yawOff = 0, gyroCal = false, walkT = 0;
let grenades = [], queue = [], spawnT = 0, prepT = 0, waveClearT = 0, lastTreeToast = -99, lastGrowl = 0, hudT = 0, perfT = 0, perfN = 0, perfSum = 0;
const clock = new THREE.Clock();
const V = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), o: new THREE.Vector3(), d: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), inv: new THREE.Matrix4() };
const Y = new THREE.Vector3(0, 1, 0);

// ---------------- quality ----------------
const Q = { high: { pr: 2, shadow: 2048, parts: 600, alive: 26 }, med: { pr: 1.5, shadow: 1024, parts: 400, alive: 22 }, low: { pr: 1, shadow: 0, parts: 220, alive: 16 } };
function applyQuality(level) {
  G.quality = level; const q = Q[level];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr));
  renderer.shadowMap.enabled = q.shadow > 0; G.sun.castShadow = q.shadow > 0;
  if (q.shadow) { G.sun.shadow.mapSize.set(q.shadow, q.shadow); if (G.sun.shadow.map) { G.sun.shadow.map.dispose(); G.sun.shadow.map = null; } }
  fx.limit = q.parts; G.maxAlive = q.alive;
  resize();
}
let rotDismissed = false;
function resize() {
  const w = innerWidth, h = innerHeight;
  $('rotate').classList.toggle('on', h > w * 1.1 && !rotDismissed);
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------------- modes ----------------
function applyModeVisuals(mode) {
  G.mode = mode;
  const bg = mode === 'normal';
  G.sky.visible = bg; G.ground.visible = bg; G.shadowPlane.visible = !bg;
  scene.fog = bg ? FOG : null;
  scene.background = bg ? new THREE.Color(0xe6d09c) : null;
  renderer.setClearAlpha(bg ? 1 : 0);
  if (mode === 'xr') { world.scale.setScalar(AR_SCALE); camera.near = 0.05; camera.far = 200; sound.refDist = 4; G.spawnR = 24; placeBarricades(G, 11); G.arOff.x = G.arOff.z = 0; }
  else { world.scale.setScalar(1); world.position.set(0, 0, 0); camera.near = 0.1; camera.far = 600; sound.refDist = 4; G.spawnR = ARENA_R + 8; placeBarricades(G, BARR_R); }
  camera.updateProjectionMatrix();
}

// ---------------- helpers ----------------
function placeWorldAR() {
  if (ar.anchorPos) G.arBase.copy(ar.anchorPos);
  world.position.set(G.arBase.x + G.arOff.x, G.arBase.y, G.arBase.z + G.arOff.z); world.updateMatrixWorld(true);
}
function clampPlayer(p) {
  const r = Math.hypot(p.x, p.z); if (r > ARENA_R - 1.5) { p.x *= (ARENA_R - 1.5) / r; p.z *= (ARENA_R - 1.5) / r; }
  for (const c of G.colliders) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + 0.45;
    if (d < min && d > 1e-4) { p.x = c.x + (dx / d) * min; p.z = c.z + (dz / d) * min; }
  }
}
function forwardFlat(out) {
  out.set(0, 0, -1).applyQuaternion(camera.quaternion); out.y = 0;
  if (out.lengthSq() < 0.04) { out.set(0, 1, 0).applyQuaternion(camera.quaternion); out.y = 0; }
  return out.normalize();
}
// aim ray in world-local (game) coordinates
function aimRay() {
  camera.updateMatrixWorld(true);
  camera.getWorldPosition(V.o); camera.getWorldDirection(V.d);
  V.r.setFromMatrixColumn(camera.matrixWorld, 0); V.u.setFromMatrixColumn(camera.matrixWorld, 1);
  if (G.mode === 'xr') {
    world.updateMatrixWorld(true); V.inv.copy(world.matrixWorld).invert();
    V.o.applyMatrix4(V.inv); V.d.transformDirection(V.inv); V.r.transformDirection(V.inv); V.u.transformDirection(V.inv);
  }
  return V;
}

// ---------------- combat callbacks used by enemies ----------------
G.growlAt = e => { const now = performance.now(); if (now - lastGrowl < 350) return; lastGrowl = now; const p = e.group.getWorldPosition(V.a.clone()); sound.growl(p, e.big); };
G.damagePlayer = (n) => {
  if (G.state !== 'wave' && G.state !== 'prep') return;
  G.player.hp -= n; G.player.lastHit = clock.elapsedTime;
  vignette(); sound.hurt(); shake = Math.max(shake, 0.25);
  if (navigator.vibrate) navigator.vibrate(35);
  if (G.player.hp <= 0) endGame(false);
};
G.damageTree = (n) => {
  if (G.state !== 'wave' && G.state !== 'prep') return;
  G.tree.hp = Math.max(0, G.tree.hp - n);
  sound.treeHit(); shake = Math.max(shake, 0.06);
  if (Math.random() < 0.5) fx.leaves(V.a.set((Math.random() - 0.5) * 8, 5 + Math.random() * 2, (Math.random() - 0.5) * 8), 5);
  if (clock.elapsedTime - lastTreeToast > 7) { lastTreeToast = clock.elapsedTime; toast(t('treeHit'), 1600); }
  if (G.tree.hp <= 0) endGame(false);
};
function barrVis(b) { b.group.visible = b.hp > 0; b.planks[0].visible = b.hp > 0; b.planks[1].visible = b.hp > 100; b.planks[2].visible = b.hp > 200; }
G.damageBarricade = (b, n) => {
  const was = b.hp; b.hp = Math.max(0, b.hp - n); sound.wood();
  fx.dust(V.a.set(b.x, 1, b.z), 4); barrVis(b);
  if (was > 0 && b.hp <= 0) fx.dust(V.a.set(b.x, 1, b.z), 20);
};
G.onKill = (e, head) => {
  const d = G.lastHitDist || 0;
  const base = e.def.pts * (head ? 1.5 : 1) * (d > 30 ? 1.25 : 1);
  addPoints(Math.round(base));
  const p = e.group.position;
  fx.blood(V.a.set(p.x, 1.2 * e.def.scale, p.z), 14);
  sound.die(e.group.getWorldPosition(V.b.clone()), e.big);
  if (navigator.vibrate) navigator.vibrate(12);
  if (e.type === 'boss' || e.type === 'miniboss') { fx.explosion(V.c.set(p.x, 1.5, p.z), 4); }
};
function addPoints(n) { G.points += n; G.score += n; }
G.explosionAt = (pos, size, o) => {
  fx.explosion(pos, o.radius || size); const wp = world.localToWorld(pos.clone());
  sound.explosion(wp);
  const camWorld = camera.getWorldPosition(V.b.clone());
  const dcam = (G.mode === 'xr' ? 1 / AR_SCALE : 1) * camWorld.distanceTo(wp); shake = Math.max(shake, Math.max(0, 0.5 - dcam * 0.02));
  if (o.enemies) {
    for (const e of enemies.list.slice()) {
      if (e.state === 'dying') continue;
      const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z);
      if (d < o.radius) { G.lastHitDist = 5; enemies.damage(e, o.enemies * (1 - d / o.radius), false); addPoints(5); }
    }
  }
  const dp = Math.hypot(G.pp.x - pos.x, G.pp.z - pos.z);
  if (o.player && dp < o.radius * 0.85) G.damagePlayer(o.player * (1 - dp / (o.radius * 0.85)));
  if (o.tree && Math.hypot(pos.x, pos.z) < o.radius + FENCE_R) G.damageTree(o.tree);
};
G.slamAt = (p, e) => {
  sound.slam(world.localToWorld(p.clone()));
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; fx.dust(V.a.set(p.x + Math.cos(a) * 2, 0.2, p.z + Math.sin(a) * 2), 3); }
  shake = Math.max(shake, 0.35);
  const dp = Math.hypot(G.pp.x - p.x, G.pp.z - p.z); if (dp < 7) G.damagePlayer(e.type === 'boss' ? 38 : 26);
  if (Math.hypot(p.x, p.z) < 11) G.damageTree(e.type === 'boss' ? 90 : 55);
};

// ---------------- shooting ----------------
function fire(w) {
  inv.mag[inv.cur]--; cd = w.rate; flashT = 0.05; kickZ = w.kick; kickRot = w.recoil * 6; camKick += w.recoil;
  shake = Math.max(shake, w.shake * 6);
  sound.shot(w.id); if (navigator.vibrate) navigator.vibrate(w.id === 'shotgun' ? 25 : 8);
  const R = aimRay(), ox = R.o.clone(), dir0 = R.d.clone(), right = R.r.clone(), up = R.u.clone();
  let anyHit = false, headHit = false;
  const bonusSpread = (input.getMove().x || input.getMove().y) ? 1.35 : 1;
  for (let k = 0; k < w.pellets; k++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * w.spread * bonusSpread;
    const dir = dir0.clone().addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr).normalize();
    const hit = enemies.rayTest(ox, dir, 140);
    if (hit) {
      const d = hit.t; const e = hit.e;
      const f = d <= w.eff ? 1 : Math.max(w.minFall, 1 - ((d - w.eff) / w.eff) * (1 - w.minFall));
      let dmg = w.dmg * f * (hit.head ? 2 : 1);
      const pts = Math.round(w.pts * (hit.head ? 2 : 1) * (1 + Math.min(0.5, d / 90)) * (w.pellets > 1 ? 1 : 1));
      addPoints(pts);
      G.lastHitDist = d;
      const pt = ox.clone().addScaledVector(dir, d);
      fx.blood(pt, hit.head ? 8 : 5);
      e.knock.addScaledVector(dir, Math.min(2.5, dmg * 0.04));
      enemies.damage(e, dmg, hit.head);
      anyHit = true; if (hit.head) headHit = true;
    } else if (dir.y < -0.01) {
      const tt = -ox.y / dir.y; if (tt > 0 && tt < 120) fx.dust(ox.clone().addScaledVector(dir, tt).setY(0.05), 3);
    }
  }
  if (anyHit) { hitmark(headHit); sound.hit(headHit); }
  if (inv.mag[inv.cur] <= 0 && inv.res[inv.cur] > 0) startReload();
}
function startReload() {
  if (reloading > 0) return; const w = wstat(inv.cur);
  if (inv.mag[inv.cur] >= w.mag || inv.res[inv.cur] <= 0) return;
  reloading = reloadDur = w.reload; sound.reload(w.reload);
}
function switchWeapon() {
  if (inv.owned.length < 2) return;
  const i = (inv.owned.indexOf(inv.cur) + 1) % inv.owned.length; inv.cur = inv.owned[i];
  reloading = 0; equipT = 0.3; equipModelSoon = 0.15; sound.click();
}
let equipModelSoon = 0;
function throwGrenade() {
  if (inv.gren <= 0) { sound.deny(); return; }
  inv.gren--; sound.throwG();
  const R = aimRay(); const m = buildGrenadeMesh(); world.add(m);
  const p = R.o.clone().addScaledVector(R.d, 0.5 * (G.mode === 'xr' ? 1 / AR_SCALE : 1)).addScaledVector(R.u, -0.1 * (G.mode === 'xr' ? 1 / AR_SCALE : 1));
  const v = R.d.clone().multiplyScalar(15); v.y += 3.5;
  m.position.copy(p);
  grenades.push({ m, p, v, t: 0, fuse: 2.1 });
}
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i]; g.t += dt; g.v.y -= 18 * dt; g.p.addScaledVector(g.v, dt);
    if (g.p.y < 0.08) { g.p.y = 0.08; g.v.y *= -0.35; g.v.x *= 0.6; g.v.z *= 0.6; }
    g.m.position.copy(g.p); g.m.rotation.x += dt * 9;
    if (g.t >= g.fuse) { world.remove(g.m); grenades.splice(i, 1); G.explosionAt(g.p.clone(), 7, { player: 40, tree: 0, radius: 7, enemies: 280 }); }
  }
}

function updateWeapon(dt) {
  const w = wstat(inv.cur); cd -= dt;
  if (reloading > 0) { reloading -= dt; if (reloading <= 0) { const need = w.mag - inv.mag[inv.cur], take = Math.min(need, inv.res[inv.cur]); inv.mag[inv.cur] += take; inv.res[inv.cur] -= take; reloading = 0; } }
  if (input.take('reload')) startReload();
  if (input.take('switchW')) switchWeapon();
  if (input.take('grenade')) throwGrenade();
  if (equipT > 0) { equipT -= dt; if (equipModelSoon > 0) { equipModelSoon -= dt; if (equipModelSoon <= 0) equipModel(); } }
  const want = input.fire;
  if (want && cd <= 0 && reloading <= 0 && equipT <= 0.1 && (w.auto || !latch)) {
    if (inv.mag[inv.cur] > 0) fire(w);
    else if (inv.res[inv.cur] > 0) startReload();
    else if (!latch) { sound.click(); toast(t('refill'), 900); }
    cd = Math.max(cd, 0.001);
  }
  latch = want;
  // viewmodel animation
  kickZ *= Math.pow(0.0006, dt); kickRot *= Math.pow(0.001, dt);
  const rl = reloading > 0 ? Math.sin(Math.PI * (1 - reloading / reloadDur)) : 0;
  const eq = equipT > 0 ? Math.sin(Math.PI * (equipT / 0.3)) : 0;
  const sway = Math.sin(walkT * 2) * 0.006 * (input.getMove().x || input.getMove().y ? 1 : 0.25);
  gunRoot.position.set(0.15 + sway, -0.19 - rl * 0.16 - eq * 0.25 + Math.abs(Math.sin(walkT)) * 0.004, -0.42 + kickZ);
  gunRoot.rotation.set(kickRot - rl * 0.5 - eq * 0.5, 0, rl * 0.35);
  if (muzzle) { flashT -= dt; muzzle.visible = flashT > 0; if (muzzle.visible) muzzle.rotation.z = Math.random() * 3; }
}

// ---------------- player movement / look ----------------
function updateLook(dt) {
  const l = input.takeLook(); const sens = 0.0042 * settings.sens;
  if (G.mode === 'xr') return; // pose comes from WebXR
  const useG = settings.gyro && gyro.active;
  if (useG) {
    const qd = gyro.quaternion();
    if (!gyroCal) {
      V.a.set(0, 0, -1).applyQuaternion(qd); const yd = Math.atan2(-V.a.x, -V.a.z);
      const ty = Math.atan2(G.pp.x, G.pp.z); // face the tree at the origin
      yawOff = ty - yd + Math.PI; gyroCal = true;
    }
    yawOff -= l.dx * sens;
    V.q.setFromAxisAngle(Y, yawOff); camera.quaternion.copy(V.q).multiply(qd);
    yaw = Math.atan2(-V.a.set(0, 0, -1).applyQuaternion(camera.quaternion).x, -V.a.z);
  } else {
    gyroCal = false;
    yaw -= l.dx * sens; pitch = Math.max(-1.35, Math.min(1.35, pitch - l.dy * sens));
    camera.quaternion.setFromEuler(V.e.set(pitch, yaw, 0));
  }
  camKick *= Math.pow(0.002, dt);
  if (camKick > 0.0005) camera.quaternion.multiply(V.q2.setFromAxisAngle(V.a.set(1, 0, 0), camKick));
}
function updateMove(dt) {
  const m = input.getMove();
  if (G.mode === 'xr') {
    // real-scale AR: you walk with your body; the stick slides the whole arena the other way
    const f = forwardFlat(V.b), r = V.c.set(-f.z, 0, f.x), mv = 4.2 * dt;
    G.arOff.x -= (f.x * m.y + r.x * m.x) * mv; G.arOff.z -= (f.z * m.y + r.z * m.x) * mv;
    placeWorldAR();
    camera.getWorldPosition(V.a); world.worldToLocal(V.a);
    G.pp.x = V.a.x; G.pp.z = V.a.z; G.eyeY = V.a.y; return;
  }
  const f = forwardFlat(V.b), r = V.c.set(-f.z, 0, f.x), sp = 4.3;
  G.pp.x += (f.x * m.y + r.x * m.x) * sp * dt; G.pp.z += (f.z * m.y + r.z * m.x) * sp * dt;
  clampPlayer(G.pp);
  if (m.x || m.y) walkT += dt * 9;
  camera.position.set(G.pp.x, EYE + Math.sin(walkT) * 0.035, G.pp.z);
  if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake * 0.25; camera.position.y += (Math.random() - 0.5) * shake * 0.25; shake *= Math.pow(0.0008, dt); }
}

// ---------------- waves ----------------
function buildQueue(w) {
  const q = []; const n = Math.round(8 + w * 4.2);
  const wt = { normal: 1, fast: w >= 2 ? 0.25 + 0.03 * w : 0, heavy: w >= 3 ? 0.1 + 0.025 * w : 0, bomber: w >= 4 ? 0.1 + 0.02 * w : 0 };
  const tot = Object.values(wt).reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) { let r = Math.random() * tot, pick = 'normal'; for (const k in wt) { if ((r -= wt[k]) <= 0) { pick = k; break; } } q.push(pick); }
  if (w === 5) q.splice(Math.min(q.length, 8), 0, 'miniboss');
  if (w === 10) { q.splice(Math.min(q.length, 10), 0, 'boss'); for (let i = 0; i < 4; i++) q.push('heavy'); }
  return q;
}
function startWave() {
  G.wave++; G.state = 'wave'; queue = buildQueue(G.wave); spawnT = 1.5;
  G.activeGates = []; const n = Math.min(GATES, 2 + Math.floor(G.wave / 2));
  const all = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5); G.activeGates = all.slice(0, n);
  for (const c of G.crates) c.uses = 3;
  hide('shop'); hide('btnShopT'); banner(`${t('waveBanner')} ${G.wave}`); sound.horn(G.wave === 5 || G.wave === 10); sound.intensity = Math.min(1, 0.4 + G.wave * 0.06);
  if (G.wave === 5 || G.wave === 10) setTimeout(() => banner(t('bossBanner')), 2700);
}
function spawnOne() {
  const type = queue.shift(); const gate = G.activeGates[Math.floor(Math.random() * G.activeGates.length)];
  const a = gateAngle(gate), r = G.spawnR, lat = (Math.random() - 0.5) * 6;
  const x = Math.cos(a) * r - Math.sin(a) * lat, z = Math.sin(a) * r + Math.cos(a) * lat;
  enemies.spawn(type, x, z, G.wave);
}
function startPrep(first) {
  G.state = 'prep'; prepT = first ? 22 : 32; sound.intensity = 0.1;
  G.player.hp = G.player.max; G.tree.hp = Math.min(G.tree.max, G.tree.hp + G.tree.max * 0.08);
  show('shop'); show('btnShopT'); renderShop();
  const lines = t('waveLines'); const line = lines[Math.min(G.wave, lines.length - 1)];
  story(line, 5200);
}
function updateWaves(dt) {
  if (G.state === 'prep') { prepT -= dt; $('count').textContent = Math.max(0, Math.ceil(prepT)); if (prepT <= 0) startWave(); return; }
  if (G.state !== 'wave') return;
  spawnT -= dt;
  if (queue.length && spawnT <= 0 && enemies.aliveCount() < (G.maxAlive || 22)) { spawnOne(); spawnT = G.fast ? 0.02 : Math.max(0.45, 1.5 - G.wave * 0.1) * (0.7 + Math.random() * 0.6); }
  if (!queue.length && enemies.aliveCount() === 0) {
    if (G.wave >= TOTAL_WAVES) { endGame(true); return; }
    addPoints(100 * G.wave); banner(`✔ ${t('wave')} ${G.wave}`); sound.buy();
    G.state = 'prep-wait'; setTimeout(() => { if (G.state === 'prep-wait') startPrep(false); }, 2200);
  }
}

// ---------------- shop ----------------
function renderShop() {
  const box = $('shopItems'); box.innerHTML = '';
  const row = (label, sub, price, enabled, cb, btn) => {
    const d = document.createElement('div'); d.className = 'item';
    const l = document.createElement('div'); l.innerHTML = `<b>${label}</b><div class="tiny">${sub || ''}</div>`;
    const b = document.createElement('button'); b.textContent = btn || `${price}`; b.disabled = !enabled;
    b.addEventListener('click', () => { if (G.points < price) { sound.deny(); toast(t('notEnough'), 1200); return; } G.points -= price; sound.buy(); cb(); renderShop(); });
    d.append(l, b); box.appendChild(d);
  };
  for (const id of WEAPON_ORDER) {
    if (id === 'pistol') continue;
    const owned = inv.owned.includes(id), W = WEAPONS[id];
    if (owned) { const d = document.createElement('div'); d.className = 'item'; d.innerHTML = `<div><b>${t(id)}</b></div><div class="tiny">${t('owned')}</div>`; box.appendChild(d); }
    else row(t(id), `${W.dmg}${W.pellets > 1 ? '×' + W.pellets : ''} dmg`, W.price, G.points >= W.price, () => { inv.owned.push(id); inv.mag[id] = wstat(id).mag; inv.res[id] = maxRes(id); inv.cur = id; equipModel(); }, `${t('buy')} ${W.price}`);
  }
  const L = inv.lvl[inv.cur] || 0, upPrice = 400 * (L + 1);
  if (L >= 3) { const d = document.createElement('div'); d.className = 'item'; d.innerHTML = `<div><b>${t(inv.cur)}</b></div><div class="tiny">${t('maxed')}</div>`; box.appendChild(d); }
  else row(`${t('upgrade')}: ${t(inv.cur)}`, `Lv ${L} → ${L + 1}`, upPrice, G.points >= upPrice, () => { inv.lvl[inv.cur] = L + 1; inv.mag[inv.cur] = wstat(inv.cur).mag; inv.res[inv.cur] = maxRes(inv.cur); }, `${upPrice}`);
  row(t('repairTree'), `${Math.round(G.tree.hp)}/${G.tree.max}`, 300, G.points >= 300 && G.tree.hp < G.tree.max, () => { G.tree.hp = Math.min(G.tree.max, G.tree.hp + G.tree.max * 0.3); });
  const dmgB = G.barricades.some(b => b.hp < b.max);
  row(t('repairBarr'), '', 150, G.points >= 150 && dmgB, () => { for (const b of G.barricades) { b.hp = b.max; barrVis(b); } });
  row(t('buyGren'), `${inv.gren}`, 200, G.points >= 200 && inv.gren < 6, () => { inv.gren = Math.min(6, inv.gren + 2); });
}

// ---------------- crates ----------------
function updateCrates() {
  let near = null, nd = 1e9;
  for (const c of G.crates) { const d = Math.hypot(G.pp.x - c.x, G.pp.z - c.z); if (d < nd) { nd = d; near = c; } }
  const can = near && nd < 3.6 && (G.state === 'wave' || G.state === 'prep');
  $('btnAct').classList.toggle('hidden', !can);
  if (can && input.take('action')) {
    if (near.uses > 0) {
      near.uses--; for (const id of inv.owned) inv.res[id] = maxRes(id); inv.gren = Math.max(inv.gren, 2);
      sound.refill(); toast(t('refilled'), 1200);
    } else { sound.deny(); toast(t('crateEmpty'), 1400); }
  } else input.take('action');
  // arrow towards nearest crate with ammo
  let tgt = null, td = 1e9;
  for (const c of G.crates) { if (c.uses <= 0) continue; const d = Math.hypot(G.pp.x - c.x, G.pp.z - c.z); if (d < td) { td = d; tgt = c; } }
  const ca = $('crateArrow');
  if (!tgt || td < 3.6) { ca.classList.add('hidden'); return; }
  ca.classList.remove('hidden');
  const f = forwardFlat(V.b), tx = tgt.x - G.pp.x, tz = tgt.z - G.pp.z;
  const ang = Math.atan2(tx * -f.z + tz * f.x, tx * f.x + tz * f.z);
  $('arArrow').style.transform = `rotate(${ang * 180 / Math.PI}deg)`;
  $('crateDist').textContent = `${Math.round(td)} m`;
}

// ---------------- HUD ----------------
function updateHUD() {
  $('waveTxt').textContent = `${t('wave')} ${Math.max(1, G.wave)}/${TOTAL_WAVES}`;
  $('zTxt').textContent = `${t('zombiesLeft')} ${enemies.aliveCount() + queue.length}`;
  const tp = G.tree.hp / G.tree.max * 100; const tb = $('treeBar').firstElementChild; tb.style.width = tp + '%'; tb.classList.toggle('low', tp < 30);
  $('ptsTxt').textContent = `${t('points')} ${G.points}`; $('scoreTxt').textContent = `${t('score')} ${G.score}`;
  $('pBar').firstElementChild.style.width = Math.max(0, G.player.hp / G.player.max * 100) + '%';
  const id = inv.cur;
  $('wName').textContent = t(id) + (inv.lvl[id] ? ' ★'.repeat(inv.lvl[id]) : '');
  $('mag').textContent = reloading > 0 ? '…' : inv.mag[id]; $('res').textContent = inv.res[id];
  $('gCount').textContent = `● ×${inv.gren}`;
  G.tree.mesh.leafMat.color.setScalar(0.5 + 0.5 * (G.tree.hp / G.tree.max));
}

// ---------------- game flow ----------------
function resetGame() {
  enemies.clear(); queue = []; for (const g of grenades) world.remove(g.m); grenades = [];
  G.wave = 0; G.points = 500; G.score = 0; G.tree.hp = G.tree.max; G.player.hp = G.player.max;
  for (const b of G.barricades) { b.hp = b.max; barrVis(b); } for (const c of G.crates) c.uses = 3;
  resetInv(); equipModel(); reloading = 0; cd = 0; gyroCal = false; shake = 0; camKick = 0;
  const a = Math.random() * Math.PI * 2; G.pp.x = Math.cos(a) * 9; G.pp.z = Math.sin(a) * 9;
  yaw = Math.atan2(G.pp.x, G.pp.z); pitch = -0.05; input.reset();
}
function beginPlay() {
  show('hud'); input.enabled = true; hideStory(); $('arMsg').classList.add('hidden');
  const lines = t('story'); let i = 0; G.state = 'intro';
  const next = () => { if (G.state !== 'intro') return; if (i < lines.length) { story(lines[i++], 3300); setTimeout(next, 3500); } else startPrepFirst(); };
  next();
}
function startPrepFirst() { if (G.state === 'intro') startPrep(true); }

async function startGame(mode) {
  sound.init(); sound.setVolume(settings.vol); sound.startMusic(); sound.intensity = 0.1; sound.ui();
  hide('menu'); hide('end'); resetGame();
  if (mode !== 'xr' && settings.gyro) { const ok = await gyro.request(); if (!ok) toast(t('gyroDenied')); }
  if (mode === 'xr') {
    try {
      applyModeVisuals('xr'); world.visible = false; G.arPlacing = true; G.state = 'placing';
      await ar.startXR(pos => {
        G.arBase.copy(pos); G.arOff.x = G.arOff.z = 0; placeWorldAR(); world.visible = true; G.arPlacing = false;
        // start with the player on the arena's edge facing the tree
        G.pp.x = 0; G.pp.z = 0; beginPlay();
      }, () => { applyModeVisuals('normal'); world.visible = true; G.arPlacing = false; if (G.state !== 'menu' && G.state !== 'ended') toMenu(); });
      show('hud'); input.enabled = false; $('arMsg').textContent = t('arScan'); $('arMsg').classList.remove('hidden');
      return;
    } catch (e) { console.warn('XR failed, using camera fallback', e); world.visible = true; G.arPlacing = false; mode = 'cam'; }
  }
  if (mode === 'cam') {
    const ok = await ar.startCamera();
    if (!ok) { toast(t('camDenied'), 3500); mode = 'normal'; }
  }
  applyModeVisuals(mode); beginPlay();
}

function endGame(win) {
  if (G.state === 'ended') return;
  G.state = 'ended'; input.enabled = false; input.reset(); hide('hud'); hide('shop'); hideStory();
  sound.intensity = 0.05; win ? sound.win() : sound.lose();
  if (G.score > settings.hi) { settings.hi = G.score; saveSettings(); }
  $('endTitle').textContent = win ? t('victory') : t('defeat'); $('endLine').textContent = win ? t('winLine') : t('loseLine');
  $('endScore').textContent = G.score; $('endHi').textContent = settings.hi; show('end');
  if (ar.session) ar.endXR();
}
function toMenu() {
  G.state = 'menu'; input.enabled = false; hide('end'); hide('hud'); hide('shop'); hideStory(); hide('settings');
  ar.stopCamera(); applyModeVisuals('normal'); world.visible = true; G.arPlacing = false; enemies.clear(); $('hiTxt').textContent = settings.hi; show('menu'); sound.intensity = 0.1;
}

// ---------------- main loop ----------------
let menuA = 0;
function frame(_, xrFrame) {
  const dt = Math.min(0.05, clock.getDelta());
  if (G.mode === 'xr') { renderer.xr.updateCamera(camera); camera.updateMatrixWorld(true); if (xrFrame) ar.update(xrFrame); if (G.state !== 'placing') placeWorldAR(); }
  if (G.tree.mesh && G.tree.mesh.tree) G.tree.mesh.tree.update(clock.elapsedTime);
  if (G.state === 'menu' || G.state === 'ended') {
    menuA += dt * 0.12; camera.position.set(Math.cos(menuA) * 15, 4.3, Math.sin(menuA) * 15); camera.lookAt(0, 4.6, 0); if (gunRoot.visible) gunRoot.visible = false;
    fx.update(dt); enemies.update(dt * 0);
  } else if (G.state === 'placing') {
    // waiting for AR placement
  } else if (!G.paused) {
    gunRoot.visible = true;
    if (G.state !== 'prep-wait' || true) {
      updateLook(dt); updateMove(dt);
      if (G.mode === 'xr') { camera.updateMatrixWorld(true); }
      updateWeapon(dt); updateGrenades(dt); enemies.update(dt); updateWaves(dt); fx.update(dt); updateCrates();
      if (G.player.hp < G.player.max && clock.elapsedTime - G.player.lastHit > 5) G.player.hp = Math.min(G.player.max, G.player.hp + 8 * dt);
      sound.updateListener(camera);
      hudT -= dt; if (hudT <= 0) { hudT = 0.1; updateHUD(); }
    }
  }
  // auto quality
  perfSum += dt; perfN++; if (perfSum > 2.5) { const avg = perfSum / perfN; if (settings.quality === 'auto' && avg > 0.042 && G.quality !== 'low') applyQuality(G.quality === 'high' ? 'med' : 'low'); perfSum = 0; perfN = 0; }
  renderer.render(scene, camera);
}

// ---------------- wiring ----------------
function setupUI() {
  applyLang();
  $('setLang').value = settings.lang; $('setQual').value = settings.quality; $('setGyro').checked = settings.gyro; $('setSens').value = settings.sens; $('setVol').value = settings.vol;
  $('setLang').onchange = e => { settings.lang = e.target.value; saveSettings(); applyLang(); if (G.state === 'prep') renderShop(); };
  $('setQual').onchange = e => { settings.quality = e.target.value; saveSettings(); applyQuality(settings.quality === 'auto' ? 'med' : settings.quality); };
  $('setGyro').onchange = e => { settings.gyro = e.target.checked; saveSettings(); };
  $('setSens').oninput = e => { settings.sens = +e.target.value; saveSettings(); };
  $('setVol').oninput = e => { settings.vol = +e.target.value; sound.setVolume(settings.vol); saveSettings(); };
  const openSet = () => { show('settings'); if (G.state === 'prep' || G.state === 'wave') G.paused = true; };
  $('btnMenuSettings').onclick = () => { sound.init(); sound.ui(); openSet(); };
  $('btnSettings').onclick = openSet;
  $('btnSetClose').onclick = () => { hide('settings'); G.paused = false; clock.getDelta(); };
  $('btnRotOk').onclick = () => { rotDismissed = true; $('rotate').classList.remove('on'); };
  $('btnPlay').onclick = () => startGame('normal');
  $('btnPlayAR').onclick = async () => { const x = await ar.xrSupported(); startGame(x ? 'xr' : 'cam'); };
  $('btnShopT').onclick = () => { if (G.state === 'prep') { $('shop').classList.toggle('hidden'); sound.ui(); } };
  $('btnStart').onclick = () => { if (G.state === 'prep') { sound.ui(); startWave(); } };
  $('btnAgain').onclick = () => { hide('end'); startGame(G.mode === 'xr' ? 'cam' : G.mode); };
  $('btnToMenu').onclick = toMenu;
  document.addEventListener('visibilitychange', () => { if (document.hidden && (G.state === 'wave' || G.state === 'prep')) { G.paused = true; show('settings'); } });
  // keep the AR overlay from also triggering XR "select" for real buttons
  $('ui').addEventListener('beforexrselect', e => { if (e.target && e.target.closest && e.target.closest('.btn,.card,#shop')) e.preventDefault(); });
}
setupUI();
applyQuality(settings.quality === 'auto' ? 'med' : settings.quality);
loadAssets().then(() => { if (A.weapons[inv.cur]) equipModel(); }).catch(() => {});
barrVisAll();
function barrVisAll() { for (const b of G.barricades) barrVis(b); }
resize();
renderer.setAnimationLoop(frame);
G.api = { lookAt: (x, y, z) => { const dx = x - G.pp.x, dz = z - G.pp.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(y - EYE, Math.hypot(dx, dz)); }, startGame, startWave, endGame, startPrep, toMenu, inv, input, gyro, ar, queue: () => queue, setPaused: v => (G.paused = v) };
