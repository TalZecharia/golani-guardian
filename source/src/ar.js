import * as THREE from 'three';
import { XREstimatedLight } from 'three/examples/jsm/webxr/XREstimatedLight.js';

export const AR_SCALE = 1; // real scale: 1 game metre = 1 real metre

export class AR {
  constructor(G) {
    this.G = G;
    this.session = null; this.hitSource = null; this.placing = false; this.placed = false;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.16, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf2c35b, transparent: true, opacity: 0.9 }));
    this.reticle.matrixAutoUpdate = false; this.reticle.visible = false;
    G.scene.add(this.reticle);
    this.stream = null; this.anchor = null; this.anchorPos = null; this.lastHit = null;
  }

  async xrSupported() {
    try { return !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar'))); } catch (e) { return false; }
  }

  // Real WebXR AR (Android Chrome etc.). Resolves true when the session started.
  async startXR(onPlaced, onEnd) {
    const G = this.G, r = G.renderer;
    const root = document.getElementById('ui');
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'local-floor', 'anchors', 'light-estimation'], domOverlay: { root }
    });
    this.session = session; this.placing = true; this.placed = false;
    r.xr.enabled = true; r.xr.setReferenceSpaceType('local');
    // match the room's real lighting when the device supports it
    try {
      this.xrLight = new XREstimatedLight(r);
      this.xrLight.addEventListener('estimationstart', () => {
        G.scene.add(this.xrLight); if (this.xrLight.environment) G.scene.environment = this.xrLight.environment;
        G.hemi.intensity = 0.25; G.sun.intensity = 1.2;
      });
      this.xrLight.addEventListener('estimationend', () => {
        G.scene.remove(this.xrLight); G.scene.environment = null; G.hemi.intensity = 1.35; G.sun.intensity = 2.6;
      });
    } catch (e) {}
    await r.xr.setSession(session);
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({ space: viewer });
    this._onPlaced = onPlaced;
    const place = () => {
      if (!this.placing || !this.reticle.visible) return;
      this.placing = false; this.placed = true;
      const hit = this.lastHit;
      if (hit && hit.createAnchor) hit.createAnchor().then(a => { this.anchor = a; }).catch(() => {});
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      this.reticle.matrix.decompose(pos, q, s);
      this.reticle.visible = false;
      onPlaced(pos);
    };
    this._place = place;
    session.addEventListener('select', place);
    // taps on the DOM overlay may not raise 'select' on every browser: fall back to the touch layer
    this._tapFallback = () => place();
    document.getElementById('touch').addEventListener('pointerdown', this._tapFallback);
    session.addEventListener('end', () => {
      this.hitSource = null; this.session = null; this.placing = false; this.reticle.visible = false; this.anchor = null; this.anchorPos = null;
      document.getElementById('touch').removeEventListener('pointerdown', this._tapFallback);
      r.xr.enabled = false;
      onEnd();
    });
    return true;
  }

  endXR() { if (this.session) { try { this.session.end(); } catch (e) {} } }

  update(frame) {
    if (this.anchor && frame) {
      const pose = frame.getPose(this.anchor.anchorSpace, this.G.renderer.xr.getReferenceSpace());
      if (pose) { const p = pose.transform.position; (this.anchorPos || (this.anchorPos = new THREE.Vector3())).set(p.x, p.y, p.z); }
    }
    if (!this.hitSource || !this.placing || !frame) return;
    const hits = frame.getHitTestResults(this.hitSource);
    if (hits.length) {
      this.lastHit = hits[0];
      const pose = hits[0].getPose(this.G.renderer.xr.getReferenceSpace());
      if (pose) { this.reticle.visible = true; this.reticle.matrix.fromArray(pose.transform.matrix); return; }
    }
    this.reticle.visible = false;
  }

  // Fallback "AR": live camera feed behind a transparent canvas.
  async startCamera() {
    const v = document.getElementById('camvid');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      v.srcObject = this.stream; v.style.display = 'block';
      try { await v.play(); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }
  stopCamera() {
    const v = document.getElementById('camvid');
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    v.srcObject = null; v.style.display = 'none';
  }
}
