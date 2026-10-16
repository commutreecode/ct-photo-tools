// web/ct-photo.js — browser photo editor: rotate / crop, background (MODNet), remove a mark / logo (MI-GAN), enhance
// (started by the host's backend) with a before / after compare, HEIC conversion, upload preparation.
// The file is inserted into the host page's main script, so its functions share the page's scope.
//
// HOST CONTRACT — the page must define these names (checked by ctPhotoCheck() when the dialog opens):
//   data   : P (record: id, status), EP, THUMB, INFO, HASORIG, GAL, BUSY (RegExp), dirty
//   actions: api(action, args) -> Promise, toast(msg), esc(s), $(sel), render(), markDirty(), refreshSide(), reload(),
//            loadThumbs(), startPoll(), isBusy(P), stuck(P), level(info, edit, [w, h]), usedLong(info, edit, [w, h]), isLogo(role),
//            edTarget(kind, key) -> { role, get() / set() … } (which photo box / gallery tile is edited)
//            ([w, h] = the photo in the dialog, before rotation)
//   backend: actions photo {id, role, orig}, bgreset {id, role}, enhance {id, role}, get {id}; uploads go through the host.
//   optional: CT_PHOTO_TEXT = { key: text } the host's own wording (keys: see ctT calls);
//             CT_PHOTO_OPT = { getAction: 'get', pollMs: 5000 } (values or functions)
// The host calls: editPhoto, prepImage, isPhotoFile, editedPreview, afterEnhance, b64, ENH_ROLE, PHOTO_ACCEPT.
// Never write slash-star or a closing script tag in this file (tests check it).
const CT_PHOTO_VERSION = '2026-10-16.6';
// Default look of the ✎ dialog: every selector inside :where() (no weight) and the style put FIRST in <head>, so any CSS rule
// of the host wins — except the last two rules: a hidden part of the dialog stays hidden whatever the host's CSS says. Colours come from the host's --acc / --line when it has them.
const CT_PHOTO_CSS = [
  ':where(#ed.modal) { position:fixed; inset:0; background:rgba(20,18,16,.62); display:flex; align-items:center; justify-content:center; z-index:20; }',
  ':where(#ed .mbox) { background:#fff; color:#1d1b18; border-radius:12px; padding:14px 16px; width:min(800px, 96vw); max-height:96vh; overflow-y:auto; display:flex; flex-direction:column; gap:10px; box-sizing:border-box; }',
  ':where(#ed .row) { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }',
  ':where(#ed .hint) { font-size:12px; color:#6b665e; }',
  ':where(#ed button) { font:inherit; border:1px solid var(--line, #e3ded5); background:#fff; border-radius:8px; padding:7px 14px; cursor:pointer; }',
  ':where(#ed button.pri) { background:var(--acc, #8a1c2b); color:#fff; border-color:var(--acc, #8a1c2b); }',
  ':where(#ed button:disabled) { opacity:.45; cursor:not-allowed; }',
  ':where(#ed .stage) { display:flex; justify-content:center; align-items:center; background:#2a2724; border-radius:8px; padding:10px; min-height:200px; color:#ddd; flex:none; }',
  ':where(#edc) { touch-action:none; cursor:crosshair; display:block; }',
  ':where(#ed .bgrow) { gap:6px; flex-wrap:wrap; }',
  ':where(#ed .bgb) { padding:4px 9px; font-size:12px; border:1px solid var(--line, #e3ded5); border-radius:7px; background:#fff; cursor:pointer; display:inline-flex; align-items:center; gap:4px; }',
  ':where(#ed .bgb.on) { border-color:var(--acc, #8a1c2b); background:var(--acc2, #f3e3e5); font-weight:600; }',
  ':where(#ed .bgb:disabled) { opacity:.5; cursor:default; }',
  ':where(#ed label.bgb:has(input:disabled)) { opacity:.5; cursor:default; }',
  ':where(#ed .bgb input[type=color]) { width:26px; height:20px; padding:0; border:0; background:none; cursor:pointer; }',
  ':where(#ed .sw) { display:inline-block; width:12px; height:12px; border-radius:3px; border:1px solid #bbb; vertical-align:-2px; }',
  ':where(#ed .sz) { display:inline-block; padding:0 6px; border-radius:9px; font-size:10px; line-height:17px; color:#fff; background:rgba(0,0,0,.62); }',
  ':where(#ed .sz.g) { background:#1f7a3f; } :where(#ed .sz.a) { background:#b26a00; } :where(#ed .sz.r) { background:#b3261e; }',
  ':where(#ed .edprog) { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--acc, #8a1c2b); }',
  ':where(#ed .edprog[hidden]), :where(#ed .mkt[hidden]), :where(#ed .cmprow[hidden]) { display:none; }',
  ':where(#ed .bar) { flex:1; height:8px; border-radius:4px; background:#efe9e1; overflow:hidden; }',
  ':where(#ed .bar > i) { display:block; height:100%; width:0; background:var(--acc, #8a1c2b); transition:width .25s ease; }',
  ':where(#ed .bar.ind > i) { width:30% !important; animation:ctpind 1.2s ease-in-out infinite; }',
  '@keyframes ctpind { 0% { margin-left:-30%; } 100% { margin-left:100%; } }',
  ':where(#ed .mkt) { display:inline-flex; gap:6px; flex-wrap:wrap; align-items:center; }',
  ':where(#ed .mbox.cmpm .edt) { display:none; }',
  ':where(#ed .cmp) { display:flex; gap:12px; justify-content:center; align-items:flex-start; }',
  ':where(#ed .cmp figure) { margin:0; text-align:center; color:#ddd; font-size:12px; }',
  ':where(#ed .cmp figcaption) { margin-top:4px; }',
  ':where(#ed .cmp canvas) { display:block; cursor:zoom-in; border-radius:4px; }',
  ':where(#ed .cmp.z canvas) { cursor:zoom-out; }',
  '#ed [hidden] { display:none !important; }',
  '#ed .mbox.cmpm .edt { display:none !important; }'
].join('\n');
(function ctPhotoStyle() {
  if (typeof document === 'undefined' || !document.head || document.getElementById('ctPhotoCss')) return;
  const s = document.createElement('style'); s.id = 'ctPhotoCss'; s.textContent = CT_PHOTO_CSS;
  document.head.insertBefore(s, document.head.firstChild);
})();
function ctT(k, d) {               // the host's own wording (CT_PHOTO_TEXT: a text, or a function giving one) or the default
  const v = (typeof CT_PHOTO_TEXT === 'object' && CT_PHOTO_TEXT) ? CT_PHOTO_TEXT[k] : undefined;
  if (typeof v === 'function') { try { const r = v(); return typeof r === 'string' ? r : d; } catch (e) { return d; } }
  return typeof v === 'string' ? v : d;
}
function ctOpt(k, d) {             // the host's options (CT_PHOTO_OPT: a value, or a function giving one) or the default
  const v = (typeof CT_PHOTO_OPT === 'object' && CT_PHOTO_OPT) ? CT_PHOTO_OPT[k] : undefined;
  if (typeof v === 'function') { try { const r = v(); return r == null ? d : r; } catch (e) { return d; } }
  return v == null ? d : v;
}
function ctPhotoCheck() {          // the names of the host contract that are missing (empty = fine)
  const t = {
    'P': typeof P,
    'EP': typeof EP,
    'THUMB': typeof THUMB,
    'INFO': typeof INFO,
    'HASORIG': typeof HASORIG,
    'GAL': typeof GAL,
    'BUSY': typeof BUSY,
    'dirty': typeof dirty,
    'api': typeof api,
    'toast': typeof toast,
    'esc': typeof esc,
    '$': typeof $,
    'render': typeof render,
    'markDirty': typeof markDirty,
    'refreshSide': typeof refreshSide,
    'reload': typeof reload,
    'loadThumbs': typeof loadThumbs,
    'startPoll': typeof startPoll,
    'isBusy': typeof isBusy,
    'stuck': typeof stuck,
    'level': typeof level,
    'usedLong': typeof usedLong,
    'isLogo': typeof isLogo,
    'edTarget': typeof edTarget,
  };
  return Object.keys(t).filter(n => t[n] === 'undefined');
}
// ------------------------------------------------------------------ photo editor (✎): rotate + crop + background + enhance + mark
// Rotate / crop are kept as numbers ({rotate, trim}; the photo itself is not re-encoded), applied later by the host;
// trim = [x0, y0, x1, y1]
// fractions of the rotated photo. Background: the person is cut out in the browser (MODNet portrait matting, onnxruntime-web,
// loaded on first use) and put on a plain colour or a soft blur. 🧽 Mark / logo: MI-GAN fills a painted part in the browser.
// ✨ Enhance HD: done by the host's backend (action enhance). A changed photo is uploaded as a new JPEG; the backend keeps
// the photo as uploaded: "Original" (bgreset) brings it back. Works on a photo box (kind 'slot') and a gallery tile (kind 'gal').
let ED = null;
const FULL = [0, 0, 1, 1];
const trimRight = t => [1 - t[3], t[0], 1 - t[1], t[2]];      // the same part of the photo after rotating 90° clockwise
const trimLeft = t => [t[1], 1 - t[2], t[3], 1 - t[0]];       // ... after rotating 90° anti-clockwise
const BGS = [['', 'Original'], ['#ffffff', 'White'], ['#f4efe6', 'Cream'], ['#e9e9e9', 'Light grey'], ['#dfe9f4', 'Light blue'],
             ['#f6e4e9', 'Light pink'], ['blur', 'Soft blur']];
const dims = im => [im.naturalWidth || im.width, im.naturalHeight || im.height];
const dataUrl = p => `data:${p.mime};base64,${p.data}`;
function loadUrl(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url; });
}
// Draw `im` (image or canvas) rotated (clockwise degrees) and trimmed into a canvas whose long side is `max` px (null = natural size).
function drawEdited(im, rot, trim, max) {
  const [iw, ih] = dims(im), sw = rot % 180 !== 0;
  const rw = sw ? ih : iw, rh = sw ? iw : ih, t = trim || FULL;
  const cw = rw * (t[2] - t[0]), ch = rh * (t[3] - t[1]);
  const k = max ? max / Math.max(cw, ch) : 1;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(cw * k)); c.height = Math.max(1, Math.round(ch * k));
  const x = c.getContext('2d');
  x.scale(k, k); x.translate(-t[0] * rw, -t[1] * rh);
  x.translate(rw / 2, rh / 2); x.rotate(rot * Math.PI / 180); x.drawImage(im, -iw / 2, -ih / 2);
  return c;
}
async function editedPreview(url, e) {
  const im = await loadUrl(url);
  return drawEdited(im, e.rotate || 0, e.trim, 240).toDataURL('image/jpeg', 0.85);
}
// ---- background tool: MODNet (Apache-2.0) in the browser, files from jsdelivr (exact versions, cached by the browser)
const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/';
const MODNET_URL = 'https://cdn.jsdelivr.net/npm/@rmbg/model-modnet@0.0.1/';
const MODNET_PARTS = ['modnet-1.onnx', 'modnet-2.onnx', 'modnet-3.onnx'];   // one model in 3 pieces (25.9 MB)
const MODNET_BYTES = 25888640;
let MODNET = null, MODNET_OK = false;
function loadScript(src) {
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error('could not load ' + src.split('/').pop())); document.head.appendChild(sc); });
}
// fetch with a progress callback (bytes so far); falls back to a plain download where streams are missing
async function fetchProgress(url, onBytes) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed (' + r.status + ')');
  if (!r.body || !r.body.getReader) { const b = await r.arrayBuffer(); onBytes(b.byteLength); return b; }
  const rd = r.body.getReader(), chunks = []; let n = 0;
  for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); n += value.length; onBytes(value.length); }
  const out = new Uint8Array(n); let o = 0; chunks.forEach(c => { out.set(c, o); o += c.length; });
  return out.buffer;
}
// The models run in a Web Worker, so the page never freezes while a photo is worked on; where a
// worker can't start, they run in the page as before. A session = {inputNames, outputNames, run({name: {type, data, dims}})}.
const ORT_WORKER = [
  'let S = {};',
  'onmessage = async ev => {',
  '  const m = ev.data;',
  '  try {',
  '    if (!self.ort) { importScripts(m.ortUrl + "ort.wasm.min.js"); ort.env.wasm.wasmPaths = m.ortUrl; ort.env.wasm.numThreads = 1; }',
  '    if (m.op === "load") { S[m.key] = await ort.InferenceSession.create(new Uint8Array(m.bytes), { executionProviders: ["wasm"] });',
  '      postMessage({ id: m.id, inputNames: S[m.key].inputNames, outputNames: S[m.key].outputNames }); return; }',
  '    const feeds = {}; for (const k in m.feeds) { const f = m.feeds[k]; feeds[k] = new ort.Tensor(f.type, f.data, f.dims); }',
  '    const out = await S[m.key].run(feeds), res = {}, tr = [];',
  '    for (const k in out) { res[k] = { data: out[k].data, dims: out[k].dims }; tr.push(out[k].data.buffer); }',
  '    postMessage({ id: m.id, out: res }, tr);',
  '  } catch (e) { postMessage({ id: m.id, error: String((e && e.message) || e) }); }',
  '};'].join('\n');
let ORTW = null, ORTW_N = 0;
const ORTW_CB = {};
function ortWorker() {
  if (ORTW !== null) return ORTW;
  try {
    ORTW = new Worker(URL.createObjectURL(new Blob([ORT_WORKER], { type: 'text/javascript' })));
    ORTW.onmessage = ev => { const cb = ORTW_CB[ev.data.id]; if (!cb) return; delete ORTW_CB[ev.data.id];
      if (ev.data.error) cb[1](new Error(ev.data.error)); else cb[0](ev.data); };
    ORTW.onerror = ev => { Object.keys(ORTW_CB).forEach(k => { ORTW_CB[k][1](new Error((ev && ev.message) || 'worker error')); delete ORTW_CB[k]; }); };
  } catch (e) { ORTW = false; }
  return ORTW;
}
function ortCall(msg) {
  return new Promise((res, rej) => { const id = ++ORTW_N; ORTW_CB[id] = [res, rej]; ORTW.postMessage(Object.assign({ id, ortUrl: ORT_URL }, msg)); });
}
async function ortSession(key, bytes) {
  if (ortWorker()) {
    try {
      const r = await ortCall({ op: 'load', key, bytes });
      return { inWorker: true, inputNames: r.inputNames, outputNames: r.outputNames,
               run: feeds => ortCall({ op: 'run', key, feeds }).then(x => x.out) };
    } catch (e) { ORTW = false; }                   // e.g. importScripts blocked: run in the page instead
  }
  if (!window.ort) await loadScript(ORT_URL + 'ort.wasm.min.js');
  ort.env.wasm.wasmPaths = ORT_URL; ort.env.wasm.numThreads = 1;
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return { inWorker: false, inputNames: s.inputNames, outputNames: s.outputNames, run: feeds => {
    const f = {}; Object.keys(feeds).forEach(k => { f[k] = new ort.Tensor(feeds[k].type, feeds[k].data, feeds[k].dims); });
    return s.run(f); } };
}
const tensor = (type, data, dims) => ({ type, data, dims });
function modnet(onPct) {
  MODNET = MODNET || (async () => {
    let got = 0;
    const parts = await Promise.all(MODNET_PARTS.map(f => fetchProgress(MODNET_URL + f, b => {
      got += b; if (onPct) onPct(Math.min(99, Math.round(got * 100 / MODNET_BYTES))); })));
    const all = new Uint8Array(parts.reduce((n, b) => n + b.byteLength, 0));
    let o = 0; parts.forEach(b => { all.set(new Uint8Array(b), o); o += b.byteLength; });
    const sess = await ortSession('modnet', all);
    MODNET_OK = true;
    return sess;
  })().catch(e => { MODNET = null; throw e; });
  return MODNET;
}
// The person's matte (alpha 0-255) as a canvas the size of `im`.
async function matteOf(im, onPct) {
  const [W, H] = dims(im), k = 512 / Math.min(W, H);
  const w = Math.max(32, Math.round(W * k / 32) * 32), h = Math.max(32, Math.round(H * k / 32) * 32);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data, n = w * h, inp = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) { inp[i] = px[4 * i] / 127.5 - 1; inp[n + i] = px[4 * i + 1] / 127.5 - 1; inp[2 * n + i] = px[4 * i + 2] / 127.5 - 1; }
  const sess = await modnet(onPct);
  if (onPct) onPct(null);
  const out = await sess.run({ [sess.inputNames[0]]: tensor('float32', inp, [1, 3, h, w]) });
  const m = out[sess.outputNames[0]].data, img = x.createImageData(w, h);
  for (let i = 0; i < n; i++) img.data[4 * i + 3] = Math.max(0, Math.min(255, Math.round(m[i] * 255)));
  x.clearRect(0, 0, w, h); x.putImageData(img, 0, 0);
  const big = document.createElement('canvas'); big.width = W; big.height = H;
  const bx = big.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(c, 0, 0, W, H);
  return big;
}
// The photo on a new background: a colour ('#rrggbb') or 'blur' (the photo itself, softly blurred).
function compose(im, matte, bg) {
  const [W, H] = dims(im);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const o = out.getContext('2d');
  if (bg === 'blur') {
    const sm = document.createElement('canvas'), f = Math.max(16, Math.round(Math.max(W, H) / 28));
    sm.width = Math.max(1, Math.round(W / f)); sm.height = Math.max(1, Math.round(H / f));
    const sx = sm.getContext('2d'); sx.imageSmoothingQuality = 'high'; sx.drawImage(im, 0, 0, sm.width, sm.height);
    o.imageSmoothingQuality = 'high'; o.drawImage(sm, 0, 0, W, H);
  } else { o.fillStyle = bg; o.fillRect(0, 0, W, H); }
  const fg = document.createElement('canvas'); fg.width = W; fg.height = H;
  const g = fg.getContext('2d'); g.drawImage(im, 0, 0, W, H); g.globalCompositeOperation = 'destination-in';
  g.imageSmoothingQuality = 'high'; g.drawImage(matte, 0, 0, W, H);
  o.drawImage(fg, 0, 0);
  return out;
}

// ---- ✨ Enhance HD: done by the backend (e.g. py/ctphoto/enhance.py: Real-ESRGAN x2 + GFPGAN 1.4 face rebuild),
// action 'enhance' -> about 1–2 minutes -> the saved photo is replaced (the photo as uploaded is kept: "Original").
// ---- mark remover: MI-GAN inpainting (Picsart AI Research, MIT) in the browser with onnxruntime-web (the same runtime as
// the background tool). The model file (28 MB) is copied in the npm package migan-onnx@1.0.0 (jsdelivr, else unpkg);
// its SHA-256 is checked before use, so a changed file is never run.
const MIGAN_URLS = ['https://cdn.jsdelivr.net/npm/migan-onnx@1.0.0/models/migan_pipeline_v2.onnx',
                    'https://unpkg.com/migan-onnx@1.0.0/models/migan_pipeline_v2.onnx'];
const MIGAN_SHA = '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b', MIGAN_BYTES = 28079181;
let MIGAN = null, MIGAN_OK = false;
function migan(onPct) {
  MIGAN = MIGAN || (async () => {
    let buf = null, last = null;
    for (const u of MIGAN_URLS) {
      try {
        let got = 0;
        buf = await fetchProgress(u, b => { got += b; if (onPct) onPct(Math.min(99, Math.round(got * 100 / MIGAN_BYTES))); });
        break;
      } catch (e) { last = e; buf = null; }
    }
    if (!buf) throw last || new Error('download failed');
    const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (h !== MIGAN_SHA) throw new Error('the mark remover file is not the expected one; please tell the admin');
    const sess = await ortSession('migan', new Uint8Array(buf));
    MIGAN_OK = true;
    return sess;
  })().catch(e => { MIGAN = null; throw e; });
  return MIGAN;
}
// `src` (canvas / image) with the pixels of `hole` (1 byte per pixel, 1 = fill) filled in from their surroundings.
async function removeMarks(src, hole, onPct) {
  const [W, H] = dims(src);
  const c = drawEdited(src, 0, null, null), x = c.getContext('2d');
  const px = x.getImageData(0, 0, W, H), d = px.data;
  const n = W * H, img = new Uint8Array(3 * n), m = new Uint8Array(n);
  let holes = 0;
  for (let i = 0; i < n; i++) {
    img[i] = d[4 * i]; img[n + i] = d[4 * i + 1]; img[2 * n + i] = d[4 * i + 2];
    m[i] = hole[i] ? 0 : 255; holes += hole[i] ? 1 : 0;                  // MI-GAN: 0 = fill, 255 = keep
  }
  if (!holes) throw new Error('paint over the mark first');
  const sess = await migan(onPct);
  if (onPct) onPct(null);
  await new Promise(r => setTimeout(r, 30));          // let the progress row show before the model runs
  const out = await sess.run({ image: tensor('uint8', img, [1, 3, H, W]), mask: tensor('uint8', m, [1, 1, H, W]) });
  const r = out[sess.outputNames[0]], rd = r.data, [oh, ow] = [r.dims[2], r.dims[3]];
  if (oh !== H || ow !== W) throw new Error('unexpected result size');
  for (let i = 0; i < n; i++) if (!m[i]) { d[4 * i] = rd[i]; d[4 * i + 1] = rd[n + i]; d[4 * i + 2] = rd[2 * n + i]; }  // nothing else changes
  x.putImageData(px, 0, 0);
  return c;
}
// Square dilation of a 0/1 map by r pixels (rows, then columns).
function dilate(a, W, H, r) {
  const t = new Uint8Array(a.length), o = new Uint8Array(a.length);
  for (let y = 0; y < H; y++) { let last = -1e9; const row = y * W;
    for (let x = 0; x < W; x++) { if (a[row + x]) last = x; if (x - last <= r) t[row + x] = 1; }
    last = 1e9; for (let x = W - 1; x >= 0; x--) { if (a[row + x]) last = x; if (last - x <= r) t[row + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9;
    for (let y = 0; y < H; y++) { const i = y * W + x; if (t[i]) last = y; if (y - last <= r) o[i] = 1; }
    last = 1e9; for (let y = H - 1; y >= 0; y--) { const i = y * W + x; if (t[i]) last = y; if (last - y <= r) o[i] = 1; } }
  return o;
}
// Chamfer distance (1 / 1.4) of every pixel to the nearest pixel of the other kind: for pixels with a[i] = 1 when
// inside is true (their distance to the edge), for pixels with a[i] = 0 otherwise (distance to the 1-pixels).
function chamfer(a, W, H, inside) {
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = (inside ? a[i] : !a[i]) ? 1e9 : 0;
  const st = (i, j, c) => { if (d[j] + c < d[i]) d[i] = d[j] + c; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (!d[i]) continue;
    if (x) st(i, i - 1, 1); if (y) st(i, i - W, 1); if (x && y) st(i, i - W - 1, 1.4); if (y && x < W - 1) st(i, i - W + 1, 1.4); }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const i = y * W + x; if (!d[i]) continue;
    if (x < W - 1) st(i, i + 1, 1); if (y < H - 1) st(i, i + W, 1); if (x < W - 1 && y < H - 1) st(i, i + W + 1, 1.4); if (y < H - 1 && x) st(i, i + W - 1, 1.4); }
  return d;
}
// "Only the logo": inside the painted part P (0/1, W×H) find the pixels of the mark = colours that the photo around the
// paint does not have (+ its outline / shadow: nearby painted pixels in colours commoner inside the paint than around),
// so the rest of the painted part stays as it is. px: RGBA bytes. Returns a 0/1 map, or null when no such colour is found.
function detectMark(px, W, H, P) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (P[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const L = Math.max(W, H), dr = Math.max(8, Math.round(0.03 * L));
  const cx0 = Math.max(0, x0 - dr - 1), cy0 = Math.max(0, y0 - dr - 1), cx1 = Math.min(W - 1, x1 + dr + 1), cy1 = Math.min(H - 1, y1 + dr + 1);
  const w = cx1 - cx0 + 1, h = cy1 - cy0 + 1, n = w * h, Q = 32;
  const p = new Uint8Array(n), idx = new Int32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y + cy0) * W + x + cx0, i = y * w + x;
    p[i] = P[s] ? 1 : 0;
    idx[i] = ((px[4 * s] >> 3) * Q + (px[4 * s + 1] >> 3)) * Q + (px[4 * s + 2] >> 3);
  }
  const big = dilate(p, w, h, dr), hb = new Uint32Array(Q * Q * Q), hp = new Uint32Array(Q * Q * Q);
  let nr = 0, np = 0;
  for (let i = 0; i < n; i++) { if (p[i]) { hp[idx[i]]++; np++; } else if (big[i]) { hb[idx[i]]++; nr++; } }
  if (!nr || !np) return null;
  const near = new Uint8Array(Q * Q * Q);              // colours (± one step) seen around the paint
  for (let r = 0; r < Q; r++) for (let g = 0; g < Q; g++) for (let b = 0; b < Q; b++) {
    if (hb[(r * Q + g) * Q + b] < 2) continue;
    for (let i = Math.max(0, r - 1); i <= Math.min(Q - 1, r + 1); i++) for (let j = Math.max(0, g - 1); j <= Math.min(Q - 1, g + 1); j++)
      for (let k = Math.max(0, b - 1); k <= Math.min(Q - 1, b + 1); k++) near[(i * Q + j) * Q + k] = 1;
  }
  let M = new Uint8Array(n), cnt = 0;
  for (let i = 0; i < n; i++) if (p[i] && !near[idx[i]]) M[i] = 1;
  const er = new Uint8Array(n);                         // opening 2×2: single stray pixels (JPEG noise) go
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) { const i = y * w + x; if (M[i] && M[i + 1] && M[i + w] && M[i + w + 1]) er[i] = 1; }
  M = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x;
    if (er[i] || (x && er[i - 1]) || (y && er[i - w]) || (x && y && er[i - w - 1])) { M[i] = 1; cnt++; } }
  if (cnt < 12) return null;
  const din = chamfer(M, w, h, true), vals = [];
  for (let i = 0; i < n; i++) if (M[i]) vals.push(din[i]);
  vals.sort((a, b) => a - b);
  const sw = 2 * vals[Math.floor(vals.length * 0.9)], reach = Math.max(2, Math.round(0.6 * sw));   // stroke width of the mark
  const dout = chamfer(M, w, h, false), g = Math.max(2, Math.round(0.004 * L));
  for (let i = 0; i < n; i++) if (!M[i] && p[i] && dout[i] <= reach && (hp[idx[i]] / np) / (hb[idx[i]] / nr + 2e-4) > 3) M[i] = 1;
  const dg = chamfer(M, w, h, false), out = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (p[i] && dg[i] <= g) out[(y + cy0) * W + x + cx0] = 1; }
  return out;
}
// A point on the dialog's canvas (fractions of the rotated photo) -> fractions of the photo as stored (not rotated).
function unrotate(u, v, rot) {
  return rot === 90 ? [v, 1 - u] : rot === 180 ? [1 - u, 1 - v] : rot === 270 ? [1 - v, u] : [u, v];
}

// Progress row in the dialog: pct = number (0-100) or null (busy, time unknown); text '' hides it.
function edProg(text, pct) {
  const el = $('#edp'); if (!el) return;
  el.hidden = !text; if (!text) return;
  el.querySelector('span').textContent = text + (pct != null ? ' ' + pct + '%' : '');
  const bar = el.querySelector('.bar'); bar.classList.toggle('ind', pct == null);
  bar.querySelector('i').style.width = (pct != null ? pct : 30) + '%';
}

// The photo the editor works on: a photo box (kind 'slot', key = role: PEND / EDIT / EP / BGV / RESET / OP) or a gallery
// tile (kind 'gal', key = position in GAL: it.p / it.e / it.ep / it.bg / it.reset / it.op). role = the saved photo ('' = new).

async function editPhoto(kind, key) {
  const missing = ctPhotoCheck();
  if (missing.length) { console.error('ct-photo: the page does not define ' + missing.join(', ')); return; }
  const T = edTarget(kind, key); if (!T) return;
  const p = T.p, e = T.e || {}, bg0 = T.bg, role = T.role;
  const info = p ? p.info : INFO[role], enh0 = (!p && !T.reset && Number((info || {}).enh)) || 0;
  const hasOrig = !!(role && HASORIG[role] && !T.reset);
  if (p && !p.preview) return toast("This photo (HEIC / TIFF) can't be edited here. Save it as JPG on the phone/PC first.", true);
  const sw = ([v, l]) => `<button type="button" class="bgb" data-bg="${v}">${v && v !== 'blur' ? `<i class="sw" style="background:${v}"></i>` : ''}${l}</button>`;
  $('body').insertAdjacentHTML('beforeend', `<div class="modal" id="ed"><div class="mbox">
    <div class="row" style="justify-content:space-between"><b>Rotate / crop / background / enhance / remove a mark</b><span class="hint">${esc(ctT('editHint', ''))}</span></div>
    <div class="stage" id="edst">Loading photo…</div>
    <div class="row edt"><button id="edL" title="Rotate left">⟲ Rotate left</button><button id="edR" title="Rotate right">⟳ Rotate right</button>
      <button id="edX">Reset crop</button><span class="hint" id="edi" style="flex:1"></span>
      <button id="edC">Cancel</button><button class="pri" id="edA">Apply</button></div>
    <div class="row bgrow edt"><b style="font-size:13px">Background:</b>${BGS.map(sw).join('')}
      <label class="bgb" title="Any colour">Colour <input type="color" id="bgc" value="#f4efe6"></label></div>
    <div class="row bgrow edt"><b style="font-size:13px">Quality:</b>
      <button type="button" class="bgb" id="hdGo" title="${esc(ctT('enhTitle', 'About 1–2 minutes: a small or blurred photo becomes bigger and the face sharper'))}">✨ Enhance HD</button>
      <button type="button" class="bgb" id="hdCmp" hidden title="The photo as uploaded and the HD photo side by side; keep one">⇆ Compare with the original</button>
      <span class="hint" id="enm"></span></div>
    <div class="row bgrow edt"><b style="font-size:13px">Mark / logo:</b>
      <button type="button" class="bgb" id="mkOn" title="Paint over a logo or text on the photo; it is filled in from its surroundings">🧽 Remove a mark / logo</button>
      <span class="mkt" id="mkTools" hidden><span class="hint">Change:</span>
        <button type="button" class="bgb" data-mm="auto" title="Only the pixels in the logo's colours change (shown green); the rest of the painted part stays">Only the logo</button>
        <button type="button" class="bgb" data-mm="all" title="Everything painted is filled in (thin line logos: paint along the lines with S)">All painted</button>
        <span class="hint">Brush:</span><button type="button" class="bgb" data-br="0.03">S</button>
        <button type="button" class="bgb" data-br="0.055">M</button><button type="button" class="bgb" data-br="0.09">L</button>
        <button type="button" class="bgb" id="mkGo"><b>Remove</b></button><button type="button" class="bgb" id="mkClr">Clear paint</button>
        <button type="button" class="bgb" id="mkUndo">Undo</button></span>
      <span class="hint" id="mkm"></span></div>
    <div class="row cmprow" id="cmpRow" hidden><span class="hint" style="flex:1" id="cmpHint"></span>
      <button id="cmpB">Keep the photo before</button><button class="pri" id="cmpA">Keep the HD photo</button></div>
    <div class="edprog" id="edp" hidden><div class="bar"><i></i></div><span></span></div>
    <span class="hint edt">Drag on the photo to draw the part to keep; drag inside it to move, drag its edges or corners to resize.
      Background: the person is cut out automatically; check the hair and shoulders, or go back with "Original".</span></div></div>`);
  const close = () => {
    if (ED && ED.hd && ED.hd.run) { ENH_ROLE = ED.role; startPoll(); toast(ctT('enhRunning', '✨ Enhance keeps running; the photo changes here by itself.')); }
    ED = null; const m = $('#ed'); m && m.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = ev => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const tools = on => document.querySelectorAll('#ed .edt button, #ed .edt input').forEach(b => { if (b.id !== 'edC') b.disabled = !on; });
  tools(false);                                     // the tools wait for the photo (a click before it is there did nothing)
  $('#edC').onclick = close;
  $('#ed').addEventListener('click', ev => { if (ev.target.id === 'ed') close(); });
  let im;
  try {
    let url = p ? dataUrl(p) : '';
    if (!url) { const r = await api('photo', { id: P.id, role, orig: !!T.reset }); url = `data:${r.mime};base64,${r.data}`; }
    im = await loadUrl(url);
  } catch (x) { close(); return toast(x.message === 'decode' ? "This photo can't be opened in the browser (HEIC?)." : x.message, true); }
  if (!$('#ed')) return;                            // closed while loading
  ED = { im, disp: im, orig: T.reset ? im : null, matte: null, rot: e.rotate || 0, trim: (e.trim || FULL).slice(), T, role, p, info,
         bg0, bg: bg0, enh0, picked: false, hasOrig, busy: false,
         paint: false, mask: null, brush: 0.055, hover: null, clean: null, undo: [], mmode: 'auto', det: null, detC: null, srcPx: null };   // mark remover: clean = photo without the marks
  $('#edst').innerHTML = '<canvas id="edc"></canvas>';
  $('#edL').onclick = () => { ED.rot = (ED.rot + 270) % 360; ED.trim = trimLeft(ED.trim); edDraw(); };
  $('#edR').onclick = () => { ED.rot = (ED.rot + 90) % 360; ED.trim = trimRight(ED.trim); edDraw(); };
  $('#edX').onclick = () => { ED.rot = 0; ED.trim = FULL.slice(); edDraw(); };
  $('#edA').onclick = async () => { if (ED.busy) return;
    if (ED.painted) return toast('The painted part is not removed yet: click Remove (or Clear paint).', true);
    const b = $('#edA'); b.disabled = true; await edApply(); close(); };
  document.querySelectorAll('#ed [data-bg]').forEach(b => b.addEventListener('click', () => setBg(b.dataset.bg)));
  $('#hdGo').onclick = hdStart;
  $('#hdCmp').onclick = hdReview;
  ED.close = close; ED.e0 = JSON.stringify(edValue());
  tools(true);
  markEnh();
  $('#mkOn').onclick = () => setPaint(!ED.paint);
  document.querySelectorAll('#ed [data-br]').forEach(b => b.addEventListener('click', () => { ED.brush = Number(b.dataset.br); markPaint(); }));
  document.querySelectorAll('#ed [data-mm]').forEach(b => b.addEventListener('click', () => { if (ED.busy) return; ED.mmode = b.dataset.mm; findMark(); markPaint(); edDraw(); }));
  $('#mkGo').onclick = runRemove;
  $('#mkClr').onclick = () => { if (ED && ED.mask) { ED.mask.getContext('2d').clearRect(0, 0, ED.mask.width, ED.mask.height); ED.painted = false; findMark(); markPaint(); edDraw(); } };
  $('#mkUndo').onclick = undoRemove;
  const bc = $('#bgc'); bc.addEventListener('input', () => setBg(bc.value)); bc.addEventListener('click', ev => ev.stopPropagation());
  if (bg0 && bg0 !== 'blur' && /^#[0-9a-f]{6}$/i.test(bg0)) bc.value = bg0;
  markBg(bg0);
  edWire($('#edc'));
  edDraw();
}
function markBg(v) {
  document.querySelectorAll('#ed [data-bg]').forEach(b => b.classList.toggle('on', b.dataset.bg === v));
  const c = $('#ed label.bgb'); c && c.classList.toggle('on', !!v && v !== 'blur' && !BGS.some(([x]) => x === v));
}
// The photo as uploaded (before any background change / enhancement): the source for every new background.
async function edOriginal() {
  if (ED.orig) return ED.orig;
  const p = ED.p;
  let url = '';
  if (p && p.bgOrig) url = dataUrl(p.bgOrig);                     // new photo + new background, both not saved yet
  else if ((p && !(p.info && p.info.bg)) || (!p && !ED.hasOrig)) { ED.orig = ED.im; return ED.im; }
  else { const r = await api('photo', { id: P.id, role: ED.role, orig: true }); url = `data:${r.mime};base64,${r.data}`; }
  ED.orig = await loadUrl(url);
  return ED.orig;
}
// true = the background picked is the one the photo already has: show / keep the photo as it is (an enhanced photo stays HD).
// "Original" on an enhanced photo, or on one the backend keeps an original of, means: back to the photo as uploaded.
const edKeepsCur = (ed, bg) => !ed.clean && bg === ed.bg0 && !(bg === '' && ed.picked && (ed.enh0 || ed.hasOrig));
// Rebuild the shown photo from the photo as uploaded (or without its marks), then the background (if any).
async function edRebuild(bg) {
  const ed = ED;
  ed.busy = true; $('#edA').disabled = true;
  try {
    if (edKeepsCur(ed, bg)) { ed.disp = ed.im; ed.bg = bg; edDraw(); return true; }
    const src = ed.clean || await edOriginal();
    const base = src;
    if (bg && !ed.matte) {
      const onPct = pct => { if (ED === ed) edProg(pct == null ? 'Finding the person…' : 'Loading the background tool (first time about 26 MB)…', pct); };
      onPct(MODNET_OK ? null : 0);
      // the person is found best upright: use the photo as rotated in the dialog, then turn the matte back
      const r = ed.rot;
      ed.matte = r ? drawEdited(await matteOf(drawEdited(src, r, null, null), onPct), (360 - r) % 360, null, null) : await matteOf(src, onPct);
    }
    if (ED !== ed) return false;
    ed.disp = bg ? compose(base, ed.matte, bg) : base; ed.bg = bg;
    edDraw();
    return true;
  } finally { ed.busy = false; if (ED === ed) { edProg(''); $('#edA').disabled = false; } }
}
async function setBg(v) {
  if (!ED || ED.busy) return;
  const ed = ED;
  markBg(v); ed.picked = true;
  try { await edRebuild(v); }
  catch (x) { if (ED === ed) markBg(ed.bg); toast('The background could not be changed: ' + (x.message || x), true); }
  markEnh();                                        // a new background is made from the photo as uploaded (not HD)
}
function markEnh() {
  if (!ED || ED.locked) return;
  const enhRun = /^Enhancing photo/.test((P && P.status) || '') && isBusy(P);
  const b = $('#hdGo'); if (b) b.disabled = !!ED.enh0 || enhRun;
  const c = $('#hdCmp'); if (c) c.hidden = !(ED.enh0 && ED.hasOrig && !ED.T.p);
  if (enhRun && !ED.enh0) { const m = $('#enm'); if (m) m.textContent = ctT('enhOther', 'Another photo is being enhanced now; wait until it is done.'); return; }
  const lost = ED.enh0 && !edKeepsCur(ED, ED.bg);
  const m = $('#enm'); if (m) m.textContent = lost ? 'This change is made from the photo as uploaded (not HD): Apply, Save, then ✨ Enhance HD again.'
    : ED.enh0 ? 'This photo is already enhanced (HD). ⇆ Compare shows it next to the original; keep the one you like.'
    : ctT('enhInfo', 'About 1–2 minutes; the photo here is replaced, the one as uploaded is kept. Check the face afterwards.');
}
// ✨ Enhance HD of the SAVED photo: the dialog must have no other change, the page must be saved.
async function hdStart() {
  if (!ED || ED.busy) return;
  const role = ED.role;
  if (!P.id || dirty || !role || ED.T.p || ED.T.reset) return toast(ctT('saveFirst', 'Save this photo first, then ✨ Enhance HD.'), true);
  if (JSON.stringify(edValue()) !== ED.e0 || !edKeepsCur(ED, ED.bg) || ED.clean || ED.painted)
    return toast('Apply and Save your changes first, then open ✎ again for ✨ Enhance HD.', true);
  const ed = ED;
  ed.busy = true; edLock(true); edProg(ctT('enhStart', 'Starting ✨ Enhance HD…'), 0);
  try { await api('enhance', { id: P.id, role }); }
  catch (x) { if (ED === ed) { ed.busy = false; edLock(false); edProg(''); } return toast(x.message, true); }
  ed.hd = { run: true, t0: Date.now(), hadOrig: ed.hasOrig };
  P.status = 'Enhancing photo…'; P.updated = new Date().toISOString(); refreshSide();
  $('#edC').textContent = 'Close (it keeps running)'; $('#edC').disabled = false;
  hdWatch(ed);
}
// The dialog stays open while the backend works: a progress bar from the status ("Enhancing photo… 45%"; before it
// reports, an estimate), then the photo before and the HD photo side by side.
async function hdWatch(ed) {
  const id = P.id, role = ed.role;
  const show = () => {
    const m = /(\d+)%/.exec(P.status || ''), real = m ? Number(m[1]) : 0;
    const est = Math.min(14, 1 + Math.round((Date.now() - ed.hd.t0) / 8000));          // start-up of the backend: ~1–2 min
    const pct = Math.max(real, real > 5 ? 0 : est);
    edProg(pct < 15 ? ctT('enhWait', 'Starting (the first time it also loads the models)…') : pct < 92 ? 'Enhancing the photo…' : 'Saving the HD photo…', pct);
  };
  show();
  const tick = setInterval(() => { if (ED === ed && ed.hd.run) show(); }, 1000);
  try {
    for (;;) {
      await new Promise(r => setTimeout(r, ctOpt('pollMs', 5000)));
      if (ED !== ed || !P || P.id !== id) return;                       // closed: the page's poll takes over
      let fresh;
      try { fresh = await api(ctOpt('getAction', 'get'), { id }); } catch (x) { continue; }  // a failed check: try again
      if (ED !== ed || !P || P.id !== id) return;
      Object.assign(P, { status: fresh.status, updated: fresh.updated, enh: fresh.enh });
      if (BUSY.test(fresh.status || '') && !stuck(P)) continue;
      ed.hd.run = false; ENH_ROLE = '';
      await reload().catch(() => {});
      const e = P.enh;
      if (!e || e.role !== role || /^Error/.test(e.st || '') || stuck(P)) {
        edProg(''); ed.busy = false; edLock(false);
        $('#edC').textContent = 'Cancel';
        return toast('✨ Enhance failed: ' + ((e && e.st) || 'the run stopped, please try again'), true);
      }
      delete EP[role]; GAL.forEach(it => { if (it.role === role) delete it.ep; }); loadThumbs();
      edProg('Loading the HD photo…', null);
      const r = await api('photo', { id, role });
      const after = await loadUrl(`data:${r.mime};base64,${r.data}`);
      if (ED !== ed) return;
      edProg(''); ed.busy = false;
      edCompare(ed.im, after, 'Before', 'HD (enhanced' + (e.faces ? ', ' + e.faces + (e.faces > 1 ? ' faces' : ' face') : '') + ')', 'enhanced');
      return;
    }
  } catch (x) {
    if (ED === ed) { edProg(''); ed.busy = false; edLock(false); $('#edC').textContent = 'Close'; }
    toast('The HD photo could not be shown: ' + (x.message || x) + '. It is saved; open ✎ again to see it.', true);
  } finally { clearInterval(tick); }
}
// ⇆ Compare (an HD photo opened later): the photo as uploaded next to the HD photo.
async function hdReview() {
  if (!ED || ED.busy) return;
  if (JSON.stringify(edValue()) !== ED.e0 || !edKeepsCur(ED, ED.bg) || ED.clean || ED.painted)
    return toast('Apply your other changes first (or Cancel them), then ⇆ Compare.', true);
  const ed = ED;
  ed.busy = true; edLock(true); edProg('Loading the original…', null);
  try { const o = await edOriginal(); if (ED !== ed) return; edProg(''); ed.busy = false; edCompare(o, ed.im, 'Photo as uploaded', 'HD (now)', 'review'); }
  catch (x) { if (ED === ed) { edProg(''); ed.busy = false; edLock(false); } toast(x.message || String(x), true); }
}
// Disable every control of the dialog except Cancel / Close (while the backend works, or while comparing).
function edLock(on) {
  if (!ED) return;
  ED.locked = on;
  document.querySelectorAll('#ed .edt button, #ed .edt input').forEach(b => { if (b.id !== 'edC') b.disabled = on; });
  if (!on) { markPaint(); markEnh(); }
}
// Side by side: a = the photo before, b = the HD photo. Click a photo to zoom both to the same place (click again: all).
function edCompare(a, b, la, lb, mode) {
  const ed = ED; if (!ed) return;
  ed.cmp = { a, b, la, lb, mode, z: null };
  edLock(true);
  $('#ed .mbox').classList.add('cmpm');
  const ttl = $('#ed .mbox > .row b'); if (ttl) ttl.textContent = ctT('cmpTitle', 'Which photo do you keep?');
  $('#cmpRow').hidden = false;
  $('#cmpB').textContent = mode === 'review' ? 'Keep the photo as uploaded' : 'Keep the photo before';
  $('#cmpHint').textContent = ctT('cmpHint', 'Click on a face to zoom both photos to it (click again to see all). Which one do you keep?');
  $('#edst').innerHTML = `<div class="cmp"><figure><canvas id="cmpa"></canvas><figcaption>${esc(la)} · ${dims(a).join('×')}</figcaption></figure>` +
    `<figure><canvas id="cmpb"></canvas><figcaption>${esc(lb)} · ${dims(b).join('×')}</figcaption></figure></div>`;
  ['#cmpa', '#cmpb'].forEach(sel => $(sel).addEventListener('click', ev => {
    const r = ev.target.getBoundingClientRect(), c = ed.cmp;
    c.z = c.z ? null : [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]; cmpDraw();
  }));
  $('#cmpA').onclick = () => cmpKeep(false);
  $('#cmpB').onclick = () => cmpKeep(true);
  cmpDraw();
}
function cmpDraw() {
  const ed = ED; if (!ed || !ed.cmp) return;
  const c = ed.cmp, Z = 3;
  const boxW = (Math.min(760, window.innerWidth * 0.96 - 52) - 12) / 2, boxH = window.innerHeight * 0.56;
  const [aw, ah] = dims(c.a), k = Math.min(boxW / aw, boxH / ah);
  const cw = Math.round(aw * k), ch = Math.round(ah * k);
  $('#ed .cmp').classList.toggle('z', !!c.z);
  [[c.a, '#cmpa'], [c.b, '#cmpb']].forEach(([im, sel]) => {
    const cv = $(sel), [iw, ih] = dims(im), x = cv.getContext('2d');
    cv.width = cw; cv.height = ch; x.imageSmoothingQuality = 'high';
    if (!c.z) return x.drawImage(im, 0, 0, cw, ch);
    const sw = iw / Z, sh = ih / Z;                                   // the same part of both photos (fractions)
    const sx = Math.min(iw - sw, Math.max(0, c.z[0] * iw - sw / 2)), sy = Math.min(ih - sh, Math.max(0, c.z[1] * ih - sh / 2));
    x.drawImage(im, sx, sy, sw, sh, 0, 0, cw, ch);
  });
}
// Keep one of the two. The HD photo is already saved; "before" puts the photo before back at once.
async function cmpKeep(before) {
  const ed = ED; if (!ed || !ed.cmp || ed.busy) return;
  const role = ed.role, it = ed.T.it;
  if (!before) { ed.cmp = null; ed.close(); return toast('✨ HD photo kept.' + ctT('keptUse', '')); }
  ed.busy = true; $('#cmpA').disabled = $('#cmpB').disabled = true; edProg('Putting the photo back…', null);
  try {
    if (ed.cmp.mode === 'enhanced' && ed.hd && ed.hd.hadOrig) {     // the photo before was itself changed (e.g. a background):
      const [h, data] = ed.im.src.split(','), mime = (h.match(/^data:([^;]+)/) || [])[1] || 'image/jpeg';   // upload it again
      const [w, hh] = dims(ed.im);
      await api('upload', { id: P.id, role, name: role + '.jpg', mime, data, info: { w, h: hh, b: Math.round(data.length * 0.75), bg: true } });
    } else {
      await api('bgreset', { id: P.id, role });
      if (ed.cmp.mode === 'review' && ed.bg0) { ed.T.setBg(''); markDirty(); }    // the background went with it
    }
    delete EP[role]; if (it) delete it.ep; delete THUMB[role];
    ed.cmp = null; ed.busy = false; ed.close();
    render(); loadThumbs();
    toast(ed.bg0 && !(ed.hd && ed.hd.hadOrig) ? 'The photo as uploaded is back. Click Save.' : 'The photo before is back.');
  } catch (x) {
    if (ED === ed) { ed.busy = false; edProg(''); $('#cmpA').disabled = $('#cmpB').disabled = false; }
    toast(x.message || String(x), true);
  }
}
let ENH_ROLE = '';                    // a photo is being enhanced (the page's poll shows the result when it is over)
function afterEnhance() {             // the run is over: new thumbnail + the result
  ENH_ROLE = '';
  const e = P && P.enh, r = e && e.role;
  if (r) { delete EP[r]; GAL.forEach(it => { if (it.role === r) delete it.ep; }); }   // edited previews from the new thumbnail
  loadThumbs();
  if (e && /^Error/.test(e.st || '')) toast('✨ Enhance failed: ' + e.st, true);
  else if (e) toast('✨ Photo enhanced' + (e.faces ? ' (' + e.faces + (e.faces > 1 ? ' faces)' : ' face)') : '') + '. Please check it (✎ shows it big).');
}

// ---- mark remover in the dialog: paint (red) over the mark, Remove = MI-GAN fills it; Undo = the step before
function markPaint() {
  if (!ED) return;
  $('#mkOn').classList.toggle('on', ED.paint);
  $('#mkTools').hidden = !ED.paint;
  document.querySelectorAll('#ed [data-br]').forEach(b => b.classList.toggle('on', Number(b.dataset.br) === ED.brush));
  document.querySelectorAll('#ed [data-mm]').forEach(b => b.classList.toggle('on', b.dataset.mm === ED.mmode));
  const auto = ED.mmode === 'auto';
  $('#mkGo').disabled = !ED.painted || ED.busy || (auto && !ED.det); $('#mkUndo').disabled = !ED.undo.length || ED.busy;
  $('#mkClr').disabled = !ED.painted;
  $('#mkm').textContent = !ED.paint ? (ED.clean ? 'Marks removed (' + ED.undo.length + '×). Check the photo, then Apply.' : '')
    : !ED.painted ? (auto ? 'Paint over the logo / text and a little around it. Only the logo (shown green) will change.'
                          : 'Paint exactly over the mark: everything painted will be filled in.')
    : auto && !ED.det ? 'Nothing to remove in "Only the logo": no logo colour found in the paint. Paint a wider area around the logo, or for a plain mark choose "All painted".'
    : auto ? 'Green = what will change. Click Remove (or paint more).' : 'Painted. Click Remove (or paint more).';
}
async function setPaint(on) {
  if (!ED || ED.busy) return;
  const ed = ED;
  if (on && !ed.mask) {
    try { ed.busy = true; edProg('Loading photo…', null); const src = ed.clean || await edOriginal(); const [w, h] = dims(src);
      ed.mask = document.createElement('canvas'); ed.mask.width = w; ed.mask.height = h; }
    catch (x) { toast('The photo could not be loaded: ' + (x.message || x), true); return; }
    finally { ed.busy = false; if (ED === ed) edProg(''); }
  }
  if (ED !== ed) return;
  ed.paint = on; ed.hover = null; markPaint(); edDraw();
}
// One brush stroke from a to b (fractions of the canvas) into the mask (photo as stored: not rotated).
function paintStroke(a, b) {
  const ed = ED, mk = ed.mask, [w, h] = [mk.width, mk.height];
  const p = unrotate(a[0], a[1], ed.rot), q = unrotate(b[0], b[1], ed.rot);
  const x = mk.getContext('2d');
  x.strokeStyle = x.fillStyle = 'rgb(230,40,60)'; x.lineCap = x.lineJoin = 'round';
  x.lineWidth = Math.max(4, ed.brush * Math.max(w, h));
  x.beginPath(); x.moveTo(p[0] * w, p[1] * h); x.lineTo(q[0] * w + 0.01, q[1] * h); x.stroke();
  ed.painted = true;
}
// The painted part as a 0/1 map of the photo as stored.
function paintedMap() {
  const mk = ED.mask, n = mk.width * mk.height, a = mk.getContext('2d').getImageData(0, 0, mk.width, mk.height).data, P = new Uint8Array(n);
  for (let i = 0; i < n; i++) P[i] = a[4 * i + 3] > 24 ? 1 : 0;
  return P;
}
// "Only the logo": find the mark inside the paint (ED.det) and its green overlay (ED.detC).
function findMark() {
  const ed = ED; if (!ed || !ed.mask) return;
  ed.det = null; ed.detC = null;
  if (ed.mmode !== 'auto' || !ed.painted) return;
  const src = ed.clean || ed.orig; if (!src) return;
  const [w, h] = [ed.mask.width, ed.mask.height];
  if (!ed.srcPx) ed.srcPx = drawEdited(src, 0, null, null).getContext('2d').getImageData(0, 0, w, h).data;
  ed.det = detectMark(ed.srcPx, w, h, paintedMap());
  if (!ed.det) return;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), im = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) if (ed.det[i]) { im.data[4 * i] = 40; im.data[4 * i + 1] = 220; im.data[4 * i + 2] = 70; im.data[4 * i + 3] = 255; }
  x.putImageData(im, 0, 0); ed.detC = c;
}
async function runRemove() {
  if (!ED || ED.busy || !ED.painted) return;
  const ed = ED;
  ed.busy = true; $('#edA').disabled = true; markPaint();
  try {
    const src = ed.clean || await edOriginal();
    const onPct = pct => { if (ED === ed) edProg(pct == null ? 'Removing the mark…' : 'Loading the mark remover (first time about 28 MB)…', pct); };
    onPct(MIGAN_OK ? null : 0);
    let hole;
    if (ed.mmode === 'auto') { if (!ed.det) throw new Error('no logo colour found in the paint'); hole = ed.det; }
    else { const [w, h] = [ed.mask.width, ed.mask.height]; hole = dilate(paintedMap(), w, h, Math.max(2, Math.round(0.004 * Math.max(w, h)))); }
    const out = await removeMarks(src, hole, onPct);
    if (ED !== ed) return;
    ed.undo.push(ed.clean); if (ed.undo.length > 6) ed.undo.splice(1, 1);
    ed.clean = out; ed.matte = null; ed.srcPx = null; ed.det = null; ed.detC = null;
    ed.mask.getContext('2d').clearRect(0, 0, ed.mask.width, ed.mask.height); ed.painted = false;
    ed.busy = false;
    await edRebuild(ed.bg);
  } catch (x) { if (ED === ed) edProg(''); toast('The mark could not be removed: ' + (x.message || x), true); }
  finally { ed.busy = false; if (ED === ed) { $('#edA').disabled = false; markPaint(); } }
}
async function undoRemove() {
  if (!ED || ED.busy || !ED.undo.length) return;
  const ed = ED;
  ed.clean = ed.undo.pop(); ed.matte = null; ed.srcPx = null; findMark();
  try { await edRebuild(ed.bg); } catch (x) { toast(x.message || String(x), true); }
  markPaint();
}

function edDraw() {
  const c = $('#edc'); if (!c || !ED) return;
  const [iw, ih] = dims(ED.disp), sw = ED.rot % 180 !== 0;
  const rw = sw ? ih : iw, rh = sw ? iw : ih;
  const maxW = Math.min(760, window.innerWidth * 0.96 - 52), maxH = window.innerHeight * 0.56;
  const k = Math.min(maxW / rw, maxH / rh);
  c.width = Math.round(rw * k); c.height = Math.round(rh * k);
  const x = c.getContext('2d');
  x.save(); x.translate(c.width / 2, c.height / 2); x.rotate(ED.rot * Math.PI / 180); x.drawImage(ED.disp, -iw * k / 2, -ih * k / 2, iw * k, ih * k);
  if (ED.paint && ED.mask) {
    x.globalAlpha = ED.mmode === 'auto' ? 0.3 : 0.55; x.drawImage(ED.mask, -iw * k / 2, -ih * k / 2, iw * k, ih * k);
    if (ED.detC) { x.globalAlpha = 0.8; x.drawImage(ED.detC, -iw * k / 2, -ih * k / 2, iw * k, ih * k); }
    x.globalAlpha = 1;
  }
  x.restore();
  if (ED.paint) {                                   // paint mode: no crop frame, a circle shows the brush
    if (ED.hover) { const [mw, mh] = ED.mask ? [ED.mask.width, ED.mask.height] : [iw, ih];
      const rad = ED.brush * Math.max(mw, mh) / 2 * (c.width / (sw ? mh : mw));
      x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.beginPath(); x.arc(ED.hover[0] * c.width, ED.hover[1] * c.height, Math.max(2, rad), 0, 2 * Math.PI); x.stroke(); }
    return;
  }
  const [x0, y0, x1, y1] = ED.trim.map((v, i) => v * (i % 2 ? c.height : c.width));
  x.fillStyle = 'rgba(0,0,0,.55)';
  x.fillRect(0, 0, c.width, y0); x.fillRect(0, y1, c.width, c.height - y1); x.fillRect(0, y0, x0, y1 - y0); x.fillRect(x1, y0, c.width - x1, y1 - y0);
  x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(x0, y0, x1 - x0, y1 - y0);
  x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 1; x.beginPath();
  for (let i = 1; i < 3; i++) { const vx = x0 + (x1 - x0) * i / 3, hy = y0 + (y1 - y0) * i / 3; x.moveTo(vx, y0); x.lineTo(vx, y1); x.moveTo(x0, hy); x.lineTo(x1, hy); }
  x.stroke();
  x.fillStyle = '#fff';
  [[x0, y0], [x1, y0], [x0, y1], [x1, y1], [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]]
    .forEach(([hx, hy]) => x.fillRect(hx - 5, hy - 5, 10, 10));
  const e = edValue(), d = dims(ED.disp), L = usedLong(ED.info, e || {}, d), lv = level(ED.info, e || {}, d);
  $('#edi').innerHTML = L ? `Kept part: <b>${L} px</b> long side <span class="sz ${lv}" style="position:static;display:inline-block">${
    lv === 'g' ? 'sharp' : lv === 'a' ? 'a little soft' : 'may look blurred'}</span>` : '';
  markEnh();                                       // the crop decides whether ✨ Enhance is offered
}

function edValue() {                               // null = no edit
  const t = ED.trim.map(v => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000);
  const full = t[0] <= 0.001 && t[1] <= 0.001 && t[2] >= 0.999 && t[3] >= 0.999;
  if (!ED.rot && full) return null;
  const e = {};
  if (ED.rot) e.rotate = ED.rot;
  if (!full) e.trim = t;
  return e;
}

function edWire(c) {
  const MIN = 0.05, HIT = 12;
  let drag = null;
  const pos = ev => { const r = c.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height, r]; };
  const clamp = v => Math.min(1, Math.max(0, v));
  let stroke = null;                                 // mark remover: last point of the brush stroke
  c.addEventListener('pointerdown', ev => {
    if (!ED || ED.locked) return;
    ev.preventDefault();
    if (ED.paint) {
      if (ED.busy || !ED.mask) return;
      const [fx, fy] = pos(ev); stroke = [fx, fy]; paintStroke(stroke, stroke); markPaint(); edDraw();
      try { c.setPointerCapture(ev.pointerId); } catch (x) { }
      return;
    }
    const [fx, fy, r] = pos(ev), t = ED.trim, hx = HIT / r.width, hy = HIT / r.height;
    const inY = fy > t[1] - hy && fy < t[3] + hy, inX = fx > t[0] - hx && fx < t[2] + hx;
    const ed = { l: inY && Math.abs(fx - t[0]) < hx, r: inY && Math.abs(fx - t[2]) < hx, t: inX && Math.abs(fy - t[1]) < hy, b: inX && Math.abs(fy - t[3]) < hy };
    const full = t[0] <= 0.001 && t[1] <= 0.001 && t[2] >= 0.999 && t[3] >= 0.999;    // whole photo: a drag draws a new part
    const inside = !full && fx > t[0] && fx < t[2] && fy > t[1] && fy < t[3];
    drag = ed.l || ed.r || ed.t || ed.b ? { mode: 'size', ed } : inside ? { mode: 'move' } : { mode: 'new' };
    Object.assign(drag, { sx: fx, sy: fy, t0: t.slice() });
    try { c.setPointerCapture(ev.pointerId); } catch (x) { }
  });
  c.addEventListener('pointermove', ev => {
    if (ED && ED.paint) {
      const [fx, fy] = pos(ev); ED.hover = [fx, fy];
      if (stroke) { paintStroke(stroke, [fx, fy]); stroke = [fx, fy]; }
      edDraw(); return;
    }
    if (!drag || !ED) return;
    const [fx, fy] = pos(ev), t = drag.t0.slice();
    if (drag.mode === 'move') {
      const w = t[2] - t[0], h = t[3] - t[1];
      const nx = Math.min(1 - w, Math.max(0, t[0] + fx - drag.sx)), ny = Math.min(1 - h, Math.max(0, t[1] + fy - drag.sy));
      ED.trim = [nx, ny, nx + w, ny + h];
    } else if (drag.mode === 'size') {
      if (drag.ed.l) t[0] = Math.min(clamp(fx), t[2] - MIN);
      if (drag.ed.r) t[2] = Math.max(clamp(fx), t[0] + MIN);
      if (drag.ed.t) t[1] = Math.min(clamp(fy), t[3] - MIN);
      if (drag.ed.b) t[3] = Math.max(clamp(fy), t[1] + MIN);
      ED.trim = t;
    } else {
      const ax = clamp(drag.sx), ay = clamp(drag.sy), bx = clamp(fx), by = clamp(fy);
      ED.trim = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    }
    edDraw();
  });
  const end = () => {
    if (stroke) { stroke = null; findMark(); markPaint(); edDraw(); return; }
    if (!drag || !ED) return;
    const t = ED.trim;
    if (t[2] - t[0] < MIN || t[3] - t[1] < MIN) ED.trim = drag.t0;   // a click, not a drag: keep the old part
    drag = null; edDraw();
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('pointerleave', () => { if (ED && ED.paint) { ED.hover = null; edDraw(); } });
  c.addEventListener('pointermove', ev => {          // cursor hint
    if (drag || !ED) return;
    if (ED.paint) { c.style.cursor = 'none'; return; }
    const [fx, fy, r] = pos(ev), t = ED.trim, hx = HIT / r.width, hy = HIT / r.height;
    const l = Math.abs(fx - t[0]) < hx, rr = Math.abs(fx - t[2]) < hx, tp = Math.abs(fy - t[1]) < hy, b = Math.abs(fy - t[3]) < hy;
    const full = t[0] <= 0.001 && t[1] <= 0.001 && t[2] >= 0.999 && t[3] >= 0.999;
    const inside = !full && fx > t[0] && fx < t[2] && fy > t[1] && fy < t[3];
    c.style.cursor = (l && tp) || (rr && b) ? 'nwse-resize' : (rr && tp) || (l && b) ? 'nesw-resize' : l || rr ? 'ew-resize' : tp || b ? 'ns-resize' : inside ? 'move' : 'crosshair';
  });
}

// A photo object (like prepImage) from a canvas: the photo with its new background / enhanced, full size.
function photoFromCanvas(c, name) {
  const url = c.toDataURL('image/jpeg', 0.92), [w, h] = dims(c);
  const t = document.createElement('canvas'), tk = 240 / Math.max(w, h);
  t.width = Math.round(w * tk); t.height = Math.round(h * tk); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  const data = url.split(',')[1];
  return { name, mime: 'image/jpeg', data, preview: t.toDataURL('image/jpeg', 0.8), info: { w, h, b: Math.round(data.length * 0.75), bg: true } };
}

async function edApply() {
  if (!ED) return;
  const ed = ED, T = ed.T, e = edValue(), name = (ed.role || 'photo') + '.jpg';
  let changed = false;
  if (ed.clean) {                                    // marks removed: the cleaned photo becomes the photo as uploaded
    changed = true;
    const cp = photoFromCanvas(ed.clean, name);
    delete cp.info.bg;
    if (ed.bg) {                                     // + a background on top (the cleaned one is kept as original)
      const np = photoFromCanvas(ed.disp, name);
      np.bgOrig = cp; T.setP(np);
    } else T.setP(cp);
    T.setReset(false); T.setBg(ed.bg); T.setOp(null);
  } else if (!edKeepsCur(ed, ed.bg)) {               // background changed (or "Original")
    changed = true;
    const cur = T.p;
    if (!ed.bg) {                                    // back to the photo as uploaded
      let np = null, reset = false;
      if (cur && cur.bgOrig) np = cur.bgOrig;
      else if (!(cur && !(cur.info && cur.info.bg))) reset = ed.hasOrig;
      T.setP(np);
      if (reset) T.setReset(true);
      T.setBg('');
      T.setOp(np ? null : await editedPreview(ed.orig.src, {}));
    } else {
      const np = photoFromCanvas(ed.disp, name);
      if (cur && cur.bgOrig) np.bgOrig = cur.bgOrig;
      else if (cur && !(cur.info && cur.info.bg)) np.bgOrig = cur;   // the new photo itself is the original
      T.setP(np); T.setReset(false); T.setBg(ed.bg); T.setOp(null);
    }
  }
  const prev = e ? drawEdited(ed.disp, e.rotate || 0, e.trim, 240).toDataURL('image/jpeg', 0.85) : '';
  if (changed || JSON.stringify(T.e || null) !== JSON.stringify(e)) { changed = true; T.setE(e, prev); }
  if (!changed) return;
  if (ed.clean || ed.bg !== ed.bg0 || T.reset) ed.info = T.p ? T.p.info : ed.info;
  markDirty(); render();
  if (e && level(ed.info, e, dims(ed.disp)) === 'r') toast(ctT('small', 'The part you kept is small: it may look blurred.'), true);
}

// ------------------------------------------------------------------ files
function b64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(file); });
}
function loadImg(file) {
  return new Promise((res, rej) => { const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = url; });
}
// Resize to max 2000 px (MAX_PX); logos stay PNG.
async function prepImage(file, role) {
  if (!isPhotoFile(file)) throw new Error('Please choose a photo (JPG, PNG, HEIC, WEBP, AVIF, GIF, BMP or TIFF).');
  let im;
  try { im = await loadImg(file); }
  catch (e) {
    const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
    const conv = heic ? await heicToJpeg(file) : null;           // iPhone photo on Windows: convert it here
    if (conv) { try { im = await loadImg(conv); file = new File([conv], file.name, { type: 'image/jpeg' }); } catch (x) { im = null; } }
    if (!im) {                                  // e.g. TIFF: upload as it is
      if (file.size > 20e6) throw new Error('Photo too big (max 20 MB).');
      return { name: file.name, mime: file.type || mimeOf(file.name), data: await b64(file), preview: '', info: { b: file.size } };
    }
  }
  const logo = isLogo(role), max = logo ? 1200 : 2000;
  const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
  const x = c.getContext('2d');
  const png = logo && /png|svg|webp/.test(file.type);
  if (!png) { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(im, 0, 0, c.width, c.height);
  const url = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
  const t = document.createElement('canvas'), tk = 200 / Math.max(c.width, c.height);
  t.width = Math.round(c.width * tk); t.height = Math.round(c.height * tk); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  return { name: role + (png ? '.png' : '.jpg'), mime: png ? 'image/png' : 'image/jpeg', data: url.split(',')[1], preview: t.toDataURL('image/jpeg', 0.8),
           info: { w: im.naturalWidth, h: im.naturalHeight, b: file.size, sw: c.width, sh: c.height } };
}

// ------------------------------------------------------------------ photo types
// The browser turns every photo it can show (JPG, PNG, WEBP, AVIF, GIF, BMP, …) into a JPEG of max 2000 px;
// HEIC/HEIF (iPhone) is converted here with heic2any when the browser can't show it; anything else (e.g. TIFF) is
// uploaded as it is.
const PHOTO_EXT_RE = /\.(jpe?g|jfif|png|webp|heic|heif|avif|gif|bmp|tiff?)$/i;
const PHOTO_ACCEPT = 'image/\u002A,.jpg,.jpeg,.jfif,.png,.webp,.heic,.heif,.avif,.gif,.bmp,.tif,.tiff';
function isPhotoFile(f) { return !!f && (/^image\//.test(f.type || '') || PHOTO_EXT_RE.test(f.name || '')); }
function mimeOf(name) {
  const e = (String(name || '').match(PHOTO_EXT_RE) || ['', ''])[1].toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
           heif: 'image/heif', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' }[e] || 'image/jpeg';
}
let HEIC_LIB = null;
function heicToJpeg(file) {                       // null when the converter can't be loaded or the file can't be read
  HEIC_LIB = HEIC_LIB || new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
    s.onload = () => res(window.heic2any || null); s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return HEIC_LIB.then(f => f ? f({ blob: file, toType: 'image/jpeg', quality: 0.92 }) : null)
                 .then(b => Array.isArray(b) ? b[0] : b).catch(() => null);
}
