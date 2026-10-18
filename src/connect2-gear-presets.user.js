// ==UserScript==
// @name         Connect2 Gear Presets (MTSU)
// @namespace    nathan.c2presets
// @version      0.2.0
// @description  Save gear presets in MTSU's Connect2 checkout, add a whole preset to your basket in one click, and check a preset's availability for your dates.
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
  let ui = Object.assign({ open: true, current: '', editing: false, altFor: null }, store.get('ui', {}));
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

  // ---------- add-to-basket queue (survives page reloads) ----------
  // queue: { preset, items: [{ options, kinds, first, firstKind }], i, opt, phase: 'find'|'searched'|'searched2'|'clicked',
  //          before, loadsKey, loads, skipped: [], results: [{ ok, line }], note }
  const MAX_LOADS_PER_OPTION = 6;
  let starting = false;

  async function startQueue(name) {
    const p = presets[name];
    if (!p || !p.slots.length) return setStatus('That preset is empty.');
    if (!isSelectPage()) return setStatus('Open a "Book by Category" equipment list first.');
    if (p.category && category() && p.category !== category()) {
      if (!confirm('This preset was made in "' + p.category + '", but you are in "' + category() + '". Continue anyway?')) return;
    }
    if (starting) return;
    starting = true;
    try {
      const d = pageDates();
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
      store.set('queue', { preset: name, items, i: 0, opt: 0, phase: 'find', before: -1, loadsKey: '', loads: 0, skipped: [], results: [], note });
    } finally {
      starting = false;
    }
    runQueue(true);
  }

  function stopQueue() { store.del('queue'); setStatus('Stopped. Anything already added stays in your basket.'); }

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
    msg += '\nNext: set your dates and press Create booking.';
    const box = searchBox();
    if (box) box.value = '';
    setStatus(msg);
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
  const host = document.createElement('div');
  host.id = 'c2presets-host';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  const CSS = `
    :host { all: initial; }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 340px; max-height: 75vh; display: flex; flex-direction: column;
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
  runQueue(true);
})();
