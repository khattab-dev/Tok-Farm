# Tok Farm 1.3.0 — verification

Verified on Windows x64 on October 29, 2026.

## Version 1.3 Qwen integration

- TypeScript, Prettier, and all **51 automated tests** passed. New pipeline tests cover source-time mapping, bounded review candidates, cache reuse/query invalidation, cancellation with partial results, temporary-file cleanup, missing model packs, and invalid model timestamps. Legacy library settings remain readable.
- Built the Windows x64 packaged app with the Qwen3-VL-2B-Instruct Q4_K_M model, Q8_0 vision encoder, and llama.cpp b11960 Vulkan/CPU runtimes included in `resources/qwen-runtime/`, together with licenses and pinned provenance.
- Tested the actual model through the **packaged app's UI** with PATH restricted to Windows system directories. Imported the supplied 1280×720, 30 fps, silent, 6220-second source and scanned 06:30–06:40 with a goal query. It returned one reviewable candidate around the known scoring play. This is a short-range test, not a full-match accuracy test.
- Edited a manual shot while Qwen was running, previewed and approved its suggestion, exported both shots, validated 1080×1920 output, and reopened the saved project with Qwen options and review status intact. Repeating the same query reused cached results in about 0.1 seconds. Cancelling another query preserved the saved shots and stopped the helper. The compact 1180×800 layout and scan controls were checked. No renderer errors occurred.
- Re-ran packaged quick-highlight acceptance: scanned the silent activity fixture, approved/dismissed suggestions, exported, reopened review decisions, and cancelled another scan successfully. The default quick scanner remains available.
- Artifacts: `test-results/packaged-qwen.json`, `test-results/packaged-qwen-settings.png`, `test-results/packaged-qwen-results.png`, `test-results/packaged-qwen-compact.png`, and `test-results/packaged-highlights.json`.
- Qwen is explicitly experimental. Earlier benchmark tests found false goal matches on a replay/chance even after stricter prompting. It is not an independent event verifier, and its evidence text can be wrong. General gaming/movie accuracy, complete goal recall, and precise landing detection remain unmeasured. See `docs/qwen-benchmark.md` and the local benchmark reports for measurements.

The Qwen model is bundled, so the packaged app needs no separate model setup or model downloads to scan. Developer packaging requires `pnpm prepare:qwen` once before building. A different prepared model folder can be selected in the app and is remembered locally. No system driver changes were made.

## Previous version 1.2 acceptance

- TypeScript, including unused declarations: passed.
- Prettier formatting check: passed.
- Vitest: **42 tests passed** across framing/crop/timestamp validation, persistent queue behavior, checkpoint failure recovery, real FFmpeg integration, the real local vision model, candidate ranking, scan cancellation, approval/dismissal, and library compatibility.
- Real media tests covered moving crop pixels, trim timing, audio synchronization, 50/60 fps, fractional frame rates, the 60 fps cap, silent/muted sources, rotation, preview conversion, Unicode filenames, collisions, missing/changed/corrupt files, destination errors, and cancellation cleanup.
- Built the Windows x64 NSIS installer, installed it silently into a temporary test directory, and exercised the installed executable.
- Installed-app acceptance: imported a **2700.017-second, 1920×1080** synthetic video; created ten shots through the UI; used playback and I/O/Enter shortcuts; dragged crop keyframes; muted a shot; exported ten valid reels while editing an eleventh shot; verified queued snapshots; closed and reopened the project successfully.
- Checked media byte-range responses and the 1180×800 compact workspace, including export footer visibility. No renderer errors occurred.
- Installed-app framing acceptance: Fit full video, Fill, custom zoom, horizontal/vertical placement, dragging the reel preview, solid-color and blurred-video backgrounds, per-shot layouts, project defaults, and applying layouts to all shots while preserving timed positions. Exported three independently snapshotted layouts, compared preview and actual export pixels, edited while exporting, and verified settings after reopening. The app's PATH was restricted to Windows system directories during this run.
- Real FFmpeg tests verified all four selectable output dimensions (1080×1920, 1080×1350, 1080×1080, and 1920×1080), solid padding pixels and boundaries, blurred background pixels, custom zoom and placement, and source-time animated positioning in fitted layouts. Domain tests covered fit/fill geometry for landscape, portrait, and square sources, blur overscan, legacy clips, and framing validation. Persistence tests covered independent queued settings; accepted AI suggestions inherit the project layout defaults.
- FFmpeg and FFprobe were absent from the system command path. The installed app exported using its bundled executables.
- Highlight UI acceptance: scanned a silent 55-second fixture, found two visual-activity candidates, previewed and approved one, dismissed the other, exported the approved shot, and restored both review decisions after reopening.
- The installed highlight test restricted the application's command path to Windows system directories, verified bundled model/runtime files, and passed without global Node.js, Python, or FFmpeg on that path. Inference runs in a separate utility process; cancelling during native model startup preserved the editor.
- The version 1.1 CPU benchmark of the synthetic 45-minute, 1080p fixture took **53.6 seconds** on this workstation. It produced no candidates for that quiet repeating scene. This measures the implementation on a simple fixture, not real-footage throughput or detection accuracy; the scanner engine is unchanged in version 1.2.
- The tests verify silent-input support, all three content profiles, static-frame suppression, cache reuse, no duplicate nearby candidates, source-change rejection, scan interruption recovery, and loading version 1.0 libraries without deleting projects.

Acceptance details and screenshots are retained locally in `test-results/packaged-acceptance.json`, `test-results/packaged-highlights.json`, `test-results/packaged-framing.json`, `test-results/highlight-suggestions.png`, and `test-results/packaged-*.png`. Scan timing is recorded in `test-results/scan-benchmark.json`.

The 45-minute fixture loops a synthetic pitch scene; the silent activity fixture contains known visual transitions. These validate processing, duration, seeking, review, persistence, and export. **Goal/save/chance recognition precision and recall on real football or gaming footage have not been measured.** Suggestions are experimental review candidates, not verified events. No clean virtual machine was used.

## Deliverable

Version 1.3 installer: `release/v1.3.0/Tok-Farm-1.3.0-Setup.exe` (1,802,449,468 bytes).

SHA-256: `9FF985237FF293753059401589E0C7D30A59DA60F3C77635F01B931CB5A9E4C8`

Updated portable app: `release/v1.3.0/win-unpacked/Tok Farm.exe` (keep its adjacent files and resources together).

Previous installer: `release/Tok-Farm-1.2.0-Setup.exe`

SHA-256: `878FD4B88BB391264E11462F1A1F652FB527FC4F842EE2C041ED3EFD5841BFA2`

The builds are unsigned. Version 1.3 includes FFmpeg, FFprobe, the CLIP model/runtime, the Qwen model/runtime, and relevant licenses/build information. Source footage is never modified or uploaded. The version 1.3 packaged app was exercised directly; the new installer was built but not installed during this change, and no clean virtual machine was used.
