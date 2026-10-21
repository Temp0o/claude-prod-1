DirGain for Windows
===================

What it does
  Applies your DirGain profile (a per-direction mouse gain measured by the calibrator) to
  your mouse before games see it. Works with any mouse and any game that reads the mouse,
  including raw-input shooters.

Two ways to use your profile
  A. Raw Accel (safer with anti-cheat): the calibrator's "Use it in games" step gives the four
     Raw Accel numbers that best match your profile and says how much of it they capture.
     No DirGain program needed.
  B. Full profile (this folder): dirgain.exe applies every part of the profile, diagonals
     included, through the Interception driver.

Setup for B (about 5 minutes)
  1. Install the Interception driver once:
       download the latest release from https://github.com/oblitum/interception/releases/latest
       and unzip it; find install-interception.exe (in its command line installer folder)
       open Command Prompt as administrator (right-click > Run as administrator), cd there
       run:  install-interception.exe /install
       (run it with no arguments to see its own instructions), then reboot.
  2. In the calibrator, open "Use it in games" and click "Download profile.conf".
  3. Put profile.conf in the same folder as dirgain.exe.
  4. Double-click dirgain.exe. A console window shows your gains by direction and "ON".
     Leave it open while you play.

Controls
  Ctrl+Alt+F8     turn the profile on or off (high beep = on, low beep = off)
  Ctrl+C          quit; your mouse goes back to normal immediately
  Save a new profile.conf over the old one and dirgain.exe reloads it within half a second.

Options (from a Command Prompt)
  dirgain.exe --list                 show the mice Interception sees
  dirgain.exe profile.conf --device 11   apply to one mouse only (number from --list)

Warnings
  * Anti-cheat: Interception is a kernel input filter. Some anti-cheat systems block or flag
    it. Check your game's rules before using it in protected online games; when in doubt,
    use route A (Raw Accel).
  * Windows SmartScreen may warn because dirgain.exe is not code-signed. Choose
    "More info" > "Run anyway", or build it yourself from the source (see below).
  * Some antivirus tools flag programs that intercept input. The full source is in this
    repository.

Uninstalling
  Close dirgain.exe. To remove the driver: install-interception.exe /uninstall as
  administrator, then reboot.

Build it yourself
  From the repository's dirgain folder, with MinGW-w64:
    make windows INTERCEPTION_SDK=/path/to/a/checkout/of/oblitum/Interception
  The prebuilt dirgain.exe here was built that way from this repository's source and
  Interception commit 39eecbbc46a52e0402f783b872ef62b0254a896a, statically, so no DLLs
  are needed.
  SHA-256 of the prebuilt dirgain.exe:
    59174807726595aca8bf186727a69d9e58913e81ff8f9142b7ab8594637c7ab5

Licenses
  DirGain code: see the repository. Interception library: LGPL for non-commercial use
  (commercial use needs Interception's own license); source at
  https://github.com/oblitum/Interception. You can rebuild or relink dirgain.exe from
  the sources above.

Verified so far
  Built with -Wall -Wextra -Werror. Startup, error messages and the event loop were tested
  under Wine against a mock Interception library (gains, button/wheel/absolute passthrough,
  per-device filtering). Not yet run on a real Windows PC with the real driver: please
  report how it behaves.
