import { logGainAtAngle } from "../core/dirgain.js";

const SIZE = 360;
const C = SIZE / 2;
const R0 = 110;
const EXAGGERATE = 4;

function radius(logGain) {
  return R0 * (1 + EXAGGERATE * (Math.exp(logGain) - 1));
}

function curve(fn) {
  const pts = [];
  for (let i = 0; i <= 180; i++) {
    const th = (i * 2 * Math.PI) / 180;
    const r = radius(fn(th));
    pts.push(`${(C + r * Math.cos(th)).toFixed(1)},${(C + r * Math.sin(th)).toFixed(1)}`);
  }
  return pts.join(" ");
}

// Screen convention: +x right, +y down, matching mouse reports.
export function polarChart({ current, proposed, dirPoints = [] }) {
  const parts = [`<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="Gain by movement direction">`];
  for (const g of [0.9, 1.0, 1.1]) {
    parts.push(`<circle class="ref" cx="${C}" cy="${C}" r="${radius(Math.log(g)).toFixed(1)}"/>`);
  }
  parts.push(`<line class="axis" x1="${C - 170}" y1="${C}" x2="${C + 170}" y2="${C}"/>`);
  parts.push(`<line class="axis" x1="${C}" y1="${C - 170}" x2="${C}" y2="${C + 170}"/>`);
  parts.push(`<text x="${C + R0 * 1.42}" y="${C - 4}">right</text>`);
  parts.push(`<text x="${C + 4}" y="${C + R0 * 1.55}">down</text>`);
  parts.push(`<text x="${C + 4}" y="${C - radius(Math.log(1.1)) - 2}">+10%</text>`);
  for (const p of dirPoints) {
    const r = radius(p.logRel);
    for (const th of [p.theta, p.theta + Math.PI]) {
      parts.push(`<circle class="pt" cx="${(C + r * Math.cos(th)).toFixed(1)}" cy="${(C + r * Math.sin(th)).toFixed(1)}" r="2.5"/>`);
    }
  }
  if (current) parts.push(`<polyline class="cur" points="${curve((th) => logGainAtAngle(current, th))}"/>`);
  if (proposed) parts.push(`<polyline class="prop" points="${curve((th) => logGainAtAngle(proposed, th))}"/>`);
  parts.push("</svg>");
  return parts.join("");
}
