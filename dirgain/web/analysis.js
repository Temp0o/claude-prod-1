import { COEF_KEYS, harmonicsAt } from "../core/dirgain.js";

export const HARMONIC_KEYS = COEF_KEYS.slice(1);

export const DEFAULTS = {
  smoothSigmaMs: 8,
  onsetFrac: 0.05,
  primaryPeakFrac: 0.5,
  endFrac: 0.1,
  persistenceFrac: 0.2,
  minDurationMs: 60,
  huberC: 1.345,
  ridge: 2,
  gateAlpha: 0.01,
  priorSd: 0.03,
  eta: 0.5,
};

// samples: [{t, x, y}] cursor positions (px) from target onset, first sample at the start position.
export function segmentTrial(samples, target, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const D = Math.hypot(target.x, target.y);
  if (samples.length < 3 || !(D > 0)) return { ok: false, reason: "too few samples" };
  const t0 = samples[0].t;
  const tEnd = samples[samples.length - 1].t;
  const n = Math.floor(tEnd - t0) + 1;
  if (n < 20) return { ok: false, reason: "too short" };
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i;
    while (j < samples.length - 2 && samples[j + 1].t <= t) j++;
    const a = samples[j];
    const b = samples[j + 1];
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
    px[i] = a.x + f * (b.x - a.x);
    py[i] = a.y + f * (b.y - a.y);
  }
  const raw = new Float64Array(n);
  for (let i = 1; i < n; i++) raw[i] = Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
  const speed = gaussianSmooth(raw, o.smoothSigmaMs);

  let globalPeak = 0;
  for (let i = 0; i < n; i++) if (speed[i] > globalPeak) globalPeak = speed[i];
  if (!(globalPeak > 0)) return { ok: false, reason: "no movement" };
  let peak = -1;
  for (let i = 1; i < n - 1; i++) {
    if (speed[i] >= o.primaryPeakFrac * globalPeak && speed[i] >= speed[i - 1] && speed[i] >= speed[i + 1]) {
      peak = i;
      break;
    }
  }
  if (peak < 0) return { ok: false, reason: "no primary peak" };
  const ps = speed[peak];
  let onset = peak;
  while (onset > 0 && speed[onset - 1] >= o.onsetFrac * ps) onset--;
  let end = n - 1;
  let minV = ps;
  let minI = peak;
  for (let i = peak + 1; i < n; i++) {
    if (speed[i] < o.endFrac * ps) {
      end = i;
      break;
    }
    if (speed[i] < minV) {
      minV = speed[i];
      minI = i;
    }
    if (speed[i] > minV + o.persistenceFrac * ps) {
      end = minI;
      break;
    }
  }
  if (end - onset < o.minDurationMs) return { ok: false, reason: "first submovement too short" };

  const ux = target.x / D;
  const uy = target.y / D;
  const along = (i) => (px[i] - px[onset]) * ux + (py[i] - py[onset]) * uy;
  const across = (i) => -(px[i] - px[onset]) * uy + (py[i] - py[onset]) * ux;
  const rho = along(end) / D;
  const lateral = across(end) / D;
  const angErr = Math.atan2(across(end), along(end));
  if (!(rho > 0.2 && rho < 3)) return { ok: false, reason: `implausible extent ${rho.toFixed(2)}` };
  if (Math.abs(angErr) > Math.PI / 4) return { ok: false, reason: "wrong direction" };
  const mirror = Math.min(n - 1, onset + 2 * (peak - onset));
  return {
    ok: true,
    rho,
    rhoMirror: along(mirror) / D,
    lateral,
    onsetMs: onset,
    peakMs: peak,
    endMs: end,
    peakSpeed: ps,
  };
}

export function gaussianSmooth(x, sigma) {
  const r = Math.ceil(3 * sigma);
  const k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp((-0.5 * i * i) / (sigma * sigma)));
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let acc = 0;
    let wsum = 0;
    for (let d = -r; d <= r; d++) {
      const j = i + d;
      if (j < 0 || j >= x.length) continue;
      acc += k[d + r] * x[j];
      wsum += k[d + r];
    }
    out[i] = acc / wsum;
  }
  return out;
}

export function harmonicRow(theta, K) {
  const row = [];
  for (let k = 1; k <= K; k++) row.push(Math.cos(2 * k * theta), Math.sin(2 * k * theta));
  return row;
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-14) throw new Error("singular system");
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

function inverse(A) {
  const n = A.length;
  const cols = [];
  for (let i = 0; i < n; i++) {
    const e = new Array(n).fill(0);
    e[i] = 1;
    cols.push(solve(A, e));
  }
  return A.map((_, i) => cols.map((c) => c[i]));
}

function median(v) {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

// rows: [{theta, amp, y}] with y = log(rho); amp is an integer group index
export function huberFit(rows, K, o = DEFAULTS) {
  const amps = [...new Set(rows.map((r) => r.amp))].sort((a, b) => a - b);
  const nA = amps.length;
  const X = rows.map((r) => [...amps.map((a) => (a === r.amp ? 1 : 0)), ...harmonicRow(r.theta, K)]);
  const y = rows.map((r) => r.y);
  const p = nA + 2 * K;
  const pen = (i) => (i >= nA ? o.ridge : 0);
  let w = new Array(rows.length).fill(1);
  let b = null;
  let s = 1;
  const normal = () => {
    const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? pen(i) : 0)));
    const v = new Array(p).fill(0);
    for (let r = 0; r < X.length; r++) {
      const xr = X[r];
      for (let i = 0; i < p; i++) {
        v[i] += w[r] * xr[i] * y[r];
        for (let j = 0; j < p; j++) A[i][j] += w[r] * xr[i] * xr[j];
      }
    }
    return [A, v];
  };
  for (let it = 0; it < 15; it++) {
    const [A, v] = normal();
    b = solve(A, v);
    const res = y.map((yy, r) => yy - X[r].reduce((acc, xi, i) => acc + xi * b[i], 0));
    const med = median(res);
    s = Math.max(1.4826 * median(res.map((e) => Math.abs(e - med))), 1e-6);
    w = res.map((e) => {
      const u = Math.abs(e) / (o.huberC * s);
      return u <= 1 ? 1 : 1 / u;
    });
  }
  const [A] = normal();
  const cov = inverse(A).map((row) => row.map((v) => v * s * s));
  const hIdx = Array.from({ length: 2 * K }, (_, i) => nA + i);
  return {
    K,
    amps,
    intercepts: b.slice(0, nA),
    harmonics: hIdx.map((i) => b[i]),
    cov: hIdx.map((i) => hIdx.map((j) => cov[i][j])),
    scale: s,
    n: rows.length,
  };
}

export function chiSquareSurvivalEven(x, df) {
  const h = x / 2;
  let term = 1;
  let sum = 1;
  for (let j = 1; j < df / 2; j++) {
    term *= h / j;
    sum += term;
  }
  return Math.exp(-h) * sum;
}

function huberLoss(e, c) {
  const a = Math.abs(e);
  return a <= c ? 0.5 * e * e : c * (a - 0.5 * c);
}

export function selectK(rows, o = DEFAULTS, folds = 5) {
  const scale = huberFit(rows, 1, o).scale;
  let best = { K: 2, loss: Infinity };
  for (const K of [1, 2, 3]) {
    let loss = 0;
    for (let f = 0; f < folds; f++) {
      const train = rows.filter((_, i) => i % folds !== f);
      const test = rows.filter((_, i) => i % folds === f);
      const fit = huberFit(train, K, o);
      for (const r of test) {
        const ai = fit.amps.indexOf(r.amp);
        const icpt = ai >= 0 ? fit.intercepts[ai] : fit.intercepts.reduce((a, b) => a + b, 0) / fit.intercepts.length;
        const pred = icpt + harmonicRow(r.theta, K).reduce((acc, v, i) => acc + v * fit.harmonics[i], 0);
        loss += huberLoss((r.y - pred) / scale, o.huberC);
      }
    }
    if (loss < best.loss - 1e-9) best = { K, loss };
  }
  return best.K;
}

// trials: [{theta, amp, rho}] from segmentTrial on data collected with the current profile active
export function analyze(trials, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rows = trials.filter((t) => t.rho > 0).map((t) => ({ theta: t.theta, amp: t.amp, y: Math.log(t.rho) }));
  if (rows.length < 30) return { ok: false, reason: `need at least 30 usable trials, have ${rows.length}` };
  const K = o.K ?? selectK(rows, o);
  const fit = huberFit(rows, K, o);
  const c = fit.harmonics;
  const chi = quadForm(c, inverse(fit.cov));
  const p = chiSquareSurvivalEven(chi, 2 * K);
  const se = fit.cov.map((r, i) => Math.sqrt(r[i]));
  const shrunk = c.map((v, i) => (v * o.priorSd ** 2) / (o.priorSd ** 2 + se[i] ** 2));
  const residualRms = rmsOverAngles((th) => harmonicRow(th, K).reduce((a, v, i) => a + v * c[i], 0));
  return { ok: true, K, n: fit.n, coef: c, se, shrunk, wald: chi, p, pass: p < o.gateAlpha, scale: fit.scale, residualRms };
}

function quadForm(v, M) {
  let s = 0;
  for (let i = 0; i < v.length; i++) for (let j = 0; j < v.length; j++) s += v[i] * M[i][j] * v[j];
  return s;
}

export function rmsOverAngles(f, n = 360) {
  let mean = 0;
  const vals = [];
  for (let i = 0; i < n; i++) {
    const v = f((i * Math.PI) / n);
    vals.push(v);
    mean += v / n;
  }
  return Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
}

export function anchorTheta(anchor) {
  if (anchor === "horizontal") return 0;
  if (anchor === "vertical") return Math.PI / 2;
  if (typeof anchor === "number") return anchor;
  return null;
}

// Closed-loop update: next = current - eta * shrunk residual; re-anchored and kept inside the clamp.
export function updateProfile(profile, result, opts = {}) {
  const o = { ...DEFAULTS, anchor: "horizontal", ...opts };
  const next = { ...profile };
  if (!result.ok || !result.pass) return { profile: next, changed: false };
  result.shrunk.forEach((v, i) => {
    next[HARMONIC_KEYS[i]] -= o.eta * v;
  });
  const harm = (th) => harmonicsAt(next, Math.cos(2 * th), Math.sin(2 * th));
  const anchorAt = anchorTheta(o.anchor);
  const setA0 = () => {
    next.a0 = anchorAt === null ? 0 : -harm(anchorAt);
  };
  setA0();
  let maxAbs = 0;
  for (let i = 0; i < 360; i++) maxAbs = Math.max(maxAbs, Math.abs(next.a0 + harm((i * Math.PI) / 360)));
  if (maxAbs > next.clamp) {
    const f = next.clamp / maxAbs;
    for (const k of HARMONIC_KEYS) next[k] *= f;
    setA0();
  }
  return { profile: next, changed: true };
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Difference of means (b - a) with a percentile bootstrap CI.
export function bootstrapDiff(a, b, iters = 2000, seed = 1) {
  if (a.length < 2 || b.length < 2) return null;
  const r = mulberry32(seed);
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const pick = (v) => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[Math.floor(r() * v.length)];
    return s / v.length;
  };
  const diffs = [];
  for (let i = 0; i < iters; i++) diffs.push(pick(b) - pick(a));
  diffs.sort((x, y) => x - y);
  return {
    diff: mean(b) - mean(a),
    lo: diffs[Math.floor(0.025 * iters)],
    hi: diffs[Math.floor(0.975 * iters)],
  };
}
