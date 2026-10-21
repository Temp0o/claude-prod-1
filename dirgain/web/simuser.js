import { createState, step } from "../core/dirgain.js";
import { harmonicRow, mulberry32 } from "./analysis.js";

function gauss(r) {
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// Synthetic user for testing the pipeline: plans with a flat internal gain that adapts to the
// overall (direction-averaged) extent error, and executes with a persistent direction-dependent
// bias exp(biasCoef . harmonics(theta)) plus lognormal noise.
export function createSimUser({
  seed = 1,
  biasCoef = [0.04, -0.03, 0.025, 0.02],
  oddCoef = [0, 0],
  noiseSd = 0.12,
  angleSdDeg = 3,
  adaptRate = 0.1,
} = {}) {
  return { r: mulberry32(seed), biasCoef, oddCoef, noiseSd, angleSd: (angleSdDeg * Math.PI) / 180, adaptRate, logH: 0 };
}

export function trueLogBias(user, theta) {
  const h = harmonicRow(theta, user.biasCoef.length / 2);
  const even = h.reduce((a, v, i) => a + v * user.biasCoef[i], 0);
  return even + user.oddCoef[0] * Math.cos(theta) + user.oddCoef[1] * Math.sin(theta);
}

function submovement(user, errX, errY, sens, primary) {
  const r = user.r;
  const dist = Math.hypot(errX, errY);
  const theta = Math.atan2(errY, errX);
  const noise = primary ? user.noiseSd : 2 * user.noiseSd;
  const extent = (dist / sens) * Math.exp(trueLogBias(user, theta) - user.logH + noise * gauss(r));
  const ang = theta + user.angleSd * gauss(r) * (primary ? 1 : 2);
  const durMs = Math.round(110 + 35 * Math.log2(1 + extent / 40));
  const events = [];
  let prev = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 1; i <= durMs; i++) {
    const s = i / durMs;
    const pos = extent * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5);
    const d = pos - prev;
    prev = pos;
    const fx = d * Math.cos(ang) + cx;
    const fy = d * Math.sin(ang) + cy;
    const ix = Math.trunc(fx) || 0;
    const iy = Math.trunc(fy) || 0;
    cx = fx - ix;
    cy = fy - iy;
    events.push([ix, iy]);
  }
  return events;
}

// Runs one flick trial through the real transform. Returns cursor samples from target onset.
export function runSimTrial(user, target, { sens, radius, profile, maxSubmovements = 6 }) {
  const r = user.r;
  const st = createState();
  let t = 0;
  let x = 0;
  let y = 0;
  let lastT = 0;
  const samples = [{ t: 0, x: 0, y: 0 }];
  const raw = [];
  t += 180 + 30 * gauss(r);
  for (let k = 0; k < maxSubmovements; k++) {
    const ex = target.x - x;
    const ey = target.y - y;
    if (Math.hypot(ex, ey) <= radius) break;
    for (const [dx, dy] of submovement(user, ex, ey, sens, k === 0)) {
      t += 1;
      if (dx === 0 && dy === 0) continue;
      const [ox, oy] = step(profile, st, dx, dy, t - lastT);
      lastT = t;
      x += ox * sens;
      y += oy * sens;
      raw.push({ t, dx, dy });
      samples.push({ t, x, y });
    }
    if (k === 0) {
      const D = Math.hypot(target.x, target.y);
      const along = (x * target.x + y * target.y) / (D * D);
      user.logH += user.adaptRate * Math.log(Math.max(along, 0.2));
    }
    t += 120 + 30 * Math.abs(gauss(r));
  }
  const hit = Math.hypot(target.x - x, target.y - y) <= radius;
  t += 80;
  samples.push({ t, x, y });
  return { samples, raw, timeToHit: t, hit };
}
