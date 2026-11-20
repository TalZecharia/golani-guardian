import * as THREE from 'three';
import { Sound } from './audio.js';
import { FX } from './fx.js';
import { Input, Gyro } from './input.js';
import { Enemies, TYPES, blobTex } from './enemies.js';
import { buildWorld, placeBarricades, GATES, gateAngle, ARENA_R, BARR_R, FENCE_R } from './world.js';
import { WEAPONS, WEAPON_ORDER, buildGun, buildGrenadeMesh } from './weapons.js';
import { AR } from './ar.js';
import { initOrient, applyOrient, OR } from './orient.js';
// AR sizing: G.arH = tree height in real metres (calibrated by the player). Zombies are ~0.45x the tree height.
const arScale = () => 0.4135 * G.arH; // zombie (1.85m) = 0.765 x tree height
function treeH0() {
  if (!G._th) {
    const g = G.tree.mesh.group, pk = g.scale.x, ws = world.scale.x; g.scale.setScalar(1); world.scale.setScalar(1); world.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g); const h = b.max.y - b.min.y; G._th = h > 5 && h < 16 ? h : 8.6;
    g.scale.setScalar(pk); world.scale.setScalar(ws);
  }
  return G._th;
}
const treeK = () => G.arH / (treeH0() * arScale());
// AR: zombies appear ~2.2 x tree height + 0.8 m away (clamped 4-6 m real) => time to aim, scope and go for headshots
function arSpawnReal() { return Math.max(4, Math.min(6, 2.2 * G.arH + 0.8)); }
function applyArScale() { world.scale.setScalar(arScale()); G.arS = arScale(); setTreeK(treeK()); if (G.mode === 'xr') G.spawnR = arSpawnReal() / G.arS; }
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
  player: { hp: 200, max: 200, lastHit: -99 }, arOff: { x: 0, z: 0 }, arBase: new THREE.Vector3(), spawnR: ARENA_R + 8
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
const muzzleLight = new THREE.PointLight(0xffb060, 0, 6, 1.5);
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
  // hands + sleeves so the gun doesn't float (positions relative to gun length)
  const L = c.length || GUN_LEN[id], hz = c.hands || [0.34, 0.62], sleeve = 0x4a5238, glove = 0x2b2b28;
  const mkArm = (x, y, z, rx, ry, sl) => {
    const a = new THREE.Group(); const sv = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, sl), new THREE.MeshStandardMaterial({ color: sleeve, roughness: 0.9 })); sv.position.z = sl / 2;
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.11), new THREE.MeshStandardMaterial({ color: glove, roughness: 0.8 }));
    a.add(sv, h); a.position.set(x, y, z); a.rotation.set(rx, ry, 0); g.add(a); return a;
  };
  mkArm(0.012, -0.075, 0.12 - L * hz[0], 0.28, -0.05, 0.42);
  mkArm(-0.01, -0.045, 0.12 - L * hz[1], 0.2, 0.12, 0.5);
  return g;
}
function equipModel() {
  if (gunMesh) gunRoot.remove(gunMesh);
  gunMesh = customGun(inv.cur) || buildGun(inv.cur);
  muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
  muzzle.position.set(0, 0.0, gunMesh.userData.muzzleZ - 0.05); muzzle.visible = false;
  const m2 = muzzle.clone(); m2.rotation.y = Math.PI / 2; muzzle.add(m2);
  gunMesh.add(muzzle); muzzle.add(muzzleLight); muzzleLight.intensity = 0;
  gunRoot.add(gunMesh);
}
equipModel();

// muzzle light (always present, intensity 0 when off => no shader recompiles) + pooled smoke puffs
const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, 'rgba(210,210,210,0.9)'); g.addColorStop(1, 'rgba(210,210,210,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const smokes = []; for (let i = 0; i < 10; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 })); sp.visible = false; sp.userData = { t: 0, life: 1, v: new THREE.Vector3(), s0: 0.05, max: 0.1 }; scene.add(sp); smokes.push(sp); }
let smokeI = 0, smokeSkip = 0;
function puffSmoke(strength) {
  if (!muzzle) return; const sp = smokes[smokeI++ % smokes.length], u = sp.userData;
  muzzle.getWorldPosition(sp.position); camera.getWorldDirection(V.c);
  u.t = 0; u.life = 0.6 + Math.random() * 0.4; u.s0 = 0.04 + 0.03 * strength; u.v.copy(V.c).multiplyScalar(0.15 + Math.random() * 0.2);
  u.v.x += (Math.random() - 0.5) * 0.12; u.v.y += 0.18 + Math.random() * 0.12; u.v.z += (Math.random() - 0.5) * 0.12; u.max = 0.5 * (0.14 + 0.1 * strength);
  sp.material.opacity = 0.3 * Math.min(1, 0.5 + strength * 0.5); sp.visible = true; sp.scale.setScalar(u.s0);
}
function updateSmoke(dt) {
  for (const sp of smokes) { if (!sp.visible) continue; const u = sp.userData; u.t += dt; const k = u.t / u.life; if (k >= 1) { sp.visible = false; continue; }
    sp.position.addScaledVector(u.v, dt); u.v.multiplyScalar(Math.pow(0.3, dt)); sp.scale.setScalar(u.s0 + (u.max - u.s0) * Math.sqrt(k)); sp.material.opacity = 0.3 * (1 - k) * (1 - k); }
}
// vibration: patterns per weapon; browsers without support (iOS Safari) simply do nothing
const VIB = { pistol: 22, mp5: 9, m4: 14, ak: 20, shotgun: 55 };
function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

// ---------------- state ----------------
let cd = 0, reloading = 0, reloadDur = 0, latch = false, equipT = 0, flashT = 0, kickZ = 0, kickRot = 0, camKick = 0, shake = 0, kickYaw = 0, kickRoll = 0, gshake = 0, flashSc = 1;
let yaw = 0, pitch = 0, yawOff = 0, gyroCal = false, walkT = 0;
let grenades = [], queue = [], spawnT = 0, prepT = 0, waveClearT = 0, lastTreeToast = -99, lastGrowl = 0, hudT = 0, perfT = 0, perfN = 0, perfSum = 0;
const clock = new THREE.Clock();
const V = { c0: new THREE.Color(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), o: new THREE.Vector3(), d: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), inv: new THREE.Matrix4() };
const Y = new THREE.Vector3(0, 1, 0);

// ---------------- quality ----------------
const Q = { high: { pr: 1.75, shadow: 2048, parts: 600, alive: 26 }, med: { pr: 1.25, shadow: 1024, parts: 400, alive: 22 }, low: { pr: 0.9, shadow: 0, parts: 200, alive: 16 } };
function applyQuality(level) {
  G.quality = level; const q = Q[level];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr));
  renderer.shadowMap.enabled = q.shadow > 0; G.sun.castShadow = q.shadow > 0;
  if (q.shadow) { G.sun.shadow.mapSize.set(q.shadow, q.shadow); if (G.sun.shadow.map) { G.sun.shadow.map.dispose(); G.sun.shadow.map = null; } }
  fx.limit = q.parts; G.maxAlive = q.alive; G.lowQ = level === 'low';
  resize();
}
let rotDismissed = false;
let ads = false, adsK = 0, baseFov = 72;
function resize() {
  const w = OR.w, h = OR.h;
  $('rotate').classList.toggle('on', h > w * 1.1 && !rotDismissed);
  renderer.setSize(w, h, false); camera.aspect = w / h; baseFov = w >= h ? 72 : Math.min(100, 2 * Math.atan(Math.tan(36 * Math.PI / 180) * 1.25 / (w / h)) * 180 / Math.PI); camera.fov = baseFov * (1 - 0.38 * adsK); camera.updateProjectionMatrix();
}
initOrient(resize);
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(applyOrient, 200));

// ---------------- modes ----------------
function setTreeK(k) {
  G.fenceR = FENCE_R * k;
  if (G.tree.mesh && G.tree.mesh.group) G.tree.mesh.group.scale.setScalar(k);
  if (G.treeCollider) G.treeCollider.r = FENCE_R * k - 0.1;
}
function applyModeVisuals(mode) {
  G.mode = mode;
  const bg = mode === 'normal';
  G.sky.visible = bg; G.ground.visible = bg; G.shadowPlane.visible = !bg; if (G.wallMesh) G.wallMesh.visible = bg; if (G.tree.mesh && G.tree.mesh.fence) G.tree.mesh.fence.visible = bg; for (const b of G.barricades) b.group.visible = bg; document.body.classList.toggle('xr', mode === 'xr'); G.tree.max = mode === 'xr' ? 3000 : 1000; G.tree.hp = G.tree.max; for (const o of G.arHide || []) o.visible = bg && !(G.rockPrims && G.rockPrims.includes(o) && G.rocksReal);
  scene.fog = bg ? FOG : null;
  scene.background = bg ? new THREE.Color(0xe6d09c) : null;
  renderer.setClearAlpha(bg ? 1 : 0);
  if (mode === 'xr') { G.arH = settings.arH || 2.0; camera.near = 0.05; camera.far = 200; sound.refDist = 4; G.spawnR = 3.6; placeBarricades(G, 1.9); G.arOff.x = G.arOff.z = 0; applyArScale(); }
  else { setTreeK(1); world.scale.setScalar(1); world.position.set(0, 0, 0); camera.near = 0.1; camera.far = 600; sound.refDist = 4; G.spawnR = ARENA_R + 22; placeBarricades(G, BARR_R); }
  warmLight(mode === 'xr');
  camera.updateProjectionMatrix();
}
// AR: warm, soft default lighting (light estimation, when the phone supports it, overrides intensity) + soft shadow disc under the tree
let treeBlob = null;
let origSun = null, origHemi = null;
function warmLight(on) {
  if (G.sun && !origSun) { origSun = G.sun.color.clone(); origHemi = G.hemi.color.clone(); }
  if (G.hemi && origHemi) G.hemi.color.copy(on ? V.c0.set(0xfff1de) : origHemi);
  if (G.sun && origSun) G.sun.color.copy(on ? V.c0.set(0xffe2b8) : origSun);
  const tm = G.tree.mesh && G.tree.mesh.group;
  if (tm && !treeBlob) { treeBlob = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.8 })); treeBlob.position.y = 0.04; treeBlob.renderOrder = -1; tm.add(treeBlob); }
  if (treeBlob) treeBlob.visible = on;
}

// ---------------- helpers ----------------
function placeWorldAR() {
  if (ar.anchorPos) G.arBase.copy(ar.anchorPos);
  let y = G.arBase.y;
  if (ar.floorY != null && Math.abs(ar.floorY - y) < 1.2) { G.arYsm = G.arYsm == null ? ar.floorY : G.arYsm + (ar.floorY - G.arYsm) * 0.12; y = G.arYsm; }
  world.position.set(G.arBase.x + G.arOff.x, y, G.arBase.z + G.arOff.z); world.updateMatrixWorld(true);
  if (ar.anchor && G.state !== 'placing') {
    world.visible = !ar.lost;
    if (ar.lost) { $('arMsg').textContent = 'מאבד מעקב. הזז את הטלפון לאט וסרוק את הרצפה'; $('arMsg').classList.remove('hidden'); G.lostShown = true; }
    else if (G.lostShown) { G.lostShown = false; $('arMsg').classList.add('hidden'); }
  }
}
function startReplant() {
  if (G.mode !== 'xr' || !ar.session) return;
  G.replantPrev = G.state; G.state = 'placing'; ar.anchor = null; ar.anchorPos = null; ar.floorSource = null; ar.floorY = null; G.arYsm = null; ar.lost = false;
  world.visible = false; G.arPlacing = true; ar.placing = true; hide('settings'); G.paused = false;
  $('arMsg').textContent = 'כוון לרצפה והקש כדי לשתול את העץ מחדש'; $('arMsg').classList.remove('hidden');
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
  if (G.mode === 'xr' && arAim) { const c = Math.cos(arAim), s = Math.sin(arAim); V.a.copy(V.d).multiplyScalar(c).addScaledVector(V.u, s); V.b.copy(V.u).multiplyScalar(c).addScaledVector(V.d, -s); V.d.copy(V.a); V.u.copy(V.b); }
  if (G.mode === 'xr') {
    world.updateMatrixWorld(true); V.inv.copy(world.matrixWorld).invert();
    V.o.applyMatrix4(V.inv); V.d.transformDirection(V.inv); V.r.transformDirection(V.inv); V.u.transformDirection(V.inv);
  }
  return V;
}

// ---------------- combat callbacks used by enemies ----------------
G.growlAt = (e, near) => { const now = performance.now(); if (now - lastGrowl < (near ? 200 : 350)) return; lastGrowl = now; const p = e.group.getWorldPosition(V.a.clone()); sound.growl(p, e.big, near ? 1.5 : 1); };
const hitDirs = [];
G.damagePlayer = (n, e) => {
  if (G.state !== 'wave' && G.state !== 'prep') return;
  killStreak = 0; n *= 0.75; G.player.hp -= n; G.player.lastHit = clock.elapsedTime;
  if (e && e.group) hitDirs.push({ dx: e.group.position.x - G.pp.x, dz: e.group.position.z - G.pp.z, t: performance.now() });
  vignette(); sound.hurt(); shake = Math.max(shake, 0.25);
  buzz([40, 30, 60]);
  if (G.player.hp <= 0) endGame(false, 'player');
};
G.damageTree = (n) => {
  if (G.state !== 'wave' && G.state !== 'prep') return;
  G.tree.hp = Math.max(0, G.tree.hp - n * (G.mode === 'xr' ? 0.6 : 1));
  sound.treeHit(); shake = Math.max(shake, 0.16); camKick += 0.004; buzz([70, 40, 110]);
  if (Math.random() < 0.5) fx.leaves(V.a.set((Math.random() - 0.5) * 8, 5 + Math.random() * 2, (Math.random() - 0.5) * 8), 5);
  if (clock.elapsedTime - lastTreeToast > 7) { lastTreeToast = clock.elapsedTime; toast(t('treeHit'), 1600); }
  if (G.tree.hp <= 0) endGame(false, 'tree');
};
function barrVis(b) { b.group.visible = b.hp > 0 && G.mode !== 'xr'; b.planks[0].visible = b.hp > 0; b.planks[1].visible = b.hp > 100; b.planks[2].visible = b.hp > 200; }
G.damageBarricade = (b, n) => {
  const was = b.hp; b.hp = Math.max(0, b.hp - n); sound.wood();
  fx.dust(V.a.set(b.x, 1, b.z), 4); barrVis(b);
  if (was > 0 && b.hp <= 0) fx.dust(V.a.set(b.x, 1, b.z), 20);
};
G.onKill = (e, head) => {
  const d = G.lastHitDist || 0;
  const base = e.def.pts * (head ? 1.5 : 1) * (d > 30 ? 1.25 : 1);
  addPoints(Math.round(base)); killStreak++; clearTimeout(streakT); streakT = setTimeout(() => { killStreak = 0; }, 3500);
  popText('+' + Math.round(base) + (head ? ' 🎯' : ''), head ? 'head' : '');
  if (killStreak >= 3 && killStreak % 2 === 1) setTimeout(() => popText('רצף x' + killStreak + '!', 'big'), 250);
  const p = e.group.position;
  fx.blood(V.a.set(p.x, 1.2 * e.def.scale, p.z), 14);
  sound.die(e.group.getWorldPosition(V.b.clone()), e.big);
  buzz(12);
  if (e.type === 'boss' || e.type === 'miniboss') { fx.explosion(V.c.set(p.x, 1.5, p.z), 4); }
};
let killStreak = 0, streakT = 0;
function popText(txt, cls) {
  const d = document.createElement('div'); d.className = 'pop ' + (cls || ''); d.textContent = txt;
  d.style.left = (50 + (Math.random() - 0.5) * 16) + '%'; $('hud').appendChild(d); setTimeout(() => d.remove(), 1000);
}
function addPoints(n) { G.points += n; G.score += n; }
G.explosionAt = (pos, size, o) => {
  fx.explosion(pos, o.radius || size); const wp = world.localToWorld(pos.clone());
  sound.explosion(wp);
  const camWorld = camera.getWorldPosition(V.b.clone());
  const dcam = (G.mode === 'xr' ? 1 / arScale() : 1) * camWorld.distanceTo(wp); shake = Math.max(shake, Math.max(0, 0.5 - dcam * 0.02));
  if (o.enemies) {
    for (const e of enemies.list.slice()) {
      if (e.state === 'dying') continue;
      const d = Math.hypot(e.group.position.x - pos.x, e.group.position.z - pos.z);
      if (d < o.radius) { G.lastHitDist = 5; enemies.damage(e, o.enemies * (1 - d / o.radius), false); addPoints(5); }
    }
  }
  const dp = Math.hypot(G.pp.x - pos.x, G.pp.z - pos.z);
  if (o.player && dp < o.radius * 0.85) G.damagePlayer(o.player * (1 - dp / (o.radius * 0.85)));
  if (o.tree && Math.hypot(pos.x, pos.z) < o.radius + (G.fenceR || FENCE_R)) G.damageTree(o.tree);
};
G.slamAt = (p, e) => {
  sound.slam(world.localToWorld(p.clone()));
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; fx.dust(V.a.set(p.x + Math.cos(a) * 2, 0.2, p.z + Math.sin(a) * 2), 3); }
  shake = Math.max(shake, 0.35);
  const dp = Math.hypot(G.pp.x - p.x, G.pp.z - p.z); if (dp < 7) G.damagePlayer(e.type === 'boss' ? 38 : 26);
  if (Math.hypot(p.x, p.z) < 11) G.damageTree(e.type === 'boss' ? 90 : 55);
};

// ---------------- threat indicators (radar + edge arrows + hit direction) ----------------
const radar = $('radar'), rctx = radar.getContext('2d'), thr = $('threat'), tctx = thr.getContext('2d');
function drawThreats() {
  document.body.classList.toggle('prepping', G.state === 'prep');
  const W = OR.w, H = OR.h; if (thr.width !== W || thr.height !== H) { thr.width = W; thr.height = H; }
  tctx.clearRect(0, 0, W, H); rctx.clearRect(0, 0, 120, 120);
  const f = forwardFlat(V.b), fx = f.x, fz = f.z, range = Math.max(10, G.spawnR * 1.25);
  const rel = (dx, dz) => Math.atan2(-fz * dx + fx * dz, fx * dx + fz * dz);
  rctx.save(); rctx.translate(60, 60);
  rctx.strokeStyle = 'rgba(255,255,255,.25)'; rctx.lineWidth = 1; rctx.beginPath(); rctx.arc(0, 0, 56, 0, 6.283); rctx.stroke(); rctx.beginPath(); rctx.arc(0, 0, 28, 0, 6.283); rctx.stroke();
  rctx.fillStyle = 'rgba(255,255,255,.14)'; rctx.beginPath(); rctx.moveTo(0, 0); rctx.arc(0, 0, 56, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); rctx.fill();
  const dot = (dx, dz, r, col) => { const a = rel(dx, dz), d = Math.min(1, Math.hypot(dx, dz) / range) * 56; rctx.fillStyle = col; rctx.beginPath(); rctx.arc(Math.sin(a) * d, -Math.cos(a) * d, r, 0, 6.283); rctx.fill(); };
  dot(-G.pp.x, -G.pp.z, 4, '#4ade80');
  const Rx = W * 0.45, Ry = H * 0.4;
  for (const e of enemies.list) {
    if (e.state === 'dying') continue;
    const dx = e.group.position.x - G.pp.x, dz = e.group.position.z - G.pp.z, d = Math.hypot(dx, dz), a = rel(dx, dz), big = e.type === 'boss' || e.type === 'miniboss';
    dot(dx, dz, big ? 4 : 2.6, '#ff4a3a');
    if (Math.abs(a) > 0.62 && d < range * 0.8) {
      const vx = Math.sin(a) * Rx, vy = -Math.cos(a) * Ry;
      tctx.save(); tctx.translate(W / 2 + vx, H / 2 + vy); tctx.rotate(Math.atan2(vy, vx)); tctx.globalAlpha = Math.max(0.35, 1 - d / range);
      const s = big ? 17 : 12; tctx.fillStyle = '#ff3b2e'; tctx.strokeStyle = '#fff'; tctx.lineWidth = 1.5;
      tctx.beginPath(); tctx.moveTo(s, 0); tctx.lineTo(-s * 0.7, -s * 0.8); tctx.lineTo(-s * 0.7, s * 0.8); tctx.closePath(); tctx.fill(); tctx.stroke(); tctx.restore();
    }
  }
  rctx.restore();
  const now = performance.now();
  for (let i = hitDirs.length - 1; i >= 0; i--) {
    const h = hitDirs[i], age = (now - h.t) / 1200; if (age >= 1) { hitDirs.splice(i, 1); continue; }
    const th = rel(h.dx, h.dz) - Math.PI / 2; tctx.strokeStyle = `rgba(255,40,30,${(1 - age) * 0.85})`; tctx.lineWidth = 16; tctx.lineCap = 'round';
    tctx.beginPath(); tctx.arc(W / 2, H / 2, Math.min(W, H) * 0.36, th - 0.32, th + 0.32); tctx.stroke();
  }
}

// ---------------- shooting ----------------
function fire(w) {
  inv.mag[inv.cur]--; cd = w.rate; flashT = 0.055; flashSc = (0.75 + Math.random() * 0.6) * (ads ? 0.6 : 1);
  const am = ads ? 0.55 : 1; // aiming steadies the gun
  kickZ = w.kick * 1.7 * am; kickRot = w.recoil * 9 * am; camKick += w.recoil * 1.4 * am;
  kickYaw += (Math.random() - 0.5) * w.recoil * 10 * am; kickRoll += (Math.random() - 0.5) * w.recoil * 14 * am;
  shake = Math.max(shake, w.shake * 8 * am); gshake = Math.max(gshake, w.shake * 14 * am);
  sound.shot(w.id); buzz(VIB[w.id] || 12);
  if (muzzle && !G.lowQ) muzzleLight.intensity = 2.2 * flashSc;
  smokeSkip -= w.rate; if (smokeSkip <= 0) { puffSmoke(Math.min(1.5, w.kick * 12)); smokeSkip = 0.12; }
  const R = aimRay(), ox = R.o.clone(), dir0 = R.d.clone(), right = R.r.clone(), up = R.u.clone();
  let anyHit = false, headHit = false, headKill = false, legHit = false;
  const bonusSpread = (input.getMove().x || input.getMove().y) ? 1.35 : 1;
  for (let k = 0; k < w.pellets; k++) {
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * w.spread * bonusSpread * (ads ? 0.35 : 1);
    const dir = dir0.clone().addScaledVector(right, Math.cos(a) * rr).addScaledVector(up, Math.sin(a) * rr).normalize();
    const hit = enemies.rayTest(ox, dir, 140);
    if (hit) {
      const d = hit.t; const e = hit.e;
      // strong up close (x1.4 within 3 m), normal inside effective range, then falling off to ~60% of the weapon's minimum
      const eR = w.eff * 0.5; // effective range
      const near = d < 3 ? 1.4 : d < eR * 0.5 ? 1 + 0.4 * (1 - (d - 3) / Math.max(1, eR * 0.5 - 3)) : 1;
      const far = d <= eR ? 1 : Math.max(w.minFall * 0.6, 1 - ((d - eR) / eR) * (1 - w.minFall * 0.6));
      const f = near * far;
      const big = e.type === 'boss' || e.type === 'miniboss';
      // headshot = instant kill (bosses take x4 instead)
      let dmg = hit.head ? (big ? w.dmg * f * 4 : e.hp + 1) : w.dmg * f;
      const pts = Math.round(w.pts * (hit.head ? 2 : 1) * (1 + Math.min(0.5, d / 90)) * (w.pellets > 1 ? 1 : 1));
      addPoints(pts);
      G.lastHitDist = d;
      const pt = ox.clone().addScaledVector(dir, d);
      fx.blood(pt, hit.head ? 8 : 5);
      e.knock.addScaledVector(dir, Math.min(2.5, dmg * 0.04));
      const killed = enemies.damage(e, dmg, hit.head, hit.part);
      anyHit = true; if (hit.head) { headHit = true; if (killed) headKill = true; } else if (hit.part === 'leg') legHit = true;
      if (hit.head) { fx.blood(pt, 6); fx.spark(pt, 3); } else if (hit.part === 'leg') fx.dust(pt.clone().setY(0.1), 3);
    } else if (dir.y < -0.01) {
      const tt = -ox.y / dir.y; if (tt > 0 && tt < 120) fx.dust(ox.clone().addScaledVector(dir, tt).setY(0.05), 3);
    }
  }
  if (anyHit) { hitmark(headHit); hitFlash(headHit ? 'head' : ''); if (headHit) { sound.headshot(); if (headKill) { sound.headKill(); shake = Math.max(shake, 0.12); buzz([10, 20, 25]); } headText(headKill); } else { sound.thud(legHit ? 'leg' : 'body'); if (legHit) popText('מעד!', ''); } }
  if (inv.mag[inv.cur] <= 0 && inv.res[inv.cur] > 0) startReload();
}
let hsT = 0;
function headText(kill) { const el = $('hsTxt'); el.textContent = kill ? 'ירייה בראש! חיסול' : 'ירייה בראש!'; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); clearTimeout(hsT); hsT = setTimeout(() => el.classList.remove('show'), 700); }
function hitFlash(cls) { const h = $('hflash'); if (!h) return; h.className = cls ? 'on ' + cls : 'on'; clearTimeout(hitFlash.t); hitFlash.t = setTimeout(() => { h.className = ''; }, 70); }
function startReload() {
  if (reloading > 0) return; const w = wstat(inv.cur);
  if (inv.mag[inv.cur] >= w.mag || inv.res[inv.cur] <= 0) return;
  reloading = reloadDur = w.reload; sound.reload(w.reload, inv.cur);
}
function switchWeapon() {
  if (inv.owned.length < 2) return;
  const i = (inv.owned.indexOf(inv.cur) + 1) % inv.owned.length; inv.cur = inv.owned[i];
  reloading = 0; equipT = 0.45; equipModelSoon = 0.22; ads = false; $('btnAds').classList.remove('on'); sound.swap();
  popText('⇄ ' + t(inv.cur), 'big'); $('btnSwitch').classList.add('pulse'); setTimeout(() => $('btnSwitch').classList.remove('pulse'), 500);
  buzz(15);
}
let equipModelSoon = 0;
function throwGrenade() {
  if (inv.gren <= 0) { sound.deny(); return; }
  inv.gren--; sound.throwG();
  const R = aimRay(); const m = buildGrenadeMesh(); world.add(m);
  const p = R.o.clone().addScaledVector(R.d, 0.5 * (G.mode === 'xr' ? 1 / arScale() : 1)).addScaledVector(R.u, -0.1 * (G.mode === 'xr' ? 1 / arScale() : 1));
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
  if (input.take('ads')) { ads = !ads; $('btnAds').classList.toggle('on', ads); sound.click(); }
  if (input.take('grenade')) throwGrenade();
  if (equipT > 0) { equipT -= dt; if (equipModelSoon > 0) { equipModelSoon -= dt; if (equipModelSoon <= 0) equipModel(); } }
  const want = input.fire;
  if (want && cd <= 0 && reloading <= 0 && equipT <= 0.1 && (w.auto || !latch)) {
    if (inv.mag[inv.cur] > 0) fire(w);
    else if (inv.res[inv.cur] > 0) startReload();
    else if (!latch) { sound.dry(); buzz(6); toast(t('refill'), 900); }
    cd = Math.max(cd, 0.001);
  }
  latch = want;
  // viewmodel animation
  kickZ *= Math.pow(0.0006, dt); kickRot *= Math.pow(0.001, dt); kickYaw *= Math.pow(0.002, dt); kickRoll *= Math.pow(0.002, dt); gshake *= Math.pow(0.0005, dt); updateSmoke(dt);
  const rl = reloading > 0 ? Math.sin(Math.PI * (1 - reloading / reloadDur)) : 0;
  const eq = equipT > 0 ? Math.sin(Math.PI * (equipT / 0.45)) : 0;
  adsK += ((ads ? 1 : 0) - adsK) * Math.min(1, dt * 12);
  if (G.mode !== 'xr') { const f = baseFov * (1 - 0.38 * adsK); if (Math.abs(camera.fov - f) > 0.05) { camera.fov = f; camera.updateProjectionMatrix(); } }
  const sway = Math.sin(walkT * 2) * 0.006 * (input.getMove().x || input.getMove().y ? 1 : 0.25);
  const gj = gshake * 0.05;
  gunRoot.position.set((0.15 + sway) * (1 - adsK) + (Math.random() - 0.5) * gj, (-0.19 - rl * 0.16 - eq * 0.32 + Math.abs(Math.sin(walkT)) * 0.004) * (1 - adsK) + -0.098 * adsK + (Math.random() - 0.5) * gj, (-0.42 + kickZ) * (1 - adsK) + -0.36 * adsK);
  gunRoot.rotation.set(kickRot - rl * 0.5 - eq * 0.5, kickYaw, rl * 0.35 + kickRoll);
  if (muzzle) { flashT -= dt; muzzle.visible = flashT > 0; if (muzzle.visible) { muzzle.rotation.z = Math.random() * 3; muzzle.scale.setScalar(flashSc); } else muzzleLight.intensity = 0; }
}

// ---------------- player movement / look ----------------
function updateLook(dt) {
  const l = input.takeLook(); const sens = 0.0042 * settings.sens * (1 - 0.5 * adsK);
  if (G.mode === 'xr') { // pose comes from WebXR; a finger drag only raises/lowers the aim (crosshair + shots), clamped
    if (l.dy) { arAim = Math.max(-0.5, Math.min(0.5, arAim - l.dy * sens * 0.7)); arDragT = clock.elapsedTime; }
    // finger released: ease back to straight ahead in ~0.2 s
    if (input.lookId === null && (input.fireId === null || clock.elapsedTime - arDragT > 0.15) && arAim) { arAim *= Math.exp(-dt * 18); if (Math.abs(arAim) < 0.002) arAim = 0; }
    const el = $('cross'), px = -Math.tan(arAim) * camera.projectionMatrix.elements[5] * OR.h / 2;
    el.style.transform = `translateY(${px.toFixed(1)}px)`; $('hitmark').style.transform = el.style.transform; return;
  }
  if (arAim) { arAim = 0; $('cross').style.transform = ''; $('hitmark').style.transform = ''; }
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
    // AR: position comes ONLY from the XR camera pose (you walk with your body); the world stays anchored in place
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
  const q = []; const n = [4, 6, 8, 11, 14, 17, 21, 26, 31, 36][Math.min(9, w - 1)];
  const wt = { normal: 1, fast: w >= 3 ? 0.15 + 0.03 * w : 0, heavy: w >= 5 ? 0.1 + 0.025 * w : 0, bomber: w >= 6 ? 0.1 + 0.02 * w : 0 };
  const tot = Object.values(wt).reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) { let r = Math.random() * tot, pick = 'normal'; for (const k in wt) { if ((r -= wt[k]) <= 0) { pick = k; break; } } q.push(pick); }
  if (w === 5) q.splice(Math.min(q.length, 8), 0, 'miniboss');
  if (w === 10) { q.splice(Math.min(q.length, 10), 0, 'boss'); for (let i = 0; i < 4; i++) q.push('heavy'); }
  return q;
}
function startWave() {
  G.wave++; G.state = 'wave'; queue = buildQueue(G.wave); spawnT = G.mode === 'xr' ? 7 : 1.5;
  G.activeGates = []; const n = Math.min(GATES, 2 + Math.floor(G.wave / 2));
  const all = [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5); G.activeGates = all.slice(0, n);
  for (const c of G.crates) c.uses = 3;
  hide('shop'); hide('btnShopT'); banner(`${t('waveBanner')} ${G.wave}`); sound.horn(G.wave === 5 || G.wave === 10); sound.siren(G.wave === 5 || G.wave === 10); shake = Math.max(shake, 0.35); buzz([120, 60, 120, 60, 200]); startTutorial(); sound.intensity = Math.min(1, 0.4 + G.wave * 0.06);
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
// ---- mood: crowd murmur, danger heartbeat, first-wave tutorial ----
let heartT = 0, dangerOn = false, tutTimers = [];
function updateMood(dt) {
  const inWave = G.state === 'wave';
  let lvl = 0;
  if (inWave) for (const e of enemies.list) { if (e.state === 'dying') continue; const d = Math.hypot(e.group.position.x, e.group.position.z); lvl += Math.max(0, 1 - d / (G.mode === 'xr' ? 6 : 28)); }
  moodT -= dt; if (moodT <= 0) { moodT = 0.25; sound.setAmbient(Math.min(1, lvl / 5)); }
  const low = (G.state === 'wave' || G.state === 'prep') && (G.tree.hp / G.tree.max < 0.3 || G.player.hp / (G.player.max || 200) < 0.25);
  if (low !== dangerOn) { dangerOn = low; $('danger').classList.toggle('on', low); }
  if (low) { heartT -= dt; if (heartT <= 0) { heartT = 0.95; sound.heart(); buzz([30, 60, 30]); } }
}
let moodT = 0, arAim = 0, arDragT = 0;
function startTutorial() {
  tutTimers.forEach(clearTimeout); tutTimers = [];
  if (G.wave !== 1) return;
  const say = (ms, txt) => tutTimers.push(setTimeout(() => { if (G.state === 'wave' && G.wave === 1) toast(txt, 3600); }, ms));
  if (G.mode !== 'xr') { tutTimers.push(setTimeout(() => { if (G.state === 'wave' && G.wave === 1) show('zones'); }, 800)); tutTimers.push(setTimeout(() => hide('zones'), 9500)); }
  say(1500, G.mode === 'xr' ? 'סובב את הטלפון כדי לכוון. גרור אצבע למעלה/למטה כדי להגביה או להנמיך את הכוונת' : 'גרור באצבע בצד ימין כדי להסתכל, ובצד שמאל כדי לזוז');
  say(6000, 'הקש על הכפתור האדום כדי לירות. כוון לראש!');
  say(13000, 'ירייה בראש = חיסול מיידי. אל תתנו להם להגיע לעץ');
  say(21000, 'נגמרה התחמושת? ↻ טעינה, או ⇄ להחליף נשק');
}
function updateWaves(dt) {
  if (G.state === 'prep') { prepT -= dt; $('count').textContent = Math.max(0, Math.ceil(prepT)); if (prepT <= 0) startWave(); return; }
  if (G.state !== 'wave') return;
  spawnT -= dt;
  if (queue.length && spawnT <= 0 && enemies.aliveCount() < Math.min(G.maxAlive || 22, 2 + Math.floor(G.wave * 1.6))) { spawnOne(); spawnT = G.fast ? 0.02 : Math.max(0.6, 3.2 - G.wave * 0.25) * (0.8 + Math.random() * 0.4); }
  if (!queue.length && enemies.aliveCount() === 0) {
    if (G.wave >= TOTAL_WAVES) { endGame(true); return; }
    { const bonus = 100 * G.wave; addPoints(bonus); banner(`🎉 ${t('wave')} ${G.wave} נוקה!`); sound.buy(); setTimeout(() => popText(`בונוס גל +${bonus}`, 'big'), 600); }
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
    else row(t(id), `${W.dmg}${W.pellets > 1 ? '×' + W.pellets : ''} dmg`, W.price, G.points >= W.price, () => { if (inv.owned.length >= 2) inv.owned.splice(1, 1, id); else inv.owned.push(id); inv.mag[id] = wstat(id).mag; inv.res[id] = maxRes(id); inv.cur = id; reloading = 0; equipModel(); }, `${t('buy')} ${W.price}` + (inv.owned.length >= 2 ? ` (מחליף ${t(inv.owned[1])})` : ''));
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
  $('wSlots').innerHTML = inv.owned.map(o => `<span class="${o === id ? 'on' : ''}">${t(o)}</span>`).join(' ⇄ ');
  { const nx = inv.owned.find(o => o !== id); $('swCur').textContent = t(id); $('swNext').textContent = nx ? '⇄ ' + t(nx) : ''; }
  $('wName').textContent = t(id) + (inv.lvl[id] ? ' ★'.repeat(inv.lvl[id]) : '');
  $('mag').textContent = reloading > 0 ? '…' : inv.mag[id]; $('res').textContent = inv.res[id];
  $('gCount').textContent = `● ×${inv.gren}`;
  G.tree.mesh.leafMat.color.setScalar(0.5 + 0.5 * (G.tree.hp / G.tree.max));
}

// ---------------- game flow ----------------
function resetGame() {
  ads = false; adsK = 0; $('btnAds').classList.remove('on'); enemies.clear(); queue = []; for (const g of grenades) world.remove(g.m); grenades = [];
  G.wave = 0; G.points = 500; G.score = 0; G.tree.hp = G.tree.max; G.player.hp = G.player.max;
  for (const b of G.barricades) { b.hp = b.max; barrVis(b); } for (const c of G.crates) c.uses = 3;
  resetInv(); equipModel(); reloading = 0; cd = 0; gyroCal = false; shake = 0; camKick = 0;
  const a = Math.random() * Math.PI * 2; G.pp.x = Math.cos(a) * 18; G.pp.z = Math.sin(a) * 18;
  yaw = Math.atan2(G.pp.x, G.pp.z); pitch = -0.05; input.reset();
}
function beginPlay() {
  show('hud'); input.enabled = true; hideStory(); $('arMsg').classList.add('hidden');
  const lines = t('story'); let i = 0; G.state = 'intro';
  const next = () => { if (G.state !== 'intro') return; if (i < lines.length) { story(lines[i++], 3300); setTimeout(next, 3500); } else startPrepFirst(); };
  next();
}
function startPrepFirst() { if (G.state === 'intro') startPrep(true); }

function startCalib() {
  G.state = 'calib'; ar.measuring = false; $('arMsg').classList.add('hidden');
  const sl = $('calH'); sl.value = G.arH; $('calV').textContent = G.arH.toFixed(2) + ' מ׳'; show('calib');
  sl.oninput = () => { G.arH = +sl.value; $('calV').textContent = G.arH.toFixed(2) + ' מ׳'; applyArScale(); };
  $('btnCalGo').onclick = () => {
    hide('calib'); settings.arH = G.arH; saveSettings(); $('setArSize').value = G.arH;
    G.pp.x = 0; G.pp.z = 0; beginPlay();
  };
}
// AR: plant the tree on the floor, then set its height manually in the calibration panel
function startPlacing() {
  G.state = 'placing'; ar.measuring = false; ar.placing = true; show('hud'); input.enabled = false;
  $('arMsg').textContent = 'כוון לרצפה והקש כדי לשתול את העץ'; $('arMsg').classList.remove('hidden');
}
function briefing(mode) {
  return new Promise(res => {
    $('brAR').classList.toggle('hidden', mode !== 'xr');
    $('brSens').value = settings.sens; $('brVol').value = settings.vol;
    $('brSens').oninput = e => { settings.sens = +e.target.value; saveSettings(); $('setSens').value = settings.sens; };
    $('brVol').oninput = e => { settings.vol = +e.target.value; saveSettings(); $('setVol').value = settings.vol; sound.setVolume(settings.vol); };
    show('brief'); $('btnBriefGo').onclick = () => { hide('brief'); res(); };
  });
}
function pickLoadout() {
  return new Promise(res => {
    const grid = $('lgrid'); grid.innerHTML = '';
    for (const id of ['mp5', 'm4', 'ak', 'shotgun']) {
      const W = WEAPONS[id], b = document.createElement('button'); b.className = 'lw';
      b.innerHTML = `<b>${t(id)}</b><span dir="ltr">${W.dmg}${W.pellets > 1 ? '×' + W.pellets : ''} dmg · ${W.mag}</span>`;
      b.onclick = () => { hide('loadout'); res(id); }; grid.appendChild(b);
    }
    show('loadout');
  });
}
// try to force landscape (needs fullscreen on Android Chrome); the virtual rotation in orient.js is the fallback
async function tryLock() { try { const el = document.documentElement; if (el.requestFullscreen && !document.fullscreenElement) await el.requestFullscreen(); if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch (e) {} }
async function startGame(mode) {
  sound.init(); sound.setVolume(settings.vol); sound.startMusic(); sound.intensity = 0.1; sound.ui();
  hide('menu'); hide('end'); resetGame();
  await briefing(mode);
  { const w = await pickLoadout(); inv.owned.push(w); inv.mag[w] = wstat(w).mag; inv.res[w] = maxRes(w); }
  if (mode !== 'xr' && settings.gyro) { const ok = await gyro.request(); if (!ok) toast(t('gyroDenied')); }
  if (mode === 'xr') {
    try {
      applyModeVisuals('xr'); world.visible = false; G.arPlacing = true; G.state = 'placing';
      await ar.startXR(pos => {
        G.arBase.copy(pos); G.arOff.x = G.arOff.z = 0; G.arYsm = null; placeWorldAR(); world.visible = true; G.arPlacing = false;
        if (G.replantPrev) { G.state = G.replantPrev; G.replantPrev = null; $('arMsg').classList.add('hidden'); toast('העץ נשתל מחדש'); return; }
        startCalib();
      }, () => { applyModeVisuals('normal'); world.visible = true; G.arPlacing = false; if (G.state !== 'menu' && G.state !== 'ended') toMenu(); });
      startPlacing();
      return;
    } catch (e) { console.warn('XR failed, using camera fallback', e); world.visible = true; G.arPlacing = false; mode = 'cam'; }
  }
  if (mode === 'cam') {
    const ok = await ar.startCamera();
    if (!ok) { toast(t('camDenied'), 3500); mode = 'normal'; }
  }
  applyModeVisuals(mode); beginPlay();
}

function endGame(win, cause) {
  if (G.state === 'ended') return;
  G.state = 'ended'; input.enabled = false; input.reset(); hide('hud'); hide('shop'); hideStory();
  sound.intensity = 0.05; win ? sound.win() : sound.lose();
  if (G.score > settings.hi) { settings.hi = G.score; saveSettings(); }
  $('endTitle').textContent = win ? t('victory') : t('defeat'); $('endLine').textContent = win ? t('winLine') : (cause === 'player' ? 'נפלת בקרב: הזומבים הגיעו אליך. העץ עדיין עומד.' : t('loseLine'));
  $('endScore').textContent = G.score; $('endHi').textContent = settings.hi; show('end');
  if (ar.session) ar.endXR();
}
function toMenu() {
  G.paused = false; tutTimers.forEach(clearTimeout); tutTimers = []; dangerOn = false; $('danger').classList.remove('on'); sound.setAmbient(0); for (const g of grenades) world.remove(g.m); grenades = []; queue = []; hide('zones'); $('toast').classList.remove('show'); clock.getDelta();
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
  } else if (G.state === 'placing' || G.state === 'calib') {
    // waiting for AR placement
  } else if (!G.paused) {
    gunRoot.visible = true;
    if (G.state !== 'prep-wait' || true) {
      updateLook(dt); updateMove(dt);
      if (G.mode === 'xr') { camera.updateMatrixWorld(true); }
      updateWeapon(dt); updateGrenades(dt); enemies.update(dt); updateWaves(dt); updateMood(dt); fx.update(dt); updateCrates(); drawThreats();
      if (G.player.hp < G.player.max && clock.elapsedTime - G.player.lastHit > 5) G.player.hp = Math.min(G.player.max, G.player.hp + 8 * dt);
      sound.updateListener(camera);
      hudT -= dt; if (hudT <= 0) { hudT = 0.1; updateHUD(); }
    }
  }
  // auto quality
  if (G.state === 'wave') { perfSum += Math.min(dt, 0.2); perfN++; if (perfSum > 1.6) { const avg = perfSum / perfN; if (settings.quality === 'auto' && avg > 0.034 && G.quality !== 'low') { applyQuality(G.quality === 'high' ? 'med' : 'low'); toast('הורדתי מעט את איכות הגרפיקה כדי שיהיה חלק', 2200); } perfSum = 0; perfN = 0; } } else { perfSum = 0; perfN = 0; }
  renderer.render(scene, camera);
}

// ---------------- wiring ----------------
function setupUI() {
  applyLang();
  $('setLang').value = settings.lang; $('setQual').value = settings.quality; $('setGyro').checked = settings.gyro; $('setSens').value = settings.sens; $('setVol').value = settings.vol;
  $('setLang').onchange = e => { settings.lang = e.target.value; saveSettings(); applyLang(); if (G.state === 'prep') renderShop(); };
  $('setQual').onchange = e => { settings.quality = e.target.value; saveSettings(); applyQuality(settings.quality === 'auto' ? 'med' : settings.quality); };
  $('setGyro').onchange = e => { settings.gyro = e.target.checked; saveSettings(); };
  $('setArSize').value = settings.arH || 2.0; $('setArSize').oninput = e => { settings.arH = +e.target.value; saveSettings(); if (G.mode === 'xr') { G.arH = settings.arH; applyArScale(); } };
  $('setSens').oninput = e => { settings.sens = +e.target.value; saveSettings(); };
  $('setVol').oninput = e => { settings.vol = +e.target.value; sound.setVolume(settings.vol); saveSettings(); };
  const inGame = () => ['wave', 'prep', 'placing', 'calib'].includes(G.state);
  const openSet = () => { $('btnReplant').classList.toggle('hidden', G.mode !== 'xr'); $('btnQuit').classList.toggle('hidden', !inGame()); armQuit(false); show('settings'); if (G.state === 'prep' || G.state === 'wave') G.paused = true; };
  $('btnMenuSettings').onclick = () => { sound.init(); sound.ui(); openSet(); };
  $('btnSettings').onclick = openSet;
  $('btnReplant').onclick = startReplant;
  let quitArm = false, quitT = 0;
  const armQuit = on => { quitArm = on; clearTimeout(quitT); $('btnQuit').textContent = on ? 'בטוח? לחץ שוב כדי לצאת' : 'יציאה לתפריט הראשי'; if (on) quitT = setTimeout(() => armQuit(false), 5500); };
  $('btnQuit').onclick = () => { if (!quitArm) { armQuit(true); return; } armQuit(false); toMenu(); };
  $('btnPause').onclick = () => { if (inGame()) openSet(); };
  $('btnSetClose').onclick = () => { hide('settings'); G.paused = false; clock.getDelta(); };
  $('btnRotOk').onclick = () => { rotDismissed = true; $('rotate').classList.remove('on'); };
  $('btnPlay').onclick = () => { tryLock(); startGame('normal'); };
  $('btnPlayAR').onclick = async () => { const x = await ar.xrSupported(); if (!x) tryLock(); startGame(x ? 'xr' : 'cam'); };
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
G.api = { gunInfo: () => ({ cur: inv.cur, mesh: gunMesh && gunMesh.children[0] ? gunMesh.children[0].uuid : null, ads, adsK, fov: camera.fov }), measure: () => { world.updateMatrixWorld(true); const h = o => { const b = new THREE.Box3().setFromObject(o); return b.max.y - b.min.y; }; const z = enemies.list[0]; return { tree: h(G.tree.mesh.group), zombie: z ? h(z.model || z.group) : null, arH: G.arH }; }, startCalib, startPlacing, pickLoadout, camera, applyMode: applyModeVisuals, lookAt: (x, y, z) => { const dx = x - G.pp.x, dz = z - G.pp.z; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(y - EYE, Math.hypot(dx, dz)); }, startGame, startWave, endGame, startPrep, toMenu, inv, input, gyro, ar, queue: () => queue, setPaused: v => (G.paused = v) };
