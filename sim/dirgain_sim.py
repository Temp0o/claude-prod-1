import numpy as np

rng = np.random.default_rng(7)
GRID = np.linspace(0, 2 * np.pi, 720, endpoint=False)
DIRS = np.arange(24) * (2 * np.pi / 24)


def basis(theta, K):
    cols = []
    for k in range(1, K + 1):
        cols += [np.cos(2 * k * theta), np.sin(2 * k * theta)]
    return np.stack(cols, axis=1)


def huber_fit(theta, y, K, lam=2.0, iters=15):
    X = np.hstack([np.ones((len(y), 1)), basis(theta, K)])
    p = X.shape[1]
    L = lam * np.eye(p)
    L[0, 0] = 0
    w = np.ones(len(y))
    for _ in range(iters):
        A = X.T @ (X * w[:, None]) + L
        b = np.linalg.solve(A, X.T @ (w * y))
        r = y - X @ b
        s = max(1.4826 * np.median(np.abs(r - np.median(r))), 1e-6)
        u = np.abs(r) / (1.345 * s)
        w = np.where(u <= 1, 1.0, 1.0 / u)
    A = X.T @ (X * w[:, None]) + L
    cov = s**2 * np.linalg.inv(A)
    return b[1:], np.sqrt(np.diag(cov))[1:]


def shrink(coef, se):
    z = coef / se
    return coef * np.maximum(0.0, 1 - 1.0 / np.maximum(z**2, 1e-12))


def make_trials(n, true_log_bias, applied_log_g, sigma, outlier_frac=0.05):
    theta = rng.choice(DIRS, size=n)
    y = true_log_bias(theta) + applied_log_g(theta) + rng.normal(0, sigma, n)
    out = rng.random(n) < outlier_frac
    y[out] += rng.normal(0, 0.8, out.sum())
    return theta, y


def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


# ground truth user bias: 2 harmonics + an unmodelled 3rd harmonic
TRUE2 = np.array([0.04, -0.03, 0.025, 0.02])
TRUE3 = np.array([0.0, 0.0, 0.0, 0.0, 0.015, -0.01])


def bias_fn(theta, c2=TRUE2, c3=TRUE3, scale=1.0):
    return scale * (basis(theta, 2) @ c2 + basis(theta, 3) @ c3)


def table_recovery():
    print("== 1. One-shot recovery (profile = inverse of fitted bias, mean-anchored) ==")
    print("   metric: RMS gain error vs ideal profile, in % (lower is better); 'none' = no profile")
    print(f"{'n':>5} {'sigma':>6} {'K':>2} {'shrink':>6} {'RMS err %':>10} {'none %':>8}")
    for sigma in (0.15, 0.25):
        for n in (120, 240, 400, 800):
            for K in (1, 2, 3):
                for sh in (False, True):
                    errs, nones = [], []
                    for _ in range(150):
                        th, y = make_trials(n, bias_fn, lambda t: 0.0, sigma)
                        c, se = huber_fit(th, y, K)
                        if sh:
                            c = shrink(c, se)
                        ideal = -bias_fn(GRID)
                        ideal -= ideal.mean()
                        prof = -(basis(GRID, K) @ c)
                        prof -= prof.mean()
                        errs.append(rms(prof - ideal))
                        nones.append(rms(ideal))
                    if sh or K in (1, 2, 3):
                        print(f"{n:>5} {sigma:>6} {K:>2} {str(sh):>6} {100*np.mean(errs):>10.2f} {100*np.mean(nones):>8.2f}")


def table_null():
    print("\n== 2. Null case (user has NO directional bias): how big a profile does the fitter hallucinate? ==")
    print(f"{'n':>5} {'sigma':>6} {'K':>2} {'shrink':>6} {'mean |profile| %':>17}")
    for sigma in (0.25,):
        for n in (120, 240, 400):
            for K in (2,):
                for sh in (False, True):
                    mags = []
                    for _ in range(300):
                        th, y = make_trials(n, lambda t: 0.0, lambda t: 0.0, sigma)
                        c, se = huber_fit(th, y, K)
                        if sh:
                            c = shrink(c, se)
                        prof = basis(GRID, K) @ c
                        mags.append(rms(prof - prof.mean()))
                    print(f"{n:>5} {sigma:>6} {K:>2} {str(sh):>6} {100*np.mean(mags):>17.2f}")


def table_reliability():
    print("\n== 3. Split-half reliability gate (n split into two halves, K=2) ==")
    print("   corr of the two fitted profiles over 0-360 deg; null = no real bias")
    print(f"{'n_total':>8} {'sigma':>6} {'case':>6} {'median r':>9} {'5th pct':>8} {'95th pct':>9}")
    sigma = 0.25
    for n in (240, 400, 800):
        for case, fn in (("null", lambda t: 0.0), ("real", bias_fn)):
            rs = []
            for _ in range(400):
                profs = []
                for _h in range(2):
                    th, y = make_trials(n // 2, fn, lambda t: 0.0, sigma)
                    c, _ = huber_fit(th, y, 2)
                    p = basis(GRID, 2) @ c
                    profs.append(p - p.mean())
                rs.append(np.corrcoef(profs[0], profs[1])[0, 1])
            rs = np.array(rs)
            print(f"{n:>8} {sigma:>6} {case:>6} {np.median(rs):>9.2f} {np.percentile(rs,5):>8.2f} {np.percentile(rs,95):>9.2f}")


def table_closed_loop():
    print("\n== 4. Closed loop with an adapting user: e_{t+1} = (1 - eta - beta) e_t (log-domain, per harmonic) ==")
    print("   eta = profile update rate, beta = user's own error-driven re-learning rate; 240 trials/block, sigma=0.25")
    print(f"{'eta':>4} {'beta':>5} | residual bias RMS % after block 0..5 | profile share of fix at block 5")
    for eta, beta in ((1.0, 0.0), (0.5, 0.0), (0.5, 0.2), (0.5, 0.5), (1.0, 0.5), (1.0, 1.0)):
        resid = np.zeros(6)
        share = []
        reps = 100
        for _ in range(reps):
            prof = np.zeros(4)
            h = np.zeros(4)
            for blk in range(6):
                eff = lambda t: basis(t, 2) @ (TRUE2 + prof - h)
                th, y = make_trials(240, eff, lambda t: 0.0, 0.25)
                resid[blk] += rms(basis(GRID, 2) @ (TRUE2 + prof - h)) / reps
                c, se = huber_fit(th, y, 2)
                c = shrink(c, se)
                prof = prof - eta * c
                h = h + beta * c
            fixed = prof
            total = prof + h
            share.append(np.linalg.norm(-fixed) / max(np.linalg.norm(total), 1e-9) if False else
                         np.linalg.norm(fixed) / max(np.linalg.norm(fixed) + np.linalg.norm(h), 1e-9))
        r = " ".join(f"{100*v:5.2f}" for v in resid)
        print(f"{eta:>4} {beta:>5} | {r} | {np.mean(share):.2f}")


if __name__ == "__main__":
    print(f"true bias RMS (2 harmonics + unmodelled 3rd): {100*rms(bias_fn(GRID)-bias_fn(GRID).mean()):.2f} %\n")
    table_recovery()
    table_null()
    table_reliability()
    table_closed_loop()
