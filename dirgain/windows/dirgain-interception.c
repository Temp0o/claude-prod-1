/* dirgain-interception: applies a DirGain profile to every mouse on Windows through the
 * Interception filter driver (https://github.com/oblitum/Interception). */
#include <windows.h>

#include <stdio.h>

#include "dirgain.h"
#include "interception.h"

static volatile LONG stop_flag;

static BOOL WINAPI on_ctrl(DWORD type)
{
    (void)type;
    InterlockedExchange(&stop_flag, 1);
    return TRUE;
}

int main(int argc, char **argv)
{
    const char *path = argc > 1 ? argv[1] : "profile.conf";
    dirgain_profile prof;
    char err[256];
    if (dirgain_profile_load(&prof, path, err, sizeof err) < 0) {
        fprintf(stderr, "dirgain: %s\n", err);
        return 1;
    }

    InterceptionContext ctx = interception_create_context();
    if (!ctx) {
        fprintf(stderr, "dirgain: cannot reach the Interception driver; install it and reboot first\n");
        return 1;
    }
    SetConsoleCtrlHandler(on_ctrl, TRUE);
    SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
    interception_set_filter(ctx, interception_is_mouse, INTERCEPTION_FILTER_MOUSE_ALL);

    dirgain_state st[INTERCEPTION_MAX_DEVICE + 1];
    double last_ms[INTERCEPTION_MAX_DEVICE + 1];
    int have_last[INTERCEPTION_MAX_DEVICE + 1];
    for (int i = 0; i <= INTERCEPTION_MAX_DEVICE; i++) {
        dirgain_state_reset(&st[i]);
        have_last[i] = 0;
    }
    LARGE_INTEGER freq;
    QueryPerformanceFrequency(&freq);
    printf("dirgain: profile %s active on all mice (Ctrl+C to stop)\n", path);

    InterceptionStroke stroke;
    while (!stop_flag) {
        InterceptionDevice dev = interception_wait_with_timeout(ctx, 250);
        if (interception_is_invalid(dev) || !interception_is_mouse(dev)) continue;
        if (interception_receive(ctx, dev, &stroke, 1) <= 0) continue;
        InterceptionMouseStroke *m = (InterceptionMouseStroke *)&stroke;
        if (!(m->flags & INTERCEPTION_MOUSE_MOVE_ABSOLUTE) && (m->x || m->y)) {
            LARGE_INTEGER now;
            QueryPerformanceCounter(&now);
            double ms = (double)now.QuadPart * 1000.0 / (double)freq.QuadPart;
            double dt = have_last[dev] ? ms - last_ms[dev] : 1.0;
            last_ms[dev] = ms;
            have_last[dev] = 1;
            int ox, oy;
            dirgain_step(&prof, &st[dev], m->x, m->y, dt, &ox, &oy);
            m->x = ox;
            m->y = oy;
            if (!ox && !oy && !m->state) continue;
        }
        interception_send(ctx, dev, &stroke, 1);
    }

    interception_destroy_context(ctx);
    return 0;
}
