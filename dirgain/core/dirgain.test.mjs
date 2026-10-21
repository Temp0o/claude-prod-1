import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, step, logGainAtAngle, defaultProfile, toConf, fromConf } from "./dirgain.js";
import { PROFILES, allStreams, flick, slowLine } from "./streams.mjs";

function run(p, events) {
  const st = createState();
  return events.map(([dx, dy, dt]) => step(p, st, dx, dy, dt));
}

const sum = (rows, i) => rows.reduce((s, r) => s + r[i], 0);
const expApprox = (x) => 1 + x + 0.5 * x * x;

test("identity profile passes every stream through unchanged", () => {
  for (const [name, events] of Object.entries(allStreams())) {
    const out = run(PROFILES.identity, events);
    assert.deepEqual(out, events.map(([dx, dy]) => [dx, dy]), name);
  }
});

test("negated input gives exactly negated output for symmetric profiles", () => {
  for (const p of Object.values(PROFILES).filter((q) => q.o1c === 0 && q.o1s === 0)) {
    for (const events of Object.values(allStreams())) {
      const a = run(p, events);
      const b = run(p, events.map(([dx, dy, dt]) => [-dx, -dy, dt]));
      assert.deepEqual(b, a.map(([x, y]) => [-x || 0, -y || 0]));
    }
  }
});

test("odd harmonics give different gains for opposite directions", () => {
  const p = { ...defaultProfile(), o1c: 0.05, o1s: -0.04 };
  const r = flick(0, 5000, 200, 1);
  const l = flick(180, 5000, 200, 1);
  const d = flick(90, 5000, 200, 1);
  const u = flick(270, 5000, 200, 1);
  const g = (ev, i) => sum(run(p, ev), i) / sum(ev, i);
  assert.ok(Math.abs(g(r, 0) - expApprox(0.05)) < 1e-3, "right");
  assert.ok(Math.abs(g(l, 0) - expApprox(-0.05)) < 1e-3, "left");
  assert.ok(Math.abs(g(d, 1) - expApprox(-0.04)) < 1e-3, "down");
  assert.ok(Math.abs(g(u, 1) - expApprox(0.04)) < 1e-3, "up");
});

test("even part of the gain is pi-periodic", () => {
  const p = PROFILES.typical;
  assert.equal(p.o1c, 0);
  for (let d = 0; d < 360; d += 7) {
    const t = (d * Math.PI) / 180;
    assert.ok(Math.abs(logGainAtAngle(p, t) - logGainAtAngle(p, t + Math.PI)) < 1e-12);
  }
});

test("horizontal and vertical flicks get exp(+a1) and exp(-a1)", () => {
  const p = { ...defaultProfile(), a1: 0.1 };
  const h = flick(0, 5000, 200, 1);
  const v = flick(90, 5000, 200, 1);
  const gh = sum(run(p, h), 0) / sum(h, 0);
  const gv = sum(run(p, v), 1) / sum(v, 1);
  assert.ok(Math.abs(gh - expApprox(0.1)) < 1e-3, `gh=${gh}`);
  assert.ok(Math.abs(gv - expApprox(-0.1)) < 1e-3, `gv=${gv}`);
});

test("clamp bounds the applied gain", () => {
  const p = PROFILES.clamped;
  const maxG = expApprox(p.clamp);
  const minG = expApprox(-p.clamp);
  for (const angle of [0, 20, 45, 90, 135, 160]) {
    const ev = flick(angle, 6000, 200, 1);
    const inMag = Math.hypot(sum(ev, 0), sum(ev, 1));
    const out = run(p, ev);
    const g = Math.hypot(sum(out, 0), sum(out, 1)) / inMag;
    assert.ok(g <= maxG + 1e-3 && g >= minG - 1e-3, `angle ${angle}: g=${g}`);
  }
});

test("slow 1-count motion is scaled, not swallowed", () => {
  const p = { ...defaultProfile(), a0: -0.12 };
  const ev = slowLine(30, 400, 8);
  assert.ok(ev.every(([dx, dy]) => Math.abs(dx) <= 1 && Math.abs(dy) <= 1));
  const out = run(p, ev);
  const want = expApprox(-0.12) * Math.hypot(sum(ev, 0), sum(ev, 1));
  const got = Math.hypot(sum(out, 0), sum(out, 1));
  assert.ok(Math.abs(got - want) <= 1.5, `got ${got}, want ${want}`);
});

test("zero motion emits nothing and keeps state", () => {
  const st = createState();
  assert.deepEqual(step(PROFILES.typical, st, 0, 0, 1), [0, 0]);
  assert.deepEqual(st, createState());
});

test("conf round-trips and rejects junk", () => {
  const p = PROFILES.typical;
  assert.deepEqual(fromConf(toConf(p)), p);
  assert.throws(() => fromConf("A0 = 1"));
  assert.throws(() => fromConf("a1 = nope"));
  assert.throws(() => fromConf("lambda = 0"));
});

test("slow 1-count packets resolve the true direction", () => {
  const p = { ...defaultProfile(), a1: 0.1 };
  for (const angle of [30, 60]) {
    const ev = slowLine(angle, 600, 8);
    const out = run(p, ev);
    const g = Math.hypot(sum(out, 0), sum(out, 1)) / Math.hypot(sum(ev, 0), sum(ev, 1));
    const want = expApprox(0.1 * Math.cos((2 * angle * Math.PI) / 180));
    assert.ok(Math.abs(g - want) < 0.005, `angle ${angle}: g=${g} want=${want}`);
  }
});

test("idle gap resets the direction estimate", () => {
  const p = { ...defaultProfile(), a1: 0.1 };
  const st = createState();
  for (let i = 0; i < 50; i++) step(p, st, 5, 0, 1);
  step(p, st, 0, 5, 500);
  assert.equal(st.vx, 0);
  assert.equal(st.vy, 5);
});

test("a reversal along one axis keeps that axis's gain", () => {
  const p = { ...defaultProfile(), a1: 0.1 };
  const st = createState();
  let outX = 0;
  let inX = 0;
  for (const d of [3, 3, 3, 3, 3, 3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3, -3]) {
    const [ox] = step(p, st, d, 0, 1);
    outX += Math.abs(ox);
    inX += Math.abs(d);
  }
  assert.ok(Math.abs(outX / inX - expApprox(0.1)) < 0.03, `ratio ${outX / inX}`);
});
