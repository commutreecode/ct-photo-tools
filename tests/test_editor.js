// The ✎ photo dialog of web/ct-photo.js in headless Chromium, inside tests/host.html (a minimal page that implements the
// host contract; backend mocked). Background (MODNet) and mark removal (MI-GAN) run for real when local copies
// of the npm packages are there (CI makes them; by hand:
//   cd /tmp && npm pack onnxruntime-web@1.17.3 @rmbg/model-modnet@0.0.1 migan-onnx@1.0.0 &&
//   for t in *.tgz; do mkdir -p ${t%.tgz} && tar xzf $t -C ${t%.tgz}; done
//   NPM_DIR=/tmp node tests/test_editor.js
// Without them only the parts without a model run. No real person: the test photo is drawn.
const fs = require('fs'), path = require('path'), assert = require('assert'), cp = require('child_process');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright'); }

const lib = fs.readFileSync(path.join(__dirname, '..', 'web', 'ct-photo.js'), 'utf8');
const host = fs.readFileSync(path.join(__dirname, 'host.html'), 'utf8');
const page_ = (drop) => {
  let h = host.replace('// @ct-photo-insert', () => lib);
  if (drop) h = h.replace(drop, '');
  return h;
};
const NPM = process.env.NPM_DIR || '/tmp';
const ORT_DIR = path.join(NPM, 'onnxruntime-web-1.17.3', 'package', 'dist');
const MODNET_DIR = path.join(NPM, 'rmbg-model-modnet-0.0.1', 'package');
const MIGAN_DIR = path.join(NPM, 'migan-onnx-1.0.0', 'package', 'models');
const haveModel = fs.existsSync(path.join(ORT_DIR, 'ort.wasm.min.js')) && fs.existsSync(path.join(MODNET_DIR, 'modnet-1.onnx'));
const haveMigan = haveModel && fs.existsSync(path.join(MIGAN_DIR, 'migan_pipeline_v2.onnx'));
if (process.env.REQUIRE_MODELS && !haveMigan) throw new Error('REQUIRE_MODELS: the npm copies of the models are missing in ' + NPM);
const py = code => cp.execFileSync('python3', ['-c', code]).toString().trim();
const PHOTO = py('import io,base64;from PIL import Image,ImageDraw;im=Image.new("RGB",(900,1100),(206,190,170));d=ImageDraw.Draw(im);' +
  'd.ellipse((300,120,600,440),fill=(120,95,75));d.rounded_rectangle((120,520,780,1300),radius=160,fill=(90,105,125));' +
  'd.rectangle((180,960,720,1010),fill=(235,60,140));b=io.BytesIO();im.save(b,"JPEG",quality=92);print(base64.b64encode(b.getvalue()).decode())');
const ENH = py('import io,base64;from PIL import Image;im=Image.open(io.BytesIO(base64.b64decode("' + PHOTO + '"))).convert("RGB");' +
  'im=im.resize((im.width*2,im.height*2));b=io.BytesIO();im.save(b,"JPEG",quality=90);print(base64.b64encode(b.getvalue()).decode())');

const mock = `
window.__calls = [];
window.__state = { status: 'Saved', enh: null, orig: false };
const PHOTO = '${PHOTO}';
function reply(action, a) {
  const st = window.__state;
  switch (action) {
    case 'photo': { const r = { mime: 'image/jpeg', data: window.__photo || PHOTO, orig: !!a.orig && st.orig, hasOrig: st.orig };
      return window.__slow ? new Promise(res => setTimeout(() => res(r), window.__slow)) : r; }
    case 'get': case 'get2': return { id: 'P1', status: st.status, enh: st.enh, updated: new Date().toISOString() };
    case 'enhance': st.status = 'Enhancing photo…'; return { ok: true };
    case 'bgreset': st.orig = false; return { ok: true };
    default: return { ok: true };
  }
}
window.__backend = (action, args) => { window.__calls.push([action, JSON.parse(JSON.stringify(args))]);
  return new Promise(res => setTimeout(() => res(reply(action, args)), 5)); };`;

(async () => {
  const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
  const browser = await pw.chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [], logs = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => logs.push(m.text()));
  let body = page_();
  await page.route('https://host.test/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: body.replace('<script>', '<script>' + mock + '</script><script>') }));
  const serve = (prefix, dir, type) => page.route(prefix + '**', r => {
    const f = path.join(dir, path.basename(new URL(r.request().url()).pathname));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'access-control-allow-origin': '*', 'content-type': type(f) } });
  });
  await serve('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/', ORT_DIR, f => f.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
  await serve('https://cdn.jsdelivr.net/npm/@rmbg/model-modnet@0.0.1/', MODNET_DIR, () => 'application/octet-stream');
  await serve('https://cdn.jsdelivr.net/npm/migan-onnx@1.0.0/', MIGAN_DIR, () => 'application/octet-stream');
  let n = 0;
  const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok:', m); };
  const calls = a => page.evaluate(x => window.__calls.filter(c => c[0] === x).map(c => c[1]), a);
  const wait = ms => page.waitForTimeout(ms);
  const fresh = async () => { await page.goto('https://host.test/', { waitUntil: 'load' }); };
  const openEd = async () => { await page.click('[data-pe="hero"]'); await page.waitForSelector('#edc'); await wait(200); };

  console.log('1 the library in a page');
  await fresh();
  ok(await page.evaluate(() => typeof CT_PHOTO_VERSION === 'string' && ctPhotoCheck().length === 0), 'loads, version ' +
     await page.evaluate(() => CT_PHOTO_VERSION) + ', host contract complete');
  ok(await page.evaluate(() => ['editPhoto', 'prepImage', 'isPhotoFile', 'editedPreview', 'afterEnhance', 'b64'].every(f => typeof window[f] === 'function')
     && typeof PHOTO_ACCEPT === 'string' && typeof ENH_ROLE === 'string'), 'the names a host calls are there');
  ok(await page.evaluate(() => document.head.firstElementChild.id === 'ctPhotoCss'), 'default dialog style first in <head> (host CSS wins)');

  console.log('2 the dialog');
  await openEd();
  ok(JSON.stringify((await calls('photo'))[0]) === '{"id":"P1","role":"hero","orig":false}', 'loads the full photo: photo {id, role, orig}');
  ok(await page.$$eval('#ed [data-bg]', b => b.length) === 7 && await page.$('#hdGo') && await page.$('#mkOn') && await page.$('#edR') && await page.$('#edL'),
     'rotate, background choices, ✨ Enhance HD, 🧽 Remove a mark');
  ok(await page.$eval('#ed', e => getComputedStyle(e).position === 'fixed') && await page.$eval('#ed .mbox', e => getComputedStyle(e).backgroundColor === 'rgb(255, 255, 255)'),
     'the default style draws the dialog (host without own CSS)');
  await page.click('#edC'); await wait(100);
  ok(await page.$('#ed') === null && !(await page.evaluate(() => dirty)), 'Cancel: closed, no change');
  await page.evaluate(() => { window.__slow = 1500; });
  await page.click('[data-pe="hero"]'); await page.waitForSelector('#mkOn'); await wait(100);
  ok(await page.$eval('#mkOn', b => b.disabled) && await page.$eval('#edR', b => b.disabled) && await page.$eval('#edA', b => b.disabled)
     && !(await page.$eval('#edC', b => b.disabled)), 'while the photo loads: tools wait, Cancel works');
  await page.waitForSelector('#edc', { timeout: 10000 }); await wait(100);
  ok(!(await page.$eval('#mkOn', b => b.disabled)) && !(await page.$eval('#edR', b => b.disabled)), 'photo there: tools ready');
  await page.evaluate(() => { window.__slow = 0; }); await page.click('#edC'); await wait(100);

  console.log('3 rotate + Apply');
  await openEd();
  await page.click('#edR'); await wait(100);
  await page.click('#edA'); await wait(300);
  ok(await page.evaluate(() => dirty && EDIT.hero && EDIT.hero.rotate === 90), 'Apply: rotate 90 kept as a number, page marked changed');
  ok(await page.evaluate(() => window.__renders > 0), 'the host redraws');

  console.log('4 ✨ Enhance HD');
  await fresh(); await openEd();
  await page.evaluate(() => { dirty = true; });
  await page.click('#hdGo'); await wait(150);
  ok(/Save this photo first/.test(await page.textContent('#toast')) && !(await calls('enhance')).length, 'unsaved page: Save first');
  await page.evaluate(() => { dirty = false; });
  await page.click('#hdGo');
  await page.waitForFunction(() => window.__calls.some(c => c[0] === 'enhance')); await wait(300);
  ok(JSON.stringify((await calls('enhance'))[0]) === '{"id":"P1","role":"hero"}', 'enhance {id, role} sent');
  ok(!(await page.$eval('#edp', e => e.hidden)) && await page.$eval('#edA', b => b.disabled), 'progress bar, other tools locked');
  await page.evaluate(e => { window.__photo = e; Object.assign(window.__state, { status: 'Saved', orig: true, enh: { role: 'hero', st: 'Done', faces: 1 } });
    INFO.hero = { w: 1800, h: 2200, b: 1, enh: 2, hd: 1 }; }, ENH);
  await page.waitForSelector('#ed .cmp canvas', { timeout: 20000 }); await wait(300);
  ok((await page.$$eval('#ed .cmp figcaption', f => f.length)) === 2 && await page.isVisible('#cmpA') && await page.isVisible('#cmpB'),
     'done: before | HD side by side, Keep HD / Keep before');
  await page.click('#cmpB');
  await page.waitForFunction(() => window.__calls.some(c => c[0] === 'bgreset'), null, { timeout: 10000 });
  ok(JSON.stringify((await calls('bgreset'))[0]) === '{"id":"P1","role":"hero"}', 'Keep the photo before (= the original): bgreset {id, role}');

  if (haveModel) {
    console.log('5 background (MODNet, real model)');
    await fresh(); await openEd();
    await page.click('#ed [data-bg="#ffffff"]');
    await page.waitForFunction(() => ED && !ED.busy && ED.bg === '#ffffff', null, { timeout: 180000 });
    const px = await page.evaluate(() => { const c = $('#edc'), x = c.getContext('2d').getImageData(4, 4, 1, 1).data; return [x[0], x[1], x[2]]; });
    ok(px.every(v => v > 235), 'corner of the photo is white now: ' + px.join(','));
    await page.click('#edA');
    await page.waitForFunction(() => !document.querySelector('#ed'), null, { timeout: 30000 });
    ok(await page.evaluate(() => !!PEND.hero && BGV.hero === '#ffffff' && dirty), 'Apply: new photo waits for Save (PEND), background kept');
  } else console.log('5 background: skipped (no local model copies, set NPM_DIR)');

  if (haveMigan) {
    console.log('6 remove a mark (MI-GAN, real model)');
    await fresh(); await openEd();
    await page.click('#mkOn'); await wait(100);
    const box = await page.$eval('#edc', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await page.mouse.move(box.x + box.w * 0.18, box.y + box.h * 0.895); await page.mouse.down();
    for (let i = 0; i <= 20; i++) await page.mouse.move(box.x + box.w * (0.18 + 0.64 * i / 20), box.y + box.h * 0.895);
    await page.mouse.up(); await wait(300);
    await page.click('#mkGo');
    await page.waitForFunction(() => ED && !ED.busy && ED.clean, null, { timeout: 180000 });
    ok(await page.evaluate(() => !!ED.clean), 'the painted mark is removed');
    await page.click('#edC');
  } else console.log('6 remove a mark: skipped (no local model copies)');

  console.log('7 the host\'s own wording (CT_PHOTO_TEXT)');
  body = host.replace('// @ct-photo-insert', () => "const CT_PHOTO_TEXT = { saveFirst: 'HOST TEXT', editHint: () => 'HINT ' + P.id };\n" + lib);
  await fresh(); await openEd();
  ok(/HINT P1/.test(await page.textContent('#ed')), 'a text given as a function');
  await page.evaluate(() => { dirty = true; }); await page.click('#hdGo'); await wait(150);
  ok(/HOST TEXT/.test(await page.textContent('#toast')), 'a text given as a string');
  await page.click('#edC');

  console.log('7b the host\'s options (CT_PHOTO_OPT)');
  body = host.replace('// @ct-photo-insert', () => "const CT_PHOTO_OPT = { getAction: 'get2', pollMs: () => 300 };\n" + lib);
  await fresh(); await openEd();
  await page.click('#hdGo'); await page.waitForFunction(() => window.__calls.some(c => c[0] === 'get2'), null, { timeout: 3000 });
  ok(!(await calls('get')).length, 'status asked with the host\'s action, at the host\'s pace');
  await page.click('#edC');

  console.log('8 a host without a contract name');
  body = page_('const isLogo = role => /^logo/.test(role);');
  await fresh(); logs.length = 0;
  await page.click('[data-pe="hero"]'); await wait(300);
  ok(await page.$('#ed') === null && logs.some(l => /ct-photo: the page does not define isLogo/.test(l)), 'no dialog, a clear console error names it');

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`editor: ${n} checks passed`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
