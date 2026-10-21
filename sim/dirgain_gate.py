import numpy as np
import dirgain_sim as S

def fit_full(theta, y, K=2, lam=2.0, iters=15):
    X = np.hstack([np.ones((len(y), 1)), S.basis(theta, K)])
    p = X.shape[1]
    L = lam * np.eye(p); L[0, 0] = 0
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
    return b[1:], cov[1:, 1:], s

def wald_p(c, cov):
    x = float(c @ np.linalg.solve(cov, c))
    return np.exp(-x / 2) * (1 + x / 2)  # chi-square, df=4 survival

def eb(c, cov, tau=0.03):
    se2 = np.diag(cov)
    return c * tau**2 / (tau**2 + se2)

print("gate = joint Wald test on 4 harmonic coefs (p<alpha) + empirical-Bayes shrink (prior SD tau=3%)")
print(f"{'n':>5} {'sigma':>6} {'alpha':>6} | {'power':>6} {'RMS err % (real)':>17} {'none %':>7} | {'false+':>6} {'|profile| % (null)':>19}")
ideal = -S.bias_fn(S.GRID); ideal -= ideal.mean()
for sigma in (0.15, 0.25):
    for n in (240, 400, 800):
        for alpha in (0.01,):
            hit = 0; errs = []
            fp = 0; mags = []
            for _ in range(400):
                th, y = S.make_trials(n, S.bias_fn, lambda t: 0.0, sigma)
                c, cov, _ = fit_full(th, y)
                if wald_p(c, cov) < alpha:
                    hit += 1
                    prof = -(S.basis(S.GRID, 2) @ eb(c, cov)); prof -= prof.mean()
                    errs.append(S.rms(prof - ideal))
                else:
                    errs.append(S.rms(ideal))
                th, y = S.make_trials(n, lambda t: 0.0, lambda t: 0.0, sigma)
                c, cov, _ = fit_full(th, y)
                if wald_p(c, cov) < alpha:
                    fp += 1
                    prof = S.basis(S.GRID, 2) @ eb(c, cov)
                    mags.append(S.rms(prof - prof.mean()))
                else:
                    mags.append(0.0)
            print(f"{n:>5} {sigma:>6} {alpha:>6} | {hit/400:>6.2f} {100*np.mean(errs):>17.2f} {100*S.rms(ideal):>7.2f} | {fp/400:>6.3f} {100*np.mean(mags):>19.2f}")
