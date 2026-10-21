# DirGain algorithm spec v0.1, with extended research

Status: design only. The estimator was checked in simulation (`sim/`), nothing else is built. Written 2026-10-21. Supersedes sections 4.1-4.3 of `PLAN-open-directional-aim.md` where they differ.

Tags: **[V]** found in this session's web search (summary level: this sandbox's WebFetch only reaches GitHub, so I did **not** read any primary paper, patent or Corsair page). **[K]** my background knowledge. **[S]** measured in `sim/`. **[D]** my own derivation or inference.

## 1. What the extended search found

### 1.1 PureVector's algorithm: what is public
- Corsair's explainer describes three steps [V]. **Measure:** about 5 minutes in Aimlabs, aiming at targets in different directions. **Calculate:** per-direction metrics, including distance moved and relative accuracy. **Adjust:** change how hand movement maps to cursor movement so weaker directions behave more like your strongest one.
- The profile is stored in firmware per DPI stage. The other stages are disabled after calibration, and you must remove the calibration to use another DPI [V]. DPI and in-game sensitivity are entered on the calibration screen [V]. "Refine calibration" re-runs it because bias shifts as muscle memory develops [V].
- Not public [V]: the formula, curve shape, how accuracy is weighted, how many directions are measured, and what the "4 billion datasets" are used for.
- Claims: up to 81 ms (33%) faster aim and 18% lower directional variance [V]. The two numbers together imply a baseline of about 245 ms of aim-plus-correction time [D: 81/0.33]. Both come from Corsair's own testing.
- Independent evidence: KitGuru scored the CF model 8/10 and was critical of the software feature, with no numbers [V]. I found no independent quantified test and no community threads [V].
- Inference [D]: "directional variance" is plausibly the spread across directions of the per-direction metric. Inverting a bias lowers that spread by construction, so it is weak evidence of a real benefit. Our primary metric will be time to hit (section 2.7).
- "Weaker directions behave like the strongest" suggests Corsair anchors to the best direction, not the mean. We make the anchor a choice (section 2.4).

### 1.2 Closest published algorithms
- **AutoGain** (Lee, Nancel, Kim, Oulasvirta, CHI 2020) [V]: gradually updates the control-to-display gain function from the speed and error of the user's submovements, minimizing expected aiming error. It builds a usable function from scratch in under about half an hour, and a month-long study showed gains over default functions. This is the same family as what we need, but its update rule is **unread**. Read the paper before finalizing section 2.5.
- **NVIDIA US11801443B2** (Kim, Boudaoud, Spjut) [V]: iterative sensitivity recommendation. It compares the speed-error relationship of a modified sensitivity against a baseline and adjusts until it settles. It tunes one global sensitivity, not a direction map. Related: Boudaoud et al., arXiv 2203.12050 [V].
- **Aimlabs Mouselabs Sensitivity Finder** [V]: looks at flick under/overshoots and tracking, recalibrates every 7 minutes of task play, and uses up to the last 100 sessions. One user calls its predecessor unstable [V, anecdote].
- **Firmware gain functions:** Kim et al., CHI 2025, a firmware transfer function that cancels OS gain [V, abstract only], and Yonsei JP2026079656A, a user gain function in firmware that offsets the OS base gain [V]. Relevant to the firmware stretch goal and to OS pointer acceleration.
- **Submovement detection** [V]: dual-threshold segmentation; Persistence1D on a Gaussian-smoothed speed trace (σ = 3 samples, persistence 0.2 in the paper I saw); ballistic-peak splitting with a 500 ms look-ahead; and a 2026 NVIDIA wavelet-inspired method (Ham and Boudaoud, tested on about 6,400 synthetic FPS trials modeled on 13 users).
- **Open source:** I found no project that builds a per-angle sensitivity map [V]. Adjacent ones are Sensitivity Randomizer (Interception-based, randomizes a global multiplier), an ITB greedy over/undershoot calibrator (single value), and a Starfield mod that equalizes horizontal and vertical sensitivity [V].

### 1.3 Why direction would matter
- Gordon et al. 1994: systematic, direction-dependent extent errors from the arm's inertial anisotropy. In one direction movements were hypermetric, and accelerations were largest perpendicular to the forearm [V]. This was on a tablet without cursor feedback.
- Flanagan and Lolley 2001: the motor system predicts this anisotropy [V]. So part of the bias is already compensated, and the residual may be small [D].
- Mouse studies: Lin et al. (4 participants, 8 directions: fastest at 0° and 180°, smaller error along cross axes than diagonals); Whisenand and Emurian CHI 1995 (angle of approach affects movement time, earlier work was mixed); a KAIST study over 16 angles; Thompson et al. 2004 (vertical targets harder), though one arXiv study found similar performance in both [V]. All small samples.
- Adaptation: rotation adapts narrowly across directions, gain adapts broadly (a review reports at least 60% transfer) [V]. I found no study of adaptation to a direction-dependent gain map [V gap], so adaptation is an open risk.

### 1.4 Patent landscape (not legal advice)
NVIDIA US11801443B2 (global sensitivity), Yonsei JP2026079656A (firmware gain), PixArt US11150748 (per-axis calibration factor for the tracking surface, sensor-level) [V]. **I could not locate Corsair's patent.** A freedom-to-operate search (Google Patents, assignees Corsair and State Space Labs, "directional sensitivity") must happen before anything is distributed.

## 2. The algorithm

### 2.1 Model (log domain) [D]
For a target at direction θ and cursor-space distance D, the user plans with a flat internal gain and executes with a direction-dependent motor bias m(θ) and noise ε:

`y = log(A/D) = log g(θ) − log h̄ + log m(θ) + log ε`

where A is the cursor displacement of the **first ballistic submovement**, g the applied gain, h̄ the user's assumed mean gain. Goal: choose `ℓ(θ) = log g(θ)` so E[y | θ] does not depend on θ, i.e. `ℓ(θ) = −log m(θ) + const`.

Parametrization: `ℓ(θ) = Σ_{k=1..K} a_k cos 2kθ + b_k sin 2kθ`, K = 2 by default. Only even harmonics, so `g(θ) = g(θ+π)` and out-and-back motion returns the cursor to its start. Then anchor (2.4) and clamp `|ℓ| ≤ 0.15`.

What a gain can and cannot fix: it fixes systematic extent bias and hand travel. With signal-dependent noise (SD proportional to amplitude), relative endpoint noise in cursor space does not depend on g, so a gain cannot fix direction differences in noise [D]. The benefit is fewer and shorter corrective submovements.

### 2.2 Trial protocol
- Return to a center start, then a target at one of 24 directions (15° steps) and 3 amplitudes, order randomized. Target size set so each amplitude is moderately hard (initial guess: about 4 bits of difficulty).
- Aim for at least 400 flicks, split over 2 sessions of about 5 minutes. Power depends strongly on per-trial noise (section 3).
- Log every raw `(dx, dy, t)` at the highest available rate, with DPI and in-game sensitivity. In the browser, use unadjusted pointer-lock movement [K].

### 2.3 First-submovement ratio ρ
Speed trace from raw deltas, Gaussian-smoothed (initial σ ≈ 8 ms). Onset: speed above 5% of trial peak. End of the first submovement: the first local minimum after the peak with prominence at least 20% of peak (Persistence1D-style), else speed below 10% of peak, with a 60 ms minimum duration. `ρ = |displacement over that window| / D`, `y = log ρ`. Cross-check with a "peak-mirror" estimator (displacement at `t0 + 2(t_peak − t0)`) [D]. Reject trials with no clear peak. All thresholds are initial values to tune on pilot data. Benchmark them on synthetic minimum-jerk traces with known submovement ends before trusting them (not done yet).

### 2.4 Estimator
Per fit, on the pooled trials:
1. Regress `y` on [per-amplitude intercepts, cos2θ, sin2θ, cos4θ, sin4θ] with Huber IRLS (c = 1.345, MAD scale) and a small ridge (λ = 2) on the harmonic terms. Per-amplitude intercepts absorb amplitude-dependent under/overshoot but are **untested**: the simulation used a single intercept.
2. **Gate:** joint Wald test on the harmonic coefficients (χ², df = 2K), apply a profile only if p < 0.01. Otherwise no profile.
3. **Shrink** the passing coefficients by `τ² / (τ² + SE²)` per coefficient, τ = 0.03 (prior: biases are a few percent).
4. Choose K by 5-fold held-out likelihood among K = 1, 2, 3 (the sim shows K = 2 is best or equal at n ≥ 240 with decent SNR, K = 1 competitive when noisy).
5. Profile = `−(fitted harmonics)`, then **anchor**: subtract `ℓ(θ_anchor)`. Default anchor: the horizontal axis, so existing in-game sensitivity and muscle memory are untouched for the most common flick direction [D]. Alternatives: geometric mean, or Corsair-style "strongest direction".

### 2.5 Closed-loop update
Fit again on trials collected with the profile active; the coefficients then estimate the residual. `ℓ_{t+1} = clamp(ℓ_t − η · shrunk(c_t))`, η = 0.5. Stop when the gate fails on two consecutive blocks. Re-check periodically, since bias can drift [V].

Why η is small [D, checked in S]: if the user also re-learns at rate β, the error evolves as `e_{t+1} = (1 − η − β) e_t`. Both act on the same error, so η + β near 2 oscillates, and part of the correction is absorbed by the user rather than the profile.

### 2.6 Runtime transform (per mouse report)
```
Qc = a·Qc + (dx² − dy²);  Qs = a·Qs + 2·dx·dy;  N = a·N + (dx² + dy²)   // a = exp(−Δt/τ), τ ≈ 3 ms
κ = hypot(Qc, Qs) / N                      // coherence, 0..1
(c2, s2) = (Qc, Qs) / hypot(Qc, Qs)
c4 = 2·c2² − 1;  s4 = 2·s2·c2
x = κ · (A1·c2 + B1·s2 + A2·c4 + B2·s4)    // log-gain; |x| ≤ 0.15
g = 1 + x + x²/2                           // error below 6e-4 for |x| ≤ 0.15
out = g·(dx, dy) + carry;  emit round(out);  carry = out − emitted
```
- The doubled-angle structure tensor is sign-invariant, so reversals do not cancel, and it is speed-weighted. No `atan2`, no lookup table, fixed-point friendly.
- The residual `carry` is per device, so slow 1-count motion is never swallowed.
- τ trades direction quantization at low speed (single packets only give 45° steps) against lag. Tune in the Linux phase and measure added latency.
- One shared set of test vectors (`dx, dy, Δt` streams plus expected output) checks the TypeScript calibrator, the C library and any kernel port within 1 count.

### 2.7 Validation protocol
- Interleaved, counterbalanced blocks of baseline vs fitted profile on held-out targets. **Primary metric: time to hit.** Secondary: hit rate, overshoot. **Do not** use directional variance of ρ as the headline, because the fit reduces it by construction.
- **Tracking guard:** a moving-target task. The profile must not worsen RMS tracking error beyond a preset margin, since it is fitted on flicks but applies to everything.
- Paired bootstrap 95% CI. Rough power, assuming a paired-difference SD of about 120 ms [D]: detecting 20 ms needs about 280 paired trials.
- Day-2 retest of the fitted coefficients (test-retest) and a 2-3 day adaptation period before the final verdict.
- Ship rule: CI excludes zero in favor on time to hit, with no tracking regression. Otherwise stop at the calibration tool.

### 2.8 Parameters
| Parameter | Default | Basis |
|---|---|---|
| Harmonics K | 2 (model-selected 1-3) | [S] |
| Gate | Wald p < 0.01 | [S] |
| Shrink prior SD τ | 0.03 | [S], assumed |
| Update rate η | 0.5 | [S] |
| Clamp on log-gain | 0.15 | assumed |
| Anchor | horizontal axis | [D] |
| Speed smoothing σ | 8 ms | assumed, tune |
| Persistence / minimum duration | 20% / 60 ms | literature-inspired [V], tune |
| Direction EMA τ | 3 ms | assumed, tune |
| Trials | at least 400 | [S] |

## 3. Simulation results [S]
Scripts: `sim/dirgain_sim.py`, `sim/dirgain_gate.py` (Python 3, numpy). Synthetic user with a log-bias of 4.4% RMS across directions (two modeled harmonics plus an unmodeled third) and per-trial log-ratio noise σ of 0.15 or 0.25. Both numbers are **assumptions, not measurements of humans.** 5% of trials are gross outliers.

**Gate + shrink estimator, K = 2** (recommended; "RMS err" is the RMS gain error of the applied profile, 4.39% with no profile):

| n trials | σ | power to detect the bias | RMS err when real | false positives (no bias) |
|---|---|---|---|---|
| 240 | 0.15 | 0.85 | 2.47% | 1.0% |
| 400 | 0.15 | 0.97 | 2.02% | 1.8% |
| 800 | 0.15 | 1.00 | 1.69% | 1.0% |
| 240 | 0.25 | 0.25 | 3.94% | 1.3% |
| 400 | 0.25 | 0.51 | 3.36% | 1.5% |
| 800 | 0.25 | 0.89 | 2.34% | 1.5% |

- With no gate, an unbiased user gets a spurious profile of 4.6% / 3.2% / 2.5% RMS at n = 120 / 240 / 400 (σ = 0.25). With the gate and shrinkage it is about 0.05%.
- Split-half correlation is a poor gate: at n = 240 the null spans −0.80 to 0.83 (5th to 95th percentile) while a real bias has median 0.50. Only at n = 800 does it separate (real median 0.79, null 95th percentile 0.74).
- The unmodeled third harmonic (about 1.3% RMS) sets a floor. K = 3 helps clearly only at n = 800 (1.34% vs 1.66% at σ = 0.15, ungated).

**Closed loop** (240 trials per block, σ = 0.25, residual bias RMS % after blocks 0 to 5):

| η | β | residual after blocks 0..5 | profile share of the fix |
|---|---|---|---|
| 0.5 | 0.0 | 4.20 → 3.29 → 2.68 → 2.31 → 2.05 → 1.90 | 1.00 |
| 0.5 | 0.2 | 4.20 → 3.14 → 2.57 → 2.23 → 1.97 → 1.98 | 0.71 |
| 0.5 | 0.5 | 4.20 → 3.27 → 2.90 → 2.66 → 2.69 → 2.48 | 0.50 |
| 1.0 | 0.5 | 4.20 → 4.30 → 4.36 → 3.92 → 4.09 → 3.90 | 0.67 |
| 1.0 | 1.0 | 4.20 → 5.99 → 6.72 → 6.92 → 7.61 → 8.14 | 0.50 |

**What this does and does not show.** It checks the estimator and controller under assumed noise, not human behavior. The headline: a 5-minute calibration (about 250 trials) can only reliably find a few-percent bias if per-trial noise is around 0.15 or lower, and at σ = 0.25 it mostly cannot. Whether the idea works at all depends on the real noise and real bias size, which nobody has published for this task.

## 4. Corrections to the earlier plan
- `PLAN-open-directional-aim.md` section 4.1 used an additive gain `1 + Σ…`. The log form here is cleaner (positive, multiplicative, symmetric under inversion). The runtime approximation `1 + x + x²/2` makes the two nearly identical.
- Its Phase 0 target of "RMS gain error under 2% at about 400 trials" is not reachable at σ = 0.25 (best 2.34% at n = 800), and at σ = 0.15 it is reached only at n = 800 (1.69%; 2.02% at n = 400).
- Its split-half reliability idea is replaced by the Wald gate plus a day-2 retest.

## 5. Unknowns that need real-human data
1. Per-trial noise σ of the first-submovement log-ratio, per direction. **Measure first.** If σ is above about 0.25, 5-minute calibrations will not work and we need 800 or more trials.
2. Size and stability of the real directional bias (RMS %, test-retest over days).
3. Amplitude and speed dependence of the bias (a static map may be too crude).
4. The user's own re-learning rate β when a map is applied.
5. Whether a flick-fitted map hurts tracking.
6. AutoGain's actual update rule and objective, and Corsair's patent claims.

## 6. Next steps
1. Build the browser calibrator first (it logs raw data and applies the candidate gain itself). Use it for a pilot on you to measure unknowns 1 and 2. That is the go/no-go.
2. Build the synthetic-trace bench for the segmentation step (section 2.3).
3. Read AutoGain in full and fold in its objective if better.
4. Run the patent search.
5. Then proceed with Phases 2 to 5 of the plan.

## Sources
- [Corsair: PureVector, the future of aiming](https://www.corsair.com/us/en/explorer/gamer/mice/purevector-the-future-of-aiming/)
- [Corsair: How to use PureVector](https://www.corsair.com/us/en/explorer/gamer/mice/how-to-use-purevector/)
- [KitGuru: SABRE v3 PRO PureVector CF review](https://www.kitguru.net/tech-news/featured-tech-reviews/carlosribeiro/corsair-sabre-v3-pro-purevector-cf-mouse-review/)
- [AutoGain (CHI 2020, ACM)](https://dl.acm.org/doi/fullHtml/10.1145/3313831.3376244) and [arXiv 1611.08154](https://arxiv.org/pdf/1611.08154)
- [NVIDIA US11801443B2, target-based mouse sensitivity recommendations](https://patents.google.com/patent/US11801443)
- [Mouse sensitivity effects in first-person targeting tasks (arXiv 2203.12050)](https://arxiv.org/abs/2203.12050)
- [Short-time, wavelet-inspired mouse submovement detection (arXiv 2604.20673)](https://arxiv.org/pdf/2604.20673)
- [Hardware-embedded pointing transfer function (CHI 2025, DGIST record)](https://scholar.dgist.ac.kr/handle/20.500.11750/58401)
- [Yonsei firmware gain patent application JP2026079656A](https://eureka.patsnap.com/patent/JP2026079656A)
- [PixArt US11150748, per-direction sensor calibration](https://patents.google.com/patent/US11150748)
- [Gordon et al. 1994, planar reaching, inertial anisotropy](https://experts.umn.edu/en/publications/accuracy-of-planar-reaching-movements-ii-systematic-extent-errors/)
- [Whisenand and Emurian, CHI 1995, angle of approach](https://chi1995.chistatic.hosting.acm.org/proceedings/shortppr/tgw_bdy.htm)
- [Thompson et al. 2004 as cited in arXiv 2204.06969](https://arxiv.org/pdf/2204.06969)
- [Lin et al., ballistic mouse movement in eight directions](https://openaccess-api.cms-conferences.org/articles/download/978-1-4951-2107-4_53)
- [Gain vs rotation generalization (PMC4507963)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4507963) and [review (PMC2888232)](https://pmc.ncbi.nlm.nih.gov/articles/PMC2888232)
- [Aimlabs Mouselabs sensitivity finder](https://aimlabs.com/articles/aimlabs/aimlabs-mouselabs-explained-smarter-sensitivity-finder-better-results/)
- [Sensitivity Randomizer](https://github.com/Whisperrr/SensitivityRandomizer)
