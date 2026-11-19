import * as THREE from 'three';
import { makeTree } from './tree.js';

export const GATES = 6;
export const gateAngle = i => ((i * 60 + 30) * Math.PI) / 180;
export const ARENA_R = 42;
export const BARR_R = 20;
export const FENCE_R = 3.9;

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return (hash(xi, zi) * (1 - u) + hash(xi + 1, zi) * u) * (1 - v) + (hash(xi, zi + 1) * (1 - u) + hash(xi + 1, zi + 1) * u) * v;
}

export function buildWorld(G) {
  const W = G.world;
  const parts = { env: [], hills: null };

  // ---- sky dome ----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x2c63c4) }, mid: { value: new THREE.Color(0x7fa9e0) }, hor: { value: new THREE.Color(0xf6dc9c) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(hor, mid, smoothstep(0.0, 0.25, h)); c = mix(c, top, smoothstep(0.2, 0.8, h)); gl_FragColor = vec4(c,1.0);\n#include <colorspace_fragment>\n} '
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 14), skyMat);
  sky.renderOrder = -10;
  G.scene.add(sky); // not in world: stays unscaled
  G.sky = sky;

  // soft clouds (billboard-less flat discs high up)
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(18 + rnd() * 22, 12), cloudMat);
    const a = rnd() * Math.PI * 2, r = 120 + rnd() * 110;
    c.position.set(Math.cos(a) * r, 55 + rnd() * 60, Math.sin(a) * r);
    c.lookAt(0, 0, 0); c.scale.y = 0.35; c.renderOrder = -9;
    sky.add(c);
  }

  // ---- ground + hills (vertex coloured) ----
  const SZ = 280, SEG = 112;
  const gg = new THREE.PlaneGeometry(SZ, SZ, SEG, SEG); gg.rotateX(-Math.PI / 2);
  const pos = gg.attributes.position, col = new Float32Array(pos.count * 3);
  const dry = new THREE.Color(0xb9a05a), dirt = new THREE.Color(0x8a7648), green = new THREE.Color(0x78883e), rockc = new THREE.Color(0x9b8f72), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z), ang = Math.atan2(z, x);
    let h = 0;
    if (r > ARENA_R + 2) {
      const k = r - (ARENA_R + 2);
      h = Math.pow(k, 1.35) * 0.055 * (0.55 + 0.45 * Math.sin(ang * 3.1 + r * 0.03) + 0.25 * vnoise(x * 0.05, z * 0.05));
      for (let g = 0; g < GATES; g++) { const da = Math.abs(((ang - gateAngle(g) + Math.PI * 3) % (Math.PI * 2)) - Math.PI); const w = Math.max(0, 1 - Math.abs(da - Math.PI) * 6 + 0); void w; }
    } else if (r > ARENA_R - 2) h = 0;
    pos.setY(i, h);
    const n1 = vnoise(x * 0.12, z * 0.12), n2 = vnoise(x * 0.5, z * 0.5);
    tmp.copy(dry).lerp(dirt, Math.max(0, n1 - 0.45) * 1.6).lerp(green, Math.max(0, vnoise(x * 0.07 + 9, z * 0.07 + 3) - 0.55) * 2.2);
    tmp.multiplyScalar(0.9 + n2 * 0.2);
    if (h > 4) tmp.lerp(rockc, Math.min(1, (h - 4) / 8) * 0.6).lerp(green, 0.15);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  gg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  gg.computeVertexNormals();
  const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  W.add(ground); G.ground = ground;

  // shadow-only plane for camera (AR-ish) mode
  const sp = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 40).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.35 }));
  sp.receiveShadow = true; sp.visible = false; sp.position.y = 0.01; W.add(sp); G.shadowPlane = sp;

  // ---- stone wall with 6 gates ----
  const wallGeo = new THREE.BoxGeometry(3.4, 1.4, 1.3);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xa79a80, roughness: 1, flatShading: true });
  const blocks = [];
  const step = (Math.PI * 2) / 78;
  for (let a = 0; a < Math.PI * 2; a += step) {
    let skip = false;
    for (let g = 0; g < GATES; g++) { const d = Math.abs(Math.atan2(Math.sin(a - gateAngle(g)), Math.cos(a - gateAngle(g)))); if (d < 0.085) skip = true; }
    if (!skip) blocks.push(a);
  }
  const wall = new THREE.InstancedMesh(wallGeo, wallMat, blocks.length);
  wall.castShadow = true; wall.receiveShadow = true;
  const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), pp = new THREE.Vector3(), ss = new THREE.Vector3(), ee = new THREE.Euler();
  blocks.forEach((a, i) => {
    const sy = 0.7 + rnd() * 0.9;
    pp.set(Math.cos(a) * (ARENA_R + 1.5), (1.4 * sy) / 2, Math.sin(a) * (ARENA_R + 1.5));
    ee.set((rnd() - 0.5) * 0.08, -a + Math.PI / 2 + (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.06); qq.setFromEuler(ee);
    ss.set(1, sy, 1); m4.compose(pp, qq, ss); wall.setMatrixAt(i, m4);
    wall.setColorAt(i, new THREE.Color().setHSL(0.1, 0.18, 0.5 + rnd() * 0.15));
  });
  W.add(wall);

  // ---- rocks (cover + colliders) ----
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c8470, roughness: 1, flatShading: true });
  const rockSpots = [];
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, r = 9 + rnd() * 27;
    let ok = true;
    for (let g = 0; g < GATES; g++) { const d = Math.abs(Math.atan2(Math.sin(a - gateAngle(g)), Math.cos(a - gateAngle(g)))); if (d < 0.18) ok = false; }
    if (!ok) continue;
    const s = 0.8 + rnd() * 1.4;
    const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    rk.position.set(Math.cos(a) * r, s * 0.45, Math.sin(a) * r); rk.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3); rk.scale.y = 0.7;
    rk.castShadow = true; rk.receiveShadow = true; W.add(rk);
    G.colliders.push({ x: rk.position.x, z: rk.position.z, r: s * 0.9 });
    rockSpots.push(rk.position);
  }

  // ---- dry grass tufts ----
  const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.07, 0.4, 4), new THREE.MeshStandardMaterial({ color: 0xcdb460, roughness: 1 }), 900);
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2, r = 5 + rnd() * 36;
    pp.set(Math.cos(a) * r, 0.3, Math.sin(a) * r); ee.set(0, rnd() * 6, (rnd() - 0.5) * 0.4); qq.setFromEuler(ee);
    const s = 0.6 + rnd() * 0.9; ss.set(s, s, s); m4.compose(pp, qq, ss); tufts.setMatrixAt(i, m4);
    tufts.setColorAt(i, new THREE.Color().setHSL(0.12 + rnd() * 0.03, 0.45, 0.45 + rnd() * 0.12));
  }
  W.add(tufts);

  // ---- tree ----
  const tree = makeTree();
  W.add(tree.group);
  G.tree.mesh = tree; G.colliders.push({ x: 0, z: 0, r: FENCE_R - 0.1 });

  // ---- barricades ----
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x8e6b3e, roughness: 1 });
  for (let g = 0; g < GATES; g++) {
    const a = gateAngle(g);
    const grp = new THREE.Group();
    grp.position.set(Math.cos(a) * BARR_R, 0, Math.sin(a) * BARR_R);
    grp.rotation.y = -a + Math.PI / 2;
    const planks = [];
    for (let k = 0; k < 3; k++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.32, 0.18), plankMat);
      p.position.set(0, 0.4 + k * 0.5, 0); p.rotation.z = (rnd() - 0.5) * 0.06; p.castShadow = true; grp.add(p); planks.push(p);
    }
    for (const x of [-2.5, 0, 2.5]) { const po = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 0.22), plankMat); po.position.set(x, 0.8, 0); po.castShadow = true; grp.add(po); }
    W.add(grp);
    G.barricades.push({ group: grp, planks, x: grp.position.x, z: grp.position.z, hp: 300, max: 300, angle: a });
  }

  // ---- ammo crates ----
  const crateSpots = [[-9.5, 7.5], [Math.cos(2.62) * 27, Math.sin(2.62) * 27]];
  for (const [cx, cz] of crateSpots) {
    const c = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0x4e5a35, roughness: 0.8 }));
    box.position.y = 0.4; box.castShadow = true; c.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.08, 0.96), new THREE.MeshStandardMaterial({ color: 0x3c4628 }));
    lid.position.y = 0.82; c.add(lid);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.92), new THREE.MeshStandardMaterial({ color: 0xe6c44a, emissive: 0x3a2c00 }));
    stripe.position.set(0, 0.86, 0); c.add(stripe);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x222 }));
    handle.position.set(0, 0.6, 0.47); c.add(handle);
    c.position.set(cx, 0, cz); c.rotation.y = Math.atan2(-cz, cx) + 0.4;
    W.add(c);
    G.crates.push({ group: c, x: cx, z: cz, uses: 3 });
    G.colliders.push({ x: cx, z: cz, r: 0.9 });
  }

  // ---- lights (inside world so AR scale carries the shadow frustum) ----
  const hemi = new THREE.HemisphereLight(0xdbe7ff, 0xe0b66a, 1.35); W.add(hemi);
  const fill = new THREE.DirectionalLight(0xffc680, 0.9); fill.position.set(30, -6, -20); W.add(fill);
  const sun = new THREE.DirectionalLight(0xffd79a, 2.6);
  sun.position.set(-34, 30, 22); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 5; sc.far = 100;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  W.add(sun); W.add(sun.target);
  G.sun = sun; G.hemi = hemi;

  G.hillsDecor = [ground]; // toggled in AR
  return parts;
}
