// Checks that need no browser: the library parses, is safe to insert into a page's script, declares its version, and its
// host-contract list (header) matches ctPhotoCheck().
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(root, 'web', 'ct-photo.js'), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok:', m); };
ok((() => { new Function(js); return true; })(), 'web/ct-photo.js parses');
ok(!js.includes('/' + '*'), 'no slash-star (some hosts strip it as a comment)');
ok(!/<\/script/i.test(js), 'no closing script tag (the file is inserted inside the page script)');
ok(!js.includes('<' + '?') && !js.includes('?' + '>'), 'no template markers');
ok(/const CT_PHOTO_VERSION = '\d{4}-\d\d-\d\d\.\d+';/.test(js), 'CT_PHOTO_VERSION present');
const fn = js.slice(js.indexOf('function ctPhotoCheck()'), js.indexOf('\n}\n', js.indexOf('function ctPhotoCheck()')));
const checked = [...fn.matchAll(/'([^']+)': typeof /g)].map(m => m[1]).sort();
const head = js.slice(0, js.indexOf('const CT_PHOTO_VERSION'));
const missingInHead = checked.filter(nm => !new RegExp('[\\s,(]' + nm.replace('$', '\\$') + '[\\s,(]').test(head));
ok(checked.length >= 20 && !missingInHead.length, 'every checked host name is documented in the header: ' + (missingInHead.join(',') || 'all'));
const pyv = /__version__ = "([^"]+)"/.exec(fs.readFileSync(path.join(root, 'py', 'ctphoto', '__init__.py'), 'utf8'))[1];
ok(js.includes("const CT_PHOTO_VERSION = '" + pyv + "';"), 'web and py versions agree: ' + pyv);
console.log(`static: ${n} checks passed`);
