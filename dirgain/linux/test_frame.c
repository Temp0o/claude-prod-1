#include <stdio.h>
#include <string.h>

#include "frame.h"

static int failures;
#define CHECK(cond, ...)                                          \
    do {                                                          \
        if (!(cond)) {                                            \
            failures++;                                           \
            fprintf(stderr, "FAIL %s:%d: ", __FILE__, __LINE__);  \
            fprintf(stderr, __VA_ARGS__);                         \
            fputc('\n', stderr);                                  \
        }                                                         \
    } while (0)

static struct input_event ev(long usec, unsigned short type, unsigned short code, int value)
{
    struct input_event e;
    memset(&e, 0, sizeof e);
    e.input_event_sec = usec / 1000000;
    e.input_event_usec = usec % 1000000;
    e.type = type;
    e.code = code;
    e.value = value;
    return e;
}

static int feed(dg_framer *f, struct input_event e, struct input_event *out)
{
    return dg_framer_push(f, &e, out);
}

int main(void)
{
    struct input_event out[DG_FRAME_CAP + 3];
    dirgain_profile flat, prof;
    dirgain_profile_default(&flat);
    dirgain_profile_default(&prof);
    prof.a1 = 0.1;

    dg_framer f;
    dg_framer_init(&f, &flat);
    CHECK(feed(&f, ev(1000, EV_REL, REL_X, 7), out) == 0, "REL_X emitted before SYN");
    CHECK(feed(&f, ev(1000, EV_REL, REL_Y, -3), out) == 0, "REL_Y emitted before SYN");
    CHECK(feed(&f, ev(1000, EV_KEY, BTN_LEFT, 1), out) == 0, "button emitted before SYN");
    int n = feed(&f, ev(1000, EV_SYN, SYN_REPORT, 0), out);
    CHECK(n == 4, "flat frame length %d", n);
    CHECK(out[0].type == EV_REL && out[0].code == REL_X && out[0].value == 7, "REL_X passthrough");
    CHECK(out[1].type == EV_REL && out[1].code == REL_Y && out[1].value == -3, "REL_Y passthrough");
    CHECK(out[2].type == EV_KEY && out[2].code == BTN_LEFT && out[2].value == 1, "button passthrough");
    CHECK(out[3].type == EV_SYN && out[3].code == SYN_REPORT, "SYN last");

    CHECK(feed(&f, ev(2000, EV_REL, REL_WHEEL, 1), out) == 0, "wheel buffered");
    n = feed(&f, ev(2000, EV_SYN, SYN_REPORT, 0), out);
    CHECK(n == 2 && out[0].code == REL_WHEEL && out[0].value == 1, "wheel-only frame");

    CHECK(feed(&f, ev(3000, EV_SYN, SYN_REPORT, 0), out) == 0, "empty frame suppressed");

    feed(&f, ev(4000, EV_REL, REL_X, 5), out);
    CHECK(feed(&f, ev(4000, EV_SYN, SYN_DROPPED, 0), out) == 0, "SYN_DROPPED emits nothing");
    feed(&f, ev(4100, EV_REL, REL_X, 9), out);
    CHECK(feed(&f, ev(4100, EV_SYN, SYN_REPORT, 0), out) == 0, "events until next SYN_REPORT discarded");
    feed(&f, ev(5000, EV_REL, REL_X, 4), out);
    n = feed(&f, ev(5000, EV_SYN, SYN_REPORT, 0), out);
    CHECK(n == 2 && out[0].value == 4, "recovers after drop");

    dg_framer_init(&f, &prof);
    long sum_in = 0, sum_out = 0;
    for (int i = 0; i < 400; i++) {
        feed(&f, ev(10000 + i * 1000, EV_REL, REL_X, 10), out);
        n = feed(&f, ev(10000 + i * 1000, EV_SYN, SYN_REPORT, 0), out);
        sum_in += 10;
        for (int k = 0; k < n; k++)
            if (out[k].type == EV_REL && out[k].code == REL_X) sum_out += out[k].value;
    }
    double g = (double)sum_out / sum_in;
    double want = 1 + 0.1 + 0.005;
    CHECK(g > want - 0.002 && g < want + 0.002, "horizontal gain %.4f, want %.4f", g, want);

    dirgain_profile vert = prof;
    dg_framer_set_profile(&f, &vert);
    sum_in = sum_out = 0;
    for (int i = 0; i < 400; i++) {
        feed(&f, ev(900000 + i * 1000, EV_REL, REL_Y, 10), out);
        n = feed(&f, ev(900000 + i * 1000, EV_SYN, SYN_REPORT, 0), out);
        sum_in += 10;
        for (int k = 0; k < n; k++)
            if (out[k].type == EV_REL && out[k].code == REL_Y) sum_out += out[k].value;
    }
    g = (double)sum_out / sum_in;
    want = 1 - 0.1 + 0.005;
    CHECK(g > want - 0.002 && g < want + 0.002, "vertical gain %.4f, want %.4f", g, want);

    if (failures) {
        fprintf(stderr, "%d failure(s)\n", failures);
        return 1;
    }
    printf("frame tests passed\n");
    return 0;
}
