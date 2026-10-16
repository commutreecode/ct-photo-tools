"""py/ctphoto/enhance.py without the 500 MB of models: stand-in onnx sessions check the upscale tiling, the face rebuild
   paste-back and the model folder setting. python3 tests/test_enhance.py"""
import os, sys, tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "py"))
import numpy as np
from PIL import Image
from ctphoto import enhance as E

ok = 0
def check(cond, msg):
    global ok
    assert cond, msg
    ok += 1
    print("  ok:", msg)

class Up:                                   # Real-ESRGAN x2 stand-in: nearest x2
    def run(self, _, feed):
        x = feed["input"]; check.n_up = getattr(check, "n_up", 0) + 1
        return [x.repeat(2, axis=2).repeat(2, axis=3)]
class Lm:                                   # 2DFAN4 stand-in: 68 points in its 64 px heat-map space
    def run(self, _, feed):
        p = np.tile(np.array([[32.0, 32.0, 1.0]], np.float32), (68, 1))
        p[36:42, :2] = (24, 26); p[42:48, :2] = (40, 26); p[30, :2] = (32, 34); p[48, :2] = (26, 44); p[54, :2] = (38, 44)
        return [p[None]]
class Gfp:                                  # GFPGAN stand-in: a flat grey face
    def run(self, _, feed):
        return [np.zeros_like(feed["input"])]

with tempfile.TemporaryDirectory() as t:
    os.environ["CTPHOTO_MODELS"] = t
    check(E.models_dir() == Path(t), "CTPHOTO_MODELS sets the model folder ")
    del os.environ["CTPHOTO_MODELS"]
    check(E.models_dir() == Path.home() / ".cache" / "ctphoto-models", "default folder ~/.cache/ctphoto-models")
    check(set(E.MODELS) == {"real_esrgan_x2.onnx", "gfpgan_1.4.onnx", "2dfan4.onnx"} and all(len(s) == 64 for s, _ in E.MODELS.values()),
          "three models, each with a SHA-256")

    en = object.__new__(E.Enhancer); en.up, en.lm, en.gfp = Up(), Lm(), Gfp()
    src, dst = Path(t) / "in.jpg", Path(t) / "out.jpg"
    rng = np.random.default_rng(1)
    Image.fromarray(rng.integers(0, 255, (401, 301, 3), dtype=np.uint8)).save(src, quality=95)
    steps = []
    r = en.run(src, dst, progress=steps.append)
    im = Image.open(dst)
    check(im.size == (602, 802) and r["scale"] == 2 and (r["w"], r["h"]) == (602, 802), f"odd-sized small photo upscaled x2: {im.size} {r}")
    check(steps and abs(steps[-1] - 0.7) < 1e-6 and steps == sorted(steps), "progress runs up to 70 % for the upscale")
    a = np.asarray(Image.open(src).convert("RGB"), np.float32); b = np.asarray(im.convert("RGB"), np.float32)[::2, ::2]
    check(np.abs(a - b).mean() < 12, "tiles put back in the right places (x2 nearest stand-in = the photo)")

    Image.fromarray(rng.integers(0, 255, (1300, 1000, 3), dtype=np.uint8)).save(src, quality=95)
    check.n_up = 0
    r = en.run(src, dst)
    check(r["scale"] == 1 and Image.open(dst).size == (1000, 1300) and check.n_up == 0, "a photo above UPSCALE_MAX is not upscaled")

    img = np.full((600, 500, 3), 180, np.uint8)
    pts = en.landmarks5(img, (150, 150, 200, 200))
    check(pts.shape == (5, 2) and pts[0][0] < pts[1][0] and pts[3][1] > pts[0][1], "5 face points from the 68 (eyes, nose, mouth)")
    out = en.restore(img, pts)
    check(out.shape == img.shape and out[250, 250].mean() < 160 and (out[5, 5] == img[5, 5]).all(),
          "face rebuilt in place (mixed with the photo), the rest of the photo untouched")

print(f"enhance: {ok} checks passed")
