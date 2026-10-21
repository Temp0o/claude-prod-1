import { EVEN_KEYS, ODD_KEYS, harmonicsAt } from "../core/dirgain.js";

export const DEFAULTS = {
  smoothSigmaMs: 8,
  onsetFrac: 0.05,
  primaryPeakFrac: 0.5,
  endFrac: 0.1,
  persistenceFrac: 0.2,
  minDurationMs: 60,
  minReactionMs: 100,
  huberC: 1.345,
  ridge: 2,
  gateAlpha: 0.01,
  permutations: 2000,
  seed: 12345,
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
  if (onset < o.minReactionMs) return { ok: false, reason: "anticipation (moved before the target appeared)" };
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

// Basis columns: even harmonics cos/sin(2k theta) for k = 1..K, then optionally the odd first
// harmonic cos/sin(theta). Order matches EVEN_KEYS and ODD_KEYS.
export function harmonicRow(theta, K, odd = false) {
  const row = [];
  for (let k = 1; k <= K; k++) row.push(Math.cos(2 * k * theta), Math.sin(2 * k * theta));
  if (odd) row.push(Math.cos(theta), Math.sin(theta));
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

function groupKeys(rows) {
  return [...new Set(rows.map((r) => String(r.group)))].sort();
}

// rows: [{theta, group, y}] with y = log(rho). Each group (e.g. session x distance) gets its own
// intercept, so shifts in overall gain between groups never leak into the direction terms.
// extra(row) optionally appends interaction columns, which are reported in `extra`.
export function huberFit(rows, K, o = DEFAULTS, { odd = false, extra = null } = {}) {
  const groups = groupKeys(rows);
  const nG = groups.length;
  const X = rows.map((r) => [
    ...groups.map((g) => (g === String(r.group) ? 1 : 0)),
    ...harmonicRow(r.theta, K, odd),
    ...(extra ? extra(r) : []),
  ]);
  const y = rows.map((r) => r.y);
  const p = X[0].length;
  const pen = (i) => (i >= nG ? o.ridge : 0);
  let w = new Array(rows.length).fill(1);
  let b = null;
  let s = 1;
  const normal = () => {
    const A = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (_, j) => (i === j ? pen(i) : 0)));
    const v = new Array(p).fill(0);
    for (let r = 0; r < X.length; r++) {
      const xr = X[r];
      for (let i = 0; i < p; i++) {
        if (xr[i] === 0) continue;
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
  const block = (from, len) => {
    const idx = Array.from({ length: len }, (_, i) => from + i);
    return { coef: idx.map((i) => b[i]), cov: idx.map((i) => idx.map((j) => cov[i][j])) };
  };
  const even = block(nG, 2 * K);
  const oddB = odd ? block(nG + 2 * K, 2) : null;
  const nExtra = p - nG - 2 * K - (odd ? 2 : 0);
  return {
    K,
    groups,
    intercepts: b.slice(0, nG),
    harmonics: even.coef,
    cov: even.cov,
    odd: oddB,
    extra: nExtra ? block(p - nExtra, nExtra) : null,
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

export function selectK(rows, o = DEFAULTS, folds = 5, odd = false) {
  const scale = huberFit(rows, 1, o, { odd }).scale;
  let best = { K: 2, loss: Infinity };
  for (const K of [1, 2, 3]) {
    let loss = 0;
    for (let f = 0; f < folds; f++) {
      const train = rows.filter((_, i) => i % folds !== f);
      const test = rows.filter((_, i) => i % folds === f);
      const fit = huberFit(train, K, o, { odd });
      const mean = fit.intercepts.reduce((a, b) => a + b, 0) / fit.intercepts.length;
      for (const r of test) {
        const gi = fit.groups.indexOf(String(r.group));
        const icpt = gi >= 0 ? fit.intercepts[gi] : mean;
        const coef = [...fit.harmonics, ...(fit.odd ? fit.odd.coef : [])];
        const pred = icpt + harmonicRow(r.theta, K, odd).reduce((acc, v, i) => acc + v * coef[i], 0);
        loss += huberLoss((r.y - pred) / scale, o.huberC);
      }
    }
    if (loss < best.loss - 1e-9) best = { K, loss };
  }
  return best.K;
}

function quadForm(v, M) {
  let s = 0;
  for (let i = 0; i < v.length; i++) for (let j = 0; j < v.length; j++) s += v[i] * M[i][j] * v[j];
  return s;
}

function gate(coef, cov, alpha, priorSd, pOverride) {
  const wald = quadForm(coef, inverse(cov));
  const p = pOverride ?? chiSquareSurvivalEven(wald, coef.length);
  const se = cov.map((r, i) => Math.sqrt(r[i]));
  const shrunk = coef.map((v, i) => (v * priorSd ** 2) / (priorSd ** 2 + se[i] ** 2));
  return { coef, se, wald, p, pass: p < alpha, shrunk };
}

// Acklam's inverse normal CDF (relative error < 1.2e-9).
function invNorm(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -invNorm(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Exact-under-the-null gate: directions are randomized within each group, so with no directional
// effect the outcomes are exchangeable within groups. Outcomes are group-centered and turned into
// rank-based normal scores (robust to outliers and heavy tails); the statistic is the score test
// n R^2 of the selected harmonic columns. Shuffling outcomes within groups gives its null
// distribution.
export function permutationGate(rows, cols, B = 2000, seed = 12345) {
  const n = rows.length;
  const byGroup = new Map();
  rows.forEach((r, i) => {
    const g = String(r.group);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(i);
  });
  const yc = new Float64Array(n);
  for (const idx of byGroup.values()) {
    const m = median(idx.map((i) => rows[i].y));
    for (const i of idx) yc[i] = rows[i].y - m;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => yc[i] - yc[j]);
  const z = new Float64Array(n);
  order.forEach((i, rank) => {
    z[i] = invNorm((rank + 0.5) / n);
  });
  const X = rows.map((r) => cols(r));
  const p = X[0].length;
  for (const idx of byGroup.values()) {
    const zm = idx.reduce((a, i) => a + z[i], 0) / idx.length;
    for (const i of idx) z[i] -= zm;
    for (let j = 0; j < p; j++) {
      const xm = idx.reduce((a, i) => a + X[i][j], 0) / idx.length;
      for (const i of idx) X[i][j] -= xm;
    }
  }
  const XtX = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => X.reduce((acc, row) => acc + row[a] * row[b], 0)));
  const M = inverse(XtX);
  const zz = z.reduce((a, v) => a + v * v, 0);
  const stat = (zv) => {
    const v = new Array(p).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) v[j] += X[i][j] * zv[i];
    return (n * quadForm(v, M)) / zz;
  };
  const observed = stat(z);
  const r = mulberry32(seed);
  const perm = Float64Array.from(z);
  let exceed = 0;
  for (let k = 0; k < B; k++) {
    for (const idx of byGroup.values()) {
      for (let a = idx.length - 1; a > 0; a--) {
        const b = Math.floor(r() * (a + 1));
        const t = perm[idx[a]];
        perm[idx[a]] = perm[idx[b]];
        perm[idx[b]] = t;
      }
    }
    if (stat(perm) >= observed) exceed++;
  }
  return { stat: observed, p: (exceed + 1) / (B + 1) };
}

function toRows(trials) {
  return trials
    .filter((t) => t.rho > 0)
    .map((t) => ({ theta: t.theta, group: t.group ?? t.amp, amp: t.amp, y: Math.log(t.rho) }));
}

// trials: [{theta, group?, amp, rho}] from segmentTrial, collected with the current profile active.
// Two separate gates (even shape, left/right-up/down asymmetry) split the overall alpha.
export function analyze(trials, opts = {}) {
  const o = { ...DEFAULTS, odd: true, ...opts };
  const rows = toRows(trials);
  if (rows.length < 30) return { ok: false, reason: `need at least 30 usable trials, have ${rows.length}` };
  const K = o.K ?? selectK(rows, o, 5, o.odd);
  const fit = huberFit(rows, K, o, { odd: o.odd });
  const alpha = o.odd ? o.gateAlpha / 2 : o.gateAlpha;
  // Gates test a fixed shape family (K = 2 even; first odd harmonic) so model selection on the
  // same data cannot inflate them.
  const pEven = permutationGate(rows, (r) => harmonicRow(r.theta, 2), o.permutations, o.seed).p;
  const pOdd = o.odd ? permutationGate(rows, (r) => [Math.cos(r.theta), Math.sin(r.theta)], o.permutations, o.seed + 1).p : 1;
  const even = gate(fit.harmonics, fit.cov, alpha, o.priorSd, pEven);
  const odd = o.odd ? gate(fit.odd.coef, fit.odd.cov, alpha, o.priorSd, pOdd) : null;
  const shape = (th) =>
    harmonicRow(th, K, !!odd).reduce((a, v, i) => a + v * [...even.coef, ...(odd ? odd.coef : [])][i], 0);
  return {
    ok: true,
    K,
    n: fit.n,
    even,
    odd,
    pass: even.pass || !!odd?.pass,
    p: Math.min(even.p, odd ? odd.p : 1),
    coef: even.coef,
    shrunk: even.shrunk,
    scale: fit.scale,
    residualRms: rmsOverAngles(shape, 720, 2 * Math.PI),
    consistency: distanceConsistency(rows, K, o),
  };
}

// Does the even directional pattern differ between flick distances? Tests harmonics x distance
// interaction terms; a low p means a single static profile is a compromise across distances.
export function distanceConsistency(rows, K, o = DEFAULTS) {
  const amps = [...new Set(rows.map((r) => r.amp))].filter((a) => a !== undefined).sort((a, b) => a - b);
  if (amps.length < 2) return null;
  const extra = (r) =>
    amps.slice(1).flatMap((a) => harmonicRow(r.theta, K).map((v) => (r.amp === a ? v : 0)));
  const fit = huberFit(rows, K, o, { extra });
  const g = gate(fit.extra.coef, fit.extra.cov, o.gateAlpha, o.priorSd);
  // Parametric and somewhat liberal on segmented data (about 7% flags on simulated consistent
  // users at 0.01), so it uses a stricter cut and is shown as a diagnostic only.
  return { p: g.p, consistent: g.p >= 0.001 };
}

export function rmsOverAngles(f, n = 360, span = Math.PI) {
  let mean = 0;
  const vals = [];
  for (let i = 0; i < n; i++) {
    const v = f((i * span) / n);
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

// Closed-loop update: next = current - eta * shrunk residual for each block that passed its
// gate; then re-anchored and kept inside the clamp. The anchor is the axis average, so an
// asymmetric profile still keeps the anchor axis's mean gain at 1.
export function updateProfile(profile, result, opts = {}) {
  const o = { ...DEFAULTS, anchor: "horizontal", allowOdd: true, ...opts };
  const next = { ...profile };
  if (!result.ok || !result.pass) return { profile: next, changed: false };
  const even = result.even ?? { pass: result.pass, shrunk: result.shrunk };
  let changed = false;
  if (even.pass) {
    even.shrunk.forEach((v, i) => {
      next[EVEN_KEYS[i]] -= o.eta * v;
    });
    changed = true;
  }
  if (o.allowOdd && result.odd?.pass) {
    result.odd.shrunk.forEach((v, i) => {
      next[ODD_KEYS[i]] -= o.eta * v;
    });
    changed = true;
  }
  if (!changed) return { profile: next, changed: false };
  const harm = (th) => harmonicsAt(next, Math.cos(th), Math.sin(th));
  const anchorAt = anchorTheta(o.anchor);
  const setA0 = () => {
    next.a0 = anchorAt === null ? 0 : -0.5 * (harm(anchorAt) + harm(anchorAt + Math.PI));
  };
  setA0();
  let maxAbs = 0;
  for (let i = 0; i < 720; i++) maxAbs = Math.max(maxAbs, Math.abs(next.a0 + harm((i * Math.PI) / 360)));
  if (maxAbs > next.clamp) {
    const f = next.clamp / maxAbs;
    for (const k of [...EVEN_KEYS, ...ODD_KEYS]) next[k] *= f;
    setA0();
  }
  return { profile: next, changed: true };
}

// Best Raw Accel approximation of a profile. Raw Accel scales output components:
// x by S (times L/R ratio when moving left), y by S * Y/X (times U/D ratio when moving up).
export function rawAccelFit(profile, n = 360) {
  const th = Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n);
  const target = th.map((t) => Math.max(-profile.clamp, Math.min(profile.clamp, profile.a0 + harmonicsAt(profile, Math.cos(t), Math.sin(t)))));
  const model = ([s, r, l, u], t) => {
    const cx = Math.cos(t) * (Math.cos(t) < 0 ? Math.exp(l) : 1);
    const cy = Math.sin(t) * Math.exp(r) * (Math.sin(t) < 0 ? Math.exp(u) : 1);
    return s + 0.5 * Math.log(cx * cx + cy * cy);
  };
  let q = [target[0], target[n / 4] - target[0], target[n / 2] - target[0], target[(3 * n) / 4] - target[n / 4]];
  for (let it = 0; it < 30; it++) {
    const res = th.map((t, i) => target[i] - model(q, t));
    const J = th.map((t) =>
      q.map((_, j) => {
        const d = q.slice();
        d[j] += 1e-6;
        return (model(d, t) - model(q, t)) / 1e-6;
      }),
    );
    const JtJ = q.map((_, a) => q.map((_, b) => J.reduce((acc, row) => acc + row[a] * row[b], 0) + (a === b ? 1e-9 : 0)));
    const Jtr = q.map((_, a) => J.reduce((acc, row, i) => acc + row[a] * res[i], 0));
    const step = solve(JtJ, Jtr);
    q = q.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-10) break;
  }
  const fitted = th.map((t) => model(q, t));
  const mean = target.reduce((a, v) => a + v, 0) / n;
  const sst = target.reduce((a, v) => a + (v - mean) ** 2, 0);
  const sse = target.reduce((a, v, i) => a + (v - fitted[i]) ** 2, 0);
  let maxDev = 0;
  for (const t of th) {
    const ox = Math.cos(t) * (Math.cos(t) < 0 ? Math.exp(q[2]) : 1);
    const oy = Math.sin(t) * Math.exp(q[1]) * (Math.sin(t) < 0 ? Math.exp(q[3]) : 1);
    let d = Math.abs(Math.atan2(oy, ox) - t);
    if (d > Math.PI) d = 2 * Math.PI - d;
    maxDev = Math.max(maxDev, d);
  }
  return {
    sens: Math.exp(q[0]),
    yx: Math.exp(q[1]),
    lr: Math.exp(q[2]),
    ud: Math.exp(q[3]),
    captured: sst > 1e-12 ? Math.max(0, 1 - sse / sst) : 1,
    rmsErrorPct: 100 * Math.sqrt(sse / n),
    maxDirectionErrorDeg: (maxDev * 180) / Math.PI,
  };
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
