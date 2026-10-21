import { defaultProfile, logGainAtAngle, toConf, PARAM_KEYS } from "../core/dirgain.js";
import { analyze, bootstrapDiff, rawAccelFit, segmentTrial, updateProfile } from "./analysis.js";
import { createArena } from "./arena.js";
import { rawAccelMeanLogGain, rawAccelProfile } from "./rawaccel.js";
import { esc, intervalChart, meter, pct, polarChart } from "./charts.js";
import { GAMES, cm360, degPerCount, gameById } from "./games.js";
import { DIRECTIONS, fpsTargetFor, makeBlock, targetFor } from "./protocol.js";
import { createSimUser, runSimTrial } from "./simuser.js";

const SIM_FROM_URL = new URLSearchParams(location.search).has("sim");
// Set by the artifact build: no downloads, no own theme switch, opens with demo data.
const ARTIFACT = !!globalThis.DIRGAIN_ARTIFACT;
let SIM = false;
const STORE_KEY = "dirgain.v2";
const THEME_KEY = "dirgain.theme";
const AB_ORDER = ["A", "B", "B", "A", "B", "A", "A", "B"];
const CAL_GOAL = 400;
const AB_GOAL = 280;
const $ = (id) => document.getElementById(id);

const app = {
  settings: { game: "valorant", sens: 0.35, cm360: 34, dpi: 800, fov: 103, mode: "fps", anchor: "horizontal", allowOdd: true, sens2d: 1, variant: "full" },
  profile: defaultProfile(),
  realProfile: null,
  demoProfile: defaultProfile(),
  proposal: null,
  lastResult: null,
  sessions: [],
  step: "setup",
  simUser: null,
};

// ---------- persistence ----------

function save() {
  try {
    const sessions = app.sessions.map((s) => ({ ...s, trials: s.trials?.map(({ samples, ...t }) => t) }));
    const profile = SIM ? app.realProfile : app.profile;
    localStorage.setItem(STORE_KEY, JSON.stringify({ settings: app.settings, profile, sessions, step: app.step }));
    $("storeNote").textContent = `${app.sessions.length} session(s) saved in this browser. Traces are kept only until you close the tab; download raw data to keep them.`;
  } catch {
    $("storeNote").textContent = "This browser blocked local storage. Download your data before closing the tab.";
  }
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!s) return;
    Object.assign(app.settings, s.settings || {});
    app.profile = { ...defaultProfile(), ...(s.profile || {}) };
    app.sessions = s.sessions || [];
    if (s.step) app.step = s.step;
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
}

const confText = () => `# DirGain profile (device coordinates, y down)\n${toConf(app.profile)}`;

// Clipboard writes must happen inside the click; when refused, select the text instead.
function copyText(text, preId, btnId) {
  const done = () => ($(btnId).textContent = "Copied");
  const select = () => {
    const r = document.createRange();
    r.selectNodeContents($(preId));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    $(btnId).textContent = "Selected, press Ctrl+C";
  };
  try {
    navigator.clipboard.writeText(text).then(done, select);
  } catch {
    select();
  }
}

function download(name, text, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- derived state ----------

const profileKey = (p) => PARAM_KEYS.filter((k) => k !== "clamp").map((k) => Number(p[k]).toFixed(6)).join(",");
const unitsPerCount = () => (app.settings.mode === "fps" ? degPerCount(app.settings) : app.settings.sens2d);
const calibKey = () => `${profileKey(app.profile)}|${app.settings.mode}|${unitsPerCount().toPrecision(6)}`;
const lambdaForDpi = (dpi) => Math.max(2, Math.round((dpi * 0.25) / 25.4));
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

function sessionsOf(kind) {
  const key = calibKey();
  const variant = app.settings.variant;
  return app.sessions.filter(
    (s) => s.kind === kind && s.calibKey === key && !!s.sim === SIM && (kind === "calibrate" || (s.variant ?? "full") === variant),
  );
}

function calibTrials() {
  return sessionsOf("calibrate").flatMap((s) => s.trials.map((t) => ({ ...t, group: `${s.id}:${t.amp}` })));
}

function otherCalibCount() {
  const key = calibKey();
  return app.sessions.filter((s) => s.kind === "calibrate" && s.calibKey !== key && !!s.sim === SIM).reduce((a, s) => a + s.trials.length, 0);
}

function directionLabels() {
  return app.settings.mode === "fps"
    ? { right: "right", left: "left", up: "push (aim up)", down: "pull (aim down)" }
    : { right: "right", left: "left", up: "up", down: "down" };
}

// What the A/B "with" condition applies: the full DirGain profile, or Raw Accel's best fit to it.
function testProfile() {
  return app.settings.variant === "rawaccel" ? rawAccelProfile(rawAccelFit(app.profile)) : app.profile;
}

// The A/B control keeps the tested profile's direction-averaged gain.
function controlProfile() {
  const p = testProfile();
  const a0 = p.kind === "rawaccel" ? rawAccelMeanLogGain(p) : p.a0;
  return { ...defaultProfile(), a0, lambda: app.profile.lambda, reset_ms: app.profile.reset_ms };
}

// ---------- step navigation ----------

const STEPS = ["setup", "calibrate", "validate", "install", "data"];

function go(step) {
  app.step = STEPS.includes(step) ? step : "setup";
  for (const s of STEPS) {
    $(`panel-${s}`).classList.toggle("on", s === app.step);
    const b = document.querySelector(`nav.steps [data-step="${s}"]`);
    if (s === app.step) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  }
  renderAll();
  save();
  window.scrollTo(0, 0);
}

function renderRail() {
  const st = app.settings;
  const g = gameById(st.game);
  $("st-setup").textContent = `${g.id === "custom" ? "Custom" : g.name} · ${cm360(st).toFixed(1)} cm/360`;
  const ok = calibTrials().filter((t) => t.seg?.ok).length;
  const flat = Math.abs(logGainAtAngle(app.profile, 0)) < 1e-9 && Math.abs(logGainAtAngle(app.profile, Math.PI / 2)) < 1e-9 && Math.abs(logGainAtAngle(app.profile, Math.PI / 4)) < 1e-9;
  $("st-calibrate").textContent = `${ok} usable flicks · ${flat ? "flat profile" : "profile on"}`;
  const ab = sessionsOf("ab").flatMap((s) => s.trials);
  const n = Math.min(ab.filter((t) => t.cond === "A").length, ab.filter((t) => t.cond === "B").length);
  $("st-validate").textContent = n ? `${n} of ${AB_GOAL} per condition` : "not started";
  $("st-install").textContent = "Raw Accel or full profile";
  $("st-data").textContent = `${app.sessions.length} session(s)`;
  document.querySelectorAll("nav.steps button").forEach((b) => {
    const s = b.dataset.step;
    b.classList.toggle("done", (s === "setup" && app.step !== "setup") || (s === "calibrate" && !flat) || (s === "validate" && n >= AB_GOAL));
  });
}

// ---------- setup ----------

function renderSetup() {
  const st = app.settings;
  const g = gameById(st.game);
  $("game").value = st.game;
  $("sens").value = st.sens;
  $("cm360").value = st.cm360;
  $("dpi").value = st.dpi;
  $("fov").value = st.fov;
  $("anchor").value = st.anchor;
  $("allowOdd").checked = !!st.allowOdd;
  $("sens2d").value = st.sens2d;
  $("sensField").hidden = g.yaw === null;
  $("cmField").hidden = g.yaw !== null;
  document.querySelectorAll('input[name="mode"]').forEach((r) => (r.checked = r.value === st.mode));
  const k = degPerCount(st);
  $("sensReadout").innerHTML = `
    <div><b>${cm360(st).toFixed(1)}</b><span>cm per 360° turn</span></div>
    <div><b>${(k * st.dpi).toFixed(1)}</b><span>degrees per inch of mouse travel</span></div>
    <div><b>${k.toFixed(4)}</b><span>degrees per mouse count</span></div>`;
}

function bindSetup() {
  $("game").innerHTML = GAMES.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
  $("game").addEventListener("change", () => {
    const g = gameById($("game").value);
    app.settings.game = g.id;
    if (g.sens !== null) app.settings.sens = g.sens;
    app.settings.fov = g.fov;
    save();
    renderAll();
  });
  const num = (id, key, min, max = Infinity) =>
    $(id).addEventListener("change", () => {
      const v = Number($(id).value);
      if (Number.isFinite(v) && v >= min && v <= max) app.settings[key] = v;
      save();
      renderAll();
    });
  num("sens", "sens", 0.0001);
  num("cm360", "cm360", 1, 1000);
  num("dpi", "dpi", 100, 32000);
  num("fov", "fov", 60, 130);
  num("sens2d", "sens2d", 0.05, 10);
  $("anchor").addEventListener("change", () => {
    app.settings.anchor = $("anchor").value;
    save();
  });
  $("allowOdd").addEventListener("change", () => {
    app.settings.allowOdd = $("allowOdd").checked;
    save();
  });
  document.querySelectorAll('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => {
      app.settings.mode = r.value;
      save();
      renderAll();
    }),
  );
}

// ---------- calibrate ----------

function dirPoints(trials) {
  const ok = trials.filter((t) => t.seg?.ok);
  if (ok.length < 48) return [];
  const all = mean(ok.map((t) => Math.log(t.seg.rho)));
  const shift = app.proposal ? app.proposal.profile.a0 - app.profile.a0 : 0;
  const pts = [];
  for (let d = 0; d < DIRECTIONS; d++) {
    const sel = ok.filter((t) => t.dir === d);
    if (sel.length < 2) continue;
    const m = mean(sel.map((t) => Math.log(t.seg.rho))) - all;
    const theta = (2 * Math.PI * d) / DIRECTIONS;
    const value = -m + logGainAtAngle(app.profile, theta) + shift;
    const deg = Math.round((theta * 180) / Math.PI);
    pts.push({ theta, value, deg, n: sel.length, bias: m, tip: `${deg}°: flicks ${m >= 0 ? "overshoot" : "undershoot"} by ${pct(Math.abs(m)).slice(1)} vs your average (${sel.length} flicks). Implied gain ${pct(value)}.` });
  }
  return pts;
}

function renderCalibrate() {
  const trials = calibTrials();
  const ok = trials.filter((t) => t.seg?.ok).length;
  $("calMeter").innerHTML = meter(ok, CAL_GOAL);
  $("calNum").textContent = `${ok} / ${CAL_GOAL} usable flicks`;
  const other = otherCalibCount();
  $("calHint").textContent = other
    ? `${other} flicks from other settings or an earlier profile are kept but not mixed in.`
    : "About six blocks give a reliable answer. Breaks between blocks are fine.";
  const pts = dirPoints(trials);
  $("chart").innerHTML = polarChart({ current: app.profile, proposed: app.proposal?.profile, points: pts, labels: directionLabels() });
  const rows = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const th = (deg * Math.PI) / 180;
    const p = pts.find((q) => q.deg === deg);
    return `<tr><td>${deg}°</td><td>${pct(logGainAtAngle(app.profile, th))}</td><td>${app.proposal ? pct(logGainAtAngle(app.proposal.profile, th)) : "·"}</td><td>${p ? pct(p.value) : "·"}</td></tr>`;
  });
  $("chartTable").innerHTML = `<table><tr><th>Direction</th><th>Current</th><th>Proposed</th><th>Implied</th></tr>${rows.join("")}</table>`;
  $("btnAccept").disabled = !app.proposal;
}

function verdictHtml(kind, title, text) {
  const icon = { good: "✓", bad: "✕", neutral: "○" }[kind];
  return `<div class="verdict ${kind}"><span class="icon" aria-hidden="true">${icon}</span><div><h3>${esc(title)}</h3><p>${text}</p></div></div>`;
}

function runAnalysis() {
  const trials = calibTrials();
  const usable = trials.filter((t) => t.seg?.ok).map((t) => ({ theta: t.theta, amp: t.amp, group: t.group, rho: t.seg.rho }));
  app.proposal = null;
  const res = analyze(usable, { odd: !!app.settings.allowOdd });
  app.lastResult = res;
  if (!res.ok) {
    $("analysis").innerHTML = verdictHtml("neutral", "Not enough flicks yet", `${esc(res.reason)}. Play a block first.`);
    $("analysisFacts").innerHTML = "";
    renderCalibrate();
    return;
  }
  const fmtP = (p) => (p < 0.001 ? "< 0.001" : p.toFixed(3));
  const gateRow = (label, g) =>
    g ? `<tr><td>${label}</td><td class="num">p ${fmtP(g.p)}</td><td>${g.pass ? '<span class="ok">✓ real</span>' : '<span class="muted">not proven</span>'}</td></tr>` : "";
  const cons = res.consistency;
  $("analysisFacts").innerHTML = `
    <table class="facts">
      <tr><th>Check</th><th>Evidence</th><th>Result</th></tr>
      ${gateRow("Direction shape (diagonals, axes)", res.even)}
      ${gateRow("Left vs right, push vs pull", res.odd)}
      <tr><td>Bias size across directions</td><td class="num">${(res.residualRms * 100).toFixed(1)}% RMS</td><td></td></tr>
      ${cons ? `<tr><td>Same pattern at all distances</td><td class="num">p ${fmtP(cons.p)}</td><td>${cons.consistent ? '<span class="ok">✓ yes</span>' : '<span class="no">differs by distance</span>'}</td></tr>` : ""}
      <tr><td>Flicks analyzed</td><td class="num">${res.n} of ${trials.length}</td><td class="muted small">${trials.length - res.n} rejected</td></tr>
    </table>
    <p class="hint">A check passes only when shuffling your directions almost never produces a pattern this strong (p below ${app.settings.allowOdd ? "0.005" : "0.01"}). Each round moves the profile only halfway toward the dots, so noise cannot push it too far.</p>`;
  if (res.pass) {
    const next = updateProfile(app.profile, res, { anchor: app.settings.anchor, allowOdd: !!app.settings.allowOdd }).profile;
    next.lambda = lambdaForDpi(app.settings.dpi);
    app.proposal = { profile: next, result: res };
    $("analysis").innerHTML = verdictHtml(
      "good",
      "Your aim has a measurable directional bias",
      "The orange curve is the proposed correction. Use it, then play another block: the next analysis measures what is left. Stop when no check passes.",
    );
  } else {
    $("analysis").innerHTML = verdictHtml(
      "neutral",
      "No reliable directional bias at this sample size",
      "Keep the current profile. Play more blocks, or stop here: if your aim has no consistent directional bias, a flat profile is the right answer.",
    );
  }
  renderCalibrate();
  renderRail();
}

// ---------- validate ----------

function renderValidate() {
  const ab = sessionsOf("ab");
  const tr = sessionsOf("tracking");
  const trials = ab.flatMap((s) => s.trials.map((t) => ({ ...t, blockId: `${s.id}:${t.block}` })));
  const by = (c) => trials.filter((t) => t.cond === c);
  const n = Math.min(by("A").length, by("B").length);
  $("abMeter").innerHTML = meter(n, AB_GOAL);
  $("abNum").textContent = `${n} / ${AB_GOAL} flicks per condition`;
  document.querySelectorAll('input[name="variant"]').forEach((r) => (r.checked = r.value === app.settings.variant));
  $("raShare").textContent = `Exactly what Raw Accel can apply: ${(100 * rawAccelFit(app.profile).captured).toFixed(0)}% of your profile's pattern.`;
  const flat = profileKey(app.profile) === profileKey({ ...defaultProfile(), a0: app.profile.a0, lambda: app.profile.lambda, reset_ms: app.profile.reset_ms });
  $("btnAB").disabled = flat;
  $("btnTrack").disabled = flat || SIM;
  if (flat) {
    $("abResult").innerHTML = verdictHtml("neutral", "Nothing to test yet", "Your profile is flat. Calibrate and accept a profile first.");
    return;
  }
  if (!trials.length && !tr.length) {
    $("abResult").innerHTML = verdictHtml("neutral", "No A/B data for this profile yet", "One session is 192 targets, about five minutes.");
    return;
  }
  let html = "";
  if (trials.length) {
    const blockMeans = (c) => {
      const g = new Map();
      for (const t of by(c)) {
        if (!t.hit) continue;
        if (!g.has(t.blockId)) g.set(t.blockId, []);
        g.get(t.blockId).push(t.timeToHit);
      }
      return [...g.values()].map(mean);
    };
    const d = bootstrapDiff(blockMeans("A"), blockMeans("B"));
    const tth = (c) => mean(by(c).filter((t) => t.hit).map((t) => t.timeToHit));
    const hr = (c) => by(c).filter((t) => t.hit).length / Math.max(1, by(c).length);
    const enough = n >= AB_GOAL;
    if (d) {
      let v;
      if (d.hi < 0) v = ["good", enough ? "The profile makes you faster" : "Leaning faster (preliminary)", `With the profile you hit targets ${Math.abs(d.diff).toFixed(0)} ms sooner on average, and the whole 95% interval is below zero.`];
      else if (d.lo > 0) v = ["bad", enough ? "The profile makes you slower" : "Leaning slower (preliminary)", "Reset to flat, or recalibrate. A profile that slows you down should not be used."];
      else v = ["neutral", "No detectable difference yet", "The interval still includes zero."];
      if (!enough) v[2] += ` Keep going until ${AB_GOAL} flicks per condition before deciding.`;
      html += verdictHtml(...v);
      html += `<figure class="chart" style="max-width:640px"><figcaption>Time to hit, with profile minus without (block means, 95% interval)</figcaption>${intervalChart({ diff: d.diff, lo: d.lo, hi: d.hi, unit: "ms", betterLabel: "profile faster", worseLabel: "profile slower" })}</figure>`;
    }
    html += `<table class="facts"><tr><th></th><th>Without</th><th>With profile</th></tr>
      <tr><td>Flicks</td><td class="num">${by("A").length}</td><td class="num">${by("B").length}</td></tr>
      <tr><td>Hit rate</td><td class="num">${(100 * hr("A")).toFixed(1)}%</td><td class="num">${(100 * hr("B")).toFixed(1)}%</td></tr>
      <tr><td>Mean time to hit</td><td class="num">${tth("A").toFixed(0)} ms</td><td class="num">${tth("B").toFixed(0)} ms</td></tr></table>`;
  }
  if (tr.length) {
    const win = (c) => tr.flatMap((s) => s.runs.filter((r) => r.cond === c).flatMap((r) => r.windows));
    const d = bootstrapDiff(win("A"), win("B"));
    const unit = app.settings.mode === "fps" ? "°" : "px";
    if (d) {
      html += `<h2>Tracking check</h2>`;
      html += d.lo > 0
        ? verdictHtml("bad", "The profile hurts tracking", "Your tracking error is higher with the profile. Consider resetting.")
        : verdictHtml("good", "No tracking regression detected", "Following a moving target is not worse with the profile.");
      html += `<figure class="chart" style="max-width:640px"><figcaption>Tracking error, with profile minus without (95% interval)</figcaption>${intervalChart({ diff: d.diff, lo: d.lo, hi: d.hi, unit, digits: 2, betterLabel: "profile more accurate", worseLabel: "profile less accurate" })}</figure>`;
    }
  }
  $("abResult").innerHTML = html;
}

// ---------- install ----------

function renderInstall() {
  const ra = rawAccelFit(app.profile);
  const dpi = app.settings.dpi;
  const json = [
    `"Output DPI": ${(1000 * ra.sens).toFixed(1)},`,
    `"Y/X output DPI ratio (vertical sens multiplier)": ${ra.yx.toFixed(4)},`,
    `"L/R output DPI ratio (left sens multiplier)": ${ra.lr.toFixed(4)},`,
    `"U/D output DPI ratio (up sens multiplier)": ${ra.ud.toFixed(4)},`,
  ].join("\n");
  const flat = ra.captured === 1 && Math.abs(ra.yx - 1) < 1e-9;
  $("installBody").innerHTML = `
    ${flat ? '<div class="callout"><b>Your profile is flat.</b> Calibrate and accept a profile first; until then both options do nothing.</div>' : ""}
    <div class="paths">
      <section>
        <h3>Raw Accel</h3>
        <p class="tagline">Signed driver many players already use. The safer choice for games with anti-cheat.</p>
        <table class="facts">
          <tr><th>Raw Accel setting</th><th>Value</th></tr>
          <tr><td>Output DPI <span class="muted small">(device DPI not set in Raw Accel)</span></td><td class="num">${(1000 * ra.sens).toFixed(1)}</td></tr>
          <tr><td>Output DPI <span class="muted small">(device DPI set to ${dpi})</span></td><td class="num">${(dpi * ra.sens).toFixed(1)}</td></tr>
          <tr><td>Y/X ratio (vertical)</td><td class="num">${ra.yx.toFixed(4)}</td></tr>
          <tr><td>L/R ratio (moving left)</td><td class="num">${ra.lr.toFixed(4)}</td></tr>
          <tr><td>U/D ratio (moving up / pushing)</td><td class="num">${ra.ud.toFixed(4)}</td></tr>
        </table>
        <p class="small">Raw Accel can express <b>${(100 * ra.captured).toFixed(0)}%</b> of your profile's direction pattern (remaining error ${ra.rmsErrorPct.toFixed(1)}%, aim direction shifts up to ${ra.maxDirectionErrorDeg.toFixed(1)}°). It has no setting for diagonals.</p>
        <ol>
          <li>Install Raw Accel from its official GitHub releases and reboot.</li>
          <li>In <span class="mono">settings.json</span>, set these four fields in your profile, then run <span class="mono">writer.exe settings.json</span> (or set them in the GUI where available).</li>
        </ol>
        <pre class="code" id="raJson">${esc(json)}</pre>
        <div class="actions"><button class="btn" type="button" id="btnCopyRa">Copy these lines</button></div>
      </section>
      <section>
        <h3>Full profile: DirGain for Windows</h3>
        <p class="tagline">Applies every part of your profile, diagonals included, through the Interception driver.</p>
        <ol>
          <li>Install the Interception driver: from its GitHub release, run <span class="mono">install-interception.exe /install</span> as administrator, then reboot.</li>
          <li>Put <span class="mono">dirgain.exe</span> (from <span class="mono">dirgain/dist/windows</span> in the repository) and your <span class="mono">profile.conf</span> in one folder.</li>
          <li>Run <span class="mono">dirgain.exe profile.conf</span>. <span class="mono">Ctrl+Alt+F8</span> turns it on and off; saving a new profile.conf reloads it.</li>
        </ol>
        <div class="actions dl"><button class="btn primary" type="button" id="btnConf">Download profile.conf</button><button class="btn quiet" type="button" id="btnJson">profile.json</button></div>
        <p class="small muted">Or copy it into a text file named <span class="mono">profile.conf</span>:</p>
        <pre class="code" id="confText">${esc(confText())}</pre>
        <div class="actions"><button class="btn" type="button" id="btnCopyConf">Copy profile.conf</button></div>
        <div class="callout"><b>Anti-cheat warning.</b> Kernel input filters like Interception are blocked or flagged by some anti-cheat systems. Check your game's rules first; when in doubt, use the Raw Accel route.</div>
      </section>
    </div>`;
  $("btnCopyRa").addEventListener("click", () => copyText(json, "raJson", "btnCopyRa"));
  $("btnCopyConf").addEventListener("click", () => copyText(confText(), "confText", "btnCopyConf"));
  $("btnConf").addEventListener("click", () => download("profile.conf", confText()));
  $("btnJson").addEventListener("click", () =>
    download("profile.json", JSON.stringify({ format: "dirgain-profile", version: 2, profile: app.profile, settings: app.settings, created: new Date().toISOString() }, null, 2), "application/json"),
  );
}

// ---------- data ----------

function renderData() {
  if (!app.sessions.length) {
    $("dataBody").innerHTML = `<p class="muted">No sessions yet.</p>`;
    return;
  }
  const rows = app.sessions
    .slice(-12)
    .reverse()
    .map((s) => {
      const n = s.trials?.length ?? 0;
      const runs = s.runs?.length ?? 0;
      const when = new Date(Number(s.id)).toLocaleString();
      return `<tr><td>${esc(when)}</td><td>${esc(s.kind)}${s.sim ? " (sim)" : ""}</td><td>${esc(s.settings?.mode ?? "")}</td><td class="num">${s.kind === "tracking" ? `${runs} runs` : `${n} flicks`}</td></tr>`;
    });
  $("dataBody").innerHTML = `<table class="facts"><tr><th>When</th><th>Kind</th><th>Mode</th><th>Size</th></tr>${rows.join("")}</table>${app.sessions.length > 12 ? `<p class="hint">Showing the latest 12 of ${app.sessions.length}.</p>` : ""}`;
}

function renderAll() {
  renderRail();
  if (app.step === "setup") renderSetup();
  if (app.step === "calibrate") renderCalibrate();
  if (app.step === "validate") renderValidate();
  if (app.step === "install") renderInstall();
  if (app.step === "data") renderData();
}

// ---------- running tasks ----------

let arena;

function newSession(kind) {
  return { id: `${Date.now()}`, kind, sim: SIM, variant: app.settings.variant, calibKey: calibKey(), profile: { ...app.profile }, settings: { ...app.settings }, trials: [], runs: [] };
}

function finish(session) {
  if (session.trials.length || session.runs.length) app.sessions.push(session);
  save();
  renderAll();
}

function abPlan() {
  const seed = Date.now() & 0xffff;
  return AB_ORDER.flatMap((cond, b) =>
    makeBlock(1, seed + b)
      .filter((t) => t.amp === (t.dir + b) % 3)
      .map((t) => ({ ...t, cond, block: b })),
  );
}

const profileFor = (t) => (t.cond === "A" ? controlProfile() : testProfile());

async function runReal(kind, plan, pf, label) {
  const session = newSession(kind);
  try {
    const res = await arena.runFlicks({ plan, profileFor: pf, settings: app.settings, k: unitsPerCount(), label });
    session.trials = res.trials;
    session.raw = res.raw;
  } catch (err) {
    $(kind === "ab" ? "abResult" : "analysis").innerHTML = verdictHtml("bad", "Could not start", `${esc(err.message)}. Click inside the page first, and use Chrome or Edge.`);
  }
  finish(session);
}

function simUser() {
  if (!app.simUser) app.simUser = createSimUser({ seed: 7, biasCoef: [0.05, -0.03, 0.03, 0.02], oddCoef: [0.03, 0], noiseSd: 0.1, adaptRate: 0.05 });
  return app.simUser;
}

function runSim(kind, plan, pf) {
  const session = newSession(kind);
  const k = unitsPerCount();
  for (const trial of plan) {
    const tgt = app.settings.mode === "fps" ? fpsTargetFor(trial) : targetFor(trial, 1600, 900);
    const res = runSimTrial(simUser(), tgt, { sens: k, radius: tgt.radius, profile: pf(trial) });
    const seg = segmentTrial(res.samples, tgt);
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
      seg: seg.ok ? { ok: true, rho: seg.rho, rhoMirror: seg.rhoMirror, lateral: seg.lateral, onsetMs: seg.onsetMs } : { ok: false, reason: seg.reason },
    });
  }
  finish(session);
}

// ---------- tooltip ----------

function bindTooltip() {
  const tip = $("tip");
  const show = (el, x, y) => {
    tip.textContent = el.getAttribute("data-tip");
    tip.classList.add("on");
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(innerWidth - w - 8, x + 14)}px`;
    tip.style.top = `${y + 16}px`;
  };
  const hide = () => tip.classList.remove("on");
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el, e.clientX, e.clientY);
    else hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (!el) return hide();
    const r = el.getBoundingClientRect();
    show(el, r.right, r.top);
  });
  document.addEventListener("focusout", hide);
}

// ---------- theme ----------

function bindTheme() {
  if (ARTIFACT) {
    $("themeBtn").hidden = true;
    return;
  }
  const order = ["system", "light", "dark"];
  let cur = "system";
  try {
    cur = localStorage.getItem(THEME_KEY) || "system";
  } catch {
    /* default to system */
  }
  const apply = () => {
    if (cur === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = cur;
    $("themeBtn").textContent = `Theme: ${cur}`;
  };
  apply();
  $("themeBtn").addEventListener("click", () => {
    cur = order[(order.indexOf(cur) + 1) % order.length];
    try {
      localStorage.setItem(THEME_KEY, cur);
    } catch {
      /* not persisted */
    }
    apply();
  });
}

// ---------- demo mode ----------

// Demo mode swaps in its own profile so nothing done in the demo touches the real one.
function setSim(on) {
  if (on && !SIM) {
    app.realProfile = app.profile;
    app.profile = app.demoProfile;
  } else if (!on && SIM) {
    app.demoProfile = app.profile;
    app.profile = app.realProfile;
  }
  SIM = on;
  app.proposal = null;
  $("analysis").innerHTML = "";
  $("analysisFacts").innerHTML = "";
  $("simBanner").hidden = !on;
  $("demoBtn").setAttribute("aria-pressed", String(on));
  $("demoBtn").textContent = on ? "Demo mode: on" : "Demo mode";
  $("btnCalib").textContent = on ? "Simulate a block" : "Start a block";
  $("btnAB").textContent = on ? "Simulate an A/B session" : "Start an A/B session";
  renderAll();
}

// ---------- init ----------

function init() {
  load();
  arena = createArena({ root: $("arena"), canvas: $("canvas"), hud: $("hud"), progress: $("arenaProgress") });
  setSim(SIM_FROM_URL);
  $("demoBtn").addEventListener("click", () => setSim(!SIM));
  document.querySelectorAll('input[name="variant"]').forEach((r) =>
    r.addEventListener("change", () => {
      app.settings.variant = r.value;
      save();
      renderAll();
    }),
  );
  bindSetup();
  bindTooltip();
  bindTheme();
  document.querySelectorAll("nav.steps [data-step]").forEach((b) => b.addEventListener("click", () => go(b.dataset.step)));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $("btnCalib").addEventListener("click", () => {
    const plan = makeBlock(1, Date.now() & 0xffff);
    if (SIM) runSim("calibrate", plan, () => app.profile);
    else runReal("calibrate", plan, () => app.profile, "Calibration");
  });
  $("btnAnalyze").addEventListener("click", runAnalysis);
  $("btnAccept").addEventListener("click", () => {
    if (!app.proposal) return;
    app.profile = app.proposal.profile;
    app.proposal = null;
    $("analysis").innerHTML = verdictHtml("good", "Profile updated", "Play another block to measure what is left, then analyze again.");
    $("analysisFacts").innerHTML = "";
    save();
    renderAll();
  });
  $("btnResetProfile").addEventListener("click", () => {
    app.profile = { ...defaultProfile(), lambda: lambdaForDpi(app.settings.dpi) };
    app.proposal = null;
    $("analysis").innerHTML = "";
    $("analysisFacts").innerHTML = "";
    save();
    renderAll();
  });
  $("btnAB").addEventListener("click", () => {
    const plan = abPlan();
    if (SIM) runSim("ab", plan, profileFor);
    else runReal("ab", plan, profileFor, "A/B test");
  });
  $("btnTrack").addEventListener("click", async () => {
    const session = newSession("tracking");
    try {
      const res = await arena.runTracking({ conds: ["A", "B", "B", "A"], profileFor: (c) => (c === "A" ? controlProfile() : testProfile()), settings: app.settings, k: unitsPerCount() });
      session.runs = res.runs;
    } catch (err) {
      $("abResult").innerHTML = verdictHtml("bad", "Could not start", esc(err.message));
    }
    finish(session);
  });
  $("btnData").addEventListener("click", () =>
    download("dirgain-data.json", JSON.stringify({ format: "dirgain-data", version: 2, settings: app.settings, profile: SIM ? app.realProfile : app.profile, sessions: app.sessions }), "application/json"),
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
      $("dataBody").insertAdjacentHTML("afterbegin", verdictHtml("bad", "Import failed", esc(err.message)));
    }
  });
  let armed = null;
  $("btnClear").addEventListener("click", () => {
    if (!armed) {
      $("btnClear").textContent = "Click again to delete everything";
      armed = setTimeout(() => {
        armed = null;
        $("btnClear").textContent = "Delete all sessions";
      }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    $("btnClear").textContent = "Deleted";
    app.sessions = [];
    save();
    renderAll();
  });
  if (ARTIFACT) document.documentElement.classList.add("artifact");
  if (ARTIFACT && !app.sessions.length) {
    setSim(true);
    for (let i = 0; i < 6; i++) runSim("calibrate", makeBlock(1, 1000 + i), () => app.profile);
    app.step = "calibrate";
    go("calibrate");
    runAnalysis();
    return;
  }
  go(app.step);
}

init();
