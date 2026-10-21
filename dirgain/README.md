# DirGain

A free, open, any-mouse remake of the idea behind Corsair PureVector: measure whether your flicks overshoot or undershoot differently by direction, and if that bias is real, correct it with a per-direction gain applied to your mouse's movement. It is independent of Corsair and Aimlabs, and no Corsair or Aimlabs code or data was used. The design and research are in `../ALGORITHM-spec.md`.

## What's here and how far each part is verified

| Part | Path | Verified |
|---|---|---|
| Core transform (JS reference + C port) | `core/` | 11 property tests (identity, exact sign symmetry, π-periodicity, clamp, slow-motion direction, reversal, carry). C and JS agree exactly on 9,612 test-vector events. |
| Analysis: submovement segmentation, gated estimator, closed-loop update, A/B stats | `web/analysis.js` | Matches the Python reference estimator to 1e-9. End-to-end tests with a simulated user; across 30 seeds, 1 near-miss on recovery and a 1/30 null false-positive rate. |
| Browser calibrator | `web/`, single file `dist/dirgain-calibrator.html` | Full simulated flow driven in headless Chromium (served and `file://` builds), no console errors. Real pointer-lock path smoke-tested with synthetic input. **Not yet used by a human.** |
| Linux daemon (evdev grab + uinput) | `linux/` | Frame logic unit-tested (passthrough, SYN_DROPPED, gains). Compiles with `-Werror`. **Not run on real hardware** (the build container has no input devices). |
| Windows adapter (Interception driver) | `windows/` | Cross-compiles with MinGW against the Interception SDK. **Not run on Windows.** |

## Use it

**1. Calibrate (any OS, Chrome or Edge).** Open `dist/dirgain-calibrator.html`, or run `python3 -m http.server` in this folder and open `http://localhost:8000/web/`. Add `?sim=1` to the URL for a demo with a simulated user.
- Run calibration blocks (72 flicks each) until you have about 400 usable trials, then click **Analyze**.
- If the statistical gate passes, **Accept** the proposal and run more blocks. Repeat until the gate stops passing, which means the bias that's left is too small to measure.
- Run **A/B sessions** (blind) until there are about 280 trials per condition. Keep the profile only if the interval for time-to-hit is entirely below zero and the tracking guard shows no regression. Otherwise **Reset to flat**.
- **Download profile.conf.**

**2. Apply it to your whole system.**
- **Linux:** `make linux`, then `sudo build/dirgaind -p profile.conf /dev/input/by-id/<your-mouse>-event-mouse`. Ctrl+C releases the mouse; `kill -HUP` reloads the profile.
- **Windows:**
  1. Install the [Interception](https://github.com/oblitum/Interception) driver (its release has an installer; reboot afterwards).
  2. Build with `make windows INTERCEPTION_SDK=/path/to/Interception` (MinGW) or the equivalent MSVC command.
  3. Run `dirgain-interception.exe profile.conf`.
  
  Interception is LGPL for non-commercial use, with a separate commercial license.

## Profile format
`key = value` lines: `a0 a1 b1 a2 b2 a3 b3` (log-gain harmonics of the doubled movement angle), `lambda` (direction window in counts), `reset_ms`, `clamp`. Angles are in device coordinates: 0° = right, 90° = **down**, the same as mouse reports on Linux and Windows.

## Caveats
- **Anti-cheat:** kernel-level input filters (uinput grabs, Interception) can be flagged by anti-cheat systems. Don't use this in protected competitive games until you have checked that game's rules.
- **No evidence yet that it helps humans.** The simulation shows the pipeline works if the bias exists and is larger than your trial-to-trial noise. The calibrator's A/B test is how you find out for yourself.
- PureVector's real algorithm is unpublished. See `../RE-capture-guide.md` for how to capture Corsair Web Hub and Aimlabs artifacts so they can be analyzed with REA.

## Develop
`make test` runs all JS and C tests. `make bundle` rebuilds the single-file calibrator. `make linux` builds the daemon. The Python estimator simulations are in `../sim/`.
