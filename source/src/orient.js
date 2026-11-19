// Virtual orientation: some phones keep the page in portrait (auto-rotate off) while the user holds the phone
// sideways. We detect that from gravity and rotate the whole UI/canvas with CSS so everything is laid out for landscape.
export const OR = { rot: 0, w: innerWidth, h: innerHeight, cb: null };
let cand = 0, candT = 0;
export function vp() { return { w: OR.w, h: OR.h }; }
// screen (client) coordinates -> virtual (rotated UI) coordinates
export function mapPt(x, y) {
  if (OR.rot === 90) return { x: y, y: innerWidth - x };
  if (OR.rot === -90) return { x: innerHeight - y, y: x };
  return { x, y };
}
export function applyOrient() {
  const rot = OR.rot, b = document.body.classList;
  const w = rot ? innerHeight : innerWidth, h = rot ? innerWidth : innerHeight;
  OR.w = w; OR.h = h;
  const r = document.documentElement.style; r.setProperty('--vw', w / 100 + 'px'); r.setProperty('--vh', h / 100 + 'px');
  b.toggle('vr', !!rot); b.toggle('vr90', rot === 90); b.toggle('vrm90', rot === -90);
  b.toggle('land', w > h); b.toggle('short', h <= 380);
  if (OR.cb) OR.cb();
}
export function initOrient(cb) {
  OR.cb = cb;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const decide = (gx, gy) => {
    const portraitViewport = innerHeight > innerWidth * 1.0 && !OR.rot || (OR.rot && innerHeight < innerWidth);
    if (!portraitViewport && !OR.rot) return;
    if (isIOS) gx = -gx;
    let want = 0;
    if (Math.abs(gx) > 6.5 && Math.abs(gx) > 1.8 * Math.abs(gy)) want = gx > 0 ? 90 : -90;
    else if (Math.abs(gy) > 6.5) want = 0;
    else return;
    if (want !== cand) { cand = want; candT = performance.now(); }
    else if (want !== OR.rot && performance.now() - candT > 350) {
      // only rotate virtually while the real viewport is portrait; if the OS rotates for real, stay at 0
      if (want !== 0 && innerHeight <= innerWidth) return;
      OR.rot = want; applyOrient();
    }
  };
  addEventListener('devicemotion', e => { const a = e.accelerationIncludingGravity; if (a && a.x != null) decide(a.x, a.y); });
  addEventListener('resize', () => { if (OR.rot && innerHeight <= innerWidth) OR.rot = 0; applyOrient(); });
  applyOrient();
}
