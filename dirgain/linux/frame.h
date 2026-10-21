#ifndef DIRGAIN_FRAME_H
#define DIRGAIN_FRAME_H

#include <linux/input.h>

#include "dirgain.h"

#define DG_FRAME_CAP 64

/* Collects one evdev frame (events up to SYN_REPORT), transforms its REL_X/REL_Y with DirGain
 * and passes everything else through unchanged. */
typedef struct {
    dirgain_profile prof;
    dirgain_state st;
    struct input_event buf[DG_FRAME_CAP];
    int nbuf;
    int dx, dy, motion;
    double last_ms;
    int have_last;
    int dropping;
} dg_framer;

void dg_framer_init(dg_framer *f, const dirgain_profile *p);
void dg_framer_set_profile(dg_framer *f, const dirgain_profile *p);

/* Feeds one event. When it completes a frame, writes the frame to out (capacity DG_FRAME_CAP + 3)
 * and returns its length; otherwise returns 0. */
int dg_framer_push(dg_framer *f, const struct input_event *ev, struct input_event *out);

#endif
