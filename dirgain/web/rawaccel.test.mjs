import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, defaultProfile } from "../core/dirgain.js";
import { rawAccelFit } from "./analysis.js";
import { applyStep, rawAccelMeanLogGain, rawAccelProfile, rawAccelStep } from "./rawaccel.js";

const run = (p, events) => {
  const st = createState();
  return events.map(([dx, dy]) => rawAccelStep(p, st, dx, dy));
};
const sum = (rows, i) => rows.reduce((a, r) => a + r[i], 0);

test("Raw Accel stand-in applies Y/X, L/R and U/D like the driver", () => {
  const p = { kind: "rawaccel", sens: 1, yx: 0.9, lr: 1.1, ud: 0.8 };
  const right = run(p, Array(100).fill([10, 0]));
  const left = run(p, Array(100).fill([-10, 0]));
  const down = run(p, Array(100).fill([0, 10]));
  const up = run(p, Array(100).fill([0, -10]));
  assert.equal(sum(right, 0), 1000);
  assert.equal(sum(left, 0), -1100);
  assert.equal(sum(down, 1), 900);
  assert.equal(sum(up, 1), -720);
});

test("truncation carries the remainder instead of dropping it", () => {
  const p = { kind: "rawaccel", sens: 0.55, yx: 1, lr: 1, ud: 1 };
  const out = run(p, Array(200).fill([1, 0]));
  assert.ok(Math.abs(sum(out, 0) - 110) <= 1);
});

test("applyStep dispatches between DirGain and Raw Accel profiles", () => {
  const st = createState();
  assert.deepEqual(applyStep(defaultProfile(), st, 5, -3, 1), [5, -3]);
  assert.deepEqual(applyStep({ kind: "rawaccel", sens: 2, yx: 1, lr: 1, ud: 1 }, createState(), 5, -3, 1), [10, -6]);
});

test("mean log gain of a flat Raw Accel profile is log(sens)", () => {
  assert.ok(Math.abs(rawAccelMeanLogGain({ kind: "rawaccel", sens: 1.2, yx: 1, lr: 1, ud: 1 }) - Math.log(1.2)) < 1e-12);
});

test("fitted Raw Accel profile reproduces an axis-ratio DirGain profile closely", () => {
  const p = rawAccelProfile(rawAccelFit({ ...defaultProfile(), a1: 0.05 }));
  const h = sum(run(p, Array(400).fill([10, 0])), 0) / 4000;
  const v = sum(run(p, Array(400).fill([0, 10])), 1) / 4000;
  assert.ok(Math.abs(Math.log(h / v) - 0.1) < 0.01, `h ${h} v ${v}`);
});
