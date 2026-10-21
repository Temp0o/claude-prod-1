/* dirgain.exe: applies a DirGain profile to mouse input on Windows through the Interception
 * filter driver (https://github.com/oblitum/Interception), so games see the corrected motion. */
#include <windows.h>

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "dirgain.h"
#include "interception.h"

#define HOTKEY_ID 1

static volatile LONG stop_flag;
static volatile LONG enabled = 1;
static volatile LONG toggled;

static BOOL WINAPI on_ctrl(DWORD type)
{
    (void)type;
    InterlockedExchange(&stop_flag, 1);
    return TRUE;
}

/* Ctrl+Alt+F8 toggles the profile. RegisterHotKey needs a thread with a message loop. */
static DWORD WINAPI hotkey_thread(LPVOID arg)
{
    (void)arg;
    if (!RegisterHotKey(NULL, HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_F8)) {
        fprintf(stderr, "dirgain: Ctrl+Alt+F8 is taken by another program; toggling is unavailable\n");
        return 0;
    }
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        if (msg.message == WM_HOTKEY && msg.wParam == HOTKEY_ID) {
            LONG now = !InterlockedCompareExchange(&enabled, 0, 0);
            InterlockedExchange(&enabled, now);
            InterlockedExchange(&toggled, 1);
        }
    }
    return 0;
}

static void default_profile_path(char *out, size_t len)
{
    char exe[MAX_PATH];
    DWORD n = GetModuleFileNameA(NULL, exe, sizeof exe);
    if (n == 0 || n >= sizeof exe) {
        snprintf(out, len, "profile.conf");
        return;
    }
    char *slash = strrchr(exe, '\\');
    if (slash) slash[1] = '\0';
    snprintf(out, len, "%sprofile.conf", slash ? exe : "");
}

static int file_stamp(const char *path, ULONGLONG *stamp)
{
    WIN32_FILE_ATTRIBUTE_DATA fa;
    if (!GetFileAttributesExA(path, GetFileExInfoStandard, &fa)) return -1;
    *stamp = ((ULONGLONG)fa.ftLastWriteTime.dwHighDateTime << 32) | fa.ftLastWriteTime.dwLowDateTime;
    return 0;
}

static double gain_pct(const dirgain_profile *p, double deg)
{
    double t = deg * 3.14159265358979323846 / 180.0;
    double x = p->a0 + dirgain_harmonics(p, cos(t), sin(t));
    if (x > p->clamp) x = p->clamp;
    if (x < -p->clamp) x = -p->clamp;
    return (1 + x + 0.5 * x * x - 1) * 100;
}

static void describe(const char *path, const dirgain_profile *p)
{
    printf("dirgain: profile %s\n", path);
    printf("         gain  right %+.1f%%  left %+.1f%%  push %+.1f%%  pull %+.1f%%  diagonals %+.1f%% / %+.1f%%\n",
           gain_pct(p, 0), gain_pct(p, 180), gain_pct(p, 270), gain_pct(p, 90), gain_pct(p, 45), gain_pct(p, 135));
}

static void usage(void)
{
    printf("usage: dirgain.exe [profile.conf] [--device N] [--list]\n"
           "  Applies a DirGain profile to mouse movement. Without a path it reads profile.conf\n"
           "  next to dirgain.exe. Ctrl+Alt+F8 turns it on and off; saving the profile reloads it.\n"
           "  --list      show mice seen by the Interception driver, then exit\n"
           "  --device N  apply only to mouse N from --list (default: all mice)\n");
}

int main(int argc, char **argv)
{
    char path[MAX_PATH + 32] = "";
    int only_device = 0;
    int list = 0;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--list")) list = 1;
        else if (!strcmp(argv[i], "--device") && i + 1 < argc) only_device = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--help") || !strcmp(argv[i], "-h") || !strcmp(argv[i], "/?")) {
            usage();
            return 0;
        } else if (argv[i][0] == '-') {
            usage();
            return 2;
        } else snprintf(path, sizeof path, "%s", argv[i]);
    }
    if (!path[0]) default_profile_path(path, sizeof path);

    dirgain_profile prof;
    char err[256];
    if (!list && dirgain_profile_load(&prof, path, err, sizeof err) < 0) {
        fprintf(stderr, "dirgain: %s\n         Download profile.conf from the calibrator and put it next to dirgain.exe.\n", err);
        if (argc == 1) system("pause");
        return 1;
    }

    InterceptionContext ctx = interception_create_context();
    if (!ctx) {
        fprintf(stderr,
                "dirgain: cannot reach the Interception driver.\n"
                "         Install it (install-interception.exe /install as administrator) and reboot.\n");
        if (argc == 1) system("pause");
        return 1;
    }

    if (list) {
        char hwid[500];
        for (InterceptionDevice d = INTERCEPTION_MOUSE(0); d <= INTERCEPTION_MOUSE(INTERCEPTION_MAX_MOUSE - 1); d++) {
            unsigned n = interception_get_hardware_id(ctx, d, hwid, sizeof hwid - 2);
            if (!n) continue;
            hwid[n] = hwid[n + 1] = 0;
            printf("mouse %d: %S\n", d, (const wchar_t *)hwid);
        }
        interception_destroy_context(ctx);
        return 0;
    }

    ULONGLONG stamp = 0;
    file_stamp(path, &stamp);

    SetConsoleCtrlHandler(on_ctrl, TRUE);
    SetConsoleTitleA("DirGain (Ctrl+Alt+F8 toggles, Ctrl+C quits)");
    SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
    CreateThread(NULL, 0, hotkey_thread, NULL, 0, NULL);
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
    ULONGLONG next_check = GetTickCount64() + 500;

    describe(path, &prof);
    printf("dirgain: ON for %s. Ctrl+Alt+F8 toggles, Ctrl+C quits.\n", only_device ? "one mouse" : "all mice");

    InterceptionStroke stroke;
    while (!stop_flag) {
        if (InterlockedExchange(&toggled, 0)) {
            int on = InterlockedCompareExchange(&enabled, 0, 0);
            for (int i = 0; i <= INTERCEPTION_MAX_DEVICE; i++) {
                dirgain_state_reset(&st[i]);
                have_last[i] = 0;
            }
            printf("dirgain: %s\n", on ? "ON" : "OFF (mouse passes through unchanged)");
            Beep(on ? 880 : 440, 80);
        }
        if (GetTickCount64() >= next_check) {
            next_check = GetTickCount64() + 500;
            ULONGLONG s;
            if (file_stamp(path, &s) == 0 && s != stamp) {
                stamp = s;
                dirgain_profile np;
                Sleep(50);
                if (dirgain_profile_load(&np, path, err, sizeof err) == 0) {
                    prof = np;
                    for (int i = 0; i <= INTERCEPTION_MAX_DEVICE; i++) dirgain_state_reset(&st[i]);
                    printf("dirgain: profile reloaded\n");
                    describe(path, &prof);
                } else {
                    fprintf(stderr, "dirgain: kept the previous profile, new one is invalid: %s\n", err);
                }
            }
        }

        InterceptionDevice dev = interception_wait_with_timeout(ctx, 250);
        if (interception_is_invalid(dev) || !interception_is_mouse(dev)) continue;
        if (interception_receive(ctx, dev, &stroke, 1) <= 0) continue;
        InterceptionMouseStroke *m = (InterceptionMouseStroke *)&stroke;
        int apply = enabled && (!only_device || dev == only_device);
        if (apply && !(m->flags & INTERCEPTION_MOUSE_MOVE_ABSOLUTE) && (m->x || m->y)) {
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
            if (!ox && !oy && !m->state && !m->rolling) continue;
        }
        interception_send(ctx, dev, &stroke, 1);
    }

    interception_destroy_context(ctx);
    printf("dirgain: stopped, mouse restored\n");
    return 0;
}
