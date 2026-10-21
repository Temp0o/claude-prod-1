import { createState } from "../core/dirgain.js";
import { applyStep } from "./rawaccel.js";
import { segmentTrial } from "./analysis.js";
import { fpsTargetFor, targetFor } from "./protocol.js";

const TRIAL_TIMEOUT_MS = 3000;
const DEG = Math.PI / 180;
const COLORS = {
  sky: "#15171c",
  horizon: "#23262d",
  grid: "rgba(214, 220, 230, 0.07)",
  gridStrong: "rgba(214, 220, 230, 0.18)",
  target: "#ff7a52",
  targetHi: "#ffd9c9",
  hit: "#c6f432",
  miss: "#ef5350",
  crosshair: "#c6f432",
  outline: "rgba(10, 11, 13, 0.85)",
  ink: "rgba(232, 235, 240, 0.85)",
};

function dir(yawDeg, pitchDeg) {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  return [Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)];
}

function camera(yawDeg, pitchDeg, W, H, hfovDeg) {
  const f = dir(yawDeg, pitchDeg);
  const y = yawDeg * DEG;
  const r = [Math.cos(y), 0, -Math.sin(y)];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const F = W / 2 / Math.tan((hfovDeg * DEG) / 2);
  return (v) => {
    const cz = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    if (cz < 0.02) return null;
    const cx = v[0] * r[0] + v[1] * r[1] + v[2] * r[2];
    const cy = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
    return { x: W / 2 + (F * cx) / cz, y: H / 2 - (F * cy) / cz, s: F / cz };
  };
}

function angleBetween(a, b) {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d) / DEG;
}

export function createArena({ root, canvas, hud, progress }) {
  const ctx = canvas.getContext("2d");
  const s = {
    active: false,
    mode: "fps",
    k: 1,
    fov: 103,
    x: 0,
    y: 0,
    profile: null,
    st: null,
    lastTs: null,
    rec: null,
    onClick: null,
    target: null,
    feedback: null,
    phase: "idle",
  };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function onMove(e) {
    if (!s.active || document.pointerLockElement !== canvas) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const dx = ev.movementX;
      const dy = ev.movementY;
      if (!dx && !dy) continue;
      const dt = s.lastTs === null ? 1 : ev.timeStamp - s.lastTs;
      s.lastTs = ev.timeStamp;
      const [ox, oy] = applyStep(s.profile, s.st, dx, dy, dt);
      s.x += ox * s.k;
      s.y += oy * s.k;
      if (s.mode === "fps") s.y = Math.max(-85, Math.min(85, s.y));
      if (s.rec) s.rec.push({ t: ev.timeStamp - s.rec.t0, x: s.x, y: s.y });
    }
  }

  function onDown(e) {
    if (s.active && e.button === 0 && s.onClick) s.onClick(performance.now());
  }

  function onLockChange() {
    if (!document.pointerLockElement && s.active) {
      s.active = false;
      if (s.onClick) s.onClick(null);
    }
  }

  document.addEventListener("pointermove", onMove);
  document.addEventListener("mousedown", onDown);
  document.addEventListener("pointerlockchange", onLockChange);
  window.addEventListener("resize", () => s.active && resize());

  function drawFps(W, H) {
    const proj = camera(s.x, -s.y, W, H, s.fov);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COLORS.sky);
    g.addColorStop(1, COLORS.horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.lineWidth = 1;
    const line = (pts, strong) => {
      ctx.strokeStyle = strong ? COLORS.gridStrong : COLORS.grid;
      ctx.beginPath();
      let pen = false;
      for (const p of pts) {
        const q = proj(p);
        if (!q) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(q.x, q.y);
        else ctx.moveTo(q.x, q.y);
        pen = true;
      }
      ctx.stroke();
    };
    for (let yaw = -180; yaw < 180; yaw += 15) {
      const pts = [];
      for (let p = -75; p <= 75; p += 3) pts.push(dir(yaw, p));
      line(pts, false);
    }
    for (let p = -75; p <= 75; p += 15) {
      const pts = [];
      for (let yaw = -180; yaw <= 180; yaw += 3) pts.push(dir(yaw, p));
      line(pts, p === 0);
    }
    if (s.target) {
      const q = proj(dir(s.target.x, -s.target.y));
      if (q) {
        const r = Math.max(3, q.s * Math.tan(s.target.radius * DEG));
        drawSphere(q.x, q.y, r);
      }
    }
    drawCrosshair(W / 2, H / 2);
  }

  function draw2d(W, H) {
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    if (s.phase === "hold") {
      ctx.strokeStyle = COLORS.gridStrong;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, 2 * Math.PI);
      ctx.stroke();
    }
    if (s.target) drawSphere(cx + s.target.x, cy + s.target.y, s.target.radius);
    drawCrosshair(cx + s.x, cy + s.y);
  }

  function drawSphere(x, y, r) {
    if (s.feedback) {
      ctx.fillStyle = s.feedback === "hit" ? COLORS.hit : COLORS.miss;
    } else {
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, COLORS.targetHi);
      g.addColorStop(0.45, COLORS.target);
      g.addColorStop(1, "#b8401f");
      ctx.fillStyle = g;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
  }

  function drawCrosshair(x, y) {
    const seg = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    const arms = () => {
      seg(x - 11, y, x - 4, y);
      seg(x + 4, y, x + 11, y);
      seg(x, y - 11, x, y - 4);
      seg(x, y + 4, x, y + 11);
    };
    ctx.lineCap = "butt";
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 4;
    arms();
    ctx.strokeStyle = COLORS.crosshair;
    ctx.lineWidth = 2;
    arms();
    ctx.fillStyle = COLORS.crosshair;
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  function frame() {
    if (!s.active) return;
    const W = innerWidth;
    const H = innerHeight;
    if (s.mode === "fps") drawFps(W, H);
    else draw2d(W, H);
    requestAnimationFrame(frame);
  }

  async function enter(settings) {
    s.mode = settings.mode;
    s.fov = settings.fov;
    root.classList.add("on");
    resize();
    let raw = true;
    try {
      await canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      raw = false;
      await canvas.requestPointerLock();
    }
    if (document.pointerLockElement !== canvas) throw new Error("pointer lock was refused");
    root.requestFullscreen?.().catch(() => {});
    s.active = true;
    requestAnimationFrame(frame);
    return { raw };
  }

  function exit() {
    s.active = false;
    s.target = null;
    s.rec = null;
    s.phase = "idle";
    if (document.pointerLockElement) document.exitPointerLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.classList.remove("on");
  }

  const aborted = () => !s.active || document.pointerLockElement !== canvas;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function geometry(trial) {
    if (s.mode === "fps") return fpsTargetFor(trial);
    return targetFor(trial, innerWidth, innerHeight);
  }

  function isHit(tgt) {
    if (s.mode === "fps") return angleBetween(dir(s.x, -s.y), dir(tgt.x, -tgt.y)) <= tgt.radius;
    return Math.hypot(s.x - tgt.x, s.y - tgt.y) <= tgt.radius;
  }

  async function flick(trial, profile) {
    const tgt = geometry(trial);
    s.profile = profile;
    s.st = createState();
    s.lastTs = null;
    s.x = 0;
    s.y = 0;
    s.target = null;
    s.feedback = null;
    s.phase = "hold";
    await sleep(350 + Math.random() * 400);
    if (aborted()) return null;
    s.x = 0;
    s.y = 0;
    s.phase = "go";
    s.target = tgt;
    const t0 = performance.now();
    s.rec = [{ t: 0, x: 0, y: 0 }];
    s.rec.t0 = t0;
    const click = await new Promise((resolve) => {
      s.onClick = resolve;
      setTimeout(() => resolve(null), TRIAL_TIMEOUT_MS);
    });
    s.onClick = null;
    const samples = s.rec;
    s.rec = null;
    if (aborted()) return null;
    const tClick = click === null ? null : click - t0;
    const hit = tClick !== null && isHit(tgt);
    if (tClick !== null) samples.push({ t: tClick, x: s.x, y: s.y });
    s.feedback = hit ? "hit" : "miss";
    await sleep(160);
    s.target = null;
    const seg = tClick === null ? { ok: false, reason: "timeout" } : segmentTrial(samples, tgt);
    return {
      dir: trial.dir,
      theta: trial.theta,
      amp: trial.amp,
      D: tgt.D,
      radius: tgt.radius,
      hit,
      timeout: tClick === null,
      timeToHit: tClick,
      seg: seg.ok ? { ok: true, rho: seg.rho, rhoMirror: seg.rhoMirror, lateral: seg.lateral, onsetMs: seg.onsetMs } : { ok: false, reason: seg.reason },
      samples,
    };
  }

  function setHud(text, frac) {
    hud.textContent = text;
    progress.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  }

  async function runFlicks({ plan, profileFor, settings, k, label }) {
    s.k = k;
    const info = await enter(settings);
    const trials = [];
    try {
      for (let i = 0; i < plan.length; i++) {
        setHud(`${label} · ${i + 1} of ${plan.length} · Esc to stop`, i / plan.length);
        const res = await flick(plan[i], profileFor(plan[i]));
        if (!res) break;
        trials.push({ ...res, cond: plan[i].cond, block: plan[i].block });
      }
    } finally {
      exit();
    }
    return { trials, raw: info.raw };
  }

  async function track(profile, seconds) {
    s.profile = profile;
    s.st = createState();
    s.lastTs = null;
    const A = s.mode === "fps" ? 10 : 0.2 * Math.min(innerWidth, innerHeight);
    const comps = [0.13, 0.21, 0.34, 0.47].map((f) => ({
      f,
      ax: (A * (0.4 + 0.6 * Math.random())) / 2,
      ay: (A * (0.4 + 0.6 * Math.random())) / 2,
      px: 2 * Math.PI * Math.random(),
      py: 2 * Math.PI * Math.random(),
    }));
    const pos = (t) => ({
      x: comps.reduce((a, c) => a + c.ax * Math.sin(2 * Math.PI * c.f * t + c.px), 0),
      y: comps.reduce((a, c) => a + c.ay * Math.sin(2 * Math.PI * c.f * t + c.py), 0),
    });
    const radius = s.mode === "fps" ? 1.2 : 12;
    const p0 = pos(0);
    s.x = p0.x;
    s.y = p0.y;
    s.feedback = null;
    s.phase = "track";
    s.target = { ...p0, radius };
    const t0 = performance.now();
    const windows = [];
    let acc = 0;
    let n = 0;
    let w = 2;
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((r) => requestAnimationFrame(r));
      if (aborted()) return null;
      const t = (performance.now() - t0) / 1000;
      const p = pos(t);
      s.target = { ...p, radius };
      if (t < 2) continue;
      const err = s.mode === "fps" ? angleBetween(dir(s.x, -s.y), dir(p.x, -p.y)) : Math.hypot(s.x - p.x, s.y - p.y);
      acc += err * err;
      n++;
      if (t >= w + 1) {
        windows.push(Math.sqrt(acc / Math.max(1, n)));
        acc = 0;
        n = 0;
        w += 1;
      }
    }
    s.target = null;
    await sleep(600);
    return { windows };
  }

  async function runTracking({ conds, profileFor, settings, k, seconds = 10 }) {
    s.k = k;
    await enter(settings);
    const runs = [];
    try {
      for (let i = 0; i < conds.length; i++) {
        setHud(`Tracking · ${i + 1} of ${conds.length} · keep the crosshair on the target · Esc to stop`, i / conds.length);
        const run = await track(profileFor(conds[i]), seconds);
        if (!run) break;
        runs.push({ cond: conds[i], ...run });
      }
    } finally {
      exit();
    }
    return { runs };
  }

  return { runFlicks, runTracking };
}
