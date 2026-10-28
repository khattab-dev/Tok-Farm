# Tok Farm

A local Windows desktop editor that turns long videos into separate vertical reels. Includes offline highlight suggestions for general footage, football, and gaming. Built with Electron, React, TypeScript, FFmpeg, and ONNX Runtime.

## Run the app

Requires Windows 10/11 x64, Node.js 22.12+ (24 LTS recommended), and pnpm 11.

```powershell
pnpm install
pnpm exec install-electron
pnpm dev
```

The first install downloads FFmpeg, FFprobe, and the Electron runtime. The first build or `pnpm prepare:analysis` also downloads the pinned CLIP vision model and a text model used to prepare its profile vectors (about 155 MB in total). Only the vision model, prepared vectors, and CPU inference runtime ship with the application. The packaged app runs offline and does not need Python, Node.js, a model server, an API key, or a separate FFmpeg installation.

## Find suggested highlights

1. Import a video and click **Find highlights**.
2. Choose **General**, **Football**, or **Gaming**, then select a sensitivity and maximum result count.
3. Click **Scan this video**. The app samples the full video every two seconds and ranks visual matches, visual activity, transitions, and optional relative audio-energy peaks. The entire video and all inference remain on your computer.
4. Preview each suggested range. Click **Add shot** to turn it into a regular editable shot, or dismiss it.
5. Return to **Your shots**, adjust timing and framing, and use the existing export queue.

Sound is optional. There is no speech recognition and no commentary-language requirement. Scanning, preview conversion, and exports run without uploading footage or audio. The packaged model is already installed; scanning does not download models or contact a cloud inference provider.

Suggestions are experimental review candidates, **not verified goals, saves, or victories**. CLIP matches sampled images to fixed descriptions; it does not understand every play or game mechanic, and two-second sampling can miss brief events. The Football profile proposes celebration, goalkeeper, chance, and replay scenes. The Gaming profile proposes combat, victory, clutch, and racing scenes. The interest score ranks combined signals and is not an event probability. All suggestions require review.

The scanner includes up to ten seconds before and after a candidate moment, avoids nearby duplicates, and suppresses static frames and steady loudness. Accepted results become normal shots and are never exported automatically. A scan can return no candidates. Try **More moments** or another profile, or mark shots manually.

One scan runs at a time in a separate helper process, so cancellation or a native-model error cannot terminate the editor. You can keep editing and exporting. Results and review decisions persist separately from editor autosaves; interrupted scans can be restarted. Visual/audio feature caches make repeat scans of the same source/profile faster and are invalidated when source metadata or model profiles change. Existing version 1.0 libraries remain readable.

## Make a reel

1. Import an MP4, MOV, or MKV video, or drop it into the window.
2. Seek to a moment. Press **I** to mark its start and **O** to mark its end. Press **Enter** or **Add shot** to save it.
3. Select a saved shot. Edit its name, trim, and audio in **Timing & audio**.
4. Choose an aspect ratio above the source monitor. Use **Fill** to crop into the frame or **Fit full video** to keep the whole picture. Open **Framing** (or the sliders icon) for zoom, placement, and blurred-video or solid-color backgrounds. Drag the reel preview to reposition the picture. Seek and move it again to animate its position; manage keyframe timing in **Timing & audio**.
5. Check the shots you want, choose an export folder, and click **Queue selected** or **Queue all shots**.
6. Click **Start queue**. You can keep selecting and editing shots during export.

Space plays/pauses. Left/right seeks by one nominal source-frame interval; Shift+left/right seeks five seconds. Timestamp fields accept seconds, `MM:SS`, or `HH:MM:SS.mmm`.

With no shot selected, framing controls set the layout for new shots, including accepted highlight suggestions. On a saved shot, changes apply to that shot. **Use for new shots** copies the current layout and playhead position to the project defaults. **Apply layout to all shots** copies the aspect ratio, fit/fill, zoom, and background to existing shots and new-shot defaults, keeping each shot's timed positions. Fit at 100% shows the entire source; raising zoom can crop it. Zoom is static for each shot (25–300%); position can be animated. Existing projects keep their original vertical Fill layout until changed.

## Export and recovery behavior

- Exports use the aspect ratio saved with each shot: **9:16** (1080×1920), **4:5** (1080×1350), **1:1** (1080×1080), or **16:9** (1920×1080). MP4 uses H.264 CRF 20, fast preset, yuv420p, AAC 192 kbps. Source frame rate is preserved up to 60 fps, including fractional rates. Variable-rate sources use their probed average frame rate for constant-rate output.
- Picture size stays fixed within each shot. Positions interpolate linearly and remain anchored to source timestamps when trimming. Positions outside the trim remain saved and participate in interpolation. In Fit layouts these positions can move the picture through padding; in Fill layouts they pan across the source.
- Queued jobs snapshot shot settings. Editing a shot does not change an existing job; queue it again to use the edits.
- Pause lets the current export finish and stops the next job. Cancel stops an export and removes its temporary file. Retry starts that reel from the beginning. Failures do not block the remaining queue.
- Existing files are never overwritten. Duplicate names receive numeric suffixes. Only successfully encoded and validated files become finished outputs.
- Projects and the queue autosave to `%APPDATA%/tok-farm/library.json`. Media caches live alongside that file. Source files stay in their original locations and are never modified. Keep their drives available.
- After restarting, pending jobs stay paused and running jobs become interrupted. Retry interrupted jobs, then start the queue.
- If the source moves, use **Relink source**. Replacement dimensions and duration must match. Relinking also repairs source references for unfinished queued jobs while preserving their shot settings.
- If Chromium cannot decode a source, create a cancellable H.264 preview copy. Exports always use the original video.
- SDR video is supported. HDR inputs are rejected explicitly. Low-resolution sources are upscaled; crop quality depends on the original footage.

## Build and verify

```powershell
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:highlights:e2e
pnpm test:framing:e2e
pnpm package
```

`pnpm test` runs domain/queue tests and real FFmpeg integration tests, including moving crop pixels, audio sync, 50/60 fps, rotated media, silence, cancellation, Unicode paths, and filename collisions.

`pnpm test:e2e` generates a synthetic 45-minute 1080p/30 fps match fixture, opens the real desktop app with Playwright, marks ten shots through the UI, drags crop positions, mutes a shot, exports ten reels while editing, verifies outputs, and reopens the saved project. Screenshots and results go to `test-results/`. The fixture loops a synthetic two-second pitch scene; it verifies long-duration navigation and the complete workflow, rather than decoder performance on every real broadcast format.

`pnpm test:highlights:e2e` scans a silent activity fixture through the real UI, previews and approves a suggestion, dismisses another, exports the approved shot, checks persistence, and cancels a second scan during model startup. Unit/integration tests also exercise the actual bundled vision model, all three profiles, cache reuse, source changes, and scan lifecycle recovery. These fixtures verify the pipeline, not goal/save detection accuracy on real matches.

`pnpm test:framing:e2e` verifies full-picture fitting, custom zoom and placement, preview dragging, aspect ratios, background choices, defaults, applying a layout to all shots without shifting keyframes, immutable queued layouts, and recovery after reopening. It compares actual exported pixels with the canvas preview and checks the compact workspace. Real FFmpeg tests also cover all four output sizes and animated fitted placement.

To run the same acceptance workflow against an installed executable:

```powershell
$env:TOKFARM_EXECUTABLE = 'C:\path\to\Tok Farm.exe'
pnpm exec tsx tests/acceptance.ts
```

The installer is generated in `release/`. It is unsigned; public distribution would require a signing certificate. No account, cloud service, tracking, or social publishing is included.

## Architecture

- `src/main`: validated file/queue IPC, ranged local-media streaming, probing, preview generation, atomic storage, and a sequential FFmpeg queue.
- `src/main/highlight-engine.ts` and `highlight-scanner.ts`: streaming frame/audio sampling, isolated local inference, candidate ranking, cancellation, and persisted review state.
- `scripts/prepare-analysis.cjs` and `vision-worker.cjs`: pinned model preparation and the inference helper. Model provenance and licenses ship in `resources/analysis-runtime/`.
- `src/preload`: the narrow typed bridge. Renderers have no Node.js access and run sandboxed with context isolation.
- `src/renderer`: the editor workspace. A single source video supplies both the source monitor and canvas-based reel preview.
- `src/shared`: validated project/clip models and shared crop interpolation/filter expressions.

See `THIRD_PARTY_NOTICES.md` for bundled executable licenses and corresponding source links.
