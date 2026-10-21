#include "dirgain.h"

#include <ctype.h>
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void dirgain_profile_default(dirgain_profile *p)
{
    memset(p, 0, sizeof(*p));
    p->lambda = 8.0;
    p->reset_ms = 100.0;
    p->clamp = 0.15;
}

static double *field(dirgain_profile *p, const char *key)
{
    if (!strcmp(key, "a0")) return &p->a0;
    if (!strcmp(key, "a1")) return &p->a1;
    if (!strcmp(key, "b1")) return &p->b1;
    if (!strcmp(key, "a2")) return &p->a2;
    if (!strcmp(key, "b2")) return &p->b2;
    if (!strcmp(key, "a3")) return &p->a3;
    if (!strcmp(key, "b3")) return &p->b3;
    if (!strcmp(key, "lambda")) return &p->lambda;
    if (!strcmp(key, "reset_ms")) return &p->reset_ms;
    if (!strcmp(key, "clamp")) return &p->clamp;
    return NULL;
}

int dirgain_profile_parse(dirgain_profile *p, const char *text, char *err, size_t errlen)
{
    dirgain_profile_default(p);
    int lineno = 0;
    const char *s = text;
    while (*s) {
        const char *eol = strchr(s, '\n');
        size_t len = eol ? (size_t)(eol - s) : strlen(s);
        char line[256];
        lineno++;
        if (len >= sizeof(line)) {
            snprintf(err, errlen, "line %d too long", lineno);
            return -1;
        }
        memcpy(line, s, len);
        line[len] = '\0';
        s = eol ? eol + 1 : s + len;

        char *hash = strchr(line, '#');
        if (hash) *hash = '\0';
        char key[32], val[64], extra[2];
        int n = sscanf(line, " %31[a-z0-9_] = %63s %1s", key, val, extra);
        if (n <= 0) {
            int blank = 1;
            for (const char *c = line; *c; c++)
                if (!isspace((unsigned char)*c)) blank = 0;
            if (blank) continue;
        }
        if (n != 2) {
            snprintf(err, errlen, "line %d: expected 'key = value'", lineno);
            return -1;
        }
        double *f = field(p, key);
        if (!f) {
            snprintf(err, errlen, "line %d: unknown key '%s'", lineno, key);
            return -1;
        }
        char *end;
        errno = 0;
        double v = strtod(val, &end);
        if (errno || *end || !isfinite(v)) {
            snprintf(err, errlen, "line %d: bad number '%s'", lineno, val);
            return -1;
        }
        *f = v;
    }
    if (!(p->lambda > 0) || !(p->reset_ms >= 0) || !(p->clamp >= 0)) {
        snprintf(err, errlen, "lambda must be > 0, reset_ms >= 0 and clamp >= 0");
        return -1;
    }
    return 0;
}

int dirgain_profile_load(dirgain_profile *p, const char *path, char *err, size_t errlen)
{
    FILE *f = fopen(path, "rb");
    if (!f) {
        snprintf(err, errlen, "cannot open %s: %s", path, strerror(errno));
        return -1;
    }
    char buf[8192];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    int toolong = !feof(f);
    fclose(f);
    if (toolong) {
        snprintf(err, errlen, "%s is larger than %zu bytes", path, sizeof(buf) - 1);
        return -1;
    }
    buf[n] = '\0';
    return dirgain_profile_parse(p, buf, err, errlen);
}

void dirgain_state_reset(dirgain_state *st)
{
    memset(st, 0, sizeof(*st));
}

double dirgain_harmonics(const dirgain_profile *p, double c2, double s2)
{
    double c4 = 2 * c2 * c2 - 1;
    double s4 = 2 * s2 * c2;
    double c6 = c2 * c4 - s2 * s4;
    double s6 = s2 * c4 + c2 * s4;
    return p->a1 * c2 + p->b1 * s2 + p->a2 * c4 + p->b2 * s4 + p->a3 * c6 + p->b3 * s6;
}

static int round_half_away(double f)
{
    return f < 0 ? -(int)floor(-f + 0.5) : (int)floor(f + 0.5);
}

/* Direction comes from the displacement over the last ~lambda counts of path (so x-only and
 * y-only 1-count packets still resolve a diagonal), doubled so reversals keep the same axis.
 * Harmonics fade only while that displacement is under one count, i.e. mid-reversal. */

void dirgain_step(const dirgain_profile *p, dirgain_state *st, int dx, int dy, double dt_ms,
                  int *ox, int *oy)
{
    if (dx == 0 && dy == 0) {
        *ox = 0;
        *oy = 0;
        return;
    }
    double fdx = dx, fdy = dy;
    double a = dt_ms > p->reset_ms ? 0 : exp(-hypot(fdx, fdy) / p->lambda);
    st->vx = a * st->vx + fdx;
    st->vy = a * st->vy + fdy;
    double m2 = st->vx * st->vx + st->vy * st->vy;
    double x = p->a0;
    if (m2 > 1e-12) {
        double k = sqrt(m2);
        if (k > 1) k = 1;
        x += k * dirgain_harmonics(p, (st->vx * st->vx - st->vy * st->vy) / m2,
                                   (2 * st->vx * st->vy) / m2);
    }
    if (x > p->clamp) x = p->clamp;
    else if (x < -p->clamp) x = -p->clamp;
    double g = 1 + x + 0.5 * x * x;
    double fx = g * fdx + st->cx;
    double fy = g * fdy + st->cy;
    *ox = round_half_away(fx);
    *oy = round_half_away(fy);
    st->cx = fx - *ox;
    st->cy = fy - *oy;
}
