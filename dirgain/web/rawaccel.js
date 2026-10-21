import { step } from "../core/dirgain.js";

// Raw Accel's output stage without acceleration, mirrored from its source
// (common/rawaccel.hpp modify(), driver/driver.cpp carry): per-axis scaling, Y/X ratio,
// L/R ratio when moving left, U/D ratio when moving up, truncation toward zero with carry.
export function rawAccelProfile(fit) {
  return { kind: "rawaccel", sens: fit.sens, yx: fit.yx, lr: fit.lr, ud: fit.ud };
}

export function rawAccelStep(p, st, dx, dy) {
  let fx = dx * p.sens;
  let fy = dy * p.sens * p.yx;
  if (fx < 0) fx *= p.lr;
  if (fy < 0) fy *= p.ud;
  fx += st.cx;
  fy += st.cy;
  const ox = Math.trunc(fx) || 0;
  const oy = Math.trunc(fy) || 0;
  st.cx = fx - ox;
  st.cy = fy - oy;
  return [ox, oy];
}

// Direction-averaged log gain, used to give the A/B control the same overall speed.
export function rawAccelMeanLogGain(p, n = 360) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const x = Math.cos(t) * (Math.cos(t) < 0 ? p.lr : 1);
    const y = Math.sin(t) * p.yx * (Math.sin(t) < 0 ? p.ud : 1);
    s += Math.log(p.sens * Math.hypot(x, y));
  }
  return s / n;
}

// One entry point for the arena and the simulator: DirGain profiles or Raw Accel stand-ins.
export function applyStep(p, st, dx, dy, dtMs) {
  return p.kind === "rawaccel" ? rawAccelStep(p, st, dx, dy) : step(p, st, dx, dy, dtMs);
}
