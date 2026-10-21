import { test } from "node:test";
import assert from "node:assert/strict";
import { cm360, degPerCount } from "./games.js";
import { fpsTargetFor } from "./protocol.js";

test("game presets convert to camera degrees per count and cm/360", () => {
  const val = { game: "valorant", sens: 0.35, dpi: 800 };
  assert.ok(Math.abs(degPerCount(val) - 0.0245) < 1e-12);
  assert.ok(Math.abs(cm360(val) - (360 / (0.0245 * 800)) * 2.54) < 1e-9);
  const cs = { game: "cs2", sens: 2, dpi: 400 };
  assert.ok(Math.abs(cm360(cs) - (360 / (0.044 * 400)) * 2.54) < 1e-9);
});

test("custom game uses the entered cm/360", () => {
  const s = { game: "custom", cm360: 40, dpi: 1600 };
  assert.ok(Math.abs(cm360(s) - 40) < 1e-9);
});

test("FPS targets sit at the planned angle and distance", () => {
  const t = fpsTargetFor({ theta: Math.PI / 2, amp: 1 });
  assert.ok(Math.abs(t.x) < 1e-9 && Math.abs(t.y - 18) < 1e-9 && t.D === 18 && t.radius >= 0.8);
});
