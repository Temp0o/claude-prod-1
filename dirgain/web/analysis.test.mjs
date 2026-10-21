import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultProfile, logGainAtAngle } from "../core/dirgain.js";
import {
  analyze,
  bootstrapDiff,
  chiSquareSurvivalEven,
  huberFit,
  segmentTrial,
  updateProfile,
} from "./analysis.js";
import { makeBlock, targetFor } from "./protocol.js";
import { createSimUser, runSimTrial } from "./simuser.js";

const fixture = JSON.parse(readFileSync(new URL("./test/fit-fixture.json", import.meta.url)));

test("Huber-ridge fit matches the Python reference estimator", () => {
  const rows = fixture.theta.map((theta, i) => ({ theta, amp: 0, y: fixture.y[i] }));
  const fit = huberFit(rows, 2);
  fit.harmonics.forEach((v, i) => assert.ok(Math.abs(v - fixture.coef[i]) < 1e-9, `coef ${i}`));
  fit.cov.forEach((row, i) =>
    row.forEach((v, j) => assert.ok(Math.abs(v - fixture.cov[i][j]) < 1e-9 * Math.max(1, Math.abs(v)), `cov ${i},${j}`)),
  );
  assert.ok(Math.abs(fit.scale - fixture.scale) < 1e-12);
});

test("chi-square survival for even df", () => {
  assert.ok(Math.abs(chiSquareSurvivalEven(3, 2) - Math.exp(-1.5)) < 1e-12);
  assert.ok(Math.abs(chiSquareSurvivalEven(5, 4) - Math.exp(-2.5) * (1 + 2.5)) < 1e-12);
  assert.ok(Math.abs(chiSquareSurvivalEven(13.28, 4) - 0.01) < 1e-3);
});

function minJerk(x0, y0, dx, dy, t0, dur) {
  const out = [];
  for (let i = 1; i <= dur; i++) {
    const s = i / dur;
    const f = 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5;
    out.push({ t: t0 + i, x: x0 + f * dx, y: y0 + f * dy });
  }
  return out;
}

test("segmentation measures a clean single submovement", () => {
  const target = { x: 300, y: -100 };
  const D = Math.hypot(target.x, target.y);
  const s = [{ t: 0, x: 0, y: 0 }, ...minJerk(0, 0, 0.9 * target.x, 0.9 * target.y, 200, 180)];
  s.push({ t: 600, x: s.at(-1).x, y: s.at(-1).y });
  const seg = segmentTrial(s, target);
  assert.ok(seg.ok, seg.reason);
  assert.ok(Math.abs(seg.rho - 0.9) < 0.03, `rho ${seg.rho}`);
  assert.ok(Math.abs(seg.lateral) < 0.01);
  assert.ok(D > 0);
});

test("segmentation stops at the first submovement when a correction follows", () => {
  const target = { x: 0, y: 250 };
  const first = minJerk(0, 0, 0, 0.8 * 250, 150, 170);
  const second = minJerk(0, 200, 0, 50, 150 + 170 + 120, 110);
  const s = [{ t: 0, x: 0, y: 0 }, ...first, { t: 440, x: 0, y: 200 }, ...second];
  const seg = segmentTrial(s, target);
  assert.ok(seg.ok, seg.reason);
  assert.ok(Math.abs(seg.rho - 0.8) < 0.04, `rho ${seg.rho}`);
});

test("segmentation rejects no movement and wrong direction", () => {
  const still = [{ t: 0, x: 0, y: 0 }, { t: 300, x: 0, y: 0 }];
  assert.equal(segmentTrial(still, { x: 100, y: 0 }).ok, false);
  const wrong = [{ t: 0, x: 0, y: 0 }, ...minJerk(0, 0, 0, 200, 100, 150), { t: 500, x: 0, y: 200 }];
  assert.equal(segmentTrial(wrong, { x: 200, y: 0 }).ok, false);
});

function runBlock(user, profile, reps, seed) {
  const W = 1600;
  const H = 900;
  const out = [];
  for (const trial of makeBlock(reps, seed)) {
    const tgt = targetFor(trial, W, H);
    const res = runSimTrial(user, tgt, { sens: 0.5, radius: tgt.radius, profile });
    const seg = segmentTrial(res.samples, tgt);
    out.push({ ...trial, ...seg, timeToHit: res.timeToHit, hit: res.hit });
  }
  return out;
}

test("end to end: a biased simulated user is detected, recovered and corrected", () => {
  const biasCoef = [0.05, -0.03, 0.03, 0.02];
  const user = createSimUser({ seed: 7, biasCoef, noiseSd: 0.1, adaptRate: 0.05 });
  const block1 = runBlock(user, defaultProfile(), 6, 1);
  const usable = block1.filter((t) => t.ok);
  assert.ok(usable.length > 0.9 * block1.length, `usable ${usable.length}/${block1.length}`);
  const r1 = analyze(usable, { K: 2 });
  assert.ok(r1.pass, `p=${r1.p}`);
  // tolerances sit just outside the worst of 30 seeds (max coef error 0.021, residual ratio 0.69)
  r1.coef.forEach((v, i) => assert.ok(Math.abs(v - biasCoef[i]) < 0.025, `coef ${i}: ${v} vs ${biasCoef[i]}`));

  let profile = defaultProfile();
  profile = updateProfile(profile, r1, { eta: 1 }).profile;
  assert.ok(Math.abs(logGainAtAngle(profile, 0)) < 1e-12, "horizontal anchor");
  const block2 = runBlock(user, profile, 6, 2).filter((t) => t.ok);
  const r2 = analyze(block2, { K: 2 });
  assert.ok(r2.residualRms < 0.8 * r1.residualRms, `residual ${r2.residualRms} vs ${r1.residualRms}`);
});

test("end to end: an unbiased simulated user gets no profile", () => {
  const user = createSimUser({ seed: 3, biasCoef: [0, 0, 0, 0], noiseSd: 0.1 });
  const r = analyze(runBlock(user, defaultProfile(), 6, 4).filter((t) => t.ok), { K: 2 });
  assert.equal(r.pass, false, `p=${r.p}`);
  const u = updateProfile(defaultProfile(), r);
  assert.equal(u.changed, false);
});

test("profile update respects the clamp and the anchor", () => {
  const huge = { ok: true, pass: true, shrunk: [-0.5, 0.4, 0.3, -0.2] };
  const p = updateProfile(defaultProfile(), huge, { eta: 1 }).profile;
  for (let d = 0; d < 180; d++) assert.ok(Math.abs(logGainAtAngle(p, (d * Math.PI) / 180)) <= p.clamp + 1e-9);
  assert.ok(Math.abs(logGainAtAngle(p, 0)) < 1e-12);
  const m = updateProfile(defaultProfile(), huge, { eta: 1, anchor: "mean" }).profile;
  assert.equal(m.a0, 0);
});

test("bootstrap CI brackets a known difference", () => {
  const a = Array.from({ length: 300 }, (_, i) => 500 + ((i * 37) % 100));
  const b = a.map((v) => v - 40);
  const r = bootstrapDiff(a, b);
  assert.ok(Math.abs(r.diff + 40) < 1e-9);
  assert.ok(r.lo < -40 && r.hi > -40);
});
