import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';

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

  // Realistic procedural oak (ez-tree, MIT): wide dome, short thick trunk like the Golani oak
  const et = new Tree();
  et.loadPreset('Oak Large');
  et.options.leaves.tint = 0xe8ffc8;
  const box0 = new THREE.Box3().setFromObject(et);
  const bw = Math.max(box0.max.x - box0.min.x, box0.max.z - box0.min.z), bh = box0.max.y - box0.min.y;
  et.scale.set(16 / bw, 8.6 / bh, 16 / bw);
  et.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.add(et);
  const leafMat = et.leavesMesh.material;
  const canopy = null;
  const rootMat = et.branchesMesh.material.clone(); rootMat.color = new THREE.Color(0xb59b86);

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
    group.add(taperTube(pts, t => 0.5 * (1 - t) + 0.07, rootMat, 14, 8));
  }


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

  return { group, leafMat, canopy, tree: et };
}
