// Offline tests: load the userscript into a saved Connect2 "Select resource" page
// and simulate the page reloads Connect2 does on every postback.
// Run with: npm test
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FIXTURES = {
  resource: fs.readFileSync(path.join(__dirname, 'fixtures/select-resource.html'), 'utf8'),
  time: fs.readFileSync(path.join(__dirname, 'fixtures/select-time.html'), 'utf8'),
  clash: fs.readFileSync(path.join(__dirname, 'fixtures/select-time-clash.html'), 'utf8'), // rejected Update
};
const SCRIPT = fs.readFileSync(path.join(__dirname, '../src/connect2-gear-presets.user.js'), 'utf8');
const URL = 'https://mtsu.getconnect2.com/wizard/multiresource.aspx';

// Resource ids on the fixture page (button suffix in parentheses)
const ID = {
  tripod: '900',   // ctl01
  dolly: '1666',   // ctl02, "You are not allowed to book this resource."
  fog: '430',      // ctl03, note: "Cannot be used in Campus Buildings without prior permission!"
  light300d: '989', // ctl04
  arri3: '581',    // ctl11
  arri4: '583',    // ctl12
  arri1: '493',    // ctl13
};

let failures = 0;
const check = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) failures += 1; };
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t = Date.now(); while (!fn() && Date.now() - t < ms) await wait(20); return fn(); }

// localStorage that survives our simulated reloads
let storage = {};
const resetStorage = () => { storage = {}; };

// "10/28/2030" → "Monday, 28 Oct 2030", the way Connect2 writes dates in availability lists
function longDate(mdyText) {
  const [m, d, y] = mdyText.split('/').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${day}, ${d} ${mon} ${y}`;
}

// Fake Connect2 availability endpoint, shaped like the real responses:
// `booked` ids come back as errors; `limits[id] = { collect, ret }` sets the collect-from / return-by times.
function fakeFetch(booked, limits, calls) {
  return async (url) => {
    const params = new URLSearchParams(String(url).split('?')[1]);
    calls.push(Object.fromEntries(params));
    const id = params.get('resourceId');
    if (booked.includes(id)) {
      return { ok: true, json: async () => ({ Type: 1, TypeName: 'error', Title: 'Not available', Text: 'Booked 10/20 – 10/22', List: [] }) };
    }
    const lim = limits[id] || {};
    const start = params.get('start'), end = params.get('end');
    // Defaults are wide on purpose: only tests that set `limits` run into time limits.
    const list = start ? ['Collect from: ' + (lim.collect || '7:00 AM'), longDate(start), 'Return by: ' + (lim.ret || '11:00 PM'), longDate(end)] : [];
    return { ok: true, json: async () => ({ Type: 3, TypeName: 'success', Title: 'Available', Text: '', List: list }) };
  };
}

/**
 * Load the page once. `edit` can change the HTML first (e.g. basket count or dates).
 * Clicks on Connect2's own submit buttons are recorded and blocked instead of posting back.
 */
function loadPage({ page = 'resource', edit, prompts = [], booked = [], limits = {} } = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|submit/i.test(e.message)) console.log('  jsdom:', e.message); });
  const html = FIXTURES[page];
  const dom = new JSDOM(edit ? edit(html) : html, { url: URL, virtualConsole: vc, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.prompt = () => prompts.shift() || null;
  const confirms = [];
  w.confirm = (m) => { confirms.push(m); return true; };
  w.alert = (m) => console.log('  alert:', m);
  const fetches = [];
  w.fetch = fakeFetch(booked, limits, fetches);
  const postbacks = [];
  w.document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches && t.matches('input[type=submit], input[type=button], .fuzzySearch button, a[id*="suggestionLink"], a[id*="resourcePager"]')) { postbacks.push(t.id || 'search'); e.preventDefault(); }
  }, true);
  w.eval(SCRIPT);
  const root = w.document.getElementById('c2presets-host').shadowRoot;
  return {
    w, root, postbacks, fetches, confirms,
    field: (name) => w.document.querySelector(`input[id$="editResourceBookingsTime_datetime_${name}_textbox"]`).value,
    button: (label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label),
    toggle: (id) => w.document.querySelector(`.resource-availability[data-id="${id}"]`).closest('li').querySelector('.c2p-toggle'),
    status: () => (root.querySelector('.status') || { textContent: '' }).textContent,
    save() { storage = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); storage[k] = w.localStorage.getItem(k); } },
    get: (k) => JSON.parse(w.localStorage.getItem('c2presets.' + k)),
    set: (k, v) => w.localStorage.setItem('c2presets.' + k, JSON.stringify(v)),
  };
}
const withBasket = (n) => (h) => h.replace('Basket (0 items)', 'Basket (' + n + ' items)');
const withDates = (h) => h.replace('// trigger the availability search', "showMultiDayAvailability('10/20/2026 09:00', '10/22/2026 17:00');");
const enableNext = (h) => h.replace(/(<input[^>]*wizardBannerRight_btnNext"[^>]*?) disabled="disabled"/, '$1');
const timeValues = (start, end) => (h) => h
  .replace(/(id="[^"]*datetime_startDate_textbox")/, `$1 value="${start}"`)
  .replace(/(id="[^"]*datetime_endDate_textbox")/, `$1 value="${end}"`);
const both = (...fns) => (h) => fns.reduce((acc, f) => f(acc), h);
const slotIds = (preset) => preset.slots.map((s) => s.options.map((o) => o.id).join('|')).join(',');

(async () => {
  console.log('Picking items into a preset');
  resetStorage();
  let p = loadPage({ prompts: ['A-cam package'] });
  check(!!p.root.querySelector('.panel'), 'panel renders');
  p.button('New').click();
  check(p.w.document.querySelectorAll('.c2p-toggle').length === 15, 'a pick button is added to all 15 listed items');
  p.toggle(ID.tripod).click();
  p.toggle(ID.light300d).click();
  check(slotIds(p.get('presets')['A-cam package']) === '900,989', 'each pick becomes its own slot');
  check(p.get('presets')['A-cam package'].category === 'Media Arts Equipment', 'preset records its category');
  check(p.postbacks.length === 0, 'picking never triggers a Connect2 postback');

  console.log('Not-bookable items and warnings');
  const dollyBtn = p.toggle(ID.dolly);
  check(dollyBtn.textContent === 'Can\'t book' && dollyBtn.disabled, 'an item your account can\'t book shows "Can\'t book" and is disabled');
  check(dollyBtn.title === 'You are not allowed to book this resource.', 'its button explains why');
  p.toggle(ID.fog).click();
  const fog = p.get('presets')['A-cam package'].slots[2].options[0];
  check(fog.note.includes('prior permission'), 'item notes are saved with the item');
  check(p.root.textContent.includes('⚠ Cannot be used in Campus Buildings'), 'warning-style notes show in the preset');
  check(!p.root.textContent.includes('⚠ Aputure'), 'ordinary items show no warning');

  console.log('Alternates');
  p.toggle(ID.fog).click(); // remove fog again
  p.toggle(ID.arri1).click();
  const arriSlot = p.get('presets')['A-cam package'].slots.length - 1;
  [...p.root.querySelectorAll('li.slot')][arriSlot].querySelector('button[title^="Add interchangeable"]').click();
  check(p.toggle(ID.arri3).textContent === '+ Alt', 'alternate mode relabels list buttons to "+ Alt"');
  p.toggle(ID.arri3).click();
  p.toggle(ID.arri4).click();
  check(slotIds(p.get('presets')['A-cam package']) === '900,989,493|581|583', 'alternates join the chosen slot in order');
  check(p.toggle(ID.arri3).textContent === '✓ Alternate', 'alternates are marked in the list');
  p.toggle(ID.arri4).click();
  check(slotIds(p.get('presets')['A-cam package']) === '900,989,493|581', 'clicking a marked alternate removes it');
  p.save();

  console.log('Migrating v0.1 presets');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Old: { category: 'Media Arts Equipment', items: [{ id: '900', name: 'Tripod' }, { id: '989', name: '300D' }] } });
  p = loadPage();
  const migrated = p.get('presets').Old;
  check(migrated && slotIds(migrated) === '900,989' && !migrated.items, 'old one-item-per-entry presets become slots');

  console.log('Adding without dates: falls through to an alternate when a unit can\'t be booked');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.dolly, name: '3Pod VT-2 Professional Universal Tripod Dolly Z4' }, { id: ID.light300d, name: 'Aputure 300D Light with Fresnel 2x Lens CC3' }] },
    { options: [{ id: '7777', name: 'Zoom F8n Recorder R1' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true });
  p = loadPage();
  p.button('Add all to basket').click();
  await until(() => p.postbacks.length);
  check(/ctl04_bookBtn$/.test(p.postbacks[0] || ''), 'skips the not-bookable dolly and clicks the 300D');
  p.save();

  p = loadPage({ edit: withBasket(1) }); await wait();
  const box = () => p.w.document.querySelector('input[id$="FuzzySearchTxt_textbox"]').value;
  check(box() === 'Zoom F8n Recorder R1' && p.postbacks[0] === 'search', 'searches for an item not on the page');
  p.save();
  p = loadPage({ edit: withBasket(1) }); await wait();
  check(box() === 'Zoom F8n Recorder', 'retries with a shorter search');
  p.save();
  p = loadPage({ edit: withBasket(1) }); await wait();
  const s1 = p.status();
  check(/Added 1 of 2/.test(s1), 'summary counts slots: 1 of 2');
  check(/used Aputure 300D .* instead of 3Pod VT-2/.test(s1) && /not allowed to book/.test(s1), 'summary says which alternate was used and why');
  check(/Couldn't add Zoom F8n Recorder R1: .*not found by search/.test(s1), 'summary names the slot it couldn\'t fill');
  check(/No dates were set/.test(s1), 'summary explains alternates weren\'t date-checked');
  check(p.get('queue') === null && p.postbacks.length === 0, 'queue is cleared and nothing else is clicked');

  console.log('Adding with dates: picks a free unit');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Softbank 1x650w 2x150w Three Light Kit #1 DD4' }, { id: ID.arri3, name: 'Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true });
  p = loadPage({ edit: withDates, booked: [ID.arri1] });
  check(p.root.textContent.includes('10/20/2026 09:00 → 10/22/2026 17:00'), 'reads the dates Connect2 uses after Go');
  p.button('Add all to basket').click();
  await until(() => p.postbacks.length);
  check(/ctl11_bookBtn$/.test(p.postbacks[0] || ''), 'Kit #1 is booked, so it clicks Kit #3 instead');
  p.save();
  p = loadPage({ edit: both(withDates, withBasket(1)), booked: [ID.arri1] }); await wait();
  const s2 = p.status();
  check(/Added 1 of 1/.test(s2) && /used Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4 instead of .*Kit #1/.test(s2), 'summary reports the swap');
  check(!/No dates were set/.test(s2), 'no missing-dates note when dates were set');

  console.log('Checking availability');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Kit #1' }, { id: ID.arri3, name: 'Arri Kit #3' }] },
    { options: [{ id: ID.tripod, name: '3 Pod V4AH Tripod' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true });
  p = loadPage({ edit: withDates, booked: [ID.arri1, ID.arri3] });
  p.button('Check availability').click();
  await until(() => /slot\(s\) have no free unit|has a free unit/.test(p.status()));
  check(/1 of 2 slot\(s\) have no free unit .*Arri Kit #1/.test(p.status()), 'flags the slot with no free unit');
  const badges = [...p.root.querySelectorAll('.badge')].map((b) => b.textContent);
  check(badges.join() === 'Not available,Not available,Available', 'shows a badge for each unit checked');

  console.log('Date ranges → bookings');
  resetStorage();
  const ranges = [
    { startDate: '2030-10-25', startTime: '09:00', endDate: '2030-10-27', endTime: '17:00' }, // Fri → Sun
    { startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-28', endTime: '17:00' }, // Mon
    { startDate: '2030-10-30', startTime: '18:00', endDate: '2030-10-31', endTime: '08:00' }, // Wed night → Thu morning
  ];
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Softbank 1x650w 2x150w Three Light Kit #1 DD4' }, { id: ID.arri3, name: 'Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true, showDays: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges });
  p = loadPage();
  const summaries = () => [...p.root.querySelectorAll('.range > .muted')].map((d) => d.textContent);
  check(summaries().join(' | ') === 'Fri 10/25 9:00 AM → Sun 10/27 5:00 PM · 3 days | Mon 10/28 9:00 AM → 5:00 PM · 1 day | Wed 10/30 6:00 PM → Thu 10/31 8:00 AM · 2 days',
    'each range shows as one booking with its length');
  check(!!p.button('Book 3 bookings'), 'offers to book 3 bookings');
  check(p.root.querySelectorAll('.range input[type=date]').length === 6, 'each range has a pickup date and a return date');

  const dateInput = (row, which) => p.root.querySelectorAll('.range')[row].querySelectorAll('input[type=date]')[which];
  const setInput = (input, v) => { input.value = v; input.dispatchEvent(new p.w.Event('change')); };
  setInput(dateInput(1, 0), '2030-11-04');
  let saved = p.get('schedule').ranges[1];
  check(saved.startDate === '2030-11-04' && saved.endDate === '2030-11-04', 'moving a pickup date moves its return date too');
  setInput(dateInput(1, 1), '2030-11-08');
  check(p.root.querySelectorAll('.range')[1].textContent.includes('⚠ longer than the 3-day maximum'), 'warns when a range is over 3 days');
  setInput(dateInput(1, 1), '2030-11-03');
  check(p.root.querySelectorAll('.range')[1].textContent.includes('⚠ return is not after pickup') && p.button('Book 3 bookings').disabled,
    'a return before pickup is flagged and blocks booking');

  p.button('+ Date range').click();
  saved = p.get('schedule').ranges[3];
  check(saved.startDate === '2030-11-01' && saved.endDate === '2030-11-02' && saved.startTime === '18:00' && saved.endTime === '08:00',
    '+ Date range starts the day after the last return, with the same length and times');

  resetStorage();
  storage['c2presets.schedule'] = JSON.stringify({ days: [{ date: '2030-10-25', start: '09:00', end: '17:00' }, { date: '2030-10-30', start: '18:00', end: '08:00' }], merge: true });
  p = loadPage();
  check(JSON.stringify(p.get('schedule').ranges) === JSON.stringify([
    { startDate: '2030-10-25', startTime: '09:00', endDate: '2030-10-25', endTime: '17:00' },
    { startDate: '2030-10-30', startTime: '18:00', endDate: '2030-10-31', endTime: '08:00' },
  ]), 'v0.3 shoot days are converted to ranges');

  resetStorage();
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2020-01-06', startTime: '09:00', endDate: '2020-01-06', endTime: '17:00' }] });
  storage['c2presets.ui'] = JSON.stringify({ open: true, showDays: true });
  storage['c2presets.presets'] = JSON.stringify({ X: { category: '', slots: [{ options: [{ id: '900', name: 'Tripod' }] }] } });
  p = loadPage();
  check(p.root.textContent.includes('⚠ starts in the past'), 'warns about a range in the past');

  console.log('Booking run: booking 1');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Softbank 1x650w 2x150w Three Light Kit #1 DD4' }, { id: ID.arri3, name: 'Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true, showDays: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges });
  p = loadPage({ booked: [ID.arri1] });
  p.button('Book 3 bookings').click();
  await until(() => p.postbacks.length);
  const checkedStarts = [...new Set(p.fetches.map((f) => f.start + '–' + f.end))].join(', ');
  check(checkedStarts === '10/25/2030–10/27/2030, 10/28/2030–10/28/2030, 10/30/2030–10/31/2030', 'checks every booking\'s own dates before starting: ' + checkedStarts);
  check(/ctl11_bookBtn$/.test(p.postbacks[0] || ''), 'Kit #1 is booked those days, so it adds Kit #3');
  check(p.get('run').stage === 'basket', 'run is in the basket stage');
  p.save();

  p = loadPage({ edit: both(withBasket(1), enableNext), booked: [ID.arri1] }); await wait();
  check(/wizardBannerRight_btnNext$/.test(p.postbacks[0] || ''), 'with the gear in the basket, presses Create booking');
  check(p.get('run').stage === 'create' && p.get('queue') === null, 'run moves to the time step');
  p.save();

  p = loadPage({ page: 'time' }); await wait();
  check(p.field('startDate') === '10/25/2030' && p.field('startTime') === '9:00 AM', 'fills pickup: 10/25/2030 9:00 AM');
  check(p.field('endDate') === '10/27/2030' && p.field('endTime') === '5:00 PM', 'fills return: 10/27/2030 5:00 PM');
  check(/editResourceBookingsTime_btnUpdate$/.test(p.postbacks[0] || ''), 'presses Update');
  p.save();

  p = loadPage({ page: 'time', edit: both(timeValues('10/25/2030', '10/27/2030'), enableNext) }); await wait();
  check(/wizardBannerRight_btnNext$/.test(p.postbacks[0] || ''), 'times accepted, so it presses Next to Terms & Conditions');
  check(p.get('run').stage === 'handoff' && !p.get('run').problem, 'then hands off with no problem');
  p.save();

  p = loadPage({ page: 'time' }); await wait(); // simulate Terms page: any non-list page shows hand-off text
  check(p.root.querySelector('.run').textContent.includes('Your turn: Terms & Conditions'), 'tells you what\'s left on the other steps');
  check(p.postbacks.length === 0, 'and clicks nothing while it\'s your turn');

  console.log('Booking run: booking 2');
  p = loadPage({ booked: [ID.arri1] });
  check(!!p.button('Start booking 2 of 3') && !!p.button('Redo booking 1'), 'back on the list, offers the next booking or a redo');
  p.button('Start booking 2 of 3').click();
  await until(() => p.postbacks.length);
  check(p.fetches.length && p.fetches.every((f) => f.start === '10/28/2030' && f.end === '10/28/2030'), 'booking 2 checks its own date');
  check(p.get('run').b === 1, 'run is on booking 2');
  p.save();

  console.log('Booking run: Connect2 rejects the times');
  const run = JSON.parse(storage['c2presets.run']);
  run.stage = 'time';
  storage['c2presets.run'] = JSON.stringify(run);
  delete storage['c2presets.queue'];
  p = loadPage({ page: 'time' }); await wait(); // Next still disabled, dates empty
  check(p.get('run').stage === 'handoff' && /didn't accept Mon 10\/28/.test(p.get('run').problem), 'hands off with an explanation instead of pressing Next');
  check(p.postbacks.length === 0, 'and presses nothing');
  p.save();
  p = loadPage();
  p.button('Stop run') || p.button('End run');
  (p.button('Stop run') || p.button('End run')).click();
  check(p.get('run') === null, 'the run can be ended');

  console.log('Checking ranges before a run');
  resetStorage();
  // Mon 10/28/2030 9:00 AM → Wed 10/30/2030 5:00 PM; cage closes 4:30 PM; the 300D is due back 2:00 PM Wed;
  // the tripod can't be collected until 10:00 AM Mon; Arri Kit #1 is due back early but Kit #3 is free.
  const limits = { [ID.light300d]: { ret: '2:00 PM' }, [ID.tripod]: { collect: '10:00 AM' }, [ID.arri1]: { ret: '12:00 PM' }, [ID.arri3]: { ret: '5:30 PM' } };
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.light300d, name: 'Aputure 300D' }] },
    { options: [{ id: ID.tripod, name: '3 Pod Tripod' }] },
    { options: [{ id: ID.arri1, name: 'Arri Kit #1' }, { id: ID.arri3, name: 'Arri Kit #3' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true, showDays: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  p = loadPage({ limits });
  p.button('Check ranges').click();
  await until(() => p.root.querySelector('.report, .okline'), 6000);
  const report = () => (p.root.querySelector('.range .report') || { textContent: '' }).textContent;
  check(report().includes('✗ Aputure 300D: return by 2:00 PM Wed 10/30'), 'flags an item due back before the return time');
  check(report().includes('✗ 3 Pod Tripod: collect from 10:00 AM Mon 10/28'), 'flags an item not ready by the pickup time');
  check(!report().includes('Arri'), 'a slot is fine when one of its alternates fits');
  check(!!p.button('Or change the times: Mon 10/28 10:00 AM → Wed 10/30 2:00 PM'), 'offers the narrower times that would fit everything');
  p.button('Or change the times: Mon 10/28 10:00 AM → Wed 10/30 2:00 PM').click();
  const fixed = p.get('schedule').ranges[0];
  check(fixed.startTime === '10:00' && fixed.endTime === '14:00' && fixed.endDate === '2030-10-30', 'one click changes the range to those times');
  await until(() => p.root.querySelector('.okline'), 6000);
  check(!!p.root.querySelector('.okline'), 'and the re-check comes back clear');
  p.save();

  console.log('Starting a run warns about problems first');
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  p = loadPage({ limits });
  p.button('Book 1 booking').click();
  await until(() => (p.get('run') || {}).stage === 'gate', 6000);
  const startMsg = p.confirms.find((m) => m.startsWith('Make 1 booking')) || '';
  check(/⚠ Aputure 300D: return by 2:00 PM/.test(startMsg) && /probably reject/.test(startMsg), 'the start confirmation lists the problems');
  const gateText = p.root.querySelector('.run').textContent;
  check(p.postbacks.length === 0 && gateText.includes('Nothing has been added yet') && gateText.includes('✗ Aputure 300D: return by 2:00 PM') && gateText.includes('✗ 3 Pod Tripod'),
    'before adding anything, the run stops on the items that don\'t fit');
  p.button('Add it anyway').click();
  check(p.root.querySelector('.run').textContent.includes('✓ Aputure 300D: adding it anyway'), 'records each choice');
  p.button('Add it anyway').click();
  await until(() => p.postbacks.length, 6000);
  check(/ctl04_bookBtn$/.test(p.postbacks[0] || ''), 'once every item is decided, adding starts');
  p.save();
  p = loadPage({ edit: withBasket(1), limits }); await wait(); // 300D added; next is the tripod
  p.save();
  p = loadPage({ edit: withBasket(2), limits }); await wait(); // tripod added; next is the Arri slot
  check(/ctl11_bookBtn$/.test(p.postbacks[0] || ''), 'ranks Kit #3 first because Kit #1 is due back too early');
  {
    const q = p.get('queue');
    check(q && q.items[2].fits[0].kind === 'ok' && q.items[0].fits[0].kind === 'hours', 'remembers which units fit the times');
  }

  console.log('Connect2 rejects the times: reasons and suggestions');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Catio: { category: 'Media Arts Equipment', slots: [{ options: [{ id: '1', name: 'Canon C100 Mark ii A3-A6' }] }] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Catio', open: true });
  storage['c2presets.run'] = JSON.stringify({ preset: 'Catio', b: 0, stage: 'time', problem: '', notes: [],
    bookings: [{ startDate: '2026-10-26', startTime: '09:00', endDate: '2026-10-28', endTime: '17:00', days: 3 }] });
  p = loadPage({ page: 'clash' }); await wait();
  const problem = p.get('run').problem;
  check(p.get('run').stage === 'handoff' && p.postbacks.length === 0, 'stops instead of pressing anything');
  check(problem.includes('Canon C100 Mark ii A3-A6: outside cage hours'), 'explains cage-hours clashes by item');
  check(problem.includes('Canon EF 24-105mm f/4L IS USM Lens: booked by someone else during that time'), 'explains booking clashes by item, including ones Connect2 hides behind "Show more"');
  const sugButtons = [...p.root.querySelectorAll('.sugs button')].map((b) => b.textContent);
  check(sugButtons.length === 6 && sugButtons[0] === 'Mon 10/26 9:00 AM → Wed 10/28 4:30 PM' && sugButtons[4] === 'Mon 11/2 2:30 PM → Thu 11/5 12:30 PM',
    'shows Connect2\'s 6 suggested times as buttons');
  check(p.root.querySelector('.run').textContent.includes('Pick one of Connect2\'s suggested times'), 'tells you to pick a suggestion (not "Terms & Conditions")');
  p.button('Mon 10/26 9:00 AM → Wed 10/28 2:00 PM').click();
  check(/suggestions_ctl04_suggestionLink$/.test(p.postbacks[0] || ''), 'clicking a suggestion clicks Connect2\'s own suggestion link');
  const after = p.get('run');
  check(after.stage === 'time' && after.bookings[0].endTime === '14:00' && after.bookings[0].endDate === '2026-10-28', 'and the run now expects those times');
  p.save();
  p = loadPage({ page: 'time', edit: both(timeValues('10/26/2026', '10/28/2026'), enableNext) }); await wait();
  check(/wizardBannerRight_btnNext$/.test(p.postbacks[0] || '') && p.get('run').stage === 'handoff', 'once Connect2 accepts the suggestion, it presses Next');

  console.log('Catalog and list scan');
  resetStorage();
  p = loadPage();
  const cat = p.get('catalog');
  check(Object.keys(cat).length === 15 && cat[ID.light300d].type === 'LED Light Kits' && cat[ID.dolly].allowed === false,
    'remembers every item on the list page, with its category and whether you can book it');
  p.button('Rescan list (15)').click();
  check(/resourcePager_LinkButtonNext$/.test(p.postbacks[0] || '') && !!p.get('scan'), 'scanning pages forward through the list');
  p.save();
  const lastPage = (h) => h.replace(/<a id="[^"]*resourcePager2?_LinkButtonNext"[^>]*>&gt;<\/a>/g, '');
  p = loadPage({ edit: lastPage }); await wait();
  check(p.status().includes('Scan done: the script now knows 15 items (this list has 161)') && p.get('scan') === null, 'stops on the last page and reports what it saved');
  resetStorage();
  storage['c2presets.scan'] = JSON.stringify({ phase: 'rewind', loads: 0 });
  p = loadPage({ edit: (h) => h.replace('<li class="disabled"><span>&lt;</span></li>', '<li><a id="x_resourcePager_LinkButtonPrevious" href="#">&lt;</a></li>') }); await wait();
  check(p.postbacks[0] === 'x_resourcePager_LinkButtonPrevious', 'starting mid-list, it goes back to page 1 first');

  console.log('Replacements in Check ranges');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [{ options: [{ id: ID.light300d, name: 'Aputure 300D Light with Fresnel 2x Lens CC3' }] }] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true, showDays: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  p = loadPage({ booked: [ID.light300d] });
  p.button('Check ranges').click();
  await until(() => p.root.querySelector('.report'), 6000);
  check(report().includes('✗ Aputure 300D Light with Fresnel 2x Lens CC3: not free'), 'flags the booked item');
  p.button('Find a replacement').click();
  await until(() => p.root.querySelector('.cand'), 6000);
  const cands = () => [...p.root.querySelectorAll('.cand > span')].map((x) => x.textContent);
  check(cands().join(' | ') === 'Aputure Amaran Tri-8 LED 3 Light Kit CC1-CC2 · LED Light Kits | Aputure Light Storm 120D LED 2 Light Kit DD4 · LED Light Kits | Aputure LS 600c Pro II RGB LED Monolight DD4 · LED Light Kits',
    'suggests similar lights that are free then, most similar first: ' + cands().join(' | '));
  check(!cands().some((c) => /Arri|Fresnel for/.test(c)), 'skips items from other categories (tungsten kits, accessories)');
  p.button('+ Use as alternate').click();
  check(slotIds(p.get('presets').Kit) === ID.light300d + '|691', 'picking one adds it as an alternate');
  await until(() => p.root.querySelector('.okline'), 6000);
  check(!!p.root.querySelector('.okline'), 'and the range now checks clear');

  console.log('Replacements during a run');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.light300d, name: 'Aputure 300D Light with Fresnel 2x Lens CC3' }] },
    { options: [{ id: ID.tripod, name: '3 Pod V4AH Tripod Y4-Y5' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true, showDays: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  const snapshot = { ...storage };
  p = loadPage({ booked: [ID.light300d] });
  p.button('Book 1 booking').click();
  await until(() => (p.get('run') || {}).stage === 'gate', 6000);
  p.button('Find a replacement').click();
  await until(() => p.root.querySelector('.run .cand'), 6000);
  p.root.querySelector('.run .cand button').click(); // "Use" the first suggestion
  await until(() => p.postbacks.length, 6000);
  check(/ctl05_bookBtn$/.test(p.postbacks[0] || ''), '"Use" adds the replacement (Amaran Tri-8) instead of the booked light');
  check(slotIds(p.get('presets').Kit).startsWith(ID.light300d + '|691'), 'and keeps it as an alternate for next time');

  storage = { ...snapshot };
  p = loadPage({ booked: [ID.light300d] });
  p.button('Book 1 booking').click();
  await until(() => (p.get('run') || {}).stage === 'gate', 6000);
  p.button('Leave it out').click();
  await until(() => p.postbacks.length, 6000);
  check(/ctl01_bookBtn$/.test(p.postbacks[0] || ''), '"Leave it out" skips it and adds the rest');
  check(/Left out: Aputure 300D/.test((p.get('queue') || {}).note || ''), 'and the summary will say what was left out');

  console.log('Replacements after a rejected time');
  resetStorage();
  storage['c2presets.catalog'] = JSON.stringify({
    5000: { name: 'Canon EF 24-105mm f/4L IS USM Lens', type: 'Cameras and Accessories', allowed: true, category: 'Media Arts Equipment' },
    6001: { name: 'Canon EF 24-70mm f/2.8L II USM Lens', type: 'Cameras and Accessories', allowed: true, category: 'Media Arts Equipment' },
    6002: { name: 'Tamron 24-70mm f/2.8 Di VC Lens N2', type: 'Cameras and Accessories', allowed: true, category: 'Media Arts Equipment' },
    6003: { name: 'Canon C100 Mark ii A3-A6', type: 'Cameras and Accessories', allowed: true, category: 'Media Arts Equipment' },
    6004: { name: 'Zoom H6 Recorder R3', type: 'Recorders', allowed: true, category: 'Media Arts Equipment' },
  });
  storage['c2presets.presets'] = JSON.stringify({ Catio: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: '5000', name: 'Canon EF 24-105mm f/4L IS USM Lens' }] },
    { options: [{ id: '6003', name: 'Canon C100 Mark ii A3-A6' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Catio', open: true });
  storage['c2presets.run'] = JSON.stringify({ preset: 'Catio', b: 0, stage: 'time', problem: '', notes: [],
    bookings: [{ startDate: '2026-10-26', startTime: '09:00', endDate: '2026-10-28', endTime: '16:30', days: 3 }] });
  p = loadPage({ page: 'clash' }); await wait();
  const runText = () => p.root.querySelector('.run').textContent;
  check(runText().includes('Replace Canon EF 24-105mm f/4L IS USM Lens?') && !runText().includes('Replace Canon C100'),
    'offers replacements only for items someone else has booked (not cage-hours clashes)');
  p.button('Find a replacement').click();
  await until(() => p.root.querySelector('.run .cand'), 6000);
  check(cands().join(' | ') === 'Canon EF 24-70mm f/2.8L II USM Lens · Cameras and Accessories | Tamron 24-70mm f/2.8 Di VC Lens N2 · Cameras and Accessories',
    'suggests similar lenses, closest first, not other gear: ' + cands().join(' | '));
  p.button('+ Use as alternate').click();
  check(slotIds(p.get('presets').Catio) === '5000|6001,6003', 'adds the lens as an alternate');
  check(p.status().includes('press Back, empty your basket, then press Redo booking 1'), 'and says how to use it for this booking');
  check(p.postbacks.length === 0, 'without clicking anything on the page');

  console.log('Saved pages with a leftover panel');
  p = loadPage({ page: 'time', edit: (h) => h.replace('</form>', '</form><div id="c2presets-host"></div>') });
  check(p.w.document.querySelectorAll('#c2presets-host').length === 1 && !!p.root, 'replaces a stale panel container instead of adding a second one');

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exitCode = failures ? 1 : 0;
})();
