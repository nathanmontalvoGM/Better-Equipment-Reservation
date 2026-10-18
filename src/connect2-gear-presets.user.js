// ==UserScript==
// @name         Connect2 Gear Presets (MTSU)
// @namespace    nathan.c2presets
// @version      0.3.0
// @description  Gear presets for MTSU's Connect2 checkout: add a whole preset to your basket in one click, check its availability, and book it across several shoot days.
// @homepageURL  https://github.com/nathanmontalvoGM/Better-Equipment-Reservation
// @downloadURL  https://raw.githubusercontent.com/nathanmontalvoGM/Better-Equipment-Reservation/main/src/connect2-gear-presets.user.js
// @updateURL    https://raw.githubusercontent.com/nathanmontalvoGM/Better-Equipment-Reservation/main/src/connect2-gear-presets.user.js
// @match        https://mtsu.getconnect2.com/wizard/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * How it works
 * - Presets are stored in this browser only (localStorage on mtsu.getconnect2.com).
 * - A preset is a list of slots ("an Arri 3-light kit"). Each slot can hold
 *   interchangeable units (Kit #1, Kit #3, ...), tried in order.
 * - "Add to basket" clicks Connect2's own Add buttons for you, one item per page load,
 *   searching for an item when it isn't on the current page. When you've set dates
 *   (Availability box → Go), each slot uses its first unit that's free for those dates.
 *   It never submits a booking: you still pick dates and press "Create booking" yourself.
 * - Items your account can't book can't be added to presets, and item notes such as
 *   "needs permission" are shown in the preset.
 * - Shoot days: list the days you need a preset, and the script makes one booking per day
 *   (back-to-back days merged up to Connect2's 3-day maximum). For each booking it adds the
 *   gear, fills in the times, presses Next, and stops at Terms & Conditions. You finish
 *   Terms, Special Requests, Verify and Complete yourself, then start the next booking.
 */

(function () {
  'use strict';

  // ---------- storage ----------
  const NS = 'c2presets.';
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(NS + k); } catch (e) { /* ignore */ } },
  };

  // Item notes worth warning about ("Cannot be used in Campus Buildings without prior permission!")
  const WARN_RE = /\b(cannot|can't|must|only|permission|training|trained|required|requires|do not|don't|not allowed|approval)\b|!/i;

  // ---------- data model ----------
  // presets: { [name]: { category, slots: [ { options: [ { id, name, note } ] } ] } }
  const normOpt = (o) => ({ id: String(o.id), name: String(o.name || o.id), note: String(o.note || '') });

  function normalizePreset(p) {
    if (!p || typeof p !== 'object') return null;
    let slots = [];
    if (Array.isArray(p.slots)) {
      slots = p.slots
        .map((s) => ({ options: (s && Array.isArray(s.options) ? s.options : []).filter((o) => o && o.id != null).map(normOpt) }))
        .filter((s) => s.options.length);
    } else if (Array.isArray(p.items)) { // v0.1 format: one unit per entry
      slots = p.items.filter((x) => x && x.id != null).map((x) => ({ options: [normOpt(x)] }));
    }
    return { category: String(p.category || ''), slots };
  }

  function normalizeAll(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw || {})) { const n = normalizePreset(v); if (n) out[k] = n; }
    return out;
  }

  let presets = normalizeAll(store.get('presets', {}));
  store.set('presets', presets); // persists the v0.1 → v0.2 migration
  let ui = Object.assign({ open: true, current: '', editing: false, altFor: null, showDays: false }, store.get('ui', {}));
  if (!presets[ui.current]) { ui.current = Object.keys(presets)[0] || ''; ui.altFor = null; }
  let availability = {}; // `${dates.label}|${id}` -> { label, kind: 'ok'|'limited'|'bad', detail }
  let statusText = store.get('lastStatus', '');

  const savePresets = () => store.set('presets', presets);
  const saveUi = () => store.set('ui', ui);
  const setStatus = (t) => { statusText = t; store.set('lastStatus', t); render(); };

  function findOption(p, id) {
    for (let si = 0; si < p.slots.length; si++) {
      const oi = p.slots[si].options.findIndex((o) => o.id === id);
      if (oi >= 0) return { si, oi };
    }
    return null;
  }

  // ---------- page helpers ----------
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

  const searchBox = () => qs('input[id$="FuzzySearchTxt_textbox"]');
  const searchBtn = () => { const b = searchBox(); return b && b.closest('.fuzzySearch') && b.closest('.fuzzySearch').querySelector('button'); };
  const isSelectPage = () => !!qs('ul.resource-list') && !!searchBox();

  function category() {
    const h = qs('h1[id$="BannerContent_pageTitle"]');
    return h ? h.textContent.split(' - ')[0].trim() : '';
  }

  function basketCount() {
    const a = qs('a[id$="wizardBannerRight_basketLink"]');
    const m = a && a.textContent.match(/\((\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  }

  function pageMessage() {
    const el = qs('[id$="MainWizardContent_pageMessages"]');
    return el ? clean(el.textContent) : '';
  }

  function pageItems() {
    return qsa('li.resource-list-item').map((li) => {
      const av = li.querySelector('.resource-availability[data-id]');
      let id = av ? String(av.getAttribute('data-id')) : null;
      if (!id) {
        const a = li.querySelector('a[href*="resourcedetail.aspx?id="]');
        const m = a && a.getAttribute('href').match(/id=(\d+)/);
        id = m ? m[1] : null;
      }
      const nameEl = li.querySelector('.resource-name');
      const noteEl = li.querySelector('.resource-description');
      const btn = li.querySelector('.resource-book input[type="submit"]');
      const allowed = !!btn && !btn.disabled;
      return {
        li, id, btn, allowed,
        name: nameEl ? clean(nameEl.textContent) : '',
        note: noteEl ? clean(noteEl.textContent) : '',
        reason: allowed ? '' : ((btn && btn.title && btn.title !== 'Disabled' ? btn.title : '') || 'Your account can\'t book this item'),
      };
    }).filter((x) => x.id);
  }

  // Dates Connect2 itself uses after you press Go in the Availability box.
  function pageDates() {
    const txt = qsa('script').map((s) => s.textContent).join('\n');
    let m = txt.match(/showMultiDayAvailability\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/);
    if (m) return { kind: 'range', start: m[1], end: m[2], label: m[1] + ' → ' + m[2] };
    m = txt.match(/showSingleDayAvailability\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m) return { kind: 'single', date: m[1], label: m[1] };
    return null;
  }

  const stripHtml = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return clean(d.textContent); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- availability ----------
  const availKey = (d, id) => d.label + '|' + id;
  const availFor = (d, id) => (d ? availability[availKey(d, id)] : undefined);

  async function fetchAvailability(id, d) {
    const key = availKey(d, id);
    if (availability[key]) return availability[key];
    let result;
    try {
      const params = d.kind === 'range' ? { resourceId: id, start: d.start, end: d.end } : { resourceId: id, dateTime: d.date };
      const path = d.kind === 'range' ? '/wizard/freetime/checkdaterangeforresource' : '/wizard/freetime/getnextresourceavailabledate';
      const r = await fetch(path + '?' + new URLSearchParams(params), {
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (d.kind === 'range') {
        result = {
          label: data.Title || data.TypeName || '?',
          kind: data.TypeName === 'error' ? 'bad' : data.TypeName === 'warning' ? 'limited' : 'ok',
          detail: stripHtml(data.Text),
        };
      } else {
        result = {
          label: data.TypeName === 'success' ? 'Available' : data.TypeName === 'error' ? 'Not available' : 'Not allowed',
          kind: data.TypeName === 'success' ? 'ok' : 'bad',
          detail: stripHtml(data.Text),
        };
      }
    } catch (e) {
      result = { label: 'Couldn\'t check', kind: 'unknown', detail: String(e.message || e) };
    }
    availability[key] = result;
    render();
    await sleep(150); // keep requests gentle on Connect2
    return result;
  }

  // Check each slot's units in order, stopping at the first free one.
  async function checkSlots(p, d) {
    for (const slot of p.slots) {
      for (const o of slot.options) {
        const r = await fetchAvailability(o.id, d);
        if (r.kind === 'ok') break;
      }
    }
  }

  const RANK = { ok: 0, limited: 1, unknown: 2, bad: 3 };
  function orderOptions(options, d) {
    if (!d) return options.slice();
    return options
      .map((o, i) => ({ o, i, r: RANK[(availFor(d, o.id) || { kind: 'unknown' }).kind] }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.o);
  }

  async function checkAvailability() {
    const p = presets[ui.current];
    if (!p || !p.slots.length) return setStatus('Pick a preset with items first.');
    const d = pageDates();
    if (!d) return setStatus('Enter Collect and Return dates in Connect2\'s Availability box, press Go, then check again.');
    setStatus('Checking "' + ui.current + '" for ' + d.label + '…');
    await checkSlots(p, d);
    const missing = p.slots.filter((s) => !s.options.some((o) => (availFor(d, o.id) || {}).kind === 'ok'));
    setStatus(missing.length
      ? missing.length + ' of ' + p.slots.length + ' slot(s) have no free unit for ' + d.label + ': ' + missing.map((s) => s.options[0].name).join('; ')
      : 'Every slot in "' + ui.current + '" has a free unit for ' + d.label + '.');
  }

  // ---------- shoot days → bookings ----------
  // schedule: { days: [{ date: 'YYYY-MM-DD', start: 'HH:mm', end: 'HH:mm' }], merge }
  // A return time at or before the pickup time means the gear comes back the next day.
  const MAX_BOOKING_DAYS = 3;   // Connect2 at MTSU: "3 day maximum booking period"
  const MAX_BOOKING_HOURS = 72; // counted conservatively: both limits must hold
  let schedule = Object.assign({ days: [], merge: true }, store.get('schedule', {}));
  const saveSchedule = () => store.set('schedule', schedule);

  const pad = (n) => String(n).padStart(2, '0');
  const ymdToUtc = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const addDays = (ymd, n) => new Date(ymdToUtc(ymd) + n * 864e5).toISOString().slice(0, 10);
  const minutesAt = (ymd, hm) => ymdToUtc(ymd) / 6e4 + Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const mdy = (ymd) => ymd.slice(5, 7) + '/' + ymd.slice(8, 10) + '/' + ymd.slice(0, 4);
  const time12 = (hm) => { const h = Number(hm.slice(0, 2)); return ((h + 11) % 12 + 1) + ':' + hm.slice(3, 5) + ' ' + (h < 12 ? 'AM' : 'PM'); };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const shortDay = (ymd) => WEEKDAYS[new Date(ymdToUtc(ymd)).getUTCDay()] + ' ' + Number(ymd.slice(5, 7)) + '/' + Number(ymd.slice(8, 10));
  const todayYmd = () => { const t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); };
  const validDay = (d) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && /^\d{2}:\d{2}$/.test(d.start) && /^\d{2}:\d{2}$/.test(d.end);

  function computeBookings(days, merge) {
    const sorted = days.filter(validDay).slice().sort((a, b) => minutesAt(a.date, a.start) - minutesAt(b.date, b.start));
    const out = [];
    for (const d of sorted) {
      const endDate = d.end <= d.start ? addDays(d.date, 1) : d.date;
      const prev = out[out.length - 1];
      if (merge && prev && addDays(prev.lastDay, 1) === d.date) {
        const hours = (minutesAt(endDate, d.end) - minutesAt(prev.startDate, prev.startTime)) / 60;
        const calDays = (ymdToUtc(endDate) - ymdToUtc(prev.startDate)) / 864e5 + 1;
        if (hours <= MAX_BOOKING_HOURS && calDays <= MAX_BOOKING_DAYS) {
          Object.assign(prev, { endDate, endTime: d.end, lastDay: d.date, days: prev.days + 1 });
          continue;
        }
      }
      out.push({ startDate: d.date, startTime: d.start, endDate, endTime: d.end, lastDay: d.date, days: 1 });
    }
    const today = todayYmd();
    out.forEach((b, i) => {
      b.warnings = [];
      const prev = out[i - 1];
      if (b.startDate < today) b.warnings.push('starts in the past');
      if (prev && minutesAt(b.startDate, b.startTime) < minutesAt(prev.endDate, prev.endTime)) b.warnings.push('overlaps the booking before it');
      const hours = (minutesAt(b.endDate, b.endTime) - minutesAt(b.startDate, b.startTime)) / 60;
      const calDays = (ymdToUtc(b.endDate) - ymdToUtc(b.startDate)) / 864e5 + 1;
      if (hours > MAX_BOOKING_HOURS || calDays > MAX_BOOKING_DAYS) b.warnings.push('longer than the 3-day maximum');
    });
    return out;
  }

  const bookingLabel = (b) => shortDay(b.startDate) + ' ' + time12(b.startTime) + ' → ' +
    (b.endDate === b.startDate ? '' : shortDay(b.endDate) + ' ') + time12(b.endTime);
  // Same shape pageDates() returns, so availability checks and the queue can use it.
  const bookingDates = (b) => ({ kind: 'range', start: mdy(b.startDate), end: mdy(b.endDate), label: mdy(b.startDate) + ' → ' + mdy(b.endDate) });

  function addDay() {
    const last = schedule.days[schedule.days.length - 1];
    schedule.days.push(validDay(last)
      ? { date: addDays(last.date, 1), start: last.start, end: last.end }
      : { date: addDays(todayYmd(), 1), start: '09:00', end: '17:00' });
    saveSchedule(); render();
  }

  function updateDay(i, field, value) {
    if (!schedule.days[i]) return;
    schedule.days[i][field] = value;
    saveSchedule(); render();
  }

  // ---------- booking run across shoot days (survives page reloads) ----------
  // run: { preset, bookings, b, stage: 'basket'|'create'|'time'|'handoff', problem, notes: [] }
  const getRun = () => store.get('run', null);
  const saveRun = (r) => store.set('run', r);
  const isTimePage = () => !!qs('input[id$="editResourceBookingsTime_datetime_startDate_textbox"]');
  const nextBtn = () => qs('input[id$="wizardBannerRight_btnNext"]');
  const timeField = (name) => qs('input[id$="editResourceBookingsTime_datetime_' + name + '_textbox"]');

  function timeErrors() {
    return qsa('.datetime-error, .validation-summary-errors, .field-validation-error, [id$="pageMessages"]')
      .map((e) => clean(e.textContent)).filter(Boolean).join(' ');
  }

  function startRun() {
    const p = presets[ui.current];
    const bookings = computeBookings(schedule.days, schedule.merge);
    if (!p || !p.slots.length) return setStatus('Pick a preset with items first.');
    if (!bookings.length) return setStatus('Add at least one shoot day first.');
    if (!isSelectPage()) return setStatus('Open Book by Category → ' + (p.category || 'your equipment category') + ' first.');
    if (p.category && category() && p.category !== category()) {
      if (!confirm('This preset was made in "' + p.category + '", but you are in "' + category() + '". Continue anyway?')) return;
    }
    const warned = bookings.filter((b) => b.warnings.length);
    const lines = bookings.map((b, i) => (i + 1) + '. ' + bookingLabel(b) + (b.warnings.length ? '  ⚠ ' + b.warnings.join('; ') : ''));
    if (!confirm('Make ' + bookings.length + ' booking(s) of "' + ui.current + '"?\n\n' + lines.join('\n') +
      (warned.length ? '\n\nSome bookings have warnings; Connect2 may reject them.' : '') +
      '\n\nFor each booking the script adds the gear, fills in the times and stops at Terms & Conditions. You finish each booking yourself.')) return;
    saveRun({
      preset: ui.current,
      bookings: bookings.map(({ startDate, startTime, endDate, endTime, days }) => ({ startDate, startTime, endDate, endTime, days })),
      b: 0, stage: 'basket', problem: '', notes: [],
    });
    beginBooking();
  }

  function beginBooking() {
    const run = getRun();
    if (!run) return;
    if (!isSelectPage()) return setStatus('Open Book by Category → ' + ((presets[run.preset] || {}).category || 'your equipment category') + ' first.');
    const n = basketCount();
    if (n > 0 && !confirm('Your basket already has ' + n + ' item(s). They\'ll be included in booking ' + (run.b + 1) + '. Continue?')) return;
    run.stage = 'basket'; run.problem = ''; run.notes[run.b] = '';
    saveRun(run);
    startQueue(run.preset, { dates: bookingDates(run.bookings[run.b]), run: true });
  }

  function nextBooking(step) {
    const run = getRun();
    if (!run) return;
    run.b = Math.min(run.b + step, run.bookings.length - 1);
    saveRun(run);
    beginBooking();
  }

  function endRun() { store.del('run'); store.del('queue'); setStatus('Run ended. Bookings you completed stay booked.'); }

  function handoff(run, problem) { run.stage = 'handoff'; run.problem = problem || ''; saveRun(run); render(); }

  // Called by the basket queue when a run's gear is in the basket.
  function afterRunBasket(run, good, summary) {
    run.notes[run.b] = summary;
    if (!good) return handoff(run, 'Nothing could be added for this booking.');
    const btn = nextBtn();
    if (!btn || btn.disabled) return handoff(run, 'Couldn\'t press Create booking. Press it yourself, set ' + bookingLabel(run.bookings[run.b]) + ', and finish the booking.');
    run.stage = 'create';
    saveRun(run); render();
    btn.click(); // "Create booking" → Select time
  }

  function setField(name, value) {
    const f = timeField(name);
    if (!f) return;
    f.value = value;
    f.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Runs on every page load while a run is active and no basket queue is working.
  function runTick() {
    const run = getRun();
    if (!run || run.stage === 'handoff' || run.stage === 'basket') return;
    const bk = run.bookings[run.b];
    if (!isTimePage()) {
      return handoff(run, 'Connect2 didn\'t open the Select time step' + (pageMessage() ? ': ' + pageMessage() : '') +
        '. Press Create booking yourself, set ' + bookingLabel(bk) + ', and finish the booking.');
    }
    if (run.stage === 'create') {
      setField('startDate', mdy(bk.startDate)); // Connect2 copies this into the end date…
      setField('startTime', time12(bk.startTime));
      setField('endDate', mdy(bk.endDate));     // …so the end date is set after it
      setField('endTime', time12(bk.endTime));
      run.stage = 'time';
      saveRun(run);
      statusText = 'Booking ' + (run.b + 1) + ' of ' + run.bookings.length + ': setting ' + bookingLabel(bk) + '…';
      render();
      const update = qs('input[id$="editResourceBookingsTime_btnUpdate"]');
      if (!update) return handoff(run, 'Couldn\'t find the Update button. Set ' + bookingLabel(bk) + ' yourself.');
      update.click(); // posts back with the new times
      return;
    }
    // stage 'time': the Update postback has come back
    const errs = timeErrors();
    const next = nextBtn();
    const sd = timeField('startDate'), ed = timeField('endDate');
    const datesStuck = sd && ed && sd.value === mdy(bk.startDate) && ed.value === mdy(bk.endDate);
    if (errs || !datesStuck || !next || next.disabled) {
      return handoff(run, 'Connect2 didn\'t accept ' + bookingLabel(bk) +
        (errs ? ': ' + errs : !datesStuck ? ' (the dates didn\'t stick)' : ' (Next is still disabled; an item may be unavailable or the cage closed then)') +
        '. Adjust the times here, press Update and Next yourself, then finish the booking.');
    }
    handoff(run, '');
    next.click(); // → Terms & Conditions; the rest is up to you
  }

  // ---------- add-to-basket queue (survives page reloads) ----------
  // queue: { preset, items: [{ options, kinds, first, firstKind }], i, opt, phase: 'find'|'searched'|'searched2'|'clicked',
  //          before, loadsKey, loads, skipped: [], results: [{ ok, line }], note }
  const MAX_LOADS_PER_OPTION = 6;
  let starting = false;

  // opts.dates overrides the page's Availability dates; opts.run marks a shoot-day booking run.
  async function startQueue(name, opts = {}) {
    const p = presets[name];
    if (!p || !p.slots.length) return setStatus('That preset is empty.');
    if (!isSelectPage()) return setStatus('Open a "Book by Category" equipment list first.');
    if (!opts.run && p.category && category() && p.category !== category()) {
      if (!confirm('This preset was made in "' + p.category + '", but you are in "' + category() + '". Continue anyway?')) return;
    }
    if (starting) return;
    starting = true;
    try {
      const d = opts.dates || pageDates();
      let note = '';
      if (d) {
        setStatus('Finding free units for ' + d.label + '…');
        await checkSlots(p, d);
      } else if (p.slots.some((s) => s.options.length > 1)) {
        note = 'No dates were set, so first choices were used. To let alternates replace booked units, set Collect/Return and press Go before adding.';
      }
      const items = p.slots.map((s) => {
        const options = orderOptions(s.options, d);
        const kindOf = (o) => (availFor(d, o.id) || { kind: d ? 'unknown' : 'nodates' }).kind;
        return { options, kinds: options.map(kindOf), first: s.options[0], firstKind: kindOf(s.options[0]) };
      });
      store.set('queue', { preset: name, items, i: 0, opt: 0, phase: 'find', before: -1, loadsKey: '', loads: 0, skipped: [], results: [], note, run: !!opts.run });
    } finally {
      starting = false;
    }
    runQueue(true);
  }

  function stopQueue() {
    const q = store.get('queue', null);
    store.del('queue');
    const run = q && q.run ? getRun() : null;
    if (run) handoff(run, 'Adding was stopped. Redo this booking, or finish it yourself.');
    setStatus('Stopped. Anything already added stays in your basket.');
  }

  function nextSlot(q) { q.i += 1; q.opt = 0; q.phase = 'find'; q.loads = 0; q.skipped = []; }

  // Current unit can't be used: try the slot's next unit, or give up on the slot.
  function skipOption(q, reason) {
    const it = q.items[q.i];
    const o = it.options[q.opt];
    q.skipped.push(o.name + ' (' + reason + ')');
    if (q.opt + 1 < it.options.length) {
      q.opt += 1; q.phase = 'find'; q.loads = 0;
    } else {
      q.results.push({ ok: false, line: 'Couldn\'t add ' + it.first.name + ': ' + q.skipped.join('; ') });
      nextSlot(q);
    }
  }

  function continueQueue(q) { store.set('queue', q); setTimeout(() => runQueue(false), 0); }

  function runQueue(fromPageLoad) {
    const q = store.get('queue', null);
    if (!q) return;

    if (!isSelectPage()) {
      setStatus('Paused: this isn\'t the equipment list page. Go back to the category list and press Resume.');
      return;
    }

    if (fromPageLoad && q.i < q.items.length) {
      const key = q.i + ':' + q.opt;
      if (q.loadsKey !== key) { q.loadsKey = key; q.loads = 0; }
      q.loads += 1;
      if (q.loads > MAX_LOADS_PER_OPTION) skipOption(q, 'gave up after several page loads');
    }

    if (q.i >= q.items.length) return finishQueue(q);
    const it = q.items[q.i];
    const o = it.options[q.opt];
    statusText = 'Adding ' + (q.i + 1) + ' of ' + q.items.length + ': ' + o.name + '…';
    render();

    if (q.phase === 'clicked') {
      const now = basketCount();
      const ok = q.before >= 0 && now > q.before;
      if (!ok) {
        q.results.push({ ok: false, line: o.name + ': ' + (pageMessage() || 'basket count didn\'t change (already in basket?)') });
      } else {
        const notes = [];
        if (o.id !== it.first.id) {
          const why = q.skipped.slice();
          if (it.firstKind === 'bad' || it.firstKind === 'limited') why.unshift(it.first.name + ' (not free for your dates)');
          notes.push('used ' + o.name + ' instead of ' + it.first.name + (why.length ? ' — skipped ' + why.join('; ') : ''));
        }
        const kind = it.kinds[q.opt];
        if (kind === 'bad') notes.push(o.name + ' was added but no unit is free for your dates');
        else if (kind === 'limited') notes.push(o.name + ' is only partly available for your dates');
        q.results.push({ ok: true, line: notes.join('. ') });
      }
      nextSlot(q);
      return continueQueue(q);
    }

    const match = pageItems().find((x) => x.id === o.id);
    if (match) {
      if (!match.allowed) { skipOption(q, match.reason); return continueQueue(q); }
      q.before = basketCount();
      q.phase = 'clicked';
      store.set('queue', q);
      match.btn.click(); // Connect2's own button: posts back and reloads the page
      return;
    }

    if (q.phase === 'find') return doSearch(q, o.name, 'searched');
    if (q.phase === 'searched') return doSearch(q, o.name.split(' ').slice(0, 3).join(' '), 'searched2');

    skipOption(q, 'not found by search');
    continueQueue(q);
  }

  function doSearch(q, text, phase) {
    const box = searchBox(), btn = searchBtn();
    if (!box || !btn) { q.phase = 'searched2'; return continueQueue(q); }
    q.phase = phase;
    store.set('queue', q);
    box.value = text;
    btn.click(); // reloads the page with search results
  }

  function finishQueue(q) {
    store.del('queue');
    const good = q.results.filter((r) => r.ok).length;
    const lines = q.results.filter((r) => r.line).map((r) => (r.ok ? '• ' : '✗ ') + r.line);
    let msg = 'Added ' + good + ' of ' + q.results.length + ' from "' + q.preset + '".';
    if (lines.length) msg += '\n' + lines.join('\n');
    if (q.note) msg += '\n' + q.note;
    const box = searchBox();
    if (box) box.value = '';
    const run = q.run ? getRun() : null;
    if (run && run.stage === 'basket') {
      setStatus(msg);
      return afterRunBasket(run, good, msg);
    }
    setStatus(msg + '\nNext: set your dates and press Create booking.');
  }

  // ---------- preset management ----------
  function newPreset() {
    const name = (prompt('Name this preset (e.g. "A-cam package", "Interview audio"):') || '').trim();
    if (!name) return;
    if (presets[name] && !confirm('"' + name + '" already exists. Replace it?')) return;
    presets[name] = { category: category(), slots: [] };
    ui.current = name; ui.editing = true; ui.altFor = null;
    savePresets(); saveUi();
    setStatus('Click "+ Preset" on each item you want in "' + name + '". Use search or the category list to find them.');
  }

  function renamePreset() {
    const old = ui.current;
    if (!old) return;
    const name = (prompt('Rename "' + old + '" to:', old) || '').trim();
    if (!name || name === old) return;
    if (presets[name]) return alert('A preset with that name already exists.');
    presets[name] = presets[old]; delete presets[old];
    ui.current = name; savePresets(); saveUi(); render();
  }

  function deletePreset() {
    if (!ui.current || !confirm('Delete preset "' + ui.current + '"?')) return;
    delete presets[ui.current];
    ui.current = Object.keys(presets)[0] || ''; ui.editing = false; ui.altFor = null;
    savePresets(); saveUi(); render();
  }

  function removeOption(si, oi) {
    const p = presets[ui.current];
    if (!p || !p.slots[si]) return;
    p.slots[si].options.splice(oi, 1);
    if (!p.slots[si].options.length) {
      p.slots.splice(si, 1);
      if (ui.altFor === si) ui.altFor = null;
      else if (ui.altFor != null && ui.altFor > si) ui.altFor -= 1;
    }
    savePresets(); saveUi(); render();
  }

  function removeSlot(si) {
    const p = presets[ui.current];
    if (!p) return;
    p.slots.splice(si, 1);
    if (ui.altFor === si) ui.altFor = null;
    else if (ui.altFor != null && ui.altFor > si) ui.altFor -= 1;
    savePresets(); saveUi(); render();
  }

  function toggleItem(item) {
    if (!ui.current) { newPreset(); if (!ui.current) return; }
    const p = presets[ui.current];
    const pos = findOption(p, item.id);
    if (pos) return removeOption(pos.si, pos.oi);
    if (!item.allowed) return setStatus(item.name + ' wasn\'t added: ' + item.reason + '.');
    const opt = { id: item.id, name: item.name, note: item.note };
    if (ui.altFor != null && p.slots[ui.altFor]) p.slots[ui.altFor].options.push(opt);
    else p.slots.push({ options: [opt] });
    if (!p.category) p.category = category();
    savePresets(); render();
  }

  function toggleAltMode(si) {
    ui.altFor = ui.altFor === si ? null : si;
    if (ui.altFor != null) ui.editing = true;
    saveUi(); render();
  }

  function exportPresets() {
    const json = JSON.stringify(presets, null, 2);
    const done = () => setStatus('Copied all presets to your clipboard. Send that text to your crew; they use Import.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(done, () => prompt('Copy this text:', json));
    } else prompt('Copy this text:', json);
  }

  function importPresets() {
    const txt = prompt('Paste preset text from Export:');
    if (!txt) return;
    try {
      const data = normalizeAll(JSON.parse(txt));
      let n = 0;
      for (const [name, p] of Object.entries(data)) {
        let key = name;
        if (presets[key] && !confirm('Replace your existing "' + key + '"?')) key = name + ' (imported)';
        presets[key] = p;
        n += 1;
      }
      if (!ui.current) ui.current = Object.keys(presets)[0] || '';
      savePresets(); saveUi();
      setStatus('Imported ' + n + ' preset(s).');
    } catch (e) {
      alert('That text isn\'t valid preset data.');
    }
  }

  // ---------- UI ----------
  qsa('#c2presets-host').forEach((old) => old.remove()); // e.g. a saved page or a double install
  const host = document.createElement('div');
  host.id = 'c2presets-host';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  const CSS = `
    :host { all: initial; }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 360px; max-height: 75vh; display: flex; flex-direction: column;
      background: #fff; color: #1d1d1f; border: 1px solid #c9ccd1; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.18);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; z-index: 2147483000; overflow: hidden; }
    .panel.closed { width: auto; }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #1f2a44; color: #fff; cursor: pointer; user-select: none; }
    header b { flex: 1; font-size: 13px; }
    .body { padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    select { flex: 1; min-width: 0; padding: 4px; font: inherit; }
    button { font: inherit; padding: 4px 8px; border: 1px solid #b7bcc4; border-radius: 6px; background: #f4f5f7; color: #1d1d1f; cursor: pointer; }
    button:hover { background: #e8eaee; }
    button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    button.primary:hover { background: #1d4fd0; }
    button.on { background: #fde68a; border-color: #d4a72c; }
    button:disabled { opacity: .5; cursor: default; }
    ul { list-style: none; margin: 0; padding: 0; border: 1px solid #e3e5e8; border-radius: 6px; }
    li.slot { display: flex; gap: 6px; align-items: flex-start; padding: 6px; border-top: 1px solid #eef0f2; }
    li.slot:first-child { border-top: 0; }
    li.slot.target { background: #fffbeb; }
    .opts { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
    .opt { display: flex; gap: 4px; align-items: baseline; flex-wrap: wrap; }
    .opt .or { color: #666; font-size: 11px; }
    .opt.alt { font-size: 12px; padding-left: 10px; }
    .tools { display: flex; gap: 4px; }
    .tools button, .opt button { padding: 0 6px; font-size: 12px; }
    .x { border: 0 !important; background: none !important; color: #888; font-size: 15px !important; line-height: 1; }
    .badge { display: inline-block; padding: 0 6px; border-radius: 9px; font-size: 11px; }
    .ok { background: #dcfce7; color: #166534; } .limited { background: #fef3c7; color: #92400e; }
    .bad { background: #fee2e2; color: #991b1b; } .unknown { background: #e5e7eb; color: #374151; }
    .warn { width: 100%; color: #92400e; font-size: 11px; }
    .detail { width: 100%; color: #555; font-size: 11px; }
    .muted { color: #666; font-size: 12px; }
    .hint { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 6px; font-size: 12px; }
    .status { white-space: pre-wrap; background: #f6f7f9; border-radius: 6px; padding: 6px; font-size: 12px; }
    .linkish { border: 0; background: none; padding: 2px 0; font-weight: 600; color: #1f2a44; text-align: left; }
    .linkish:hover { background: none; text-decoration: underline; }
    .days { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid #e3e5e8; padding-top: 8px; }
    .day { display: flex; gap: 4px; align-items: center; }
    .day input { font: 12px system-ui, sans-serif; padding: 2px 3px; border: 1px solid #b7bcc4; border-radius: 4px; min-width: 0; }
    .day input[type=date] { flex: 1.4; } .day input[type=time] { flex: 1; }
    label.muted { display: flex; gap: 4px; align-items: center; }
    ol.bookings { margin: 0; padding-left: 20px; font-size: 12px; }
    ol.bookings li { margin: 2px 0; }
    .run { border: 2px solid #2563eb; border-radius: 8px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: #eff6ff; }
  `;

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }

  function renderSlot(slot, si, dates) {
    const opts = slot.options.map((o, oi) => {
      const a = availFor(dates, o.id);
      return el('div', { class: 'opt' + (oi ? ' alt' : '') },
        oi ? el('span', { class: 'or' }, 'or') : null,
        el('span', {}, o.name),
        a ? el('span', { class: 'badge ' + a.kind, title: a.detail || '' }, a.label) : null,
        slot.options.length > 1 ? el('button', { class: 'x', title: 'Remove this unit', onclick: () => removeOption(si, oi) }, '×') : null,
        o.note && WARN_RE.test(o.note) ? el('div', { class: 'warn' }, '⚠ ' + o.note) : null,
        a && a.kind !== 'ok' && a.detail ? el('div', { class: 'detail' }, a.detail) : null);
    });
    return el('li', { class: 'slot' + (ui.altFor === si ? ' target' : '') },
      el('div', { class: 'opts' }, opts),
      el('div', { class: 'tools' },
        el('button', { class: ui.altFor === si ? 'on' : '', title: 'Add interchangeable units for this slot', onclick: () => toggleAltMode(si) }, ui.altFor === si ? 'Done' : '+ alt'),
        el('button', { class: 'x', title: 'Remove this slot', onclick: () => removeSlot(si) }, '×')));
  }

  function renderDays(p) {
    const wrap = el('div', { class: 'days' },
      el('button', { class: 'linkish', onclick: () => { ui.showDays = !ui.showDays; saveUi(); render(); } },
        (ui.showDays ? '▾ ' : '▸ ') + 'Book over shoot days' + (schedule.days.length ? ' (' + schedule.days.length + ')' : '')));
    if (!ui.showDays) return wrap;
    schedule.days.forEach((d, i) => {
      wrap.append(el('div', { class: 'day' },
        el('input', { type: 'date', value: d.date, 'aria-label': 'Shoot date', onchange: (e) => updateDay(i, 'date', e.target.value) }),
        el('input', { type: 'time', value: d.start, step: 1800, 'aria-label': 'Pickup time', onchange: (e) => updateDay(i, 'start', e.target.value) }),
        el('span', { class: 'muted' }, '→'),
        el('input', { type: 'time', value: d.end, step: 1800, 'aria-label': 'Return time', onchange: (e) => updateDay(i, 'end', e.target.value) }),
        el('button', { class: 'x', title: 'Remove this day', onclick: () => { schedule.days.splice(i, 1); saveSchedule(); render(); } }, '×')));
    });
    wrap.append(el('div', { class: 'row' },
      el('button', { onclick: addDay }, '+ Day'),
      el('label', { class: 'muted' },
        el('input', { type: 'checkbox', checked: !!schedule.merge, onchange: (e) => { schedule.merge = e.target.checked; saveSchedule(); render(); } }),
        'Merge back-to-back days (3-day max)')));
    const bookings = computeBookings(schedule.days, schedule.merge);
    if (bookings.length) {
      wrap.append(el('ol', { class: 'bookings' }, bookings.map((b) => el('li', {},
        bookingLabel(b) + (b.days > 1 ? ' (' + b.days + ' shoot days)' : ''),
        b.warnings.length ? el('div', { class: 'warn' }, '⚠ ' + b.warnings.join('; ')) : null))));
      wrap.append(el('div', { class: 'row' },
        el('button', { class: 'primary', disabled: !p.slots.length || !!getRun() || !!store.get('queue', null) || !isSelectPage(), onclick: startRun },
          'Book ' + bookings.length + (bookings.length > 1 ? ' bookings' : ' booking'))));
      wrap.append(el('div', { class: 'muted' }, 'A return time at or before pickup means the gear comes back the next day. Each booking stops at Terms & Conditions for you to finish.'));
    }
    return wrap;
  }

  function renderRun(run) {
    const n = run.bookings.length;
    const bk = run.bookings[run.b];
    const last = run.b + 1 >= n;
    const box = el('div', { class: 'run' }, el('b', {}, 'Booking ' + (run.b + 1) + ' of ' + n + ': ' + bookingLabel(bk)));
    if (run.stage !== 'handoff') {
      box.append(el('div', {}, run.stage === 'basket' ? 'Adding "' + run.preset + '" to the basket…' : 'Setting the times…'));
    } else {
      if (run.problem) box.append(el('div', { class: 'warn' }, '⚠ ' + run.problem));
      if (isSelectPage()) {
        box.append(el('div', {}, last
          ? 'That was the last booking. Once it shows Complete, end the run.'
          : 'Once booking ' + (run.b + 1) + ' shows Complete, start the next one.'));
      } else {
        box.append(el('div', {}, 'Your turn: Terms & Conditions → Special Requests → Verify → Complete.' +
          (last ? '' : ' Then open Book by Category → ' + ((presets[run.preset] || {}).category || 'your category') + ' for booking ' + (run.b + 2) + '.')));
      }
      if (run.notes[run.b]) box.append(el('div', { class: 'detail' }, run.notes[run.b]));
    }
    const row = el('div', { class: 'row' });
    if (run.stage === 'handoff' && isSelectPage() && !last) {
      row.append(el('button', { class: 'primary', onclick: () => nextBooking(1) }, 'Start booking ' + (run.b + 2) + ' of ' + n));
    }
    if (run.stage === 'handoff' && isSelectPage()) row.append(el('button', { onclick: () => nextBooking(0) }, 'Redo booking ' + (run.b + 1)));
    row.append(el('button', { onclick: endRun }, run.stage === 'handoff' && last ? 'End run' : 'Stop run'));
    box.append(row);
    return box;
  }

  function render() {
    const queue = store.get('queue', null);
    const p = presets[ui.current];
    const dates = pageDates();
    root.innerHTML = '';
    root.append(el('style', {}, CSS));

    const panel = el('div', { class: 'panel' + (ui.open ? '' : ' closed') },
      el('header', { onclick: () => { ui.open = !ui.open; saveUi(); render(); } },
        el('b', {}, 'Gear presets'), el('span', {}, ui.open ? '▾' : '▴')));

    if (ui.open) {
      const names = Object.keys(presets);
      const body = el('div', { class: 'body' });
      const run = getRun();
      if (run) body.append(renderRun(run));

      body.append(el('div', { class: 'row' },
        names.length
          ? el('select', { onchange: (e) => { ui.current = e.target.value; ui.editing = false; ui.altFor = null; saveUi(); render(); } },
              names.map((n) => el('option', { value: n, selected: n === ui.current }, n + ' (' + presets[n].slots.length + ')')))
          : el('span', { class: 'muted' }, 'No presets yet.'),
        el('button', { onclick: newPreset }, 'New'),
        p ? el('button', { onclick: renamePreset }, 'Rename') : null,
        p ? el('button', { onclick: deletePreset }, 'Delete') : null));

      if (p) {
        if (p.slots.length) body.append(el('ul', {}, p.slots.map((s, si) => renderSlot(s, si, dates))));
        else body.append(el('div', { class: 'muted' }, 'Empty. Turn on "Pick items", then click "+ Preset" on equipment in the list.'));

        if (ui.altFor != null && p.slots[ui.altFor]) {
          body.append(el('div', { class: 'hint' },
            'Adding alternates for "' + p.slots[ui.altFor].options[0].name + '". Click "+ Alt" on interchangeable units in the list, in the order you\'d want them. Press Done when finished.'));
        }

        body.append(el('div', { class: 'row' },
          el('button', { class: 'primary', disabled: !!queue || starting || !p.slots.length || !isSelectPage(), onclick: () => startQueue(ui.current) }, 'Add all to basket'),
          el('button', { disabled: !p.slots.length, onclick: checkAvailability, title: dates ? 'Uses ' + dates.label : 'Set dates in the Availability box and press Go first' }, 'Check availability'),
          el('button', { class: ui.editing ? 'on' : '', onclick: () => { ui.editing = !ui.editing; if (!ui.editing) ui.altFor = null; saveUi(); render(); } }, ui.editing ? 'Done picking' : 'Pick items')));

        body.append(el('div', { class: 'muted' }, dates
          ? 'Dates from Connect2: ' + dates.label + '. Adding will use a free unit for each slot.'
          : 'Set Collect/Return in the Availability box and press Go to check dates and let alternates replace booked units.'));

        body.append(renderDays(p));
      }

      if (queue) {
        body.append(el('div', { class: 'row' },
          el('button', { onclick: () => runQueue(true) }, 'Resume'),
          el('button', { onclick: stopQueue }, 'Stop')));
      }

      if (statusText) body.append(el('div', { class: 'status' }, statusText));

      body.append(el('div', { class: 'row' },
        el('button', { onclick: exportPresets, disabled: !names.length }, 'Export'),
        el('button', { onclick: importPresets }, 'Import')));

      panel.append(body);
    }
    root.append(panel);
    decorateList();
  }

  // Buttons next to Connect2's own Add buttons, only while picking.
  function decorateList() {
    qsa('.c2p-toggle').forEach((b) => b.remove());
    const p = presets[ui.current];
    if (!ui.editing || !p) return;
    const altMode = ui.altFor != null && !!p.slots[ui.altFor];
    for (const it of pageItems()) {
      const pos = findOption(p, it.id);
      const b = document.createElement('button');
      b.type = 'button'; // never submits Connect2's form
      b.className = 'c2p-toggle';
      let style = 'margin-left:6px;padding:6px 10px;border-radius:6px;font-size:13px;cursor:pointer;';
      if (pos) {
        b.textContent = pos.oi ? '✓ Alternate' : '✓ In preset';
        b.title = 'Click to remove from the preset';
        style += 'background:#fde68a;border:1px solid #d4a72c;color:#1d1d1f;';
      } else if (!it.allowed) {
        b.textContent = 'Can\'t book';
        b.title = it.reason;
        b.disabled = true;
        style += 'background:#f3f4f6;border:1px solid #d1d5db;color:#6b7280;cursor:not-allowed;';
      } else {
        b.textContent = altMode ? '+ Alt' : '+ Preset';
        style += 'background:#fff;border:1px solid #2563eb;color:#2563eb;';
      }
      if (!pos && it.allowed && it.note && WARN_RE.test(it.note)) b.title = 'Note: ' + it.note;
      b.style.cssText = style;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleItem(it); });
      const slot = it.li.querySelector('.resource-book') || it.li;
      slot.appendChild(b);
    }
  }

  render();
  if (store.get('queue', null)) runQueue(true);
  else runTick();
})();
