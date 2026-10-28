# Tok Farm 1.1.0 — verification

Verified on Windows x64 on October 28, 2026.

- TypeScript, including unused declarations: passed.
- Prettier formatting check: passed.
- Vitest: **35 tests passed** across crop/timestamp validation, persistent queue behavior, checkpoint failure recovery, real FFmpeg integration, the real local vision model, candidate ranking, scan cancellation, approval/dismissal, and library compatibility.
- Real media tests covered moving crop pixels, trim timing, audio synchronization, 50/60 fps, fractional frame rates, the 60 fps cap, silent/muted sources, rotation, preview conversion, Unicode filenames, collisions, missing/changed/corrupt files, destination errors, and cancellation cleanup.
- Built the Windows x64 NSIS installer, installed it silently into a temporary test directory, and exercised the installed executable.
- Installed-app acceptance: imported a **2700.017-second, 1920×1080** synthetic video; created ten shots through the UI; used playback and I/O/Enter shortcuts; dragged crop keyframes; muted a shot; exported ten valid reels while editing an eleventh shot; verified queued snapshots; closed and reopened the project successfully.
- Checked media byte-range responses and the 1180×800 compact workspace, including export footer visibility. No renderer errors occurred.
- FFmpeg and FFprobe were absent from the system command path. The installed app exported using its bundled executables.
- Highlight UI acceptance: scanned a silent 55-second fixture, found two visual-activity candidates, previewed and approved one, dismissed the other, exported the approved shot, and restored both review decisions after reopening.
- The installed highlight test restricted the application's command path to Windows system directories, verified bundled model/runtime files, and passed without global Node.js, Python, or FFmpeg on that path. Inference runs in a separate utility process; cancelling during native model startup preserved the editor.
- A fresh local CPU scan of the synthetic 45-minute, 1080p fixture took **53.6 seconds** on this workstation. It produced no candidates for that quiet repeating scene. This measures the implementation on a simple fixture, not real-footage throughput or detection accuracy.
- The tests verify silent-input support, all three content profiles, static-frame suppression, cache reuse, no duplicate nearby candidates, source-change rejection, scan interruption recovery, and loading version 1.0 libraries without deleting projects.

Acceptance details and screenshots are retained locally in `test-results/packaged-acceptance.json`, `test-results/packaged-highlights.json`, `test-results/highlight-suggestions.png`, and `test-results/packaged-*.png`. Scan timing is recorded in `test-results/scan-benchmark.json`.

The 45-minute fixture loops a synthetic pitch scene; the silent activity fixture contains known visual transitions. These validate processing, duration, seeking, review, persistence, and export. **Goal/save/chance recognition precision and recall on real football or gaming footage have not been measured.** Suggestions are experimental review candidates, not verified events. No clean virtual machine was used.

## Deliverable

`release/Tok-Farm-1.1.0-Setup.exe`

SHA-256: `40B5AFC9D2B35EDE873EB5AB64BAE8856FB33FB14AA3AB74160223860A442C9A`

The installer is unsigned. It includes FFmpeg, FFprobe, the quantized CLIP vision model, prepared profile vectors, the Windows ONNX Runtime, and relevant licenses/build information. Source footage is never modified or uploaded.
