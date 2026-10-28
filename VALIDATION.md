# Tok Farm 1.0.0 — verification

Verified on Windows x64 on October 28, 2026.

- TypeScript, including unused declarations: passed.
- Prettier formatting check: passed.
- Vitest: **16 tests passed** across crop/timestamp validation, persistent queue behavior, checkpoint failure recovery, and real FFmpeg integration.
- Real media tests covered moving crop pixels, trim timing, audio synchronization, 50/60 fps, fractional frame rates, the 60 fps cap, silent/muted sources, rotation, preview conversion, Unicode filenames, collisions, missing/changed/corrupt files, destination errors, and cancellation cleanup.
- Built the Windows x64 NSIS installer, installed it silently into a temporary test directory, and exercised the installed executable.
- Installed-app acceptance: imported a **2700.017-second, 1920×1080** synthetic video; created ten shots through the UI; used playback and I/O/Enter shortcuts; dragged crop keyframes; muted a shot; exported ten valid reels while editing an eleventh shot; verified queued snapshots; closed and reopened the project successfully.
- Checked media byte-range responses and the 1180×800 compact workspace, including export footer visibility. No renderer errors occurred.
- FFmpeg and FFprobe were absent from the system command path. The installed app exported using its bundled executables.

Acceptance details and screenshots are retained locally in `test-results/packaged-acceptance.json` and `test-results/packaged-*.png`. The 45-minute fixture loops a synthetic pitch scene; this validates duration, seeking, persistence, and the full workflow rather than every real broadcast codec or recording condition. No clean virtual machine was used.

## Deliverable

`release/Tok-Farm-1.0.0-Setup.exe`

SHA-256: `84D38DDA58FF8E282E7EA7B8B32C2C9D46C516A82BFF8DF1404617754CAC10B9`

The installer is unsigned. FFmpeg, FFprobe, their licenses/build information, and bundled JavaScript license notices are included. Source footage is never modified or uploaded.
