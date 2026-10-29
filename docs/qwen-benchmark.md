# Local Qwen3-VL benchmark

This is the standalone evaluation runner for the experimental Qwen engine. Tok Farm 1.3 also exposes Qwen through **Find highlights → Analysis engine → Qwen · experimental**. The quick visual scanner remains the default. The benchmark tests short ranges of arbitrary SDR videos with natural-language event searches or automatic visual-highlight prompts. It does not require training, Python, Ollama, an API key, or an external inference service. The app scans selected ranges or full videos, whereas this benchmark keeps a 120-second cap on individual experiments.

## Prepare once

From the project directory on Windows x64:

```powershell
pnpm prepare:tools
pnpm prepare:qwen
```

Preparation downloads the official Qwen3-VL-2B-Instruct Q4_K_M model (1,107,409,952 bytes), matching Q8_0 vision encoder (445,053,216 bytes), and pinned Windows x64 llama.cpp b11960 Vulkan/CPU runtimes. Allow several GB for downloads, extracted runtimes, and test artifacts. Files stay in ignored `build/qwen-runtime/` and `build/model-cache/qwen/` directories. Downloads resume partial files and verify exact sizes and SHA-256 values before use. Model/runtime provenance and licenses are stored beside the prepared files. `scripts/qwen-assets.json` records immutable revisions and hashes.

Only preparation downloads files. Inference uses local model files and a loopback-only helper authenticated with a temporary random key. It does not expose file access, tools, or a web UI. Video snippets are sent as data to that local helper. The original video is read without modification. The helper is stopped after a run or cancellation, and temporary snippets are removed.

The Vulkan backend was chosen for the RTX 3050 laptop's existing NVIDIA driver; no driver or system settings are changed. `--backend auto` tries a compatible Vulkan GPU, preferring NVIDIA when present, then falls back to CPU if GPU initialization fails. `--backend cpu` explicitly selects the CPU runtime. An inference error is recorded rather than silently substituting results from another engine.

## Run

```powershell
pnpm benchmark:qwen --controlled

pnpm benchmark:qwen --video "C:\Videos\match.mp4" --event "A goal being scored during live play, excluding replays and celebrations alone" --start 390 --duration 22 --truth 398

pnpm benchmark:qwen --video "C:\Videos\aircraft.mp4" --event "The airplane's wheels touch the runway" --start 20 --duration 20

pnpm benchmark:qwen --video "C:\Videos\movie.mp4" --start 60 --duration 24
```

Omitting `--event` uses an automatic visual-highlight prompt. `--truth` is optional and can be repeated to evaluate known events. **All times are seconds on the video player's timeline, not a broadcast's match clock.** A provided 5:53 football match-clock example corresponded to approximately 6:38 / 398 seconds in the supplied video file.

Defaults are 10-second windows, two-second overlap, 2 sampled frames per second, 256 image tokens per frame, and 8192 context tokens. Options include `--backend`, `--fps`, `--window`, `--overlap`, `--context`, `--image-tokens`, and `--output`. These are benchmark settings, not validated universal defaults. The runner caps a range at 120 seconds, windows at 20 seconds, FPS at 8, and context at 16384 to bound experiments. Increasing detail can improve visibility of small objects but increases memory/time; tokens can still overflow the chosen context, which is reported as an error.

Use `--negative` only when the entire chosen range is known to contain no requested event. This is an evaluation label and is never supplied to the model. The controlled fixture has a red rectangle visible from 4–7 seconds on an otherwise empty dark background; its empty sections are labeled automatically.

```powershell
pnpm benchmark:qwen --controlled --start 8 --duration 4 --negative
pnpm benchmark:qwen --controlled --cancel-after 10
```

Ctrl+C or `--cancel-after SECONDS` cancels the run. The helper and its owned FFmpeg child processes are terminated; a cancelled report is retained. No user app processes are closed.

## Reports and interpretation

Each run writes `report.json` and `runtime.log` under `test-results/qwen/run-<timestamp>/`, or the requested output directory. Reports contain source metadata, search text, analysis protocol version, runtime/model revisions, hardware, effective backend, startup/inference times, token counts, raw structured responses, validated absolute event times, and observed memory use. Snippets are removed, but reports include local file paths and content descriptions; keep them private when using private footage.

Qwen returns an observation summary, an explicit `match_found` decision, and events with relative start/end times and visible evidence. JSON generation is constrained to a schema and validated again in TypeScript. Inconsistent decisions, malformed data, out-of-range timestamps, and truncated output are errors. Model output is data and is never executed. Overlapping observations of the same label can be merged; adjacent segments with identical labels and evidence are coalesced into a continuous event. Separate events remain independent. There is no legacy 22-second suppression or top-20 cap.

The evaluation matches known timestamps one-to-one against predicted intervals within a two-second tolerance. It reports recall only on provided events. With incomplete annotations, unmatched predictions are **unreviewed**, not automatically false positives. `--negative` and the controlled fixture can measure known false detections. A wide predicted interval matching a timestamp does not demonstrate precise timing. Event intervals and evidence descriptions remain model estimates requiring review.

GPU readings are sampled total device usage, including other applications, and can miss brief peaks. Process RSS is the helper's OS-recorded peak working set and excludes child processes. Timing includes overlapping inference work; a 22-second range can require more than 22 seconds of sampled windows. No full-match processing-speed claim follows from these short runs.

The runner is **visual-only**. Qwen3-VL is not being used to listen to audio; speech/sound processing would require separate local components. A silent video is supported, but an event defined only by dialogue or sound cannot be found by this benchmark. General-purpose recognition, complete goal recall, game mechanics, replay identification, and arbitrary precise timestamps are not guaranteed.

## Initial observations

The October 29, 2026 check used an RTX 3050 Laptop GPU with 4 GB VRAM, NVIDIA driver 529.04, and 15.8 GiB system RAM. Vulkan inference ran without a driver upgrade. The supplied goal was detected around source time 397.5–398.5 seconds in a 10-second test, taking about 18.3 seconds of inference and 2,486 MiB (about 2.43 GiB) observed GPU memory. A separate initial 22-second test took about 46.6 seconds of inference, and its celebration-only section correctly returned no goal.

Negative tests exposed false positives on an earlier replay/chance and an empty controlled section in the initial prompt. An explicit match decision and negative-response instructions were added in protocol `qwen-window-v3`: the empty section then returned no events on both GPU and CPU, but the earlier replay/chance still produced a false goal. The CPU test took about 60 seconds for four seconds of video, with approximately 3,210 MiB peak process working set; it was a functional fallback check, not a controlled CPU speed benchmark. These results do not justify making Qwen the default or presenting its output as verified events; it is offered as an explicit experimental choice requiring review.

A public-domain aviation clip was recognized as an airplane moving along a runway. Initially it produced repetitive half-second segments; identical adjacent observations are now coalesced. This is a basic cross-domain check, not a validated touchdown-localization result. Movie and gaming accuracy have not been evaluated with this model.

Before promoting this beyond an experimental engine, evaluate a larger labeled set with positive and negative examples from multiple sports, games, movies, and ordinary recordings; measure event recall, false positives, timing errors, and throughput. Compare verification strategies and detail settings, especially when evidence is small or ambiguous. Retain this benchmark as the baseline rather than treating model-generated confidence as a calibrated probability.

## Primary sources

- [Official Qwen GGUF model and vision encoder](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF)
- [Qwen video inference documentation](https://github.com/QwenLM/Qwen3-VL)
- [llama.cpp multimodal support](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)
- [Pinned llama.cpp runtime release](https://github.com/ggml-org/llama.cpp/releases/tag/b11960)

The optional aviation fixture used in local tests is [Airplane Landing Timelapse](https://commons.wikimedia.org/wiki/File:Airplane_Landing_Timelapse.webm), by Kingofthedead / MB298, released into the public domain. Original SHA-1: `cf2c03752276c0417283b3975e5b53b903c613bc`. It shows the runway from a passenger-window viewpoint; a successful runway-rollout search does not validate precise touchdown detection. It is retained only in ignored local test results and is not bundled with the app.
