# Third-party software bundled with Tok Farm

Tok Farm invokes FFmpeg and FFprobe as separate executable programs. They retain their own licenses. The application's MIT license does not replace the licenses of those programs or their bundled libraries.

## FFmpeg and FFprobe

- Packages: `ffmpeg-static` 5.3.0 and `@derhuerst/ffprobe-static` 5.3.0.
- Windows x64 binaries: FFmpeg 6.1.1 essentials build by Gyan Doshi, distributed under GNU GPL version 3. No changes to the binary programs have been made by Tok Farm.
- Original distribution and build information: https://www.gyan.dev/ffmpeg/builds/
- Binary release: https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- FFmpeg source revision identified by the build: https://github.com/FFmpeg/FFmpeg/commit/e38092ef93
- Source archive: https://github.com/FFmpeg/FFmpeg/archive/e38092ef93.tar.gz
- Build/download scripts and package source: https://github.com/eugeneware/ffmpeg-static/tree/b6.1.1
- Full GPL license text and each build's README/configuration accompany the executables in `resources/video-tools/`.

Builds include separately licensed libraries such as x264. The bundled build README lists their versions, build configuration, and license information. Preserve these files when redistributing the application, and satisfy the corresponding-source obligations for the GPL executable builds and their linked libraries. Source and build information are also available from the original binary distributor.

## Electron and Chromium

Electron is MIT licensed: https://github.com/electron/electron/blob/main/LICENSE

Electron includes Chromium, Node.js, and other components. Electron's `LICENSE` and `LICENSES.chromium.html` are included in the installation directory.

## Local visual analysis

- CLIP ViT-B/32, developed by OpenAI, with quantized ONNX weights converted by Xenova: https://huggingface.co/Xenova/clip-vit-base-patch32
- Model revision: `4c1807b705b1d015fb032789cc4d221b23025a6f`. The original MIT license is included as `resources/analysis-runtime/CLIP-LICENSE.txt`. Original source and model documentation: https://github.com/openai/CLIP
- ONNX Runtime 1.22.0 by Microsoft, MIT licensed: https://github.com/microsoft/onnxruntime/tree/v1.22.0. Its license and third-party notices accompany the native runtime in `resources/analysis-runtime/`.
- The packaged application includes the quantized vision encoder, locally prepared text vectors for the supported profiles, and the Windows CPU inference runtime. No hosted inference service is used. `MODEL-PROVENANCE.json` records the pinned source, vision weight checksum, and profile checksum.
- Hugging Face Tokenizers.js 0.2.0 is used only during model preparation and is not part of the runtime application: https://github.com/huggingface/tokenizers.js (Apache-2.0).

## Application dependencies

- React / React DOM: MIT, https://github.com/facebook/react
- Zod: MIT, https://github.com/colinhacks/zod
- Lucide React icons: ISC, https://github.com/lucide-icons/lucide

License notices for bundled JavaScript dependencies accompany the application in `resources/video-tools/JAVASCRIPT-LICENSES.txt`. Development-only tooling is not part of the runtime application.
