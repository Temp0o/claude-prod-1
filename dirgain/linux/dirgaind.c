/* dirgaind: grabs one evdev mouse, applies a DirGain profile, re-emits through uinput. */
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>

#include "dirgain.h"
#include "frame.h"

#define NBITS(x) ((((x) - 1) / (8 * sizeof(unsigned long))) + 1)
#define TEST_BIT(bit, arr) ((arr[(bit) / (8 * sizeof(unsigned long))] >> ((bit) % (8 * sizeof(unsigned long)))) & 1UL)

static volatile sig_atomic_t stop_flag;
static volatile sig_atomic_t reload_flag;

static void on_signal(int sig)
{
    if (sig == SIGHUP) reload_flag = 1;
    else stop_flag = 1;
}

static void usage(const char *argv0)
{
    fprintf(stderr,
            "usage: %s [-p profile.conf] /dev/input/eventN\n"
            "  Grabs the mouse, applies the profile, and re-emits it as a virtual device.\n"
            "  SIGHUP reloads the profile; SIGINT/SIGTERM release the mouse and exit.\n",
            argv0);
}

static int copy_caps(int src, int dst, unsigned type, unsigned max, unsigned long set_req)
{
    unsigned long bits[NBITS(KEY_MAX + 1)];
    memset(bits, 0, sizeof bits);
    if (ioctl(src, EVIOCGBIT(type, sizeof bits), bits) < 0) return 0;
    int any = 0;
    for (unsigned code = 0; code <= max; code++) {
        if (!TEST_BIT(code, bits)) continue;
        if (!any && ioctl(dst, UI_SET_EVBIT, type) < 0) return -1;
        any = 1;
        if (ioctl(dst, set_req, code) < 0) return -1;
    }
    return any;
}

static int load_profile(const char *path, dirgain_profile *p)
{
    char err[256];
    if (!path) {
        dirgain_profile_default(p);
        return 0;
    }
    if (dirgain_profile_load(p, path, err, sizeof err) < 0) {
        fprintf(stderr, "dirgaind: %s\n", err);
        return -1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    const char *profile_path = NULL;
    int opt;
    while ((opt = getopt(argc, argv, "p:h")) != -1) {
        if (opt == 'p') profile_path = optarg;
        else {
            usage(argv[0]);
            return opt == 'h' ? 0 : 2;
        }
    }
    if (optind != argc - 1) {
        usage(argv[0]);
        return 2;
    }
    const char *dev = argv[optind];

    dirgain_profile prof;
    if (load_profile(profile_path, &prof) < 0) return 1;

    int src = open(dev, O_RDONLY);
    if (src < 0) {
        fprintf(stderr, "dirgaind: open %s: %s\n", dev, strerror(errno));
        return 1;
    }
    unsigned long relbits[NBITS(REL_MAX + 1)];
    memset(relbits, 0, sizeof relbits);
    if (ioctl(src, EVIOCGBIT(EV_REL, sizeof relbits), relbits) < 0 || !TEST_BIT(REL_X, relbits) ||
        !TEST_BIT(REL_Y, relbits)) {
        fprintf(stderr, "dirgaind: %s does not report relative X/Y motion\n", dev);
        return 1;
    }
    char name[200] = "mouse";
    ioctl(src, EVIOCGNAME(sizeof name), name);
    struct input_id id;
    memset(&id, 0, sizeof id);
    ioctl(src, EVIOCGID, &id);

    int dst = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (dst < 0) {
        fprintf(stderr, "dirgaind: open /dev/uinput: %s\n", strerror(errno));
        return 1;
    }
    if (copy_caps(src, dst, EV_KEY, KEY_MAX, UI_SET_KEYBIT) < 0 ||
        copy_caps(src, dst, EV_REL, REL_MAX, UI_SET_RELBIT) < 0 ||
        copy_caps(src, dst, EV_MSC, MSC_MAX, UI_SET_MSCBIT) < 0) {
        fprintf(stderr, "dirgaind: copying device capabilities failed: %s\n", strerror(errno));
        return 1;
    }
    struct uinput_setup us;
    memset(&us, 0, sizeof us);
    us.id = id;
    snprintf(us.name, sizeof us.name, "DirGain %.60s", name);
    if (ioctl(dst, UI_DEV_SETUP, &us) < 0 || ioctl(dst, UI_DEV_CREATE) < 0) {
        fprintf(stderr, "dirgaind: creating virtual device failed: %s\n", strerror(errno));
        return 1;
    }

    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_signal;
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGHUP, &sa, NULL);

    /* Let the desktop see the virtual device before the real one disappears. */
    usleep(200000);
    if (ioctl(src, EVIOCGRAB, 1) < 0) {
        fprintf(stderr, "dirgaind: grab %s: %s\n", dev, strerror(errno));
        ioctl(dst, UI_DEV_DESTROY);
        return 1;
    }
    fprintf(stderr, "dirgaind: applying profile to \"%s\" (Ctrl+C to stop)\n", name);

    dg_framer fr;
    dg_framer_init(&fr, &prof);
    struct input_event in[64];
    struct input_event out[DG_FRAME_CAP + 3];
    int rc = 0;
    while (!stop_flag) {
        if (reload_flag) {
            reload_flag = 0;
            dirgain_profile np;
            if (load_profile(profile_path, &np) == 0) {
                dg_framer_set_profile(&fr, &np);
                fprintf(stderr, "dirgaind: profile reloaded\n");
            }
        }
        ssize_t r = read(src, in, sizeof in);
        if (r < 0) {
            if (errno == EINTR) continue;
            fprintf(stderr, "dirgaind: read: %s\n", strerror(errno));
            rc = 1;
            break;
        }
        for (size_t i = 0; i < (size_t)r / sizeof in[0]; i++) {
            int n = dg_framer_push(&fr, &in[i], out);
            if (n > 0) {
                ssize_t w;
                do {
                    w = write(dst, out, n * sizeof out[0]);
                } while (w < 0 && errno == EINTR);
                if (w < 0 && errno != EAGAIN) {
                    fprintf(stderr, "dirgaind: write: %s\n", strerror(errno));
                    stop_flag = 1;
                    rc = 1;
                    break;
                }
            }
        }
    }

    ioctl(src, EVIOCGRAB, 0);
    ioctl(dst, UI_DEV_DESTROY);
    close(dst);
    close(src);
    return rc;
}
