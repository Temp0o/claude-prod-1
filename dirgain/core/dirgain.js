export const COEF_KEYS = ["a0", "a1", "b1", "a2", "b2", "a3", "b3"];
export const PARAM_KEYS = [...COEF_KEYS, "lambda", "reset_ms", "clamp"];

export function defaultProfile() {
  return { a0: 0, a1: 0, b1: 0, a2: 0, b2: 0, a3: 0, b3: 0, lambda: 8, reset_ms: 100, clamp: 0.15 };
}

export function createState() {
  return { vx: 0, vy: 0, cx: 0, cy: 0 };
}

// c2, s2 = cos/sin of the doubled movement angle (unit vector)
export function harmonicsAt(p, c2, s2) {
  const c4 = 2 * c2 * c2 - 1;
  const s4 = 2 * s2 * c2;
  const c6 = c2 * c4 - s2 * s4;
  const s6 = s2 * c4 + c2 * s4;
  return p.a1 * c2 + p.b1 * s2 + p.a2 * c4 + p.b2 * s4 + p.a3 * c6 + p.b3 * s6;
}

export function logGainAtAngle(p, theta) {
  return p.a0 + harmonicsAt(p, Math.cos(2 * theta), Math.sin(2 * theta));
}

function roundHalfAway(f) {
  const r = f < 0 ? -Math.floor(-f + 0.5) : Math.floor(f + 0.5);
  return r === 0 ? 0 : r;
}

// Direction comes from the displacement over the last ~lambda counts of path (so x-only and
// y-only 1-count packets still resolve a diagonal), doubled so reversals keep the same axis.
// Harmonics fade only while that displacement is under one count, i.e. mid-reversal.
export function step(p, st, dx, dy, dtMs) {
  if (dx === 0 && dy === 0) return [0, 0];
  const a = dtMs > p.reset_ms ? 0 : Math.exp(-Math.hypot(dx, dy) / p.lambda);
  st.vx = a * st.vx + dx;
  st.vy = a * st.vy + dy;
  const m2 = st.vx * st.vx + st.vy * st.vy;
  let x = p.a0;
  if (m2 > 1e-12) {
    const k = Math.min(1, Math.sqrt(m2));
    x += k * harmonicsAt(p, (st.vx * st.vx - st.vy * st.vy) / m2, (2 * st.vx * st.vy) / m2);
  }
  if (x > p.clamp) x = p.clamp;
  else if (x < -p.clamp) x = -p.clamp;
  const g = 1 + x + 0.5 * x * x;
  const fx = g * dx + st.cx;
  const fy = g * dy + st.cy;
  const ox = roundHalfAway(fx);
  const oy = roundHalfAway(fy);
  st.cx = fx - ox;
  st.cy = fy - oy;
  return [ox, oy];
}

export function toConf(p) {
  return PARAM_KEYS.map((k) => `${k} = ${p[k]}`).join("\n") + "\n";
}

export function fromConf(text) {
  const p = defaultProfile();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = /^([a-z0-9_]+)\s*=\s*(\S+)$/.exec(line);
    if (!m || !(m[1] in p)) throw new Error(`bad profile line: ${raw}`);
    const v = Number(m[2]);
    if (!Number.isFinite(v)) throw new Error(`bad number: ${raw}`);
    p[m[1]] = v;
  }
  if (!(p.lambda > 0) || !(p.reset_ms >= 0) || !(p.clamp >= 0)) {
    throw new Error("lambda must be > 0, reset_ms >= 0 and clamp >= 0");
  }
  return p;
}
