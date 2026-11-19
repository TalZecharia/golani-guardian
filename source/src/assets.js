import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

// Optional realistic assets, driven by assets/models/manifest.json (see README there).
// Everything is optional: with no manifest the game keeps its procedural models.
export const A = { zombies: [], clips: {}, weapons: {}, loaded: false };

const base = 'assets/models/';
function loaderFor(file) {
  if (/\.fbx$/i.test(file)) return new FBXLoader();
  const g = new GLTFLoader(); const d = new DRACOLoader(); d.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'); g.setDRACOLoader(d); return g;
}
async function load(file) {
  const r = await loaderFor(file).loadAsync(base + file);
  const obj = r.scene || r; if (!obj.animations) obj.animations = r.animations || [];
  if (r.animations && r.animations.length) obj.animations = r.animations;
  return obj;
}

export async function loadAssets() {
  let man = null;
  try { const r = await fetch(base + 'manifest.json', { cache: 'no-cache' }); if (r.ok) man = await r.json(); } catch (e) {}
  if (!man) { A.loaded = true; return A; }
  // zombie characters
  for (const z of man.zombies || []) {
    try {
      const obj = await load(z.file);
      const clips = {}; for (const c of obj.animations) clips[c.name.toLowerCase()] = c;
      A.zombies.push({ obj, cfg: z, clips });
      if (z.clips) for (const k in z.clips) { const c = obj.animations.find(a => a.name === z.clips[k]); if (c) A.clips[k] = c; }
    } catch (e) { console.warn('zombie asset failed', z.file, e); }
  }
  // animation files (Mixamo "without skin"); each file's first clip is used
  for (const k in man.anims || {}) {
    try { const o = await load(man.anims[k]); if (o.animations[0]) A.clips[k] = o.animations[0]; } catch (e) { console.warn('anim asset failed', k, e); }
  }
  // clips embedded in the character files fill any gaps by name
  const find = (re) => { for (const z of A.zombies) for (const n in z.clips) if (re.test(n)) return z.clips[n]; };
  for (const [k, re] of Object.entries({ walk: /walk/, run: /run/, idle: /idle/, attack: /attack|hit|punch|bite/, death: /death|die|dying/ })) if (!A.clips[k]) { const c = find(re); if (c) A.clips[k] = c; }
  // weapons
  for (const id in man.weapons || {}) {
    try { const w = man.weapons[id]; const obj = await load(w.file); A.weapons[id] = { obj, cfg: w }; } catch (e) { console.warn('weapon asset failed', id, e); }
  }
  A.loaded = true;
  return A;
}

// Find the head bone of a skinned model (Mixamo: mixamorigHead)
export function findBone(root, re) { let b = null; root.traverse(o => { if (!b && o.isBone && re.test(o.name)) b = o; }); return b; }

// Scale a loaded model so it's `height` metres tall (works for cm-scaled FBX files)
export function normalizeHeight(obj, height) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj); const h = box.max.y - box.min.y || 1;
  obj.scale.multiplyScalar(height / h);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  obj.position.y -= b2.min.y;
}
