// Offline tests: load the userscript into a saved Connect2 "Select resource" page
// and simulate the page reloads Connect2 does on every postback.
// Run with: npm test
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FIXTURES = {
  resource: fs.readFileSync(path.join(__dirname, 'fixtures/select-resource.html'), 'utf8'),
  time: fs.readFileSync(path.join(__dirname, 'fixtures/select-time.html'), 'utf8'),
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

// Fake Connect2 availability endpoint: `booked` ids come back as errors.
function fakeFetch(booked, calls) {
  return async (url) => {
    const params = new URLSearchParams(String(url).split('?')[1]);
    calls.push(Object.fromEntries(params));
    const id = params.get('resourceId');
    const isBooked = booked.includes(id);
    return {
      ok: true,
      json: async () => (isBooked
        ? { TypeName: 'error', Title: 'Not available', Text: 'Booked 10/20 – 10/22', List: [] }
        : { TypeName: 'success', Title: 'Available', Text: '', List: [] }),
    };
  };
}

/**
 * Load the page once. `edit` can change the HTML first (e.g. basket count or dates).
 * Clicks on Connect2's own submit buttons are recorded and blocked instead of posting back.
 */
function loadPage({ page = 'resource', edit, prompts = [], booked = [] } = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|submit/i.test(e.message)) console.log('  jsdom:', e.message); });
  const html = FIXTURES[page];
  const dom = new JSDOM(edit ? edit(html) : html, { url: URL, virtualConsole: vc, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.prompt = () => prompts.shift() || null;
  w.confirm = () => true;
  w.alert = (m) => console.log('  alert:', m);
  const fetches = [];
  w.fetch = fakeFetch(booked, fetches);
  const postbacks = [];
  w.document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches && t.matches('input[type=submit], input[type=button], .fuzzySearch button')) { postbacks.push(t.id || 'search'); e.preventDefault(); }
  }, true);
  w.eval(SCRIPT);
  const root = w.document.getElementById('c2presets-host').shadowRoot;
  return {
    w, root, postbacks, fetches,
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

  console.log('Shoot days → bookings');
  resetStorage();
  const days = [
    { date: '2030-10-25', start: '09:00', end: '17:00' }, // Fri
    { date: '2030-10-26', start: '09:00', end: '17:00' }, // Sat
    { date: '2030-10-27', start: '09:00', end: '17:00' }, // Sun
    { date: '2030-10-28', start: '09:00', end: '17:00' }, // Mon (would make 4 days)
    { date: '2030-10-30', start: '18:00', end: '08:00' }, // Wed night shoot, back Thu morning
  ];
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Softbank 1x650w 2x150w Three Light Kit #1 DD4' }, { id: ID.arri3, name: 'Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true, showDays: true });
  storage['c2presets.schedule'] = JSON.stringify({ days, merge: true });
  p = loadPage();
  const listed = () => [...p.root.querySelectorAll('ol.bookings > li')].map((li) => li.textContent);
  check(listed().join(' | ') === 'Fri 10/25 9:00 AM → Sun 10/27 5:00 PM (3 shoot days) | Mon 10/28 9:00 AM → 5:00 PM | Wed 10/30 6:00 PM → Thu 10/31 8:00 AM',
    'merges Fri–Sun, keeps Mon separate (3-day max), and treats an earlier return time as next day');
  p.root.querySelector('label.muted input[type=checkbox]').click();
  check(listed().length === 5, 'turning merge off gives one booking per day');
  p.root.querySelector('label.muted input[type=checkbox]').click();
  check(!!p.button('Book 3 bookings'), 'offers to book 3 bookings');
  p.save();
  storage['c2presets.schedule'] = JSON.stringify({ days: [{ date: '2020-01-06', start: '09:00', end: '17:00' }], merge: true });
  p = loadPage();
  check(p.root.textContent.includes('⚠ starts in the past'), 'warns about a booking in the past');

  console.log('Booking run: booking 1');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Softbank 1x650w 2x150w Three Light Kit #1 DD4' }, { id: ID.arri3, name: 'Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true, showDays: true });
  storage['c2presets.schedule'] = JSON.stringify({ days, merge: true });
  p = loadPage({ booked: [ID.arri1] });
  p.button('Book 3 bookings').click();
  await until(() => p.postbacks.length);
  check(p.fetches.length && p.fetches.every((f) => f.start === '10/25/2030' && f.end === '10/27/2030'), 'checks availability for booking 1\'s own dates');
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

  console.log('Saved pages with a leftover panel');
  p = loadPage({ page: 'time', edit: (h) => h.replace('</form>', '</form><div id="c2presets-host"></div>') });
  check(p.w.document.querySelectorAll('#c2presets-host').length === 1 && !!p.root, 'replaces a stale panel container instead of adding a second one');

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exitCode = failures ? 1 : 0;
})();
