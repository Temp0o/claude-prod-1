import { logGainAtAngle } from "../core/dirgain.js";

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function pct(logGain) {
  const v = (Math.exp(logGain) - 1) * 100;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
}

const SIZE = 380;
const C = SIZE / 2;
const R0 = 100;
const EXAGGERATE = 4;
const radius = (lg) => R0 * (1 + EXAGGERATE * (Math.exp(lg) - 1));

function curve(fn) {
  const pts = [];
  for (let i = 0; i <= 240; i++) {
    const th = (i * 2 * Math.PI) / 240;
    const r = Math.max(4, radius(fn(th)));
    pts.push(`${(C + r * Math.cos(th)).toFixed(1)},${(C + r * Math.sin(th)).toFixed(1)}`);
  }
  return pts.join(" ");
}

// Polar view of gain by movement direction. Screen convention: right = 0 deg, down = 90 deg.
// points: [{theta, value (log gain), tip}]; labels: {right, down, left, up}.
export function polarChart({ current, proposed, points = [], labels }) {
  const out = [`<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Gain by mouse movement direction">`];
  for (const g of [0.9, 1.1]) out.push(`<circle class="grid" cx="${C}" cy="${C}" r="${radius(Math.log(g)).toFixed(1)}"/>`);
  out.push(`<circle class="base" cx="${C}" cy="${C}" r="${R0}"/>`);
  out.push(`<line class="grid" x1="${C - 170}" y1="${C}" x2="${C + 170}" y2="${C}"/>`);
  out.push(`<line class="grid" x1="${C}" y1="${C - 170}" x2="${C}" y2="${C + 170}"/>`);
  out.push(`<text class="tick" x="${C + 4}" y="${(C - radius(Math.log(1.1)) - 4).toFixed(1)}">+10%</text>`);
  out.push(`<text class="tick" x="${C + 4}" y="${C - R0 - 4}">±0</text>`);
  out.push(`<text class="tick" x="${C + 4}" y="${(C - radius(Math.log(0.9)) - 4).toFixed(1)}">−10%</text>`);
  out.push(`<text class="axis" x="${SIZE - 6}" y="${C - 6}" text-anchor="end">${esc(labels.right)}</text>`);
  out.push(`<text class="axis" x="6" y="${C - 6}">${esc(labels.left)}</text>`);
  out.push(`<text class="axis" x="${C}" y="16" text-anchor="middle">${esc(labels.up)}</text>`);
  out.push(`<text class="axis" x="${C}" y="${SIZE - 6}" text-anchor="middle">${esc(labels.down)}</text>`);
  if (current) out.push(`<polyline class="s1" points="${curve((th) => logGainAtAngle(current, th))}"/>`);
  if (proposed) out.push(`<polyline class="s2" points="${curve((th) => logGainAtAngle(proposed, th))}"/>`);
  for (const p of points) {
    const r = Math.max(4, radius(p.value));
    const x = (C + r * Math.cos(p.theta)).toFixed(1);
    const y = (C + r * Math.sin(p.theta)).toFixed(1);
    out.push(`<circle class="pt" cx="${x}" cy="${y}" r="4"/>`);
    out.push(`<circle class="hit" cx="${x}" cy="${y}" r="12" tabindex="0" data-tip="${esc(p.tip)}"/>`);
  }
  out.push("</svg>");
  return out.join("");
}

// One interval on a symmetric axis around zero, with the side that means "better" labeled.
export function intervalChart({ diff, lo, hi, unit, digits = 0, betterLabel, worseLabel }) {
  const W = 560;
  const H = 76;
  const pad = 24;
  const span = Math.max(Math.abs(lo), Math.abs(hi), Math.abs(diff), 1e-9) * 1.25;
  const X = (v) => pad + ((v + span) / (2 * span)) * (W - 2 * pad);
  const f = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)} ${unit}`;
  const tip = `Difference ${f(diff)}, 95% interval ${f(lo)} to ${f(hi)}`;
  return [
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(tip)}">`,
    `<line class="grid" x1="${pad}" y1="34" x2="${W - pad}" y2="34"/>`,
    `<line class="base" x1="${X(0)}" y1="14" x2="${X(0)}" y2="54"/>`,
    `<text class="tick" x="${X(0)}" y="70" text-anchor="middle">0</text>`,
    `<text class="axis" x="${pad}" y="10">${esc(betterLabel)}</text>`,
    `<text class="axis" x="${W - pad}" y="10" text-anchor="end">${esc(worseLabel)}</text>`,
    `<line class="ci" x1="${X(lo).toFixed(1)}" y1="34" x2="${X(hi).toFixed(1)}" y2="34"/>`,
    `<circle class="est" cx="${X(diff).toFixed(1)}" cy="34" r="6"/>`,
    `<text class="tick" x="${X(lo).toFixed(1)}" y="70" text-anchor="middle">${esc(f(lo))}</text>`,
    `<text class="tick" x="${X(hi).toFixed(1)}" y="70" text-anchor="middle">${esc(f(hi))}</text>`,
    `<rect class="hitbar" x="${(X(lo) - 8).toFixed(1)}" y="20" width="${(X(hi) - X(lo) + 16).toFixed(1)}" height="28" tabindex="0" data-tip="${esc(tip)}"/>`,
    "</svg>",
  ].join("");
}

export function meter(value, goal) {
  const frac = Math.max(0, Math.min(1, value / goal));
  return `<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${Math.round(value)}"><span style="transform:scaleX(${frac.toFixed(3)})"></span></div>`;
}
