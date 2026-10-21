# Open Directional Aim: research and plan

Status: plan only, nothing built yet. Written 2026-10-21.
Tags: **[V]** = found in this session's web research (search summaries, not always the primary page). **[K]** = my own background knowledge, verify before relying on it.

## 1. What PureVector is, and what we don't know

What the sources say [V]:
- Launched on Corsair's SABRE v3 PRO PureVector mice, built with Aimlabs.
- A ~5 minute calibration runs inside Aimlabs while you aim at targets in different directions. It measures how your aim differs by direction and builds a personal **per-direction sensitivity profile**. "Refine calibration" re-runs it later.
- The profile is saved in the **mouse firmware**. No background app is needed, and Corsair's help page says nothing adjusts in real time.
- Corsair's claims: up to 81 ms (33%) faster aim speed, 18% lower directional variance. These come from its internal testing.

What we don't know:
- I could not open corsair.com from this sandbox (DNS blocked). Everything above comes from search summaries of Corsair, press and launch coverage.
- No independent review turned up. The algorithm is unpublished. "Patented" and "4 billion datasets" are unverified claims.
- Sources disagree on real-time versus static. A pre-launch preview said real-time, and the help page says no.
- Working interpretation (my hypothesis): a static direction-dependent gain map applied between sensor and host. Our design does not need to match Corsair's internals. It only needs to measurably help.

## 2. Is there a real effect?

- A small study I found (Lin et al., 4 participants, 8 directions) reports the fastest ballistic moves at 0° and 180°, and smaller aiming error along the cross axes than the diagonals [V]. I did not open the paper, and the sample is tiny.
- Fitts' law work treats movement angle as a confound, which is why ISO 9241-9 uses a circular layout [V]. Direction effects are plausible, but I found no strong open evidence for the size of the benefit.
- Consequence: **validation is built in from day one** (section 4.3). Kill criterion: if a paired A/B on your own aim shows no benefit, stop at the calibration tool.

## 3. Prior art we can reuse

| Project | What it gives us |
|---|---|
| Raw Accel (MIT, Windows 10/11 x64) [V] | Kernel driver that modifies the raw input stream. Has Y/X ratio, separate x/y curves ("By Component"), smoothing, a GUI and signed releases. Active (about 2.6k stars, 84 open issues, UI 2.0 branch in progress). |
| Moufiltr [V] | KMDF upper filter under mouclass. Reference for a standalone driver. Needs Test Mode. |
| Interception wrappers [V] | Wrappers around the Interception driver, not replacements. Not evaluated further. |
| MouseSync / busdog smoothing [V] | User-mode, depends on a USB sniffer driver, adds delay. Not a fit. |
| HID-BPF, Linux 6.3+ [V] | Can alter mouse reports before the kernel driver sees them. Works on raw bytes, so a loader must parse the report descriptor. Runs in IRQ context. |
| libinput [V] | Only adaptive/flat profiles, so no per-direction control. X11 has a coordinate transformation matrix. |

## 4. Design

> The detailed, simulation-checked algorithm is in `ALGORITHM-spec.md`. It supersedes 4.1-4.3 where they differ (log-domain gain, statistical gate, anchor choice, closed-loop update).

### 4.1 The transform ("dirgain")
Per mouse report `(dx, dy)`, output `g(θ)·(dx, dy)` with

`g(θ) = 1 + a1·cos2θ + b1·sin2θ + a2·cos4θ + b2·sin4θ`

- Only even harmonics, so `g(θ) = g(θ+π)`. Opposite directions get the same gain, so out-and-back hand motion returns the cursor to its start. This is a design decision of mine, not a Corsair fact.
- `cos2θ` covers horizontal versus vertical. `sin2θ` covers a tilted axis. The `4θ` terms cover cardinal versus diagonal, which is the pattern in the Lin et al. result.
- No trig needed at runtime. With `r² = dx²+dy²`: `c2=(dx²−dy²)/r²`, `s2=2·dx·dy/r²`, `c4=2c2²−1`, `s4=2·s2·c2`. This is cheap and works in fixed-point.
- Clamp `|g−1| ≤ 0.15` by default (tunable), mean gain fixed at 1 so your overall sensitivity is unchanged.
- **Model B to compare in the A/B:** a linear anisotropic matrix `R(φ)·diag(sx,sy)·R(−φ)`, which generalizes Raw Accel's Y/X ratio. Model A keeps the cursor moving in the hand's direction. B slightly rotates it. Ship whichever wins.

### 4.2 Engineering details that decide quality
- **Fractional carry:** keep a per-device float/fixed residual so small counts are never dropped. Otherwise `g<1` swallows slow 1-count movement.
- **Low-speed direction quantization:** a single packet like `(1,0)` or `(1,1)` only gives 45° steps. Estimate θ from a short windowed vector (EMA of about 2-4 ms, tunable), apply the gain to the raw delta, and measure the lag this adds.
- **DPI independence:** the gain is dimensionless, so any mouse works. Key the profile to (device, DPI, in-game sensitivity) because the optimum may depend on total sensitivity.
- **Kernel math:** Windows kernel code must save FPU state or use fixed-point. Q16.16 is enough here [K].
- **Latency budget:** under 50 µs added per report (my target), measured, not assumed.

### 4.3 Calibration and validation tool (our "Aimlabs" part)
- Static web app, TypeScript, no backend, hostable free on GitHub Pages. It reads raw deltas with Pointer Lock `requestPointerLock({unadjustedMovement: true})` [K, Chromium].
- Trials: center start, target at one of 3 distances in one of 24 directions (15° steps), randomized. Log every raw `(dx, dy, t)`.
- Per-trial metrics: first-submovement radial ratio `ρ` (displacement of the first ballistic move divided by target distance, ending when speed drops below 10% of peak), lateral error, time to hit, correction count.
- Fit: robust (Huber), ridge-regularized π-periodic Fourier fit of `ρ(θ)`, then `ĝ(θ) = mean(ρ)/ρ̂(θ)`, normalized and clamped. Re-run with the profile applied to refine, like Corsair's "Refine".
- **The browser can apply the candidate gain to the pointer-lock deltas itself.** So calibration and A/B are fully testable before any driver exists. The driver then only has to reproduce what was validated.
- A/B: interleaved, counterbalanced blocks of baseline versus fitted on held-out targets. Primary metric is time to hit, secondary is directional variance and lateral error. Paired bootstrap 95% CI. Rough power, assuming per-trial SD of about 120 ms: detecting 20 ms needs about 280 paired trials (about 10-15 min).
- Adaptation confound: a new mapping is worse at first. Judge after a 2-3 day adaptation period and keep a no-profile control.

### 4.4 Profile format
Versioned JSON: harmonic coefficients, clamp, device id, DPI, in-game sensitivity, calibration stats, timestamp. Adapters read it. The driver never needs the web app.

## 5. Platform plan: the free path

| Target | Approach | Cost | Catch |
|---|---|---|---|
| Linux | evdev grab + uinput daemon (Rust or C) first, HID-BPF later (kernel 6.3+) | $0 | No signing needed. Best prototype platform. |
| Windows (preferred) | Propose and contribute a "directional gain" stage to Raw Accel upstream (MIT). You get their signed driver and GUI. | $0 | Maintainers must accept it. Personal fork builds need test signing. |
| Windows (alt) | Standalone KMDF filter, using Moufiltr as a reference | $0 in Test Mode only | Shipping signed needs an EV cert, listed at about $250-500/yr [V]. Sources conflict on whether an individual can get one. Not free. |
| Windows user-mode only (Raw Input + SendInput) | Not recommended | $0 | [K] Games reading Raw Input still see the physical device, so only the desktop cursor is affected. |
| macOS | Out of scope for v1 | | |
| Firmware | Stretch goal, open-firmware mice only (e.g. QMK pointing devices) [K] | $0 | Not "any mouse". |

## 6. Roadmap and exit criteria

0. **Spec and simulator.** A Python notebook with simulated users that have a known `g_true(θ)` plus noise. Exit: the fitter recovers it. Done in `sim/`: the earlier "under 2% at about 400 trials" target was not reachable at realistic noise, and the measured numbers are in `ALGORITHM-spec.md` section 3.
1. **Browser calibrator and A/B.** This is the real go/no-go. Exit: your paired CI shows a benefit, or we stop here.
2. **`dirgain` core library** in portable C, with tests: identity at `g=1`, π-periodicity, no residual loss (property tests), fixed-point versus float agreement, and benchmarks.
3. **Linux daemon.** Measure added latency (compare evdev input timestamps with uinput output).
4. **Windows.** Open an issue with the Raw Accel maintainers first, then implement the stage. Test in a VM with test signing, then on real hardware.
5. **Packaging and docs.** MIT for the library. Pick our own name, not "PureVector".
6. **Stretch:** firmware path for open-firmware mice.

## 7. Risks

- **No real effect.** Handled by the kill criterion above.
- **Anti-cheat.** One outlet says Vanguard does not flag Raw Accel [V, weak source]. I found nothing on EAC or BattlEye. Test Mode likely blocks competitive titles [K]. Rule: don't use it in an anti-cheat game until checked for that title. Dirgain reads no game state and only transforms mouse deltas, but each game's rules decide.
- **IP.** Corsair describes a patented algorithm [V, unverified]. Do a patent search before distributing. Use our own math from public principles, don't copy anything from Corsair or Aimlabs, and don't use the trademark. This is not legal advice.
- **Latency or jitter regression.** Mitigated by the 4.2 measurements.
- **Adaptation confound.** Mitigated by the protocol in 4.3.

## 8. Open questions for you

1. Is your PC Windows or Linux? I assumed Windows, with Linux as the prototyping platform.
2. Which games matter, and do they use anti-cheat?
3. Which mouse and DPI do you use, for default profile settings?

## Sources

- [Corsair press release](https://www.corsair.com/newsroom/press-release/corsair-changes-the-game-with-purevector-a-science-based-personalized-aiming-technology-launching-exclusively-in-the-sabre-v3-pro-purevector-mouse-series)
- [PureVector: The Future of Aiming (Corsair)](https://www.corsair.com/us/en/explorer/gamer/mice/purevector-the-future-of-aiming/)
- [How to Use PureVector (Corsair)](https://www.corsair.com/us/en/explorer/gamer/mice/how-to-use-purevector/)
- [Launch coverage with the 33% claim (Yahoo Finance)](https://finance.yahoo.com/technology/articles/corsair-unleashes-purevector-testing-showing-130000648.html)
- [Raw Accel repository](https://github.com/a1xd/rawaccel) and [Guide](https://github.com/RawAccelOfficial/rawaccel/blob/master/doc/Guide.md)
- [Moufiltr](https://github.com/Devilasa/Moufiltr)
- [Mouse Smoothing (CodeProject)](https://www.codeproject.com/Articles/5247322/Mouse-Smoothing)
- [HID-BPF kernel docs](https://docs.kernel.org/6.3/hid/hid-bpf.html)
- [Directional ballistic movement study (Lin et al.)](https://openaccess-api.cms-conferences.org/articles/download/978-1-4951-2107-4_53)
- [Fitts' law and direction (Mack, York University)](https://www.yorku.ca/mack/ijhcs2004.html)
- [EV code signing for individuals (SSL.com)](https://www.ssl.com/products/software-integrity/code-signing/ev-sole-proprietor/)
- [Raw Accel and Vanguard (AFK Gaming)](https://afkgaming.com/esports/guide/what-is-raw-accel-in-valorant-and-is-it-bannable-2)
