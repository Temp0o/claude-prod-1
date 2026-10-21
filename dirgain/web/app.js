import { createState, defaultProfile, logGainAtAngle, step, toConf, PARAM_KEYS } from "../core/dirgain.js";
import { analyze, bootstrapDiff, segmentTrial, updateProfile } from "./analysis.js";
import { polarChart } from "./charts.js";
import { DIRECTIONS, makeBlock, targetFor } from "./protocol.js";
import { createSimUser, runSimTrial } from "./simuser.js";

const SIM = new URLSearchParams(location.search).has("sim");
const STORE_KEY = "dirgain.v1";
const AB_ORDER = ["A", "B", "B", "A", "B", "A", "A", "B"];
const MIN_AB_TRIALS = 280;
const TRIAL_TIMEOUT_MS = 3000;
const $ = (id) => document.getElementById(id);

const app = {
  settings: { dpi: 800, sens: 1, anchor: "horizontal" },
  profile: defaultProfile(),
  proposal: null,
  sessions: [],
  simUser: null,
};

function profileKey(p) {
  return PARAM_KEYS.filter((k) => k !== "clamp").map((k) => Number(p[k]).toFixed(6)).join(",");
}

function lambdaForDpi(dpi) {
  return Math.max(2, Math.round((dpi * 0.25) / 25.4));
}

function stripRaw(session) {
  return { ...session, trials: session.trials?.map(({ samples, ...t }) => t) };
}

function save() {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ settings: app.settings, profile: app.profile, sessions: app.sessions.map(stripRaw) }),
    );
    $("storeNote").textContent = `${app.sessions.length} session(s) saved in this browser (summaries only; download raw data to keep traces).`;
  } catch {
    $("storeNote").textContent = "Browser storage unavailable: download your data before closing the tab.";
  }
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (s) {
      Object.assign(app.settings, s.settings || {});
      app.profile = { ...defaultProfile(), ...(s.profile || {}) };
      app.sessions = s.sessions || [];
    }
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
}

function download(name, text, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- analysis and rendering ----------

function calibTrials() {
  const key = profileKey(app.profile);
  return app.sessions
    .filter((s) => s.kind === "calibrate" && s.profileKey === key && !!s.sim === SIM)
    .flatMap((s) => s.trials);
}

function dirPoints(trials) {
  const ok = trials.filter((t) => t.seg?.ok);
  if (ok.length < 24) return [];
  const mean = ok.reduce((a, t) => a + Math.log(t.seg.rho), 0) / ok.length;
  const shift = app.proposal ? app.proposal.profile.a0 - app.profile.a0 : 0;
  const half = DIRECTIONS / 2;
  const pts = [];
  for (let d = 0; d < half; d++) {
    const sel = ok.filter((t) => t.dir % half === d);
    if (sel.length < 3) continue;
    const m = sel.reduce((a, t) => a + Math.log(t.seg.rho), 0) / sel.length;
    const theta = (2 * Math.PI * d) / DIRECTIONS;
    pts.push({ theta, logRel: -(m - mean) + logGainAtAngle(app.profile, theta) + shift });
  }
  return pts;
}

function fmtPct(logGain) {
  const v = (Math.exp(logGain) - 1) * 100;
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function renderProfile() {
  const trials = calibTrials();
  $("chart").innerHTML = polarChart({
    current: app.profile,
    proposed: app.proposal?.profile,
    dirPoints: dirPoints(trials),
  });
  const rows = [0, 45, 90, 135].map((deg) => {
    const th = (deg * Math.PI) / 180;
    const cur = fmtPct(logGainAtAngle(app.profile, th));
    const prop = app.proposal ? fmtPct(logGainAtAngle(app.proposal.profile, th)) : "–";
    return `<tr><td>${deg}° / ${deg + 180}°</td><td>${cur}</td><td>${prop}</td></tr>`;
  });
  $("profileTable").innerHTML =
    `<table><tr><th>Direction (0° = right, 90° = down)</th><th>Current</th><th>Proposed</th></tr>${rows.join("")}</table>` +
    `<p class="muted">Solid: current profile. Dashed: proposal. Dots: gain implied by your measured bias. Radial scale exaggerated 4×.</p>`;
  $("btnAccept").disabled = !app.proposal;
}

function renderCounts() {
  const trials = calibTrials();
  const ok = trials.filter((t) => t.seg?.ok).length;
  $("calibCount").textContent = `${trials.length} trials collected with the current profile (${ok} usable). The analysis needs about 400 for a reliable result.`;
  const cps = 1 / app.settings.sens;
  const cm = (window.innerWidth * cps * 2.54) / app.settings.dpi;
  $("sensNote").textContent = `Crossing this screen's width takes about ${cm.toFixed(1)} cm of mouse travel. Pick a speed that feels like your in-game aim.`;
}

function runAnalysis() {
  const trials = calibTrials();
  const usable = trials.filter((t) => t.seg?.ok).map((t) => ({ theta: t.theta, amp: t.amp, rho: t.seg.rho }));
  const res = analyze(usable);
  const el = $("analysis");
  app.proposal = null;
  if (!res.ok) {
    el.innerHTML = `<p class="warn">${res.reason}.</p>`;
    renderProfile();
    return;
  }
  const rejected = trials.length - usable.length;
  const spread = (res.residualRms * 100).toFixed(1);
  let html = `<table>
    <tr><td>Usable trials</td><td>${res.n} (${rejected} rejected)</td></tr>
    <tr><td>Harmonics (auto-selected)</td><td>${res.K}</td></tr>
    <tr><td>Directional bias (RMS)</td><td>${spread}%</td></tr>
    <tr><td>Gate: joint Wald test</td><td>p = ${res.p.toExponential(2)} (needs &lt; 0.01)</td></tr>
  </table>`;
  if (res.pass) {
    app.proposal = { profile: updateProfile(app.profile, res, { anchor: app.settings.anchor }).profile, result: res };
    app.proposal.profile.lambda = lambdaForDpi(app.settings.dpi);
    html += `<p class="good">A directional bias is statistically reliable. A proposal is shown on the profile chart. Accept it, then run another calibration block to measure what is left (and an A/B session to see whether it helps).</p>`;
  } else {
    html += `<p>No reliable directional bias at this sample size. Keep the current profile. Collect more blocks, or stop here: a flat profile is the right answer if your aim has no consistent directional bias.</p>`;
  }
  el.innerHTML = html;
  renderProfile();
}

function renderAB() {
  const key = profileKey(app.profile);
  const ab = app.sessions.filter((s) => s.kind === "ab" && s.profileKey === key && !!s.sim === SIM);
  const tr = app.sessions.filter((s) => s.kind === "tracking" && s.profileKey === key && !!s.sim === SIM);
  const el = $("abResult");
  if (!ab.length && !tr.length) {
    el.innerHTML = `<p class="muted">No A/B data for the current profile yet.</p>`;
    return;
  }
  const trials = ab.flatMap((s) => s.trials.map((t) => ({ ...t, blockId: `${s.id}:${t.block}` })));
  const byCond = (c) => trials.filter((t) => t.cond === c);
  const tth = (c) => byCond(c).filter((t) => t.hit).map((t) => t.timeToHit);
  const hitRate = (c) => byCond(c).filter((t) => t.hit).length / Math.max(1, byCond(c).length);
  const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
  // Resample whole mini-blocks: trials inside a block share warm-up, fatigue and adaptation state.
  const blockMeans = (c) => {
    const groups = new Map();
    for (const t of byCond(c)) {
      if (!t.hit) continue;
      if (!groups.has(t.blockId)) groups.set(t.blockId, []);
      groups.get(t.blockId).push(t.timeToHit);
    }
    return [...groups.values()].map(mean);
  };
  let html = "";
  if (trials.length) {
    const d = bootstrapDiff(blockMeans("A"), blockMeans("B"));
    const enough = Math.min(byCond("A").length, byCond("B").length) >= MIN_AB_TRIALS;
    let verdict = "Not enough blocks yet.";
    if (d) {
      if (d.hi < 0) verdict = `<span class="good">The profile made you faster: the whole 95% interval is below zero.</span>`;
      else if (d.lo > 0) verdict = `<span class="bad">The profile made you slower. Reset to flat.</span>`;
      else verdict = "No detectable difference (the interval includes zero).";
      if (!enough) verdict = `<b>Preliminary</b> (under ${MIN_AB_TRIALS} trials per condition, keep collecting): ${verdict}`;
    }
    html += `<table>
      <tr><th></th><th>Without profile</th><th>With profile</th></tr>
      <tr><td>Trials</td><td>${byCond("A").length}</td><td>${byCond("B").length}</td></tr>
      <tr><td>Hit rate</td><td>${(100 * hitRate("A")).toFixed(1)}%</td><td>${(100 * hitRate("B")).toFixed(1)}%</td></tr>
      <tr><td>Mean time to hit</td><td>${mean(tth("A")).toFixed(0)} ms</td><td>${mean(tth("B")).toFixed(0)} ms</td></tr>
    </table>`;
    if (d) html += `<p>Difference (with − without): <b>${d.diff.toFixed(0)} ms</b>, 95% CI ${d.lo.toFixed(0)} to ${d.hi.toFixed(0)} ms (block bootstrap). ${verdict}</p>`;
  }
  if (tr.length) {
    const win = (c) => tr.flatMap((s) => s.runs.filter((r) => r.cond === c).flatMap((r) => r.windows));
    const d = bootstrapDiff(win("A"), win("B"));
    if (d) {
      const worse = d.lo > 0;
      html += `<p>Tracking guard: RMS error difference ${d.diff.toFixed(1)} px (95% CI ${d.lo.toFixed(1)} to ${d.hi.toFixed(1)}). ${
        worse ? '<span class="bad">The profile hurts tracking.</span>' : "No tracking regression detected."
      }</p>`;
    }
  }
  el.innerHTML = html;
}

function renderAll() {
  $("dpi").value = app.settings.dpi;
  $("sens").value = app.settings.sens;
  $("anchor").value = app.settings.anchor;
  renderCounts();
  renderProfile();
  renderAB();
}

// ---------- task runner (real mouse) ----------

const task = {
  canvas: null,
  ctx: null,
  active: false,
  x: 0,
  y: 0,
  profile: null,
  st: null,
  lastTs: null,
  rec: null,
  onClick: null,
  target: null,
  phase: "idle",
  feedback: null,
  path: null,
};

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  task.canvas.width = Math.round(innerWidth * dpr);
  task.canvas.height = Math.round(innerHeight * dpr);
  task.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function onPointerMove(e) {
  if (!task.active || document.pointerLockElement !== task.canvas) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs.length ? evs : [e]) {
    const dx = ev.movementX;
    const dy = ev.movementY;
    if (!dx && !dy) continue;
    const dt = task.lastTs === null ? 1 : ev.timeStamp - task.lastTs;
    task.lastTs = ev.timeStamp;
    const [ox, oy] = step(task.profile, task.st, dx, dy, dt);
    task.x += ox * app.settings.sens;
    task.y += oy * app.settings.sens;
    if (task.rec) task.rec.push({ t: ev.timeStamp - task.rec.t0, x: task.x, y: task.y });
  }
}

function draw() {
  if (!task.active) return;
  const ctx = task.ctx;
  const W = innerWidth;
  const H = innerHeight;
  const cx = W / 2;
  const cy = H / 2;
  const css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue("--task-bg");
  ctx.fillRect(0, 0, W, H);
  if (task.phase === "hold") {
    ctx.strokeStyle = css.getPropertyValue("--task-ink");
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (task.target) {
    ctx.fillStyle = task.feedback ? css.getPropertyValue(task.feedback === "hit" ? "--hit" : "--miss") : css.getPropertyValue("--target");
    ctx.beginPath();
    ctx.arc(cx + task.target.x, cy + task.target.y, task.target.radius, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.strokeStyle = css.getPropertyValue("--task-ink");
  ctx.lineWidth = 2;
  const px = cx + task.x;
  const py = cy + task.y;
  ctx.beginPath();
  ctx.moveTo(px - 8, py);
  ctx.lineTo(px + 8, py);
  ctx.moveTo(px, py - 8);
  ctx.lineTo(px, py + 8);
  ctx.stroke();
  requestAnimationFrame(draw);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function enterTask() {
  $("task").classList.add("on");
  resizeCanvas();
  try {
    await task.canvas.requestPointerLock({ unadjustedMovement: true });
  } catch {
    await task.canvas.requestPointerLock();
    $("lockNote").innerHTML = '<span class="warn">Raw (unadjusted) input was not available in this browser; OS acceleration may affect the numbers.</span>';
  }
  if (document.pointerLockElement !== task.canvas) throw new Error("pointer lock refused");
  task.active = true;
  requestAnimationFrame(draw);
}

function exitTask() {
  task.active = false;
  task.target = null;
  task.rec = null;
  if (document.pointerLockElement) document.exitPointerLock();
  $("task").classList.remove("on");
}

function aborted() {
  return !task.active || document.pointerLockElement !== task.canvas;
}

async function runFlick(trial, profile) {
  const tgt = targetFor(trial, innerWidth, innerHeight);
  task.profile = profile;
  task.st = createState();
  task.lastTs = null;
  task.x = 0;
  task.y = 0;
  task.target = null;
  task.feedback = null;
  task.phase = "hold";
  await sleep(350 + Math.random() * 400);
  if (aborted()) return null;
  task.x = 0;
  task.y = 0;
  task.phase = "go";
  task.target = tgt;
  const t0 = performance.now();
  task.rec = [{ t: 0, x: 0, y: 0 }];
  task.rec.t0 = t0;
  const click = await new Promise((resolve) => {
    task.onClick = resolve;
    setTimeout(() => resolve(null), TRIAL_TIMEOUT_MS);
  });
  task.onClick = null;
  const samples = task.rec;
  task.rec = null;
  if (aborted()) return null;
  const tClick = click === null ? null : click - t0;
  const hit = tClick !== null && Math.hypot(task.x - tgt.x, task.y - tgt.y) <= tgt.radius;
  if (tClick !== null) samples.push({ t: tClick, x: task.x, y: task.y });
  task.feedback = hit ? "hit" : "miss";
  await sleep(180);
  task.target = null;
  return {
    dir: trial.dir,
    theta: trial.theta,
    amp: trial.amp,
    D: tgt.D,
    radius: tgt.radius,
    hit,
    timeout: tClick === null,
    timeToHit: tClick,
    seg: tClick === null ? { ok: false, reason: "timeout" } : pickSeg(segmentTrial(samples, tgt)),
    samples,
  };
}

function pickSeg(s) {
  return s.ok ? { ok: true, rho: s.rho, rhoMirror: s.rhoMirror, lateral: s.lateral } : { ok: false, reason: s.reason };
}

function hud(text) {
  $("hud").textContent = text;
}

async function runTrials(kind, plan, profileFor) {
  const session = newSession(kind);
  try {
    await enterTask();
    for (let i = 0; i < plan.length; i++) {
      hud(`${i + 1} / ${plan.length}  ·  Esc to stop`);
      const res = await runFlick(plan[i], profileFor(plan[i]));
      if (!res) break;
      session.trials.push({ ...res, cond: plan[i].cond, block: plan[i].block });
    }
  } catch (err) {
    alert(`Could not start: ${err.message}. Click the page first, and use a Chromium-based browser for raw input.`);
  } finally {
    exitTask();
  }
  finishSession(session);
}

function newSession(kind) {
  return {
    id: `${Date.now()}`,
    kind,
    sim: SIM,
    profileKey: profileKey(app.profile),
    profile: { ...app.profile },
    settings: { ...app.settings },
    trials: [],
    runs: [],
  };
}

function finishSession(session) {
  if (session.trials.length || session.runs.length) app.sessions.push(session);
  save();
  renderAll();
}

// Each mini-block visits every direction once with distances rotating, so both conditions get
// the same direction and distance mix.
function abPlan() {
  const seed = Date.now() & 0xffff;
  return AB_ORDER.flatMap((cond, b) =>
    makeBlock(1, seed + b)
      .filter((t) => t.amp === (t.dir + b) % 3)
      .map((t) => ({ ...t, cond, block: b })),
  );
}

// The control keeps the profile's direction-averaged gain (a0), so A and B differ only in
// directional shape and switching blocks does not force a global re-adaptation.
function controlProfile() {
  return { ...defaultProfile(), a0: app.profile.a0, lambda: app.profile.lambda, reset_ms: app.profile.reset_ms };
}

function profileForCond(trial) {
  return trial.cond === "A" ? controlProfile() : app.profile;
}

async function runTracking() {
  const session = newSession("tracking");
  try {
    await enterTask();
    for (const [i, cond] of ["A", "B", "B", "A"].entries()) {
      hud(`Tracking ${i + 1} / 4: keep the crosshair on the moving target  ·  Esc to stop`);
      const run = await trackRun(cond === "A" ? controlProfile() : app.profile);
      if (!run) break;
      session.runs.push({ cond, ...run });
    }
  } catch (err) {
    alert(`Could not start: ${err.message}`);
  } finally {
    exitTask();
  }
  finishSession(session);
}

async function trackRun(profile) {
  task.profile = profile;
  task.st = createState();
  task.lastTs = null;
  const S = 0.22 * Math.min(innerWidth, innerHeight);
  const comps = [0.13, 0.21, 0.34, 0.47].map((f) => ({
    f,
    ax: S * (0.4 + 0.6 * Math.random()) / 2,
    ay: S * (0.4 + 0.6 * Math.random()) / 2,
    px: 2 * Math.PI * Math.random(),
    py: 2 * Math.PI * Math.random(),
  }));
  const pos = (t) => ({
    x: comps.reduce((a, c) => a + c.ax * Math.sin(2 * Math.PI * c.f * t + c.px), 0),
    y: comps.reduce((a, c) => a + c.ay * Math.sin(2 * Math.PI * c.f * t + c.py), 0),
  });
  const start = pos(0);
  task.x = start.x;
  task.y = start.y;
  task.phase = "track";
  task.target = { ...start, radius: 12 };
  const t0 = performance.now();
  const windows = [];
  let acc = 0;
  let n = 0;
  let w = 2;
  while (performance.now() - t0 < 10000) {
    await new Promise((r) => requestAnimationFrame(r));
    if (aborted()) return null;
    const t = (performance.now() - t0) / 1000;
    const p = pos(t);
    task.target = { ...p, radius: 12 };
    if (t < 2) continue;
    acc += (task.x - p.x) ** 2 + (task.y - p.y) ** 2;
    n++;
    if (t >= w + 1) {
      windows.push(Math.sqrt(acc / Math.max(1, n)));
      acc = 0;
      n = 0;
      w += 1;
    }
  }
  task.target = null;
  await sleep(600);
  return { windows };
}

// ---------- simulation mode ----------

function simUser() {
  if (!app.simUser) app.simUser = createSimUser({ seed: 7, biasCoef: [0.05, -0.03, 0.03, 0.02], noiseSd: 0.1, adaptRate: 0.05 });
  return app.simUser;
}

function simTrials(kind, plan, profileFor) {
  const session = newSession(kind);
  const W = 1600;
  const H = 900;
  for (const trial of plan) {
    const tgt = targetFor(trial, W, H);
    const res = runSimTrial(simUser(), tgt, { sens: app.settings.sens, radius: tgt.radius, profile: profileFor(trial) });
    session.trials.push({
      dir: trial.dir,
      theta: trial.theta,
      amp: trial.amp,
      cond: trial.cond,
      block: trial.block,
      D: tgt.D,
      radius: tgt.radius,
      hit: res.hit,
      timeout: false,
      timeToHit: res.timeToHit,
      seg: pickSeg(segmentTrial(res.samples, tgt)),
      samples: res.samples,
    });
  }
  finishSession(session);
}

// ---------- wiring ----------

function init() {
  load();
  task.canvas = $("canvas");
  task.ctx = task.canvas.getContext("2d");
  if (SIM) {
    $("simBanner").hidden = false;
    $("btnCalib").textContent = "Simulate calibration block";
    $("btnAB").textContent = "Simulate A/B session";
    $("btnTrack").disabled = true;
    $("btnTrack").title = "Tracking is not simulated";
  }
  window.addEventListener("resize", () => task.active && resizeCanvas());
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("mousedown", (e) => {
    if (task.active && e.button === 0 && task.onClick) task.onClick(performance.now());
  });
  document.addEventListener("pointerlockchange", () => {
    if (!document.pointerLockElement && task.active) {
      task.active = false;
      if (task.onClick) task.onClick(null);
    }
  });
  const num = (id, key, min) =>
    $(id).addEventListener("change", () => {
      const v = Number($(id).value);
      if (Number.isFinite(v) && v >= min) app.settings[key] = v;
      save();
      renderAll();
    });
  num("dpi", "dpi", 100);
  num("sens", "sens", 0.05);
  $("anchor").addEventListener("change", () => {
    app.settings.anchor = $("anchor").value;
    save();
  });
  $("btnCalib").addEventListener("click", () => {
    const plan = makeBlock(1, Date.now() & 0xffff);
    if (SIM) simTrials("calibrate", plan, () => app.profile);
    else runTrials("calibrate", plan, () => app.profile);
  });
  $("btnAnalyze").addEventListener("click", runAnalysis);
  $("btnAccept").addEventListener("click", () => {
    if (!app.proposal) return;
    app.profile = app.proposal.profile;
    app.proposal = null;
    $("analysis").innerHTML = `<p>Profile accepted. Run another calibration block to measure the residual, then an A/B session.</p>`;
    save();
    renderAll();
  });
  $("btnResetProfile").addEventListener("click", () => {
    app.profile = { ...defaultProfile(), lambda: lambdaForDpi(app.settings.dpi) };
    app.proposal = null;
    save();
    renderAll();
  });
  $("btnAB").addEventListener("click", () => {
    const plan = abPlan();
    if (SIM) simTrials("ab", plan, profileForCond);
    else runTrials("ab", plan, profileForCond);
  });
  $("btnTrack").addEventListener("click", runTracking);
  $("btnConf").addEventListener("click", () => download("profile.conf", `# DirGain profile, device coordinates (y down)\n${toConf(app.profile)}`));
  $("btnJson").addEventListener("click", () =>
    download(
      "profile.json",
      JSON.stringify({ format: "dirgain-profile", version: 1, profile: app.profile, settings: app.settings, created: new Date().toISOString() }, null, 2),
      "application/json",
    ),
  );
  $("btnData").addEventListener("click", () =>
    download("dirgain-data.json", JSON.stringify({ format: "dirgain-data", version: 1, ...app, simUser: undefined, proposal: undefined }), "application/json"),
  );
  $("importData").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.format !== "dirgain-data" || !Array.isArray(d.sessions)) throw new Error("not a DirGain data file");
      app.sessions = d.sessions;
      app.settings = { ...app.settings, ...d.settings };
      app.profile = { ...defaultProfile(), ...d.profile };
      save();
      renderAll();
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });
  $("btnClear").addEventListener("click", () => {
    if (!confirm("Delete all sessions stored in this browser?")) return;
    app.sessions = [];
    save();
    renderAll();
  });
  renderAll();
  save();
}

init();
