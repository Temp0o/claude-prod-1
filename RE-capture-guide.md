# Reverse-engineering PureVector with REA: what to capture

This cloud sandbox cannot download Corsair Web Hub, Aimlabs or Corsair firmware: the environment's network policy denies `corsair.com`, `aimlabs.com` and `store.steampowered.com`. REA itself works here (`rea-agents` 6.7.0 via `npx`, smoke-tested offline on a synthetic HAR). It just needs the artifacts. Capture them on your PC, put them in `captures/` (git-ignored) or attach them, and I'll run the REA routes below.

## Questions to answer
1. **Profile format:** how many direction bins or parameters, value type and range, how it's tied to a DPI stage.
2. **Where the profile is computed:** in the Aimlabs client, in the cloud, or in Web Hub? How it reaches Web Hub.
3. **Firmware write:** the HID report or command layout (only for Corsair compatibility, not needed for any-mouse).
4. **Calibration task:** target count, directions, distances, and what "distance moved" and "relative accuracy" mean.
5. **Runtime behavior:** a static per-direction multiplier (our assumption) or something else.

## Artifacts, how to capture them, and the REA route

| # | Artifact | Needs the mouse? | Capture on your PC | REA here | Answers |
|---|---|---|---|---|---|
| 1 | **Web Hub HAR with response bodies** | No for the JavaScript; yes for profile traffic | Chrome: DevTools, Network tab, tick "Preserve log" and "Disable cache", open Web Hub, open the PureVector card (and run "Refine calibration" if you own the mouse), then right-click and "Export HAR (sanitized)". | `rea inspect-web-network-capture <abs path> har`, then extract the JavaScript bodies into a folder and run `rea analyze-javascript-application <dir> --json` (summary first), then trace the seeds `PureVector`, `purevector`, `directional`. | 1, 2, 3 |
| 2 | **Web Hub live bundle** (optional) | No | REA's installer supports macOS/Linux. Start Chrome with `--remote-debugging-port=9222` and open Web Hub. | On your machine: `rea list-browser-targets http://127.0.0.1:9222`, then `rea export-web-scripts` or `rea analyze-web-bundle http://127.0.0.1:9222 <targetId> --observation-ms 5000`. | 1, 3 |
| 3 | **USB capture while the profile is written** | Yes | Wireshark + USBPcap on Windows. Capture only while Web Hub saves the calibration, then save as `.pcapng`. | `rea inspect-pcap-capture` / `rea inspect-packet-capture` with USB HID fields. This needs TShark in this environment; if it can't be installed here, run REA locally. | 3 |
| 4 | **Aimlabs game files** (free on Steam) | No | Look in the Aimlabs install folder. Mono build: `Aimlabs_Data/Managed/Assembly-CSharp.dll`. IL2CPP build: `Aimlabs_Data/il2cpp_data/Metadata/global-metadata.dat` + `GameAssembly.dll`. | Mono: `rea inspect-managed-members` (types, methods, string literals; no disassembler needed). IL2CPP: the skill's `inspect_il2cpp_metadata` is newer than the published 6.7.0 CLI, and native code needs Ghidra, which isn't installed here. | 2, 4, 5 |

## Privacy and rules
- HARs can contain login tokens. Use Chrome's sanitized export, and don't upload passwords or session cookies. REA's `--sensitive-value` can mark extra literals.
- Findings are used only as **facts** (format, parameter counts, ranges, task layout). No Corsair or Aimlabs code or data is copied into the remake. This is interoperability research; check your local law and the software's terms. Not legal advice.
- Each finding gets logged with its REA Evidence ID and kept separate from inference, as the skill requires.
