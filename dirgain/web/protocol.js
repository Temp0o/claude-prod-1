import { mulberry32 } from "./analysis.js";

export const DIRECTIONS = 24;
export const AMP_FRACS = [0.14, 0.26, 0.4];

// Angles are in screen/device coordinates (y grows downward), matching mouse reports.
export function makeBlock(reps, seed) {
  const r = mulberry32(seed);
  const trials = [];
  for (let k = 0; k < reps; k++) {
    for (let d = 0; d < DIRECTIONS; d++) {
      for (let a = 0; a < AMP_FRACS.length; a++) {
        trials.push({ dir: d, theta: (2 * Math.PI * d) / DIRECTIONS, amp: a });
      }
    }
  }
  for (let i = trials.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [trials[i], trials[j]] = [trials[j], trials[i]];
  }
  for (let i = 1; i < trials.length; i++) {
    if (trials[i].dir === trials[i - 1].dir) {
      const j = trials.findIndex((t, k) => k > i && t.dir !== trials[i - 1].dir);
      if (j > 0) [trials[i], trials[j]] = [trials[j], trials[i]];
    }
  }
  return trials;
}

export function targetFor(trial, viewW, viewH) {
  const D = AMP_FRACS[trial.amp] * Math.min(viewW, viewH);
  return {
    x: D * Math.cos(trial.theta),
    y: D * Math.sin(trial.theta),
    D,
    radius: Math.max(10, D / 24),
  };
}
