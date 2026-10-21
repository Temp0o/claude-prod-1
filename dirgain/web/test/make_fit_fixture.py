import json, os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", "sim"))
import dirgain_sim as S
from dirgain_gate import fit_full

S.rng = np.random.default_rng(42)
theta, y = S.make_trials(400, S.bias_fn, lambda t: 0.0, 0.2)
c, cov, s = fit_full(theta, y, K=2, lam=2.0)
out = {"theta": theta.tolist(), "y": y.tolist(), "coef": c.tolist(), "cov": cov.tolist(), "scale": s}
with open(os.path.join(os.path.dirname(__file__), "fit-fixture.json"), "w") as f:
    json.dump(out, f)
print("coef", c)
