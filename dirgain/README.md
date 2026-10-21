# DirGain

A free, open, any-mouse remake of the idea behind Corsair PureVector. DirGain measures whether your flicks overshoot or undershoot differently by direction. If that bias is statistically real, it corrects it with a per-direction gain applied to your mouse before games see it, and then checks with a blind A/B test whether that actually makes you faster. It is independent of Corsair and Aimlabs; no Corsair or Aimlabs code or data was used. Design and research: `../ALGORITHM-spec.md`.

## Quick start (Windows)

1. **Calibrate:** open `dist/dirgain-calibrator.html` in Chrome or Edge (just double-click it).
   - **Step 1:** pick your game and sensitivity, so the FPS task uses your real hand movement (cm/360).
   - **Step 2:** play calibration blocks (72 flicks, about 2 minutes each), click **Analyze**, accept the proposal, and repeat until no check passes.
   - **Step 3:** run blind A/B sessions until about 280 flicks per condition. Keep the profile only if it makes you faster.
2. **Use it in games** (step 4 of the calibrator), either:
   - **Raw Accel** (signed driver, the safer choice with anti-cheat): enter the four values the calibrator gives you. It tells you how much of your profile they capture.
   - **Full profile:** `dist/windows/dirgain.exe` plus the Interception driver. See `dist/windows/README-Windows.txt`.

Add `?sim=1` to the calibrator's address to see the whole flow with a simulated player.

## What's here and how far each part is verified

| Part | Path | Verified |
|---|---|---|
| Core transform, JS reference and C port | `core/` | 13 property tests. C and JS agree exactly on 12,816 test-vector events, including asymmetric profiles. |
| Estimator: segmentation, permutation-gated fit, closed-loop update, Raw Accel fit, A/B stats | `web/analysis.js` | Matches the Python reference fit to 1e-9. Gate calibrated on 500 simulated null players: 4.6% below p 0.05, 1.0% below p 0.01. Detects simulated directional and left/right biases in 30 of 30 players. |
| Calibrator: FPS camera and desktop modes, game presets, A/B, tracking check, install guide | `web/`, single file `dist/dirgain-calibrator.html` | Full simulated flow driven in headless Chromium in light and dark themes and at phone width, with no console errors. The real pointer-lock FPS arena was exercised with synthetic input. **Not yet used by a human.** |
| Windows app | `windows/`, `dist/windows/dirgain.exe` | Self-contained exe (no extra DLLs). Its real event loop passes 8 checks under Wine against a mock Interception library. **Not yet run on Windows with the real driver.** |
| Linux daemon (evdev grab + uinput) | `linux/` | Frame logic unit-tested; compiles with `-Werror`. Not run on real hardware. |

## How the algorithm works, briefly
- **Gain model:** a smooth function of movement direction. It has even harmonics (axes vs diagonals, tilted axes), plus an optional first odd harmonic (left vs right, push vs pull).
- **Calibration:** the extent of your first ballistic movement is measured per flick. A Huber-robust fit gives each session × distance its own intercept, so day-to-day changes in your overall gain don't leak into the direction terms. Movements that start before the target appears are rejected.
- **Gate:** a profile is proposed only if a within-group permutation test says the directional pattern is real. The parametric test it replaced gave 3-5% false profiles on realistic simulated data.
- **Updates:** each round moves only halfway toward the fitted correction. The profile is anchored so your left/right gain, which sets your cm/360, stays unchanged.
- **Runtime:** direction is estimated from the last ~0.25 mm of mouse path, so slow 1-count movements still resolve the right direction. There's sub-count carry, so no motion is lost, and the gain is clamped to ±15%.

## Profile format
`key = value` lines: `a0 a1 b1 a2 b2 a3 b3` (even harmonics), `o1c o1s` (left/right and up/down), `lambda` (direction window in counts), `reset_ms`, `clamp`. Angles are device coordinates: 0° = right, 90° = toward you (down).

## Caveats
- **Anti-cheat:** kernel-level input filters (Interception, uinput grabs) can be blocked or flagged. Check your game's rules first, and prefer the Raw Accel route for protected games.
- **No evidence yet that it helps humans.** The simulation shows the pipeline works when a bias exists and is larger than your flick-to-flick noise. The blind A/B test is how you find out for yourself.
- PureVector's real algorithm is unpublished. `../RE-capture-guide.md` explains how to capture Corsair Web Hub and Aimlabs artifacts for analysis with REA.

## Develop
- `make test` runs all JS and C tests.
- `make bundle` rebuilds the single-file calibrator.
- `make linux` builds the Linux daemon.
- `make windows INTERCEPTION_SDK=…` and `make windows-test INTERCEPTION_SDK=…` build the Windows exe and test it under Wine. These need MinGW-w64, Wine and a checkout of oblitum/Interception.
- The Python estimator simulations are in `../sim/`.
