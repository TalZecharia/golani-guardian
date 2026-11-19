import * as THREE from 'three';

// dmg: per bullet; pellets: bullets per shot; eff: effective range (m); minFall: damage factor at 2x eff
export const WEAPONS = {
  pistol: { id: 'pistol', dmg: 18, rate: 0.24, mag: 12, reload: 1.1, spread: 0.006, eff: 45, minFall: 0.5, auto: false, pellets: 1, pts: 10, price: 0, kick: 0.05, recoil: 0.012, shake: 0.004, reserveMul: 6, mat: 0x2b2d30 },
  mp5: { id: 'mp5', dmg: 20, rate: 0.075, mag: 30, reload: 1.7, spread: 0.026, eff: 28, minFall: 0.35, auto: true, pellets: 1, pts: 8, price: 700, kick: 0.035, recoil: 0.006, shake: 0.0025, reserveMul: 5, mat: 0x25282b },
  m4: { id: 'm4', dmg: 28, rate: 0.1, mag: 30, reload: 2.0, spread: 0.012, eff: 55, minFall: 0.55, auto: true, pellets: 1, pts: 10, price: 1300, kick: 0.045, recoil: 0.008, shake: 0.003, reserveMul: 5, mat: 0x30332e },
  ak: { id: 'ak', dmg: 38, rate: 0.12, mag: 30, reload: 2.3, spread: 0.02, eff: 50, minFall: 0.5, auto: true, pellets: 1, pts: 12, price: 1600, kick: 0.06, recoil: 0.014, shake: 0.0045, reserveMul: 4, mat: 0x3b2f22 },
  shotgun: { id: 'shotgun', dmg: 16, rate: 0.85, mag: 6, reload: 2.4, spread: 0.075, eff: 14, minFall: 0.1, auto: false, pellets: 8, pts: 4, price: 950, kick: 0.12, recoil: 0.04, shake: 0.012, reserveMul: 5, mat: 0x2a2018 }
};
export const WEAPON_ORDER = ['pistol', 'mp5', 'm4', 'ak', 'shotgun'];

function box(w, h, d, color, x, y, z, rough = 0.6, metal = 0.5) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: Math.min(metal, 0.3) }));
  m.position.set(x, y, z); return m;
}

// Viewmodel built from primitives, pointing down -Z. Returns {group, muzzle}
export function buildGun(id) {
  const g = new THREE.Group();
  const dark = 0x3a3e42, steel = 0x7a8086, wood = 0x9a6a3a, olive = 0x6a7650;
  let muzzleZ = -0.5;
  if (id === 'pistol') {
    g.add(box(0.05, 0.07, 0.24, steel, 0, 0, -0.1));
    g.add(box(0.045, 0.12, 0.06, dark, 0, -0.09, 0.0));
    g.add(box(0.03, 0.02, 0.05, dark, 0, 0.05, -0.1));
    muzzleZ = -0.23;
  } else if (id === 'mp5') {
    g.add(box(0.06, 0.08, 0.36, dark, 0, 0, -0.12));
    g.add(box(0.035, 0.035, 0.14, steel, 0, 0.0, -0.38));
    g.add(box(0.04, 0.16, 0.05, dark, 0, -0.12, -0.14));
    g.add(box(0.045, 0.1, 0.05, dark, 0, -0.09, 0.0));
    g.add(box(0.05, 0.06, 0.18, steel, 0, -0.02, 0.2));
    g.add(box(0.025, 0.03, 0.04, steel, 0, 0.055, -0.3));
    muzzleZ = -0.46;
  } else if (id === 'm4') {
    g.add(box(0.06, 0.09, 0.42, dark, 0, 0, -0.1));
    g.add(box(0.045, 0.045, 0.3, steel, 0, 0.0, -0.46));
    g.add(box(0.05, 0.06, 0.22, olive, 0, 0.0, -0.36));
    g.add(box(0.04, 0.15, 0.07, dark, 0, -0.12, -0.08));
    g.add(box(0.045, 0.1, 0.05, dark, 0, -0.1, 0.06));
    g.add(box(0.05, 0.08, 0.22, dark, 0, -0.02, 0.28));
    g.add(box(0.03, 0.04, 0.1, steel, 0, 0.075, -0.05));
    muzzleZ = -0.64;
  } else if (id === 'ak') {
    g.add(box(0.06, 0.09, 0.4, steel, 0, 0, -0.1));
    g.add(box(0.04, 0.04, 0.34, steel, 0, 0.01, -0.46));
    g.add(box(0.055, 0.06, 0.22, wood, 0, -0.005, -0.34));
    const mag = box(0.045, 0.17, 0.06, steel, 0, -0.13, -0.1); mag.rotation.x = 0.28; g.add(mag);
    g.add(box(0.045, 0.1, 0.05, wood, 0, -0.1, 0.05));
    g.add(box(0.05, 0.08, 0.26, wood, 0, -0.02, 0.28));
    muzzleZ = -0.65;
  } else { // shotgun
    g.add(box(0.05, 0.05, 0.62, steel, 0, 0.0, -0.3));
    g.add(box(0.05, 0.05, 0.5, steel, 0, -0.045, -0.24));
    g.add(box(0.065, 0.06, 0.2, wood, 0, -0.045, -0.3));
    g.add(box(0.06, 0.09, 0.25, dark, 0, -0.01, 0.0));
    g.add(box(0.05, 0.08, 0.28, wood, 0, -0.04, 0.26));
    muzzleZ = -0.62;
  }
  // arms (two simple sleeves + hands)
  const sleeve = 0x4a5238, skin = 0xc79a76;
  const left = new THREE.Group(); left.add(box(0.08, 0.08, 0.22, sleeve, 0, 0, 0.04)); left.add(box(0.075, 0.07, 0.1, skin, 0, 0, -0.1, 0.9, 0));
  left.position.set(-0.07, -0.1, id === 'pistol' ? 0.1 : -0.12); left.rotation.set(0.12, 0.15, 0); g.add(left);
  const right = new THREE.Group(); right.add(box(0.08, 0.08, 0.2, sleeve, 0, 0, 0.1)); right.add(box(0.07, 0.07, 0.09, skin, 0, 0, 0.0, 0.9, 0));
  right.position.set(0.07, -0.13, 0.12); right.rotation.set(0.2, -0.1, 0); g.add(right);
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  g.userData.muzzleZ = muzzleZ;
  return g;
}

export function buildGrenadeMesh() {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3f4a2c, roughness: 0.6, metalness: 0.3 }));
  m.castShadow = true; return m;
}
