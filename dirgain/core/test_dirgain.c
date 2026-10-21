#include "dirgain.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures;

#define CHECK(cond, ...)                                  \
    do {                                                  \
        if (!(cond)) {                                    \
            failures++;                                   \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__); \
            fprintf(stderr, __VA_ARGS__);                 \
            fputc('\n', stderr);                          \
        }                                                 \
    } while (0)

static void test_parse(void)
{
    dirgain_profile p;
    char err[128];
    CHECK(dirgain_profile_parse(&p, "a1 = -0.05\n# c\n\nb2=0.01\r\nlambda = 4\n", err, sizeof err) == 0,
          "valid conf rejected: %s", err);
    CHECK(p.a1 == -0.05 && p.b2 == 0.01 && p.lambda == 4 && p.reset_ms == 100 && p.clamp == 0.15,
          "values not parsed");
    CHECK(dirgain_profile_parse(&p, "A0 = 1\n", err, sizeof err) != 0, "uppercase key accepted");
    CHECK(dirgain_profile_parse(&p, "zz = 1\n", err, sizeof err) != 0, "unknown key accepted");
    CHECK(dirgain_profile_parse(&p, "a1 = 1x\n", err, sizeof err) != 0, "bad number accepted");
    CHECK(dirgain_profile_parse(&p, "a1 = 1 2\n", err, sizeof err) != 0, "trailing token accepted");
    CHECK(dirgain_profile_parse(&p, "lambda = 0\n", err, sizeof err) != 0, "lambda 0 accepted");
    CHECK(dirgain_profile_parse(&p, "clamp = inf\n", err, sizeof err) != 0, "inf accepted");
}

static void test_vectors(const char *path)
{
    FILE *f = fopen(path, "r");
    CHECK(f != NULL, "cannot open %s", path);
    if (!f) return;
    char line[512];
    dirgain_profile p;
    dirgain_state st;
    int cases = 0, events = 0, off_by_one = 0;
    long sum_c[2] = {0, 0}, sum_e[2] = {0, 0};
    dirgain_profile_default(&p);
    dirgain_state_reset(&st);
    while (fgets(line, sizeof line, f)) {
        if (line[0] == 'P') {
            char conf[512];
            char err[128];
            snprintf(conf, sizeof conf, "%s", line + 1);
            for (char *c = conf; *c; c++)
                if (*c == ' ') *c = '\n';
            CHECK(dirgain_profile_parse(&p, conf, err, sizeof err) == 0, "bad P line: %s (%s)", line, err);
            dirgain_state_reset(&st);
            sum_c[0] = sum_c[1] = sum_e[0] = sum_e[1] = 0;
        } else if (line[0] == 'E') {
            int dx, dy, ex, ey, ox, oy;
            double dt;
            CHECK(sscanf(line, "E %d %d %lf %d %d", &dx, &dy, &dt, &ex, &ey) == 5, "bad E line");
            dirgain_step(&p, &st, dx, dy, dt, &ox, &oy);
            events++;
            if (ox != ex || oy != ey) off_by_one++;
            CHECK(abs(ox - ex) <= 1 && abs(oy - ey) <= 1, "event %d: got %d,%d want %d,%d", events, ox,
                  oy, ex, ey);
            sum_c[0] += ox, sum_c[1] += oy, sum_e[0] += ex, sum_e[1] += ey;
        } else if (line[0] == 'X') {
            cases++;
            CHECK(labs(sum_c[0] - sum_e[0]) <= 1 && labs(sum_c[1] - sum_e[1]) <= 1,
                  "case %d cumulative drift %ld,%ld", cases, sum_c[0] - sum_e[0], sum_c[1] - sum_e[1]);
        }
    }
    fclose(f);
    CHECK(cases > 0 && events > 0, "no vectors read");
    printf("vectors: %d cases, %d events, %d events differ by 1 count from JS\n", cases, events,
           off_by_one);
}

int main(int argc, char **argv)
{
    test_parse();
    test_vectors(argc > 1 ? argv[1] : "vectors/transform-vectors.txt");
    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("C tests passed\n");
    return 0;
}
