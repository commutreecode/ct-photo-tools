"""✨ Enhance (HD) for one photo on a CPU (onnxruntime).

    photo -> Real-ESRGAN x2 (only when its long side <= UPSCALE_MAX: small / blurred photos)
          -> every face (up to MAX_FACES; OpenCV Haar finder + 2DFAN4 landmarks) rebuilt by GFPGAN 1.4 at 512 px,
             mixed BLEND rebuilt + (1 - BLEND) original so the person still looks like themself, pasted back softly
          -> JPEG (a see-through photo: PNG, its alpha channel resized to the new size)

Models (onnx copies in the facefusion-assets release on GitHub, checked by SHA-256 before use):
    Real-ESRGAN x2plus  BSD-3-Clause (xinntao/Real-ESRGAN)
    GFPGAN v1.4         Apache-2.0  (TencentARC/GFPGAN)
    2DFAN4              BSD-3-Clause (1adrianb/face-alignment)
The face finder is OpenCV's own (BSD). No model with a non-commercial licence is used.

    PYTHONPATH=py python3 -m ctphoto.enhance in.jpg out.jpg   (a see-through input is written as out.png; models are downloaded to $CTPHOTO_MODELS or ~/.cache/ctphoto-models;
    set CTPHOTO_MODELS to a cached folder)
"""
from __future__ import annotations

import hashlib
import os
import sys
import time
import urllib.request
from pathlib import Path

ASSETS = "https://github.com/facefusion/facefusion-assets/releases/download/models-3.0.0/"
MODELS = {   # file: (sha256, bytes)
    "real_esrgan_x2.onnx": ("5be2d62ab3b0357986efb20a19638334c0e7a2a055ccbc52c77063da0482b3bb", 69552244),
    "gfpgan_1.4.onnx": ("accc4757b26bdb89b32b4d3500d4f79c9dff97c1dd7c7104bf9dcb95e3311385", 340299087),
    "2dfan4.onnx": ("678c6fa539d52335a31c980feefdf4a6e02d781d83dce00af8a894f114557285", 97904803),
}
UPSCALE_MAX = 1200      # px, long side: photos up to this size are upscaled x2 first (bigger ones: faces only)
MAX_FACES = 4
BLEND = 0.8             # rebuilt face share (the rest is the photo's own face: keeps the person's look)
TEMPLATE = [[192.98138, 239.94708], [318.90277, 240.1936], [256.63416, 314.01935],   # FFHQ 512: eyes, nose, mouth corners
            [201.26117, 371.41043], [313.08905, 371.15118]]


def models_dir() -> Path:
    return Path(os.environ.get("CTPHOTO_MODELS") or Path.home() / ".cache" / "ctphoto-models")


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def ensure_models(log=print) -> Path:
    """The three model files, downloaded once (GitHub release) and always checked against their SHA-256."""
    d = models_dir()
    d.mkdir(parents=True, exist_ok=True)
    for name, (sha, size) in MODELS.items():
        p = d / name
        if p.exists() and p.stat().st_size == size and _sha(p) == sha:
            continue
        log(f"downloading {name} ({size >> 20} MB)")
        tmp = p.with_suffix(".part")
        urllib.request.urlretrieve(ASSETS + name, tmp)
        if tmp.stat().st_size != size or _sha(tmp) != sha:
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"enhance model {name} is not the expected file")
        tmp.replace(p)
    return d


class Enhancer:
    def __init__(self, threads: int | None = None):
        import onnxruntime as ort
        d = ensure_models()
        opt = ort.SessionOptions()
        opt.intra_op_num_threads = threads or max(1, os.cpu_count() or 2)
        s = lambda f: ort.InferenceSession(str(d / f), opt, providers=["CPUExecutionProvider"])
        self.up, self.gfp, self.lm = s("real_esrgan_x2.onnx"), s("gfpgan_1.4.onnx"), s("2dfan4.onnx")

    # ---------------------------------------------------------------- upscale
    def esrgan(self, img, tile=192, pad=12, progress=None):
        import cv2
        import numpy as np
        H0, W0 = img.shape[:2]
        img = cv2.copyMakeBorder(img, 0, H0 % 2, 0, W0 % 2, cv2.BORDER_REFLECT)       # the x2 model needs even sizes
        h, w = img.shape[:2]
        out = np.zeros((h * 2, w * 2, 3), np.float32)
        x = img[:, :, ::-1].astype(np.float32) / 255
        tiles = [(y0, x0) for y0 in range(0, h, tile) for x0 in range(0, w, tile)]
        for k, (y0, x0) in enumerate(tiles):
            ya, yb, xa, xb = max(0, y0 - pad), min(h, y0 + tile + pad), max(0, x0 - pad), min(w, x0 + tile + pad)
            r = self.up.run(None, {"input": x[ya:yb, xa:xb].transpose(2, 0, 1)[None]})[0][0].transpose(1, 2, 0)
            oy, ox, hh, ww = (y0 - ya) * 2, (x0 - xa) * 2, min(tile, h - y0) * 2, min(tile, w - x0) * 2
            out[y0 * 2:y0 * 2 + hh, x0 * 2:x0 * 2 + ww] = r[oy:oy + hh, ox:ox + ww]
            if progress:
                progress((k + 1) / len(tiles))
        return (np.clip(out, 0, 1) * 255).round().astype(np.uint8)[:H0 * 2, :W0 * 2, ::-1]

    # ---------------------------------------------------------------- faces
    @staticmethod
    def faces(img):
        import cv2
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        c = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        m = max(48, min(img.shape[:2]) // 12)
        found = c.detectMultiScale(g, 1.1, 6, minSize=(m, m))
        return sorted((tuple(int(v) for v in b) for b in found), key=lambda b: -b[2] * b[3])[:MAX_FACES]

    def landmarks5(self, img, box):
        import cv2
        import numpy as np
        x, y, w, h = box
        scale = 195 / max(w, h)
        A = np.array([[scale, 0, (256 - (2 * x + w) * scale) * 0.5], [0, scale, (256 - (2 * y + h) * scale) * 0.5]], np.float32)
        crop = cv2.warpAffine(img, A, (256, 256))
        lm = self.lm.run(None, {"input": crop[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255})[0][0][:, :2]
        lm = cv2.transform((lm / 64 * 256)[None], cv2.invertAffineTransform(A))[0]
        return np.array([lm[36:42].mean(0), lm[42:48].mean(0), lm[30], lm[48], lm[54]], np.float32)

    def restore(self, img, pts):
        import cv2
        import numpy as np
        A, _ = cv2.estimateAffinePartial2D(pts, np.array(TEMPLATE, np.float32), method=cv2.LMEDS)
        if A is None:
            return img
        crop = cv2.warpAffine(img, A, (512, 512), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_REFLECT)
        inp = ((crop[:, :, ::-1].astype(np.float32) / 255 - 0.5) / 0.5).transpose(2, 0, 1)[None]
        out = self.gfp.run(None, {"input": inp})[0][0].transpose(1, 2, 0)
        out = ((np.clip(out, -1, 1) + 1) / 2 * 255).round().astype(np.uint8)[:, :, ::-1]
        out = cv2.addWeighted(out, BLEND, crop, 1 - BLEND, 0)
        mask = np.zeros((512, 512), np.float32)
        cv2.rectangle(mask, (40, 40), (472, 472), 1, -1)
        mask = cv2.GaussianBlur(mask, (0, 0), 24)
        inv = cv2.invertAffineTransform(A)
        H, W = img.shape[:2]
        back = cv2.warpAffine(out, inv, (W, H), flags=cv2.INTER_LINEAR)
        m = cv2.warpAffine(mask, inv, (W, H))[:, :, None]
        return (back * m + img * (1 - m)).astype(np.uint8)

    # ---------------------------------------------------------------- all
    def run(self, src: Path, dst: Path, progress=None) -> dict:
        """Enhance src -> dst. Returns {w, h, scale, faces, seconds, path, mime}: path = the file written (dst; for a
        see-through input dst with the suffix .png, alpha kept), mime = its type."""
        import cv2
        import numpy as np
        im, alpha = read_photo(src)
        img = np.array(im)[:, :, ::-1].copy()
        t0, scale = time.time(), 1
        if max(img.shape[:2]) <= UPSCALE_MAX:
            img = self.esrgan(img, progress=(lambda f: progress(f * 0.7)) if progress else None)
            scale = 2
        boxes = self.faces(img)
        for k, b in enumerate(boxes):
            try:
                img = self.restore(img, self.landmarks5(img, b))
            except cv2.error:
                pass
            if progress:
                progress(0.7 + 0.3 * (k + 1) / len(boxes))
        dst = Path(dst)
        dst.parent.mkdir(parents=True, exist_ok=True)
        if alpha is not None:                       # see-through: the alpha channel at the new size, saved as PNG
            from PIL import Image
            a = np.asarray(alpha.resize((img.shape[1], img.shape[0]), Image.LANCZOS))
            dst = dst.with_suffix(".png")
            if not cv2.imwrite(str(dst), np.dstack([img, a])):
                raise RuntimeError(f"could not write {dst}")
            mime = "image/png"
        else:
            if not cv2.imwrite(str(dst), img, [cv2.IMWRITE_JPEG_QUALITY, 93]):
                raise RuntimeError(f"could not write {dst}")
            mime = "image/jpeg"
        return {"w": img.shape[1], "h": img.shape[0], "scale": scale, "faces": len(boxes), "seconds": round(time.time() - t0, 1),
                "path": str(dst), "mime": mime}


def read_photo(src: Path):
    """(RGB image, alpha or None). A see-through photo (some alpha < 255) gets its alpha back separately; its colour is
    worked on with the empty part white: pixels below alpha 64 fade to white, the rest keep their own colour, so the
    models never see the black that see-through pixels usually carry, and soft edges (hair) keep their colour."""
    import numpy as np
    from PIL import Image, ImageOps
    im = ImageOps.exif_transpose(Image.open(src))                       # HEIC / PNG / WEBP … all read by Pillow
    if im.mode == "P" and "transparency" in im.info or im.mode in ("RGBA", "LA", "PA", "RGBa", "La"):
        im = im.convert("RGBA")
        alpha = im.getchannel("A")
        if alpha.getextrema()[0] < 255:
            rgb = np.asarray(im.convert("RGB"), np.float32)
            k = np.clip(np.asarray(alpha, np.float32) / 64, 0, 1)[:, :, None]
            rgb = rgb * k + 255 * (1 - k)
            return Image.fromarray(rgb.round().astype(np.uint8)), alpha
    return im.convert("RGB"), None


if __name__ == "__main__":
    print(Enhancer().run(Path(sys.argv[1]), Path(sys.argv[2]), progress=lambda f: print(f"[progress] {int(f * 100)}")))
