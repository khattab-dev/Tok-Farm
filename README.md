# Tok Farm

A local Windows desktop editor that turns long match videos into separate vertical reels. Built with Electron, React, TypeScript, and FFmpeg.

## Run the app

Requires Windows 10/11 x64, Node.js 22.12+ (24 LTS recommended), and pnpm 11.

```powershell
pnpm install
pnpm exec install-electron
pnpm dev
```

The first install downloads FFmpeg, FFprobe, and the Electron runtime. The packaged app runs offline and does not need Node.js or a separate FFmpeg installation.

## Make a reel

1. Import an MP4, MOV, or MKV video, or drop it into the window.
2. Seek to a moment. Press **I** to mark its start and **O** to mark its end. Press **Enter** or **Add shot** to save it.
3. Select a saved shot. Edit its name and trim times in **Shot settings**.
4. Seek to a point in the shot and drag the 9:16 frame. Repeat at another point to create a moving crop. Use the crop-position sliders to adjust timing, or delete unwanted positions.
5. Check the shots you want, choose an export folder, and click **Queue selected** or **Queue all shots**.
6. Click **Start queue**. You can keep selecting and editing shots during export.

Space plays/pauses. Left/right seeks by one nominal source-frame interval; Shift+left/right seeks five seconds. Timestamp fields accept seconds, `MM:SS`, or `HH:MM:SS.mmm`.

## Export and recovery behavior

- Reels are independent 1080×1920 MP4 files: H.264 CRF 20, fast preset, yuv420p, AAC 192 kbps. Source frame rate is preserved up to 60 fps, including fractional rates. Variable-rate sources use their probed average frame rate for constant-rate output.
- The vertical crop has a fixed size. Crop positions interpolate linearly and remain anchored to source timestamps when trimming. Positions outside the trim remain saved and participate in interpolation.
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
pnpm package
```

`pnpm test` runs domain/queue tests and real FFmpeg integration tests, including moving crop pixels, audio sync, 50/60 fps, rotated media, silence, cancellation, Unicode paths, and filename collisions.

`pnpm test:e2e` generates a synthetic 45-minute 1080p/30 fps match fixture, opens the real desktop app with Playwright, marks ten shots through the UI, drags crop positions, mutes a shot, exports ten reels while editing, verifies outputs, and reopens the saved project. Screenshots and results go to `test-results/`. The fixture loops a synthetic two-second pitch scene; it verifies long-duration navigation and the complete workflow, rather than decoder performance on every real broadcast format.

To run the same acceptance workflow against an installed executable:

```powershell
$env:TOKFARM_EXECUTABLE = 'C:\path\to\Tok Farm.exe'
pnpm exec tsx tests/acceptance.ts
```

The installer is generated in `release/`. It is unsigned; public distribution would require a signing certificate. No account, cloud service, tracking, or social publishing is included.

## Architecture

- `src/main`: validated file/queue IPC, ranged local-media streaming, probing, preview generation, atomic storage, and a sequential FFmpeg queue.
- `src/preload`: the narrow typed bridge. Renderers have no Node.js access and run sandboxed with context isolation.
- `src/renderer`: the editor workspace. A single source video supplies both the source monitor and canvas-based reel preview.
- `src/shared`: validated project/clip models and shared crop interpolation/filter expressions.

See `THIRD_PARTY_NOTICES.md` for bundled executable licenses and corresponding source links.
