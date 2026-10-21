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

function quantize(fx, fy, events, dt, carry) {
  const x = fx + carry.x;
  const y = fy + carry.y;
  const ix = Math.trunc(x) || 0;
  const iy = Math.trunc(y) || 0;
  carry.x = x - ix;
  carry.y = y - iy;
  if (ix !== 0 || iy !== 0) events.push([ix, iy, dt]);
}

export function flick(angleDeg, distanceCounts, durationMs, dtMs) {
  const th = (angleDeg * Math.PI) / 180;
  const events = [];
  const carry = { x: 0, y: 0 };
  const steps = Math.round(durationMs / dtMs);
  let prev = 0;
  for (let i = 1; i <= steps; i++) {
    const s = i / steps;
    const pos = distanceCounts * (10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5);
    const d = pos - prev;
    prev = pos;
    quantize(d * Math.cos(th), d * Math.sin(th), events, dtMs, carry);
  }
  return events;
}

export function circle(radiusCounts, periodMs, turns, dtMs) {
  const events = [];
  const carry = { x: 0, y: 0 };
  const steps = Math.round((periodMs * turns) / dtMs);
  for (let i = 1; i <= steps; i++) {
    const t0 = ((i - 1) * dtMs * 2 * Math.PI) / periodMs;
    const t1 = (i * dtMs * 2 * Math.PI) / periodMs;
    quantize(
      radiusCounts * (Math.cos(t1) - Math.cos(t0)),
      radiusCounts * (Math.sin(t1) - Math.sin(t0)),
      events,
      dtMs,
      carry,
    );
  }
  return events;
}

export function jitter(n, seed) {
  const r = mulberry32(seed);
  const events = [];
  for (let i = 0; i < n; i++) {
    const dx = Math.floor(r() * 7) - 3;
    const dy = Math.floor(r() * 7) - 3;
    if (dx || dy) events.push([dx, dy, 1]);
  }
  return events;
}

export function slowLine(angleDeg, totalCounts, dtMs) {
  return flick(angleDeg, totalCounts, totalCounts * 40, dtMs);
}

export function mixedDt(n, seed) {
  const r = mulberry32(seed);
  const dts = [0, 0.125, 1, 2, 8, 50];
  const events = [];
  for (let i = 0; i < n; i++) {
    const dx = Math.floor(r() * 41) - 20;
    const dy = Math.floor(r() * 41) - 20;
    if (dx || dy) events.push([dx, dy, dts[Math.floor(r() * dts.length)]]);
  }
  return events;
}

export const PROFILES = {
  identity: { a0: 0, a1: 0, b1: 0, a2: 0, b2: 0, a3: 0, b3: 0, lambda: 8, reset_ms: 100, clamp: 0.15 },
  typical: { a0: 0.01, a1: -0.05, b1: 0.03, a2: 0.02, b2: -0.015, a3: 0.005, b3: 0, lambda: 8, reset_ms: 100, clamp: 0.15 },
  clamped: { a0: 0, a1: 0.4, b1: -0.3, a2: 0, b2: 0, a3: 0, b3: 0, lambda: 3, reset_ms: 20, clamp: 0.15 },
};

export function allStreams() {
  return {
    flickH: flick(0, 1200, 180, 1),
    flickV: flick(90, 900, 160, 1),
    flickDiag: flick(225, 1500, 200, 0.125 * 8),
    flick8k: flick(30, 800, 150, 0.125),
    circle: circle(400, 600, 2, 1),
    jitter: jitter(400, 11),
    slow: slowLine(30, 60, 8),
    mixed: mixedDt(300, 5),
  };
}
