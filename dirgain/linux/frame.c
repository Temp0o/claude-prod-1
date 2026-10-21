#include "frame.h"

#include <string.h>

static void reset_frame(dg_framer *f)
{
    f->nbuf = 0;
    f->dx = 0;
    f->dy = 0;
    f->motion = 0;
}

void dg_framer_init(dg_framer *f, const dirgain_profile *p)
{
    memset(f, 0, sizeof(*f));
    f->prof = *p;
    dirgain_state_reset(&f->st);
}

void dg_framer_set_profile(dg_framer *f, const dirgain_profile *p)
{
    f->prof = *p;
    dirgain_state_reset(&f->st);
}

static double event_ms(const struct input_event *ev)
{
    return ev->input_event_sec * 1000.0 + ev->input_event_usec / 1000.0;
}

static struct input_event make_event(const struct input_event *tmpl, unsigned short type,
                                     unsigned short code, int value)
{
    struct input_event e = *tmpl;
    e.type = type;
    e.code = code;
    e.value = value;
    return e;
}

int dg_framer_push(dg_framer *f, const struct input_event *ev, struct input_event *out)
{
    if (ev->type == EV_SYN && ev->code == SYN_DROPPED) {
        reset_frame(f);
        dirgain_state_reset(&f->st);
        f->have_last = 0;
        f->dropping = 1;
        return 0;
    }
    if (ev->type == EV_SYN && ev->code == SYN_REPORT) {
        if (f->dropping) {
            f->dropping = 0;
            reset_frame(f);
            return 0;
        }
        int n = 0;
        if (f->motion) {
            double now = event_ms(ev);
            double dt = f->have_last ? now - f->last_ms : 1.0;
            f->last_ms = now;
            f->have_last = 1;
            int ox, oy;
            dirgain_step(&f->prof, &f->st, f->dx, f->dy, dt, &ox, &oy);
            if (ox) out[n++] = make_event(ev, EV_REL, REL_X, ox);
            if (oy) out[n++] = make_event(ev, EV_REL, REL_Y, oy);
        }
        for (int i = 0; i < f->nbuf; i++) out[n++] = f->buf[i];
        reset_frame(f);
        if (n == 0) return 0;
        out[n++] = *ev;
        return n;
    }
    if (f->dropping) return 0;
    if (ev->type == EV_REL && (ev->code == REL_X || ev->code == REL_Y)) {
        if (ev->code == REL_X) f->dx += ev->value;
        else f->dy += ev->value;
        f->motion = 1;
        return 0;
    }
    if (f->nbuf == DG_FRAME_CAP) {
        /* Oversized frame: flush what we have untransformed rather than drop input. */
        int n = 0;
        if (f->dx) out[n++] = make_event(ev, EV_REL, REL_X, f->dx);
        if (f->dy) out[n++] = make_event(ev, EV_REL, REL_Y, f->dy);
        for (int i = 0; i < f->nbuf; i++) out[n++] = f->buf[i];
        reset_frame(f);
        f->buf[f->nbuf++] = *ev;
        return n;
    }
    f->buf[f->nbuf++] = *ev;
    return 0;
}
