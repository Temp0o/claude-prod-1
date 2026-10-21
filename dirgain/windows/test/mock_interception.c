/* Test double for the Interception library: replays strokes from strokes.txt
 * ("device x y state flags rolling" per line) and prints every stroke the app sends on. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "interception.h"

typedef struct {
    int dev;
    InterceptionMouseStroke s;
} queued;

static queued q[100000];
static int nq, iq;

InterceptionContext interception_create_context(void)
{
    FILE *f = fopen("strokes.txt", "r");
    if (!f) return 0;
    int dev, x, y, state, flags, rolling;
    while (nq < 100000 && fscanf(f, "%d %d %d %d %d %d", &dev, &x, &y, &state, &flags, &rolling) == 6) {
        memset(&q[nq], 0, sizeof q[nq]);
        q[nq].dev = dev;
        q[nq].s.x = x;
        q[nq].s.y = y;
        q[nq].s.state = (unsigned short)state;
        q[nq].s.flags = (unsigned short)flags;
        q[nq].s.rolling = (short)rolling;
        nq++;
    }
    fclose(f);
    return (InterceptionContext)1;
}

void interception_destroy_context(InterceptionContext context) { (void)context; }

void interception_set_filter(InterceptionContext context, InterceptionPredicate predicate, InterceptionFilter filter)
{
    (void)context;
    (void)predicate;
    (void)filter;
}

InterceptionDevice interception_wait_with_timeout(InterceptionContext context, unsigned long milliseconds)
{
    (void)context;
    (void)milliseconds;
    if (iq >= nq) {
        printf("END\n");
        fflush(stdout);
        exit(0);
    }
    return q[iq].dev;
}

int interception_receive(InterceptionContext context, InterceptionDevice device, InterceptionStroke *stroke, unsigned int nstroke)
{
    (void)context;
    (void)device;
    (void)nstroke;
    memcpy(stroke, &q[iq++].s, sizeof(InterceptionMouseStroke));
    return 1;
}

int interception_send(InterceptionContext context, InterceptionDevice device, const InterceptionStroke *stroke, unsigned int nstroke)
{
    (void)context;
    (void)nstroke;
    const InterceptionMouseStroke *m = (const InterceptionMouseStroke *)stroke;
    printf("SEND %d %d %d %d %d %d\n", device, m->x, m->y, m->state, m->flags, m->rolling);
    return 1;
}

unsigned int interception_get_hardware_id(InterceptionContext context, InterceptionDevice device, void *buf, unsigned int size)
{
    (void)context;
    if (device != INTERCEPTION_MOUSE(0) || size < 32) return 0;
    const wchar_t id[] = L"HID\\VID_1B1C&PID_TEST";
    memcpy(buf, id, sizeof id);
    return sizeof id - sizeof(wchar_t);
}

int interception_is_invalid(InterceptionDevice device) { return !interception_is_keyboard(device) && !interception_is_mouse(device); }
int interception_is_keyboard(InterceptionDevice device) { return device >= INTERCEPTION_KEYBOARD(0) && device <= INTERCEPTION_KEYBOARD(INTERCEPTION_MAX_KEYBOARD - 1); }
int interception_is_mouse(InterceptionDevice device) { return device >= INTERCEPTION_MOUSE(0) && device <= INTERCEPTION_MOUSE(INTERCEPTION_MAX_MOUSE - 1); }
