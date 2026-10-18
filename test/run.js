// Offline tests: load the userscript into a saved Connect2 "Select resource" page
// and simulate the page reloads Connect2 does on every postback.
// Run with: npm test
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures/select-resource.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(__dirname, '../src/connect2-gear-presets.user.js'), 'utf8');
const URL = 'https://mtsu.getconnect2.com/wizard/multiresource.aspx';

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) failures += 1; };
const tick = () => new Promise((r) => setTimeout(r, 20));

// localStorage that survives our simulated reloads
let storage = {};

/**
 * Load the page once. `edit` can change the HTML first (e.g. basket count).
 * Clicks on Connect2's own submit buttons are recorded and blocked instead of posting back.
 */
function loadPage(edit, prompts = []) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|submit/i.test(e.message)) console.log('  jsdom:', e.message); });
  const dom = new JSDOM(edit ? edit(FIXTURE) : FIXTURE, { url: URL, virtualConsole: vc, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.prompt = () => prompts.shift() || null;
  w.confirm = () => true;
  w.alert = (m) => console.log('  alert:', m);
  const postbacks = [];
  w.document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches && t.matches('input[type=submit], .fuzzySearch button')) { postbacks.push(t.id || 'search'); e.preventDefault(); }
  }, true);
  w.eval(SCRIPT);
  const root = w.document.getElementById('c2presets-host').shadowRoot;
  return {
    w, root, postbacks,
    button: (label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label),
    save() { storage = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); storage[k] = w.localStorage.getItem(k); } },
    get: (k) => JSON.parse(w.localStorage.getItem('c2presets.' + k)),
  };
}
const withBasket = (n) => (h) => h.replace('Basket (0 items)', 'Basket (' + n + ' items)');

(async () => {
  console.log('Picking items into a preset');
  let p = loadPage(null, ['A-cam package']);
  check(!!p.root.querySelector('.panel'), 'panel renders');
  p.button('New').click();
  check(p.w.document.querySelectorAll('.c2p-toggle').length === 15, '"+ Preset" added to all 15 listed items');
  p.w.document.querySelectorAll('.c2p-toggle')[0].click(); // 3 Pod V4AH Tripod, id 900
  p.w.document.querySelectorAll('.c2p-toggle')[3].click(); // Aputure 300D, id 989
  const presets = p.get('presets');
  check(presets['A-cam package'].items.map((x) => x.id).join() === '900,989', 'preset stores resource ids 900 and 989');
  check(presets['A-cam package'].category === 'Media Arts Equipment', 'preset records its category');
  check(p.postbacks.length === 0, 'picking never triggers a Connect2 postback');
  check(!p.root.textContent.includes('Dates from Connect2'), 'no dates detected before Go is pressed');

  // An item that is not on page 1, to exercise the search fallback
  presets['A-cam package'].items.push({ id: '7777', name: 'Zoom F8n Recorder R1' });
  p.w.localStorage.setItem('c2presets.presets', JSON.stringify(presets));
  p.save();

  console.log('Adding a preset to the basket');
  p = loadPage();
  p.button('Add all to basket').click();
  check(/ctl01_bookBtn$/.test(p.postbacks[0] || ''), 'clicks the tripod\'s Add button');
  p.save();

  p = loadPage(withBasket(1)); await tick();
  check(/ctl04_bookBtn$/.test(p.postbacks[0] || ''), 'after reload, clicks the 300D\'s Add button');
  p.save();

  p = loadPage(withBasket(2)); await tick();
  const box = () => p.w.document.querySelector('input[id$="FuzzySearchTxt_textbox"]').value;
  check(box() === 'Zoom F8n Recorder R1' && p.postbacks[0] === 'search', 'searches for an item not on the page');
  p.save();

  p = loadPage(withBasket(2)); await tick();
  check(box() === 'Zoom F8n Recorder', 'retries with a shorter search');
  p.save();

  p = loadPage(withBasket(2)); await tick();
  const status = p.root.querySelector('.status').textContent;
  check(/Added 2 of 3/.test(status) && /Zoom F8n Recorder R1/.test(status), 'summary says 2 of 3 and names the missing item');
  check(p.get('queue') === null, 'queue is cleared when done');
  check(p.postbacks.length === 0, 'no further clicks after finishing');

  console.log('Availability dates');
  p = loadPage((h) => h.replace('// trigger the availability search', "showMultiDayAvailability('10/20/2026 09:00', '10/22/2026 17:00');"));
  check(p.root.textContent.includes('10/20/2026 09:00 → 10/22/2026 17:00'), 'reads the dates Connect2 uses after Go');

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exitCode = failures ? 1 : 0;
})();
