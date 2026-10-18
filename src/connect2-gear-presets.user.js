// ==UserScript==
// @name         Connect2 Gear Presets (MTSU)
// @namespace    nathan.c2presets
// @version      0.1.0
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
 * - "Add to basket" clicks Connect2's own Add buttons for you, one item per page load,
 *   searching for an item when it isn't on the current page. It never submits a booking:
 *   you still pick dates and press "Create booking" yourself.
 * - "Check availability" reuses the dates you entered in Connect2's Availability box
 *   (Collect / Return, then Go) and asks Connect2 about each preset item.
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

  // presets: { [name]: { category: 'Media Arts Equipment', items: [{ id, name }] } }
  let presets = store.get('presets', {});
  let ui = Object.assign({ open: true, current: '', editing: false }, store.get('ui', {}));
  if (!presets[ui.current]) ui.current = Object.keys(presets)[0] || '';
  let availability = {}; // id -> { label, kind: 'ok'|'limited'|'bad', detail }
  let statusText = store.get('lastStatus', '');

  const savePresets = () => store.set('presets', presets);
  const saveUi = () => store.set('ui', ui);
  const setStatus = (t) => { statusText = t; store.set('lastStatus', t); render(); };

  // ---------- page helpers ----------
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

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
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
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
      const btn = li.querySelector('.resource-book input[type="submit"]');
      return { li, id, name: nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : '', btn };
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

  const stripHtml = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- add-to-basket queue (survives page reloads) ----------
  // queue: { preset, items, i, phase: 'find'|'searched'|'searched2'|'clicked', before, loadsFor, loads, results: [] }
  const MAX_LOADS_PER_ITEM = 6;

  function startQueue(name) {
    const p = presets[name];
    if (!p || !p.items.length) return setStatus('That preset is empty.');
    if (!isSelectPage()) return setStatus('Open a "Book by Category" equipment list first.');
    if (p.category && category() && p.category !== category()) {
      if (!confirm('This preset was made in "' + p.category + '", but you are in "' + category() + '". Continue anyway?')) return;
    }
    store.set('queue', { preset: name, items: p.items.slice(), i: 0, phase: 'find', before: -1, loadsFor: -1, loads: 0, results: [] });
    runQueue(true);
  }

  function stopQueue() { store.del('queue'); setStatus('Stopped. Anything already added stays in your basket.'); }

  function nextItem(q) { q.i += 1; q.phase = 'find'; q.loads = 0; }

  function runQueue(fromPageLoad) {
    const q = store.get('queue', null);
    if (!q) return;

    if (!isSelectPage()) {
      setStatus('Paused: this isn\'t the equipment list page. Go back to the category list and press Resume.');
      return;
    }

    if (fromPageLoad) {
      if (q.loadsFor !== q.i) { q.loadsFor = q.i; q.loads = 0; }
      q.loads += 1;
      if (q.loads > MAX_LOADS_PER_ITEM && q.i < q.items.length) {
        q.results.push({ name: q.items[q.i].name, ok: false, msg: 'Gave up after several page loads' });
        nextItem(q);
      }
    }

    if (q.i >= q.items.length) return finishQueue(q);
    const it = q.items[q.i];
    statusText = 'Adding ' + (q.i + 1) + ' of ' + q.items.length + ': ' + it.name + '…';
    render();

    if (q.phase === 'clicked') {
      const now = basketCount();
      const ok = q.before >= 0 && now > q.before;
      q.results.push({ name: it.name, ok, msg: ok ? '' : (pageMessage() || 'Basket count didn\'t change (already in basket?)') });
      nextItem(q);
      store.set('queue', q);
      return setTimeout(() => runQueue(false), 0);
    }

    const match = pageItems().find((p) => p.id === String(it.id));
    if (match) {
      if (!match.btn || match.btn.disabled) {
        q.results.push({ name: it.name, ok: false, msg: (match.btn && match.btn.title) || 'No Add button for this item' });
        nextItem(q);
        store.set('queue', q);
        return setTimeout(() => runQueue(false), 0);
      }
      q.before = basketCount();
      q.phase = 'clicked';
      store.set('queue', q);
      match.btn.click(); // Connect2's own button: posts back and reloads the page
      return;
    }

    if (q.phase === 'find') return doSearch(q, it.name, 'searched');
    if (q.phase === 'searched') return doSearch(q, it.name.split(' ').slice(0, 3).join(' '), 'searched2');

    q.results.push({ name: it.name, ok: false, msg: 'Not found by search (renamed or removed?)' });
    nextItem(q);
    store.set('queue', q);
    setTimeout(() => runQueue(false), 0);
  }

  function doSearch(q, text, phase) {
    const box = searchBox(), btn = searchBtn();
    if (!box || !btn) {
      q.phase = 'searched2';
      store.set('queue', q);
      return setTimeout(() => runQueue(false), 0);
    }
    q.phase = phase;
    store.set('queue', q);
    box.value = text;
    btn.click(); // reloads the page with search results
  }

  function finishQueue(q) {
    store.del('queue');
    const good = q.results.filter((r) => r.ok).length;
    const bad = q.results.filter((r) => !r.ok);
    let msg = 'Added ' + good + ' of ' + q.results.length + ' from "' + q.preset + '".';
    if (bad.length) msg += '\nCheck: ' + bad.map((r) => r.name + ' (' + r.msg + ')').join('; ');
    msg += '\nNext: set your dates and press Create booking.';
    const box = searchBox();
    if (box) box.value = '';
    setStatus(msg);
  }

  // ---------- availability ----------
  async function checkAvailability() {
    const p = presets[ui.current];
    if (!p || !p.items.length) return setStatus('Pick a preset with items first.');
    const d = pageDates();
    if (!d) return setStatus('Enter Collect and Return dates in Connect2\'s Availability box, press Go, then check again.');
    availability = {};
    setStatus('Checking ' + p.items.length + ' items for ' + d.label + '…');
    let problems = 0;
    for (const it of p.items) {
      try {
        const params = d.kind === 'range'
          ? { resourceId: it.id, start: d.start, end: d.end }
          : { resourceId: it.id, dateTime: d.date };
        const path = d.kind === 'range' ? '/wizard/freetime/checkdaterangeforresource' : '/wizard/freetime/getnextresourceavailabledate';
        const r = await fetch(path + '?' + new URLSearchParams(params), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        let label, kind;
        if (d.kind === 'range') {
          label = data.Title || data.TypeName || '?';
          kind = data.TypeName === 'error' ? 'bad' : data.TypeName === 'warning' ? 'limited' : 'ok';
        } else {
          kind = data.TypeName === 'success' ? 'ok' : 'bad';
          label = data.TypeName === 'success' ? 'Available' : data.TypeName === 'error' ? 'Not available' : 'Not allowed';
        }
        if (kind !== 'ok') problems += 1;
        availability[it.id] = { label, kind, detail: stripHtml(data.Text) };
      } catch (e) {
        problems += 1;
        availability[it.id] = { label: 'Couldn\'t check', kind: 'bad', detail: String(e.message || e) };
      }
      render();
      await sleep(150);
    }
    setStatus(problems ? problems + ' item(s) need attention for ' + d.label + '.' : 'Everything in "' + ui.current + '" looks available for ' + d.label + '.');
  }

  // ---------- preset management ----------
  function newPreset() {
    const name = (prompt('Name this preset (e.g. "A-cam package", "Interview audio"):') || '').trim();
    if (!name) return;
    if (presets[name] && !confirm('"' + name + '" already exists. Replace it?')) return;
    presets[name] = { category: category(), items: [] };
    ui.current = name; ui.editing = true;
    savePresets(); saveUi();
    setStatus('Now click "+ Preset" on each item you want in "' + name + '". Use search or the category list to find them.');
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
    ui.current = Object.keys(presets)[0] || ''; ui.editing = false;
    savePresets(); saveUi(); render();
  }

  function toggleItem(id, name) {
    if (!ui.current) { newPreset(); if (!ui.current) return; }
    const p = presets[ui.current];
    const idx = p.items.findIndex((x) => x.id === id);
    if (idx >= 0) p.items.splice(idx, 1); else p.items.push({ id, name });
    if (!p.category) p.category = category();
    savePresets(); render();
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
      const data = JSON.parse(txt);
      let n = 0;
      for (const [name, p] of Object.entries(data)) {
        if (!p || !Array.isArray(p.items)) continue;
        const items = p.items.filter((x) => x && x.id != null).map((x) => ({ id: String(x.id), name: String(x.name || x.id) }));
        let key = name;
        if (presets[key] && !confirm('Replace your existing "' + key + '"?')) key = name + ' (imported)';
        presets[key] = { category: String(p.category || ''), items };
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
    .panel { position: fixed; right: 16px; bottom: 16px; width: 320px; max-height: 75vh; display: flex; flex-direction: column;
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
    li { display: flex; gap: 6px; align-items: flex-start; padding: 5px 6px; border-top: 1px solid #eef0f2; }
    li:first-child { border-top: 0; }
    li .nm { flex: 1; min-width: 0; }
    li .x { padding: 0 6px; border: 0; background: none; color: #888; font-size: 15px; line-height: 1; }
    .badge { display: inline-block; margin-top: 2px; padding: 0 6px; border-radius: 9px; font-size: 11px; }
    .ok { background: #dcfce7; color: #166534; } .limited { background: #fef3c7; color: #92400e; } .bad { background: #fee2e2; color: #991b1b; }
    .detail { color: #555; font-size: 11px; }
    .muted { color: #666; font-size: 12px; }
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
          ? el('select', { onchange: (e) => { ui.current = e.target.value; ui.editing = false; availability = {}; saveUi(); render(); } },
              names.map((n) => el('option', { value: n, selected: n === ui.current }, n + ' (' + presets[n].items.length + ')')))
          : el('span', { class: 'muted' }, 'No presets yet.'),
        el('button', { onclick: newPreset }, 'New'),
        p ? el('button', { onclick: renamePreset, title: 'Rename' }, 'Rename') : null,
        p ? el('button', { onclick: deletePreset, title: 'Delete' }, 'Delete') : null));

      if (p) {
        if (p.items.length) {
          body.append(el('ul', {}, p.items.map((it) => {
            const a = availability[it.id];
            return el('li', {},
              el('div', { class: 'nm' }, it.name,
                a ? el('div', {}, el('span', { class: 'badge ' + a.kind }, a.label)) : null,
                a && a.detail ? el('div', { class: 'detail' }, a.detail) : null),
              el('button', { class: 'x', title: 'Remove from preset', onclick: () => toggleItem(it.id, it.name) }, '×'));
          })));
        } else {
          body.append(el('div', { class: 'muted' }, 'Empty. Turn on "Pick items", then click "+ Preset" on equipment in the list.'));
        }

        body.append(el('div', { class: 'row' },
          el('button', { class: 'primary', disabled: !!queue || !p.items.length || !isSelectPage(), onclick: () => startQueue(ui.current) }, 'Add all to basket'),
          el('button', { disabled: !p.items.length, onclick: checkAvailability, title: dates ? 'Uses ' + dates.label : 'Set dates in the Availability box and press Go first' }, 'Check availability'),
          el('button', { class: ui.editing ? 'on' : '', onclick: () => { ui.editing = !ui.editing; saveUi(); render(); } }, ui.editing ? 'Done picking' : 'Pick items')));

        body.append(el('div', { class: 'muted' }, dates ? 'Dates from Connect2: ' + dates.label : 'For availability: set Collect/Return in the Availability box and press Go.'));
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

  // "+ Preset" buttons next to Connect2's own Add buttons, only while picking.
  function decorateList() {
    qsa('.c2p-toggle').forEach((b) => b.remove());
    if (!ui.editing || !presets[ui.current]) return;
    const inPreset = new Set(presets[ui.current].items.map((x) => x.id));
    for (const it of pageItems()) {
      const has = inPreset.has(it.id);
      const b = document.createElement('button');
      b.type = 'button'; // never submits Connect2's form
      b.className = 'c2p-toggle';
      b.textContent = has ? '✓ In preset' : '+ Preset';
      b.style.cssText = 'margin-left:6px;padding:6px 10px;border-radius:6px;font-size:13px;cursor:pointer;' +
        (has ? 'background:#fde68a;border:1px solid #d4a72c;color:#1d1d1f;' : 'background:#fff;border:1px solid #2563eb;color:#2563eb;');
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleItem(it.id, it.name); });
      const slot = it.li.querySelector('.resource-book') || it.li;
      slot.appendChild(b);
    }
  }

  render();
  runQueue(true);
})();
