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
  basket: fs.readFileSync(path.join(__dirname, 'fixtures/select-resource-basket.html'), 'utf8'), // 3 items in the basket (search results page)
};
const ACCOUNT = fs.readFileSync(path.join(__dirname, 'fixtures/account.html'), 'utf8'); // My Account, page 1 of 2 of bookings
const SCRIPT = fs.readFileSync(path.join(__dirname, '../src/better-checkout.user.js'), 'utf8');
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
function fakeFetch(booked, limits, calls, account, accountCalls) {
  return async (url, init) => {
    if (String(url).startsWith('/account')) { // My Account pages: `account` maps path → HTML
      accountCalls.push({ url: String(url), headers: (init && init.headers) || {}, credentials: init && init.credentials });
      const html = account && account[String(url)];
      return html ? { ok: true, status: 200, text: async () => html } : { ok: false, status: 404, text: async () => '' };
    }
    const params = new URLSearchParams(String(url).split('?')[1]);
    calls.push(Object.fromEntries(params));
    const id = params.get('resourceId');
    if (booked.includes(id)) {
      return { ok: true, json: async () => ({ Type: 1, TypeName: 'error', Title: 'Not available', Text: 'Booked 10/20 – 10/22', List: [] }) };
    }
    const lim = limits[id] || {};
    const start = params.get('start'), end = params.get('end');
    if (lim.partial && !(start === lim.partial[0] && end === lim.partial[2])) { // asked for more than the free part
      // [startMdy, startTime, endMdy, endTime], e.g. ['11/06/2030', '8:00 AM', '11/07/2030', '12:00 PM']
      const [ps, pst, pe, pet] = lim.partial;
      const short = (mdyText) => longDate(mdyText).replace(/^(\w{3})\w*, (\d+) (\w+) \d+$/, '$1, $2 $3');
      return { ok: true, json: async () => ({ Type: 2, TypeName: 'warning', Title: 'Limited availability',
        Text: `A shorter booking is available from ${short(ps)} (${pst}) - ${short(pe)} (${pet})`,
        List: ['Collect from: ' + pst, longDate(ps), 'Return by: ' + pet, longDate(pe)] }) };
    }
    // Defaults are wide on purpose: only tests that set `limits` run into time limits.
    const collectAt = lim.partial ? lim.partial[1] : lim.collect, returnBy = lim.partial ? lim.partial[3] : lim.ret; // asked for exactly the free part
    const list = start ? ['Collect from: ' + (collectAt || '7:00 AM'), longDate(start), 'Return by: ' + (returnBy || '11:00 PM'), longDate(end)] : [];
    return { ok: true, json: async () => ({ Type: 3, TypeName: 'success', Title: 'Available', Text: '', List: list }) };
  };
}

/**
 * Load the page once. `edit` can change the HTML first (e.g. basket count or dates).
 * Clicks on Connect2's own submit buttons are recorded and blocked instead of posting back.
 */
function loadPage({ page = 'resource', edit, prompts = [], booked = [], limits = {}, url = URL, confirmAnswers = [], version, account } = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/navigation|submit/i.test(e.message)) console.log('  jsdom:', e.message); });
  const html = FIXTURES[page];
  const dom = new JSDOM(edit ? edit(html) : html, { url, virtualConsole: vc, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  const prompted = [];
  w.prompt = (m, d) => { prompted.push([m, d]); return prompts.shift() || null; };
  const confirms = [];
  w.confirm = (m) => { confirms.push(m); return confirmAnswers.length ? confirmAnswers.shift() : true; };
  w.alert = (m) => console.log('  alert:', m);
  const fetches = [];
  const accountFetches = [];
  w.fetch = fakeFetch(booked, limits, fetches, account, accountFetches);
  if (version) w.GM_info = { script: { version } }; // what Tampermonkey provides
  const postbacks = [];
  w.document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.matches && t.matches('input[type=submit], input[type=button], .fuzzySearch button, a[id*="suggestionLink"], a[id*="resourcePager"]')) { postbacks.push(t.id || 'search'); e.preventDefault(); }
  }, true);
  w.eval(SCRIPT);
  const root = w.document.getElementById('c2presets-host').shadowRoot;
  return {
    w, root, postbacks, fetches, confirms, prompted, accountFetches,
    field: (name) => w.document.querySelector(`input[id$="editResourceBookingsTime_datetime_${name}_textbox"]`).value,
    button: (label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label),
    // A collapsible section's header, by its title ("Dates", "Preset", "More")
    card: (title) => [...root.querySelectorAll('.card-h')].find((b) => b.querySelector('.card-t').textContent === title),
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
// The text "Copy problem report" produces (jsdom has no clipboard, so it goes to the prompt fallback).
function problemReportOf(p) {
  if (!p.button('Copy problem report')) p.card('Share and Help').click();
  p.button('Copy problem report').click();
  return (p.prompted[p.prompted.length - 1] || [])[1] || '';
}
const slotIds = (preset) => preset.slots.map((s) => s.options.map((o) => o.id).join('|')).join(',');

(async () => {
  console.log('Picking items into a preset');
  resetStorage();
  let p = loadPage({ prompts: ['A-cam package'] });
  check(!!p.root.querySelector('.panel'), 'panel renders');
  p.button('New preset').click();
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
  [...p.root.querySelectorAll('li.slot')][arriSlot].querySelector('button[title^="Add backups"]').click();
  check(p.toggle(ID.arri3).textContent === '+ Backup', 'alternate mode relabels list buttons to "+ Backup"');
  p.toggle(ID.arri3).click();
  p.toggle(ID.arri4).click();
  check(slotIds(p.get('presets')['A-cam package']) === '900,989,493|581|583', 'alternates join the chosen slot in order');
  check(p.toggle(ID.arri3).textContent === '✓ Backup', 'alternates are marked in the list');
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
  p.button('Add to basket').click();
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
  check(/No dates were picked/.test(s1), 'summary explains alternates weren\'t date-checked');
  check(p.get('queue') === null && p.postbacks.length === 0, 'queue is cleared and nothing else is clicked');

  console.log('Connect2\'s own Availability box');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Softbank 1x650w 2x150w Three Light Kit #1 DD4' }, { id: ID.arri3, name: 'Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true });
  p = loadPage({ edit: withDates, booked: [ID.arri1] });
  const c2box = () => p.w.document.querySelector('[id$="availabilitySearch_availabilitySetup"]');
  const note = () => p.w.document.querySelector('.c2p-availnote');
  check(c2box().style.display === 'none' && c2box().nextElementSibling === note(),
    'its date-only box is hidden, with the helper\'s box in its place');
  check(JSON.stringify(p.get('schedule').ranges) === JSON.stringify([{ startDate: '2026-10-20', startTime: '09:00', endDate: '2026-10-22', endTime: '17:00' }]) && p.get('ui').activeRange === 0,
    'dates already set there are carried over and selected');
  check(p.status().includes('Better Checkout is using the dates from Connect2\'s Availability box: Tue 10/20 9 AM → Thu 10/22 5 PM'), 'and it says so');
  check(note().textContent.includes('Showing what\'s available Tue 10/20 9 AM → Thu 10/22 5 PM') && !!note().querySelector('.c2p-changedates'), 'the new box shows the dates with "Change dates"');
  check(p.w.document.body.classList.contains('c2p-own-avail'), 'and Connect2\'s own markers on the list are hidden, so they can\'t contradict the helper');
  p.button('Add to basket only').click();
  await until(() => p.postbacks.length);
  check(/ctl11_bookBtn$/.test(p.postbacks[0] || ''), 'adding uses those dates: Kit #1 is booked, so it picks Kit #3');
  p.save();
  p = loadPage({ edit: both(withDates, withBasket(1)), booked: [ID.arri1] }); await wait();
  const s2 = p.status();
  check(/Added 1 of 1/.test(s2) && /used Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4 instead of .*Kit #1/.test(s2), 'summary reports the swap');
  check(!/No dates were picked/.test(s2), 'no missing-dates note when dates were set');
  p.root.querySelectorAll('.range')[0].querySelector('.x').click();
  p.save();
  p = loadPage({ edit: withDates });
  check(p.get('schedule').ranges.length === 0, 'they\'re carried over only once: delete them and they stay deleted');
  note().querySelector('.c2p-changedates').click();
  check(p.get('schedule').ranges.length === 1 && p.get('ui').editRange === 0, '"Pick your dates" in that box adds dates in the panel');

  console.log('Available for only part of your dates');
  resetStorage();
  // Tue 11/5/2030 9 AM → Thu 11/7 4:30 PM. The fog machine is free only Wed 11/6 8 AM → Thu 11/7 12 PM;
  // the tripod can't be collected until 10 AM Tue.
  const partLimits = { [ID.fog]: { partial: ['11/06/2030', '8:00 AM', '11/07/2030', '12:00 PM'] }, [ID.tripod]: { collect: '10:00 AM' } };
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.fog, name: 'Antari Z-Stream 1000W Fog Machine B1' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-11-05', startTime: '09:00', endDate: '2030-11-07', endTime: '16:30' }] });
  p = loadPage({ limits: partLimits });
  await until(() => p.w.document.querySelector('.c2p-avail') && !p.w.document.querySelector('.c2p-avail-pending') && !p.root.querySelector('.badge.pending'), 8000);
  const itemLi = (id) => p.w.document.querySelector(`.resource-availability[data-id="${id}"]`).closest('li');
  const fogBadge = itemLi(ID.fog).querySelector('.c2p-avail').textContent;
  check(fogBadge.startsWith('⚠ Available for only part of your dates') && fogBadge.includes('Available Wed 11/6 8 AM → Thu 11/7 12 PM') && !/shorter booking|collect from/i.test(fogBadge),
    'on the list: says once, plainly, when it is free (' + fogBadge + ')');
  check(!!itemLi(ID.fog).querySelector('.c2p-freepart button') && itemLi(ID.fog).querySelector('.c2p-freepart button').textContent === 'Use these dates', 'with "Use these dates"');
  check(itemLi(ID.tripod).querySelector('.c2p-avail').textContent.includes('Available Tue 11/5 10 AM → Thu 11/7 4:30 PM'), 'items free from a later pickup time get the same offer');
  const fogSlot = p.root.querySelector('li.slot').textContent;
  check(fogSlot.includes('Part of the time') && fogSlot.includes('Available Wed 11/6 8 AM → Thu 11/7 12 PM'), 'and in the preset');
  check(p.root.querySelector('.fit') && p.root.querySelector('.fit').textContent.includes('Everything in your preset is available Wed 11/6 8 AM → Thu 11/7 12 PM.'), 'the whole-list time fix uses it too');
  itemLi(ID.fog).querySelector('.c2p-freepart button').click();
  check(JSON.stringify(p.get('schedule').ranges[0]) === JSON.stringify({ startDate: '2030-11-06', startTime: '08:00', endDate: '2030-11-07', endTime: '12:00' }),
    'pressing it changes your selected dates to those');
  check(p.status().includes('Your dates are now Wed 11/6 8 AM → Thu 11/7 12 PM (they were Tue 11/5 9 AM → Thu 11/7 4:30 PM).') && !!p.button('Undo'), 'and says what changed, with Undo');
  await until(() => itemLi(ID.fog).querySelector('.c2p-avail-ok'), 8000);
  check(itemLi(ID.fog).querySelector('.c2p-avail').textContent === '✓ Available for your dates', 'now it\'s free for your dates');
  p.button('Undo').click();
  check(p.get('schedule').ranges[0].startDate === '2030-11-05' && p.get('schedule').ranges[0].startTime === '09:00' && p.status().includes('Your dates are back to Tue 11/5 9 AM → Thu 11/7 4:30 PM'),
    'Undo puts them back');

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
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges });
  p = loadPage();
  const labels = () => [...p.root.querySelectorAll('.range .pick .rl')].map((b) => b.firstChild.textContent + ', ' + b.querySelector('.len').textContent);
  check(labels().join(' | ') === 'Fri 10/25 9 AM → Sun 10/27 5 PM, 3 days | Mon 10/28 9 AM → 5 PM, 1 day | Wed 10/30 6 PM → Thu 10/31 8 AM, 2 days',
    'each date range is one line with its length');
  check(p.root.querySelectorAll('.range.active').length === 1 && p.root.querySelector('.range.active .dot').textContent === '●', 'the first range is selected');
  check(!!p.button('Book all 3 dates'), 'offers to book all 3');
  check(p.root.querySelectorAll('.range input').length === 0, 'no date fields until you press Edit');
  const rangeEl = (row) => p.root.querySelectorAll('.range')[row];
  rangeEl(1).querySelector('button.link').click(); // Edit
  check(rangeEl(1).querySelectorAll('input[type=date]').length === 2 && p.root.querySelectorAll('.range input').length === 4, 'Edit opens that range\'s pickup and return fields');

  const dateInput = (row, which) => rangeEl(row).querySelectorAll('input[type=date]')[which];
  const setInput = (input, v) => { input.value = v; input.dispatchEvent(new p.w.Event('change')); };
  setInput(dateInput(1, 0), '2030-11-04');
  let saved = p.get('schedule').ranges[1];
  check(saved.startDate === '2030-11-04' && saved.endDate === '2030-11-04', 'moving a pickup date moves its return date too');
  setInput(dateInput(1, 1), '2030-11-08');
  check(rangeEl(1).textContent.includes('⚠ longer than the 3-day maximum'), 'warns when a range is over 3 days');
  setInput(dateInput(1, 1), '2030-11-03');
  check(rangeEl(1).textContent.includes('⚠ return is not after pickup') && p.button('Book all 3 dates').disabled,
    'a return before pickup is flagged and blocks booking');

  p.button('+ Add dates').click();
  saved = p.get('schedule').ranges[3];
  check(saved.startDate === '2030-11-01' && saved.endDate === '2030-11-02' && saved.startTime === '18:00' && saved.endTime === '08:00',
    '+ Add dates starts the day after the last return, with the same length and times');
  check(p.get('ui').activeRange === 3 && p.get('ui').editRange === 3, 'and selects it, open for editing');
  rangeEl(3).querySelector('.x').click();
  check(p.get('schedule').ranges.length === 3 && p.get('ui').activeRange === 2, '× removes it and selects the one before');

  resetStorage();
  storage['c2presets.schedule'] = JSON.stringify({ days: [{ date: '2030-10-25', start: '09:00', end: '17:00' }, { date: '2030-10-30', start: '18:00', end: '08:00' }], merge: true });
  p = loadPage();
  check(JSON.stringify(p.get('schedule').ranges) === JSON.stringify([
    { startDate: '2030-10-25', startTime: '09:00', endDate: '2030-10-25', endTime: '17:00' },
    { startDate: '2030-10-30', startTime: '18:00', endDate: '2030-10-31', endTime: '08:00' },
  ]), 'v0.3 shoot days are converted to ranges');

  resetStorage();
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2020-01-06', startTime: '09:00', endDate: '2020-01-06', endTime: '17:00' }] });
  storage['c2presets.ui'] = JSON.stringify({ open: true });
  storage['c2presets.presets'] = JSON.stringify({ X: { category: '', slots: [{ options: [{ id: '900', name: 'Tripod' }] }] } });
  p = loadPage();
  check(p.root.textContent.includes('⚠ starts in the past'), 'warns about a range in the past');

  console.log('Booking run: booking 1');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Softbank 1x650w 2x150w Three Light Kit #1 DD4' }, { id: ID.arri3, name: 'Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges });
  p = loadPage({ booked: [ID.arri1] });
  p.button('Book all 3 dates').click();
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
  check(/ctl11_bookBtn$/.test(p.postbacks[0] || '') && p.fetches.length === 0,
    'booking 2 uses the results checked before the run (under 5 minutes old) and picks Kit #3 without new requests');
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

  console.log('The preset, checked for the selected dates');
  resetStorage();
  // Mon 10/28/2030 9:00 AM → Wed 10/30/2030 5:00 PM; the 300D is due back 2:00 PM Wed;
  // the tripod can't be collected until 10:00 AM Mon; Arri Kit #1 is due back early but Kit #3 is free.
  const limits = { [ID.light300d]: { ret: '2:00 PM' }, [ID.tripod]: { collect: '10:00 AM' }, [ID.arri1]: { ret: '12:00 PM' }, [ID.arri3]: { ret: '5:30 PM' } };
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.light300d, name: 'Aputure 300D' }] },
    { options: [{ id: ID.tripod, name: '3 Pod Tripod' }] },
    { options: [{ id: ID.arri1, name: 'Arri Kit #1' }, { id: ID.arri3, name: 'Arri Kit #3' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  p = loadPage({ limits });
  await until(() => !p.root.querySelector('li.slot .badge.pending') && p.root.querySelectorAll('li.slot .badge').length === 4, 8000);
  const slotBadgeTexts = () => [...p.root.querySelectorAll('li.slot .badge')].map((b) => b.textContent).join(' | ');
  check(slotBadgeTexts() === 'Return by 2 PM Wed 10/30 | Collect from 10 AM Mon 10/28 | Return by 12 PM Wed 10/30 | Available',
    'checks the preset by itself and badges each unit for the selected times: ' + slotBadgeTexts());
  const slotEls = () => [...p.root.querySelectorAll('li.slot')];
  check(slotEls()[0].textContent.includes('Find something similar') && slotEls()[1].textContent.includes('Find something similar') && !slotEls()[2].textContent.includes('Find something similar'),
    'items with nothing that fits offer a replacement; a slot is fine when an alternate fits');
  const fitBtn = () => [...p.root.querySelectorAll('button')].find((b) => b.textContent === 'Use those times');
  check(fitBtn() && fitBtn().parentElement.textContent.startsWith('Everything in your preset is available Mon 10/28 10 AM → Wed 10/30 2 PM.'), 'offers the narrower times that would fit everything');
  fitBtn().click();
  const fixed = p.get('schedule').ranges[0];
  check(fixed.startTime === '10:00' && fixed.endTime === '14:00' && fixed.endDate === '2030-10-30', 'one click changes the dates to those times');
  await until(() => !p.root.querySelector('li.slot .badge.pending') && !fitBtn() && !p.root.textContent.includes('Find something similar'), 8000);
  check(!fitBtn() && !p.root.textContent.includes('Find something similar'), 'and the preset now fits');
  p.save();

  console.log('Starting a run warns about problems first');
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  p = loadPage({ limits });
  p.button('Book these dates').click();
  await until(() => (p.get('run') || {}).stage === 'gate', 6000);
  const startMsg = p.confirms.find((m) => m.startsWith('Better Checkout: book')) || '';
  check(/⚠ Aputure 300D: return by 2 PM/.test(startMsg) && /probably reject/.test(startMsg), 'the start confirmation lists the problems');
  const gateText = p.root.querySelector('.run').textContent;
  check(p.postbacks.length === 0 && gateText.includes('Nothing has been added yet') && gateText.includes('✗ Aputure 300D: return by 2 PM') && gateText.includes('✗ 3 Pod Tripod'),
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
  check(!p.button('Rescan equipment list'), 'scan and export live under More, closed by default');
  p.card('Share and Help').click();
  check(p.root.textContent.includes('Knows 15 items for suggesting similar gear.'), 'More says how many items the script knows');
  p.button('Rescan equipment list').click();
  check(/resourcePager_LinkButtonNext$/.test(p.postbacks[0] || '') && !!p.get('scan'), 'scanning pages forward through the list');
  p.save();
  const lastPage = (h) => h.replace(/<a id="[^"]*resourcePager2?_LinkButtonNext"[^>]*>&gt;<\/a>/g, '');
  p = loadPage({ edit: lastPage }); await wait();
  check(p.status().includes('Scan done: Better Checkout now knows 15 items (this list has 161)') && p.get('scan') === null, 'stops on the last page and reports what it saved');
  resetStorage();
  storage['c2presets.scan'] = JSON.stringify({ phase: 'rewind', loads: 0 });
  p = loadPage({ edit: (h) => h.replace('<li class="disabled"><span>&lt;</span></li>', '<li><a id="x_resourcePager_LinkButtonPrevious" href="#">&lt;</a></li>') }); await wait();
  check(p.postbacks[0] === 'x_resourcePager_LinkButtonPrevious', 'starting mid-list, it goes back to page 1 first');

  console.log('Replacements for the selected dates');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [{ options: [{ id: ID.light300d, name: 'Aputure 300D Light with Fresnel 2x Lens CC3' }] }] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  p = loadPage({ booked: [ID.light300d] });
  await until(() => p.button('Find something similar'), 8000);
  check(p.root.querySelector('li.slot .badge').textContent === 'Not available', 'the booked item is marked in the preset');
  p.button('Find something similar').click();
  await until(() => p.root.querySelector('.cand'), 6000);
  const cands = () => [...p.root.querySelectorAll('.cand > span')].map((x) => x.textContent);
  check(cands().join(' | ') === 'Aputure Amaran Tri-8 LED 3 Light Kit CC1-CC2 · LED Light Kits | Aputure Light Storm 120D LED 2 Light Kit DD4 · LED Light Kits | Aputure LS 600c Pro II RGB LED Monolight DD4 · LED Light Kits',
    'suggests similar lights that are available then, most similar first: ' + cands().join(' | '));
  check(!cands().some((c) => /Arri|Fresnel for/.test(c)), 'skips items from other categories (tungsten kits, accessories)');
  p.button('Add as backup').click();
  check(slotIds(p.get('presets').Kit) === ID.light300d + '|691', 'picking one adds it as an alternate');
  await until(() => p.root.querySelectorAll('li.slot .badge').length === 2 && !p.root.querySelector('li.slot .badge.pending'), 6000);
  check([...p.root.querySelectorAll('li.slot .badge')].map((b) => b.textContent).join() === 'Not available,Available' && !p.button('Find something similar'),
    'and the slot is covered for those dates');

  console.log('Replacements during a run');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.light300d, name: 'Aputure 300D Light with Fresnel 2x Lens CC3' }] },
    { options: [{ id: ID.tripod, name: '3 Pod V4AH Tripod Y4-Y5' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  const snapshot = { ...storage };
  p = loadPage({ booked: [ID.light300d] });
  p.button('Book these dates').click();
  await until(() => (p.get('run') || {}).stage === 'gate', 6000);
  p.button('Find something similar').click();
  await until(() => p.root.querySelector('.run .cand'), 6000);
  p.root.querySelector('.run .cand button').click(); // "Use" the first suggestion
  await until(() => p.postbacks.length, 6000);
  check(/ctl05_bookBtn$/.test(p.postbacks[0] || ''), '"Use" adds the replacement (Amaran Tri-8) instead of the booked light');
  check(slotIds(p.get('presets').Kit).startsWith(ID.light300d + '|691'), 'and keeps it as an alternate for next time');

  storage = { ...snapshot };
  p = loadPage({ booked: [ID.light300d] });
  p.button('Book these dates').click();
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
  p.button('Find something similar').click();
  await until(() => p.root.querySelector('.run .cand'), 6000);
  check(cands().join(' | ') === 'Canon EF 24-70mm f/2.8L II USM Lens · Cameras and Accessories | Tamron 24-70mm f/2.8 Di VC Lens N2 · Cameras and Accessories',
    'suggests similar lenses, closest first, not other gear: ' + cands().join(' | '));
  p.button('Add as backup').click();
  check(slotIds(p.get('presets').Catio) === '5000|6001,6003', 'adds the lens as an alternate');
  check(p.status().includes('press Back, then Redo booking 1 and empty the basket first'), 'and says how to use it for this booking');
  check(p.postbacks.length === 0, 'without clicking anything on the page');

  console.log('Badges next to every item for the selected dates');
  resetStorage();
  const shootLimits = { [ID.tripod]: { collect: '10:00 AM' } };
  p = loadPage({ booked: [ID.light300d], limits: shootLimits });
  check(p.root.textContent.includes('Add when you\'ll pick up and return the gear') && p.root.textContent.includes('Save the gear you check out every time'), 'with nothing set up, each section says what it\'s for');
  p.button('+ Add dates').click();
  setInput(dateInput(0, 0), '2030-10-28');
  check(JSON.stringify(p.get('schedule').ranges) === JSON.stringify([{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-28', endTime: '16:30' }]),
    'new dates start as a 9:00 AM to 4:30 PM day, and the return date follows the pickup date');
  const badgeOf = (id) => { // the badge itself, without the line under it
    const b = p.w.document.querySelector(`.resource-availability[data-id="${id}"]`).closest('li').querySelector('.c2p-avail > span');
    return b ? b.textContent : null;
  };
  await until(() => p.w.document.querySelector('.c2p-avail') && !p.w.document.querySelector('.c2p-avail-pending'), 8000);
  check(p.fetches.length === 14 && p.fetches.every((f) => f.start === '10/28/2030' && f.end === '10/28/2030'), 'checks the 14 bookable items on the page for those dates');
  check(badgeOf(ID.fog) === '✓ Available for your dates', 'a free item says so');
  check(badgeOf(ID.light300d).startsWith('✗ Not available for your dates'), 'a booked item says so');
  check(badgeOf(ID.tripod) === '⚠ Collect from 10 AM Mon 10/28', 'an item free but not by the pickup time says when');
  check(badgeOf(ID.dolly) === null, 'items you can\'t book get no badge');
  await until(() => p.root.querySelector('.range.active .extras'), 4000);
  check(p.root.querySelector('.range.active .extras').textContent.includes('On this page: 12 available, 1 partly available, 1 not available.'), 'the selected range sums up the page');
  p.save();

  p = loadPage({ booked: [ID.light300d], limits: shootLimits });
  await until(() => p.w.document.querySelector('.c2p-avail') && !p.w.document.querySelector('.c2p-avail-pending'), 8000);
  check(badgeOf(ID.fog) === '✓ Available for your dates', 'the dates carry over to the next page or reload');
  setInput(dateInput(0, 1), '2030-10-30');
  await until(() => p.fetches.some((f) => f.end === '10/30/2030') && !p.w.document.querySelector('.c2p-avail-pending'), 8000);
  check(p.fetches.filter((f) => f.end === '10/30/2030').length === 14, 'changing the return date re-checks the page');
  rangeEl(0).querySelectorAll('input[type=time]')[1].value = '08:00';
  rangeEl(0).querySelectorAll('input[type=time]')[1].dispatchEvent(new p.w.Event('change'));
  setInput(dateInput(0, 1), '2030-10-28');
  check(rangeEl(0).textContent.includes('⚠ return is not after pickup') && !p.w.document.querySelector('.c2p-avail'),
    'a return before pickup is flagged and badges are hidden');
  rangeEl(0).querySelectorAll('input[type=time]')[1].value = '16:30';
  rangeEl(0).querySelectorAll('input[type=time]')[1].dispatchEvent(new p.w.Event('change'));
  p.button('Done').click();
  p.button('+ Add dates').click(); // Tue 10/29
  await until(() => p.fetches.some((f) => f.start === '10/29/2030') && !p.w.document.querySelector('.c2p-avail-pending'), 8000);
  check(p.get('ui').activeRange === 1 && p.fetches.filter((f) => f.start === '10/29/2030').length === 14, 'new dates are selected and the page is checked for them');
  const before = p.fetches.length;
  rangeEl(0).querySelector('.pick').click();
  check(p.get('ui').activeRange === 0 && badgeOf(ID.fog) === '✓ Available for your dates' && p.fetches.length === before, 'selecting other dates switches the badges, from what was already checked');
  rangeEl(1).querySelector('.x').click();
  rangeEl(0).querySelector('.x').click();
  check(p.get('schedule').ranges.length === 0 && !p.w.document.querySelector('.c2p-avail'), 'removing the dates removes the badges');

  console.log('v0.7 check dates move into the dates list');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Kit #1' }, { id: ID.arri3, name: 'Arri Kit #3' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-11-04', startTime: '09:00', endDate: '2030-11-04', endTime: '16:30' }] });
  storage['c2presets.shoot'] = JSON.stringify({ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-29', endTime: '16:30' });
  p = loadPage({ booked: [ID.arri1] });
  check(p.get('schedule').ranges.length === 2 && p.get('schedule').ranges[1].startDate === '2030-10-28' && p.get('ui').activeRange === 1 && p.get('shoot') === null,
    'old check dates become a date range, and stay selected');
  await until(() => p.root.querySelectorAll('li.slot .badge').length === 2 && !p.root.querySelector('li.slot .badge.pending'), 8000);
  const slotBadges = [...p.root.querySelectorAll('li.slot .badge')].map((b) => b.textContent).join();
  check(slotBadges === 'Not available,Available', 'the preset shows each unit\'s availability for the selected dates: ' + slotBadges);
  p.button('Add to basket only').click();
  await until(() => p.postbacks.length, 6000);
  check(/ctl11_bookBtn$/.test(p.postbacks[0] || ''), '"Add to basket only" picks Kit #3 for those dates');

  console.log('Collapsible sections and a quieter preset');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ 'Catio Doc': { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Kit #1' }, { id: ID.arri3, name: 'Arri Kit #3' }] }, { options: [{ id: ID.tripod, name: '3 Pod Tripod' }] },
  ] }, Audio: { category: 'Media Arts Equipment', slots: [] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Catio Doc', open: true });
  p = loadPage();
  check(!p.root.querySelector('li.slot .tools') && !p.root.querySelector('li.slot .x') && !p.button('Rename'), 'outside Edit, the preset shows just the items: no +alt, ×, Rename or Delete');
  p.button('Edit').click();
  check(p.root.querySelectorAll('li.slot .tools').length === 2 && !!p.button('Rename') && !!p.button('Delete preset') && p.w.document.querySelectorAll('.c2p-toggle').length === 15,
    'Edit shows the controls and the "+ Preset" buttons on the list');
  p.button('Done').click();
  check(p.w.document.querySelectorAll('.c2p-toggle').length === 0, 'Done hides them again');
  check(!p.card('Dates').querySelector('.card-m') && !p.card('Equipment Presets').querySelector('.card-m'), 'open sections don\'t repeat themselves in their headers');
  p.card('Equipment Presets').click();
  check(!p.root.querySelector('li.slot') && p.card('Equipment Presets').textContent.includes('Catio Doc, 2 items') && p.get('ui').showPresets === false,
    'the Preset section collapses to one line with the preset\'s name');
  p.save();
  p = loadPage();
  check(!p.root.querySelector('li.slot') && p.card('Equipment Presets').getAttribute('aria-expanded') === 'false', 'and stays collapsed on the next page');
  p.card('Equipment Presets').click();
  p.card('Dates').click();
  check(!!p.root.querySelector('li.slot') && !p.button('+ Add dates') && p.card('Dates').textContent.includes('None yet'), 'the Dates section collapses too');
  const sel = p.root.querySelector('select[aria-label="Equipment preset"]');
  check([...sel.options].map((o) => o.textContent).join() === 'Catio Doc (2),Audio (0),New preset…', 'the preset picker lists presets and "+ New preset…"');
  p.w.prompt = () => 'Interview audio';
  sel.value = sel.options[2].value;
  sel.dispatchEvent(new p.w.Event('change'));
  check(p.get('ui').current === 'Interview audio' && p.get('ui').editing === true, '"New preset…" makes a preset and opens it for editing');

  console.log('Preset button layout');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ X: { category: 'Media Arts Equipment', slots: [] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'X', open: true, editing: true });
  p = loadPage();
  const tb = p.toggle(ID.tripod);
  const area = tb.closest('.resource-book');
  check(!!area && tb.parentElement.className === 'c2p-under' && tb.parentElement.previousElementSibling === area.querySelector('input[type=submit]'),
    'the preset button sits on its own line under Connect2\'s Add button');
  check(tb.style.boxSizing === 'border-box' && tb.style.maxWidth === '100%' && tb.parentElement.style.flex.startsWith('0 0 100%') && area.style.flexWrap === 'wrap',
    'and is sized to fit inside the item instead of overflowing it');
  check(p.w.document.querySelectorAll('.c2p-under').length === 15, 'one per item, with no duplicates after re-rendering');
  p.button('Done').click();
  check(p.w.document.querySelectorAll('.c2p-under').length === 0, 'and they go away when editing is done');

  console.log('Saved results instead of re-checking');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Kit #1' }, { id: ID.arri3, name: 'Arri Kit #3' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-29', endTime: '16:30' }] });
  p = loadPage({ booked: [ID.arri1] });
  await until(() => p.w.document.querySelector('.c2p-avail') && !p.w.document.querySelector('.c2p-avail-pending') && !p.root.querySelector('.badge.pending'), 8000);
  check(p.fetches.length === 14, 'first visit: checks the preset and the page once each (14 items; the preset\'s kits are on this page)');
  await until(() => p.root.textContent.includes('Checked just now'), 4000);
  check(p.root.textContent.includes('Checked just now. Refresh'), 'says how old the results are, with Refresh');
  p.save();
  check(Object.keys(JSON.parse(storage['c2presets.avail'])).length === 14, 'results are saved in the browser');

  p = loadPage({ booked: [ID.arri1] });
  await wait(300);
  check(p.fetches.length === 0 && badgeOf(ID.fog) === '✓ Available for your dates' && p.root.querySelector('li.slot .badge').textContent === 'Not available',
    'next page or reload: badges come from saved results, with no requests');
  rangeEl(0).querySelector('button.link').click(); // Edit
  const t2 = rangeEl(0).querySelectorAll('input[type=time]')[1];
  t2.value = '12:00'; t2.dispatchEvent(new p.w.Event('change'));
  await wait(300);
  check(p.fetches.length === 0, 'changing only the times needs no new requests (Connect2 answers per day)');
  p.save();

  const aged = (min) => {
    const a = JSON.parse(storage['c2presets.avail']);
    for (const k of Object.keys(a)) a[k].at = Date.now() - min * 60000;
    storage['c2presets.avail'] = JSON.stringify(a);
  };
  aged(12);
  p = loadPage({ booked: [ID.arri1] });
  await wait(300);
  check(p.fetches.length === 0 && p.root.textContent.includes('Checked 12 min ago'), 'results under 30 minutes old are still used, and their age shown');
  p.button('Add to basket only').click();
  await until(() => p.postbacks.length, 6000);
  check(p.fetches.length === 2 && /ctl11_bookBtn$/.test(p.postbacks[0] || ''), 'adding re-checks the preset\'s units when results are over 5 minutes old');
  p.w.localStorage.removeItem('c2presets.queue');
  p.save();

  aged(31);
  p = loadPage({ booked: [ID.arri1] });
  await until(() => p.fetches.length === 14 && !p.w.document.querySelector('.c2p-avail-pending'), 8000);
  check(p.fetches.length === 14, 'after 30 minutes, everything is checked again');
  p.save();

  p = loadPage({ booked: [ID.arri1] });
  await wait(300);
  p.button('Refresh').click();
  await until(() => p.fetches.length === 14 && !p.w.document.querySelector('.c2p-avail-pending'), 8000);
  check(p.fetches.length === 14, 'Refresh checks the selected dates again right away');

  resetStorage();
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-29', endTime: '16:30' }] });
  p = loadPage();
  p.w.fetch = async () => { throw new Error('offline'); };
  await until(() => p.w.document.querySelector('.c2p-avail-unknown') && !p.w.document.querySelector('.c2p-avail-pending'), 8000);
  check((badgeOf(ID.fog) || '').startsWith('? Couldn\'t check'), 'a failed check says so');
  p.save();
  check(Object.keys(JSON.parse(storage['c2presets.avail'] || '{}')).length === 0, 'and failures are never saved');

  console.log('Problem report');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [{ options: [{ id: ID.light300d, name: 'Aputure 300D Light with Fresnel 2x Lens CC3' }] }] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true });
  p = loadPage();
  p.button('Add to basket').click();
  await until(() => p.postbacks.length);
  p.save();
  p = loadPage({ edit: withBasket(1) }); await wait();
  p.save();
  p = loadPage({ edit: withBasket(1) });
  p.card('Share and Help').click();
  p.button('Copy problem report').click();
  const reportText = (p.prompted[p.prompted.length - 1] || [])[1] || '';
  check(reportText.startsWith('Better Checkout problem report') && reportText.includes('Page: /wizard/multiresource.aspx (list) · Step 1 of 6'),
    'the report says which page you were on');
  check(reportText.includes('list items 15, add buttons 14 on / 1 off') && reportText.includes('basket 1') && reportText.includes('next page yes'),
    'what the script found on it');
  check(/\[list\] add: pressed Add for Aputure 300D.*basket was 0/.test(reportText) && /\[list\] added: Aputure 300D.*\(basket 0 → 1\)/.test(reportText) && reportText.includes('done adding: added 1 of 1'),
    'and the steps it took');
  check(!reportText.includes('Test Student') && !reportText.includes('REDACTED') && !/VIEWSTATE|RequestVerification/.test(reportText), 'never your name or the page\'s session fields');
  check(p.status().includes('Problem report copied'), 'and tells you what to do with it');

  console.log('Only show gear that\'s free');
  resetStorage();
  p = loadPage({ booked: [ID.light300d], limits: shootLimits });
  const bar = () => p.w.document.querySelector('.c2p-filterbar');
  check(!!bar() && bar().textContent.includes('See only the gear that\'s available when you need it') && !!bar().querySelector('.c2p-pickdates'), 'without dates, a bar above the list offers to pick them');
  check(bar().nextElementSibling === p.w.document.querySelector('ul.resource-list'), 'it sits right above Connect2\'s list');
  bar().querySelector('.c2p-pickdates').click();
  check(p.get('schedule').ranges.length === 1 && p.get('ui').editRange === 0 && !!p.root.querySelector('.range input[type=date]'), '"Pick your dates" adds dates in the panel, open for editing');
  setInput(dateInput(0, 0), '2030-10-28');
  await until(() => p.w.document.querySelector('.c2p-avail') && !p.w.document.querySelector('.c2p-avail-pending'), 8000);
  const sw = () => bar().querySelector('[role=switch]');
  check(!!sw() && sw().getAttribute('aria-checked') === 'false' && bar().textContent.includes('Only show gear that\'s available (off)') && bar().textContent.includes('Mon 10/28 9 AM → 4:30 PM'),
    'with dates, it\'s a labelled on/off switch showing them, off by default');
  const visible = () => [...p.w.document.querySelectorAll('li.resource-list-item')].filter((li) => li.style.display !== 'none');
  const isVisible = (id) => p.w.document.querySelector(`.resource-availability[data-id="${id}"]`).closest('li').style.display !== 'none';
  check(visible().length === 15, 'off: everything shows');
  sw().click();
  check(visible().length === 12 && !isVisible(ID.light300d) && !isVisible(ID.tripod) && !isVisible(ID.dolly) && isVisible(ID.fog),
    'on: hides what\'s booked, what doesn\'t fit your times, and what you can\'t book');
  check(bar().textContent.includes('Hiding 3 items on this page that aren\'t available then.') && sw().getAttribute('aria-checked') === 'true', 'and says how many it hid');
  p.save();
  p = loadPage({ booked: [ID.light300d], limits: shootLimits }); await wait(300);
  check(visible().length === 12 && sw().getAttribute('aria-checked') === 'true', 'it stays on as you change pages');
  sw().click();
  check(visible().length === 15 && p.get('ui').onlyFree === false, 'turning it off shows everything again');
  const allIds = [...FIXTURES.resource.matchAll(/class="resource-availability" data-id="(\d+)"/g)].map((m) => m[1]);
  resetStorage();
  storage['c2presets.ui'] = JSON.stringify({ open: true, onlyFree: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-28', endTime: '16:30' }] });
  p = loadPage({ booked: allIds });
  await until(() => p.w.document.querySelector('.c2p-filterbar') && !p.w.document.querySelector('.c2p-avail-pending') && p.w.document.querySelector('.c2p-avail'), 8000);
  check(visible().length === 0 && bar().textContent.includes('Nothing on this page is available then. Try the next page.'), 'when nothing on the page is free, it says to try the next page');
  storage['c2presets.run'] = JSON.stringify({ preset: 'X', bookings: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-28', endTime: '16:30', days: 1 }], b: 0, stage: 'handoff', problem: '', notes: [] });
  p = loadPage({ booked: allIds }); await wait();
  check(!bar() && visible().length === 15, 'during a booking run it steps aside and hides nothing');

  console.log('Share links');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ 'Catio Doc': { category: 'Media Arts Equipment', slots: [
    { options: [{ id: ID.arri1, name: 'Arri Softbank 1x650w 2x150w Three Light Kit #1 DD4' }, { id: ID.arri3, name: 'Arri Softbank 1x650W 2x150W 3 Light Kit #3 DD4' }] },
    { options: [{ id: ID.tripod, name: '3 Pod V4AH Tripod Y4-Y5' }] },
    { options: [{ id: ID.fog, name: 'Antari Z-Stream 1000W Fog Machine B1', note: 'Cannot be used in Campus Buildings without prior permission!' }] },
  ] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Catio Doc', open: true });
  p = loadPage();
  p.card('Share and Help').click();
  p.button('Share "Catio Doc"').click();
  const link = (p.prompted[p.prompted.length - 1] || [])[1] || '';
  check(link.startsWith('https://mtsu.getconnect2.com/wizard/multiresource.aspx#c2p=') && link.length < 700, 'the link points at the equipment list (' + link.length + ' characters)');
  check(p.status().includes('Anyone with Better Checkout who opens it while signed in'), 'and says who it works for');

  resetStorage(); // a classmate
  p = loadPage({ url: link });
  check((p.confirms[0] || '').includes('add the equipment preset "Catio Doc" (3 items) that was shared with you?'), 'opening it asks before adding anything');
  const got = p.get('presets')['Catio Doc'];
  check(got && slotIds(got) === ID.arri1 + '|' + ID.arri3 + ',' + ID.tripod + ',' + ID.fog, 'the preset arrives with its items and backups');
  check(got.slots[2].options[0].note.includes('prior permission'), 'item notes are filled in from the equipment list');
  check(p.w.location.hash === '' && p.get('ui').current === 'Catio Doc' && p.status().includes('Added the preset "Catio Doc" (3 items).'),
    'it\'s selected, and the link part is cleared so a reload doesn\'t add it again');
  p.save();
  p = loadPage({ url: link, confirmAnswers: [true, false] });
  check(Object.keys(p.get('presets')).join() === 'Catio Doc,Catio Doc (shared)', 'if you already have one by that name and say no to replacing, it\'s added as "(shared)"');
  p = loadPage({ url: URL + '#c2p=bm90LXZhbGlk' });
  check(p.status().includes('That share link is broken') && p.confirms.length === 0, 'a broken link says so and adds nothing');

  console.log('Runs end when Connect2 shows Complete');
  const completePage = (h) => h.replace(/Select time/g, 'Complete').replace('Step 2 of 6', 'Step 6 of 6').replace(/datetime_startDate_textbox/g, 'gone_textbox');
  const twoRun = (b) => JSON.stringify({ preset: 'Lights', b, stage: 'handoff', problem: '', notes: [], done: [],
    listUrl: URL, bookings: [
      { startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-28', endTime: '16:30', days: 1 },
      { startDate: '2030-10-30', startTime: '09:00', endDate: '2030-10-30', endTime: '16:30', days: 1 }] });
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Lights: { category: 'Media Arts Equipment', slots: [{ options: [{ id: ID.arri1, name: 'Arri Kit #1' }] }] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Lights', open: true });
  storage['c2presets.run'] = twoRun(0);
  p = loadPage({ page: 'time', edit: completePage }); await wait();
  check(p.get('run').stage === 'done' && p.get('run').done[0] === true, 'the Complete page marks the booking done');
  const runBox = () => p.root.querySelector('.run').textContent;
  check(runBox().includes('✓ Booking 1 of 2 is complete.') && runBox().includes('Next: Wed 10/30') && !!p.button('Start booking 2 of 2') && !!p.button('End run'),
    'and offers the next booking in one click');
  p.save();
  p = loadPage({ page: 'time', edit: completePage }); await wait();
  check(p.get('run').b === 0 && p.get('run').stage === 'done', 'reloading the Complete page doesn\'t count it twice');
  p.button('Start booking 2 of 2').click();
  check(p.get('run').autoStart === true, 'the button heads back to the equipment list');
  p.save();
  p = loadPage();
  await until(() => p.postbacks.length, 6000);
  check(p.get('run').b === 1 && p.get('run').autoStart === false && /ctl13_bookBtn$/.test(p.postbacks[0] || ''), 'where booking 2 starts by itself');
  storage['c2presets.run'] = twoRun(1);
  delete storage['c2presets.queue'];
  p = loadPage({ page: 'time', edit: completePage }); await wait();
  check(p.get('run') === null && p.status().includes('✓ All 2 bookings of "Lights" are complete. The run has ended.'), 'after the last booking, the run ends by itself');
  check(!p.root.querySelector('.run'), 'no End run button to press');

  console.log('Basket section');
  const withoutRow = (ctl) => (h) => h.replace(new RegExp('<tr id="[^"]*shoppingCart_resourceRpt_' + ctl + '_itemRow">[\\s\\S]*?</tr>'), '');
  const basketText = () => (p.card('Basket') ? p.card('Basket').parentElement.textContent : '');
  resetStorage();
  p = loadPage({ page: 'basket' }); await wait();
  check(basketText().includes('Canon 6D with 24-105mm L Series lens C1') && basketText().includes('Revo Shoulder Support Rig R2') && basketText().includes('Sony MDR-7506 Studio Headphones I6'),
    'lists what\'s in Connect2\'s basket');
  resetStorage();
  p = loadPage(); await wait();
  check(!p.card('Basket'), 'no Basket section when the basket is empty');
  p = loadPage({ page: 'basket' }); await wait();
  p.root.querySelector('button[aria-label="Remove Revo Shoulder Support Rig R2 from your basket"]').click();
  check(p.postbacks.length === 1 && /shoppingCart_resourceRpt_ctl02_bookBtn$/.test(p.postbacks[0]), '× presses Connect2\'s own Remove for that item: ' + p.postbacks.join());
  p.save();
  p = loadPage({ page: 'basket', edit: withoutRow('ctl02') }); await wait();
  check(p.status().includes('Removed Revo Shoulder Support Rig R2 from your basket.') && !p.get('empty') && p.postbacks.length === 0, 'and says so once the page comes back without it');

  resetStorage();
  p = loadPage({ page: 'basket' }); await wait();
  p.button('Empty basket').click();
  check(/ctl01_bookBtn$/.test(p.postbacks[0] || '') && p.get('empty').ids.join() === '609,404,333', 'Empty basket removes the first item');
  check(!p.button('Empty basket') && !p.root.querySelector('.blist .x'), 'and hides the basket buttons while it works');
  p.save();
  p = loadPage({ page: 'basket', edit: withoutRow('ctl01') }); await wait();
  check(/ctl02_bookBtn$/.test(p.postbacks[0] || ''), 'then the next one after the page reloads');
  p.save();
  p = loadPage({ page: 'basket', edit: both(withoutRow('ctl01'), withoutRow('ctl02'), withoutRow('ctl03')) }); await wait();
  check(p.status().includes('Your basket is empty.') && !p.get('empty') && p.postbacks.length === 0, 'until the basket is empty');

  resetStorage();
  p = loadPage({ page: 'basket' }); await wait();
  p.button('Empty basket').click();
  for (let i = 0; i < 7; i++) { p.save(); p = loadPage({ page: 'basket' }); await wait(); } // Remove never works
  check(p.status().includes('Couldn\'t remove') && !p.get('empty'), 'gives up and says so if Remove doesn\'t work');
  check(p.get('log').filter((e) => e.ev === 'basket' && /pressed Remove/.test(e.d)).length === 6, 'after a few tries');

  console.log('Booking with gear already in the basket');
  const kitWithTripod = () => {
    resetStorage();
    storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [{ options: [{ id: ID.tripod, name: 'Manfrotto 502AH Video Head and Tripod #1' }] }] } });
    storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true });
    storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-28', startTime: '09:00', endDate: '2030-10-30', endTime: '17:00' }] });
  };
  kitWithTripod();
  p = loadPage({ page: 'basket' }); await wait();
  p.button('Book these dates').click();
  await until(() => p.get('run') && p.get('run').stage === 'leftovers');
  const leftoverBox = () => (p.root.querySelector('.run') || { textContent: '' }).textContent;
  check(p.get('run').stage === 'leftovers' && leftoverBox().includes('Your basket already has 3 items') && leftoverBox().includes('Revo Shoulder Support Rig R2'),
    'the run stops first and lists what\'s already in the basket');
  check(p.postbacks.length === 0 && !p.get('queue'), 'without adding anything');
  p.button('Empty the basket first').click();
  check(/shoppingCart_resourceRpt_ctl01_bookBtn$/.test(p.postbacks[0] || '') && p.get('empty').then === 'run', '"Empty the basket first" starts removing');
  p.save();
  p = loadPage(); await wait(100); // Connect2 comes back with an empty basket
  await until(() => p.postbacks.length);
  check(p.get('run').stage === 'basket' && /resourceList_resourceRpt_ctl01_bookBtn$/.test(p.postbacks[0] || ''), 'then the run carries on and adds the preset: ' + p.postbacks.join());
  kitWithTripod();
  p = loadPage({ page: 'basket' }); await wait();
  p.button('Book these dates').click();
  await until(() => p.get('run') && p.get('run').stage === 'leftovers');
  p.button('Book them too').click();
  await until(() => p.postbacks.length);
  check(p.get('run').stage === 'basket' && p.postbacks[0] === 'search' && !p.get('empty'), '"Book them too" keeps them and adds the preset');

  console.log('Your bookings, from My Account');
  const row = (ref, id, start, end, item, out) => `<tr><td data-label="Ref no"><a href="/bookings/view.aspx?id=${id}">${ref}</a></td>` +
    `<td data-label="Start date">${start}</td><td data-label="End date">${end}</td><td data-label="Resource">${item}</td><td data-label="Checked out">${out}</td></tr>`;
  const page2 = '<div id="resourceBookingDiv"><div class="pagination-area"><ul class="pagination"><li><a href="/account/resourcebookinglist/1">1</a></li><li class="active"><span>2</span></li></ul></div>' +
    '<table class="table stacked-table"><tbody>' +
    row('Con000105', 105, '11/2/2030 9:00 AM', '11/4/2030 4:30 PM', 'K-Tek Shotgun Mic Boompole Kit AA1, BB', '') +
    row('Con000106', 106, '10/1/2020 9:00 AM', '10/2/2020 4:30 PM', 'Zoom H6 Recorder Z2', '10/1/2020 9:12 AM') + // still out: overdue
    row('Con000107', 107, '9/1/2020 9:00 AM', '9/2/2020 4:30 PM', 'Old Light Kit', '') + // over and never collected
    '</tbody></table></div>';
  const account = { '/account': ACCOUNT, '/account/resourcebookinglist/2': page2 };
  resetStorage();
  p = loadPage({ account }); await wait(100);
  check(p.accountFetches.map((f) => f.url).join() === '/account,/account/resourcebookinglist/2', 'reads My Account and its second page of bookings');
  check(p.accountFetches.every((f) => f.credentials === 'same-origin') && p.accountFetches[1].headers['X-Requested-With'] === 'XMLHttpRequest', 'the way Connect2\'s own page does');
  const bk = p.get('bookings').list;
  check(bk.map((k) => k.ref + ':' + k.items.length).join() === 'Con000106:1,Con000101:6,Con000105:3', 'groups rows into bookings across pages, oldest first, without finished ones: ' + bk.map((k) => k.ref + ':' + k.items.length).join());
  const kept = JSON.stringify(p.get('bookings')) + JSON.stringify(p.get('log'));
  check(!kept.includes('Test Student') && !kept.includes('student@example.edu'), 'never keeps your name or email');
  check(p.card('Your bookings') && p.card('Your bookings').textContent.includes('⚠ Overdue'), 'the closed section says what needs doing first');
  p.card('Your bookings').click();
  const bkText = () => p.card('Your bookings').parentElement.textContent;
  check(bkText().includes('⚠ Overdue: due back Fri 10/2 4:30 PM') && bkText().includes('Tue 10/29 4:30 PM → Wed 10/30 4:30 PMCon000101'),
    'each booking says when to pick up or return: ' + bkText().slice(0, 200));
  check(bkText().includes('Canon C100 Mark ii A3-A6 · Sony UWP-D11 Wireless Lav Package I3') && !bkText().includes('Old Light Kit'), 'with its gear');
  const ref = [...p.root.querySelectorAll('a.bk-ref')].find((a) => a.textContent === 'Con000101');
  check(ref && ref.getAttribute('href') === '/bookings/view.aspx?id=101' && ref.target === '_blank', 'and a link to it in Connect2');
  p.save();
  p = loadPage({ account }); await wait(50);
  check(p.accountFetches.length === 0, 're-reads My Account only every 10 minutes');
  storage['c2presets.bookings'] = JSON.stringify(Object.assign(p.get('bookings'), { list: p.get('bookings').list.filter((k) => k.ref !== 'Con000106') }));
  storage['c2presets.ui'] = JSON.stringify({ open: true, showBookings: false });
  p = loadPage({ account }); await wait(50);
  check(p.card('Your bookings').textContent.includes('Pick up Tue 10/29 4:30 PM'), 'otherwise, when to pick up the next one');

  storage['c2presets.presets'] = JSON.stringify({ Shoot: { category: 'Media Arts Equipment', slots: [{ options: [{ id: '609', name: 'Canon 6D with 24-105mm L Series lens C1' }] }, { options: [{ id: ID.tripod, name: 'Tripod' }] }] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Shoot', open: true });
  storage['c2presets.schedule'] = JSON.stringify({ ranges: [{ startDate: '2030-10-30', startTime: '09:00', endDate: '2030-10-30', endTime: '12:00' }] });
  p = loadPage({ account, booked: ['609'] }); await wait(100);
  await until(() => p.root.textContent.includes('Booked by you'));
  check(p.card('Dates').parentElement.textContent.includes('You already have a booking then: Con000101, Tue 10/29 4:30 PM → Wed 10/30 4:30 PM (6 items).'), 'dates that overlap your booking say so');
  const camRow = [...p.root.querySelectorAll('.opt')].find((o) => o.textContent.includes('Canon 6D'));
  check(camRow && camRow.querySelector('.badge.bad').textContent === 'Booked by you' && camRow.textContent.includes('In your booking Con000101'), 'gear you\'ve booked then says "Booked by you", not just "Not available"');
  p.card('Your bookings').click();
  check(p.root.querySelector('.bk.hit') && p.root.querySelector('.bk.hit').textContent.includes('Overlaps your selected dates.'), 'the overlapping booking is marked');

  resetStorage();
  p = loadPage(); await wait(50);
  check(!p.card('Your bookings') && p.get('bookings').error === 'HTTP 404', 'if My Account can\'t be read, nothing is shown');
  check(p.accountFetches.length === 1, 'and it isn\'t retried right away');
  p.save();
  p = loadPage(); await wait(50);
  check(p.accountFetches.length === 0 && problemReportOf(p).includes('My Account: HTTP 404'), 'the problem report says why');

  console.log('Export and import presets as a file');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ 'A-cam': { category: 'Media Arts Equipment', slots: [{ options: [{ id: ID.tripod, name: 'Tripod', note: '' }] }] } });
  p = loadPage(); await wait();
  const blobs = [], downloads = [];
  p.w.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:test'; };
  p.w.URL.revokeObjectURL = () => {};
  p.w.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, download: this.download }); };
  p.card('Share and Help').click();
  p.button('Export presets').click();
  check(downloads.length === 1 && /^Better Checkout presets \d{4}-\d{2}-\d{2}\.txt$/.test(downloads[0].download) && downloads[0].href === 'blob:test', 'Export presets downloads a .txt file: ' + JSON.stringify(downloads));
  const fileText = await new Promise((res) => { const r = new p.w.FileReader(); r.onload = () => res(r.result); r.readAsText(blobs[0]); });
  check(fileText.startsWith('Better Checkout presets, saved') && fileText.includes('Import presets'), 'the file says what it is and how to use it');
  check(JSON.stringify(JSON.parse(fileText.slice(fileText.indexOf('{')))) === JSON.stringify(p.get('presets')), 'and holds all your presets');
  check(p.status().includes('Downloads folder'), 'the panel says where it went');
  check(!p.w.document.querySelector('a[download]'), 'without leaving anything on the page');

  resetStorage();
  p = loadPage(); await wait();
  const pickers = [], alerts = [];
  p.w.alert = (m) => alerts.push(m);
  p.w.HTMLInputElement.prototype.click = function () { if (this.type === 'file') pickers.push(this); };
  const pickFile = async (text) => {
    if (!p.button('Import presets')) p.card('Share and Help').click();
    p.button('Import presets').click();
    const input = pickers[pickers.length - 1];
    Object.defineProperty(input, 'files', { value: [new p.w.File([text], 'presets.txt', { type: 'text/plain' })] });
    input.dispatchEvent(new p.w.Event('change'));
    await wait(50);
  };
  await pickFile(fileText);
  check(pickers.length === 1 && pickers[0].accept.includes('.txt'), 'Import presets opens a file picker for .txt files');
  check(p.get('presets')['A-cam'] && p.get('presets')['A-cam'].slots[0].options[0].id === ID.tripod && p.status().includes('Imported 1 preset.'), 'and adds the presets in the file');
  await pickFile(JSON.stringify({ Old: { category: '', slots: [{ options: [{ id: '1', name: 'X' }] }] } }));
  check(p.get('presets').Old, 'files from older exports (only the presets) work too');
  await pickFile('hello there');
  check(alerts.length === 1 && /isn't from Export presets/.test(alerts[0]) && Object.keys(p.get('presets')).length === 2, 'any other file is refused with a plain message');

  console.log('What\'s new after an update');
  resetStorage();
  p = loadPage({ version: '1.1.0' });
  check(!p.root.querySelector('.news') && p.get('seenVersion') === '1.1.0', 'a first install shows no update note');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: 'Media Arts Equipment', slots: [{ options: [{ id: ID.tripod, name: 'Tripod' }] }] } });
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: true });
  p = loadPage({ version: '1.1.0' });
  const newsText = () => (p.root.querySelector('.news') || { textContent: '' }).textContent;
  check(newsText().startsWith('What\'s new in Better Checkout 1.1.0') && newsText().includes('a short note like this one') && newsText().includes('called equipment presets again'),
    'someone updating from before the note sees what changed since 1.0');
  check(p.root.querySelector('.body').firstElementChild.className === 'news', 'at the top of the panel');
  p.button('Got it').click();
  check(!p.root.querySelector('.news') && p.get('seenVersion') === '1.1.0', '"Got it" puts it away');
  p.save();
  p = loadPage({ version: '1.1.0' });
  check(!p.root.querySelector('.news'), 'and it stays away');
  storage['c2presets.seenVersion'] = JSON.stringify('1.0.1');
  storage['c2presets.ui'] = JSON.stringify({ current: 'Kit', open: false });
  p = loadPage({ version: '1.1.0' });
  check(p.root.querySelector('header .newtag') && p.root.querySelector('header .newtag').textContent === 'New', 'a minimized panel shows a "New" tag');
  p.root.querySelector('header').click();
  check(newsText().includes('a short note like this one') && !newsText().includes('equipment presets again'), 'only changes newer than the last version seen');
  resetStorage();
  storage['c2presets.presets'] = JSON.stringify({ Kit: { category: '', slots: [] } });
  p = loadPage();
  check(!p.root.querySelector('.news'), 'nothing when not running as an installed release');
  p = loadPage({ version: '1.1.0' });
  p.card('Share and Help').click();
  const guide = p.root.querySelector('.foot a');
  check(guide && guide.textContent === 'Install guide' && guide.getAttribute('href') === 'https://nathanmontalvogm.github.io/Better-Equipment-Reservation/', 'Share and Help links the install guide');

  console.log('Saved pages with a leftover panel');
  p = loadPage({ page: 'time', edit: (h) => h.replace('</form>', '</form><div id="c2presets-host"></div>') });
  check(p.w.document.querySelectorAll('#c2presets-host').length === 1 && !!p.root, 'replaces a stale panel container instead of adding a second one');

  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  process.exitCode = failures ? 1 : 0;
})();
