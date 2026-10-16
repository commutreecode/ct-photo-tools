# ct-photo-tools

Browser photo editing helpers: rotate / crop, background replacement or a transparent background (MODNet; a see-through
photo is uploaded as PNG), mark removal (MI-GAN), an enhance step
with a before / after compare, HEIC conversion and upload preparation; plus a CPU photo enhancer (Real-ESRGAN + GFPGAN).

| File | What |
|---|---|
| `web/ct-photo.js` | the ✎ dialog; inserted into a host page's script (its header lists the names the host defines) |
| `py/ctphoto/enhance.py` | enhance one photo on a CPU (models downloaded once, SHA-256 checked; `CTPHOTO_MODELS` = folder); a see-through input keeps its alpha and is written as PNG: `run()` returns the file's `path` and `mime` |
| `tests/host.html` | the smallest host page |

Branch `live` = the last commit of `main` whose tests passed (`.github/workflows/test.yml`); *Rollback live* puts an
older commit there.

```
node tests/test_static.js
NPM_DIR=<dir with the unpacked npm packages> node tests/test_editor.js
python3 tests/test_enhance.py
```

Pinned: onnxruntime-web 1.17.3, @rmbg/model-modnet 0.0.1, migan-onnx 1.0.0, heic2any 0.0.4.
Licences: MODNet (Apache-2.0), MI-GAN (MIT), onnxruntime-web (MIT), heic2any (MIT), Real-ESRGAN / 2DFAN4 (BSD-3),
GFPGAN (Apache-2.0). No support; provided as is.
