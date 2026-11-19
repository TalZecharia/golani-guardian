import * as THREE from 'three';

// Tapered tube along a curve. radiusFn(t) -> radius at t in [0,1].
function taperTube(points, radiusFn, mat, seg = 26, radial = 12) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const pos = g.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  const per = radial + 1;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, c);
    const r = radiusFn(t);
    for (let j = 0; j < per; j++) {
      const idx = i * per + j;
      v.fromBufferAttribute(pos, idx).sub(c);
      // gnarly bark bumps
      const bump = 1 + 0.09 * Math.sin(j * 2.1 + i * 0.9) + 0.05 * Math.sin(j * 5.3 - i * 1.7);
      v.multiplyScalar(r * bump).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function makeTree() {
  const group = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x6b5238, roughness: 0.95 });
  const barkDark = new THREE.MeshStandardMaterial({ color: 0x4d3a28, roughness: 1 });

  // Short, thick, slightly twisted trunk with flared base
  const trunkPts = [
    new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0.25, 0.9, 0.12),
    new THREE.Vector3(-0.2, 2.1, -0.1), new THREE.Vector3(0.18, 3.1, 0.16),
    new THREE.Vector3(0, 3.9, 0)
  ];
  group.add(taperTube(trunkPts, t => 0.78 + 0.75 * Math.pow(1 - t, 3) + 0.12 * (1 - t), bark, 30, 14));

  // Exposed roots
  const rootN = 9;
  for (let i = 0; i < rootN; i++) {
    const a = (i / rootN) * Math.PI * 2 + Math.sin(i * 12.9) * 0.3;
    const len = 3.6 + (Math.sin(i * 7.7) * 0.5 + 0.5) * 2.2;
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const pts = [
      d.clone().multiplyScalar(0.3).setY(0.9),
      d.clone().multiplyScalar(len * 0.3).setY(0.45 + Math.sin(i) * 0.1),
      d.clone().multiplyScalar(len * 0.65).setY(0.16),
      d.clone().multiplyScalar(len).setY(-0.15)
    ];
    group.add(taperTube(pts, t => 0.5 * (1 - t) + 0.07, barkDark, 14, 8));
  }

  // Main branches
  const branches = [
    { a: 0.3, out: 7.4, y: 3.0, low: true },
    { a: 1.4, out: 6.4, y: 6.0 }, { a: 2.5, out: 6.8, y: 5.6 },
    { a: 3.6, out: 6.0, y: 6.4 }, { a: 4.6, out: 6.6, y: 5.8 }, { a: 5.6, out: 5.8, y: 6.2 }
  ];
  for (const b of branches) {
    const d = new THREE.Vector3(Math.cos(b.a), 0, Math.sin(b.a));
    const pts = b.low ? [
      new THREE.Vector3(0, 2.7, 0.1), d.clone().multiplyScalar(2.4).setY(3.5),
      d.clone().multiplyScalar(5).setY(3.7), d.clone().multiplyScalar(b.out).setY(3.1)
    ] : [
      new THREE.Vector3(0, 3.3, 0), d.clone().multiplyScalar(b.out * 0.3).setY(4.3),
      d.clone().multiplyScalar(b.out * 0.65).setY(b.y - 0.4), d.clone().multiplyScalar(b.out).setY(b.y)
    ];
    group.add(taperTube(pts, t => 0.5 * (1 - t) + 0.1, bark, 16, 8));
  }

  // Canopy: wide dome of low-poly foliage blobs
  const blobGeo = new THREE.IcosahedronGeometry(1, 1);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true, emissive: 0x2a3010 });
  const N = 90;
  const canopy = new THREE.InstancedMesh(blobGeo, leafMat, N);
  canopy.castShadow = true; canopy.receiveShadow = true;
  const palette = [0x4b6a2a, 0x5e7a30, 0x70803a, 0x86863c, 0x95883a, 0x55602a, 0x6a5a2c].map(c => new THREE.Color(c));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    let x, y, z;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1 || y < -0.35);
    p.set(x * 7.6 + 0.8, 6.0 + y * 3.3 + (1 - Math.min(1, Math.hypot(x, z))) * 0.8, z * 7.4);
    const sc = 1.7 + rnd() * 1.4;
    s.set(sc * 1.1, sc * 0.78, sc * 1.1);
    e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e);
    m.compose(p, q, s); canopy.setMatrixAt(i, m);
    const col = palette[Math.floor(rnd() * palette.length)].clone().multiplyScalar(1.05 + rnd() * 0.35);
    canopy.setColorAt(i, col);
  }
  group.add(canopy);

  // Wooden fence ring
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 1 });
  const R = 3.9, posts = 16;
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.0, 0.16), fenceMat);
    post.position.set(Math.cos(a) * R, 0.5, Math.sin(a) * R); post.castShadow = true;
    group.add(post);
    const a2 = ((i + 1) / posts) * Math.PI * 2;
    const x1 = Math.cos(a) * R, z1 = Math.sin(a) * R, x2 = Math.cos(a2) * R, z2 = Math.sin(a2) * R;
    const len = Math.hypot(x2 - x1, z2 - z1);
    for (const hy of [0.4, 0.8]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.06), fenceMat);
      rail.position.set((x1 + x2) / 2, hy, (z1 + z2) / 2);
      rail.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      group.add(rail);
    }
  }

  // Information sign + stone plaque
  const sign = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.5 }));
  pole.position.y = 1.1; sign.add(pole);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.04), new THREE.MeshStandardMaterial({ color: 0xf4f4ee, roughness: 0.6 }));
  board.position.y = 2.0; sign.add(board);
  const icon = new THREE.Mesh(new THREE.CircleGeometry(0.22, 8), new THREE.MeshStandardMaterial({ color: 0x2f9a3b }));
  icon.position.set(0, 2.08, 0.025); sign.add(icon);
  const trunkIcon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.01), new THREE.MeshStandardMaterial({ color: 0x4a3a28 }));
  trunkIcon.position.set(0, 1.78, 0.025); sign.add(trunkIcon);
  sign.position.set(5.0, 0, 3.4); sign.rotation.y = -0.6;
  group.add(sign);
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.25), new THREE.MeshStandardMaterial({ color: 0x555a5e, roughness: 1 }));
  plaque.position.set(-2.6, 0.25, 3.0); plaque.rotation.y = 0.4; plaque.castShadow = true;
  group.add(plaque);

  return { group, leafMat, canopy };
}
