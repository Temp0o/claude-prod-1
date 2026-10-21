#ifndef DIRGAIN_H
#define DIRGAIN_H

#include <stddef.h>

typedef struct {
    double a0, a1, b1, a2, b2, a3, b3;
    double lambda;
    double reset_ms;
    double clamp;
} dirgain_profile;

typedef struct {
    double vx, vy;
    double cx, cy;
} dirgain_state;

void dirgain_profile_default(dirgain_profile *p);
int dirgain_profile_parse(dirgain_profile *p, const char *text, char *err, size_t errlen);
int dirgain_profile_load(dirgain_profile *p, const char *path, char *err, size_t errlen);

void dirgain_state_reset(dirgain_state *st);
double dirgain_harmonics(const dirgain_profile *p, double c2, double s2);
void dirgain_step(const dirgain_profile *p, dirgain_state *st, int dx, int dy, double dt_ms,
                  int *ox, int *oy);

#endif
