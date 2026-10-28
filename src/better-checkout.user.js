// ==UserScript==
// @name         Better Checkout
// @namespace    better-checkout.mtsu
// @version      1.0.1
// @description  A friendlier way to book gear on MTSU's Connect2 equipment checkout: see what's free for your dates, save the gear you use as lists, and book several dates in a row.
// @author       Nathan Montalvo
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3QgeD0iMiIgeT0iMy4yIiB3aWR0aD0iMjAiIGhlaWdodD0iNS4zIiByeD0iMS40IiBmaWxsPSIjMTcxODFkIi8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTYuMiAzLjJoMi45TDYuNiA4LjVIMy43ek0xMi4yIDMuMmgyLjlsLTIuNSA1LjNIOS43ek0xOC4yIDMuMmgyLjlsLTIuNSA1LjNoLTIuOXoiLz48cmVjdCB4PSIyIiB5PSIxMCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjExLjUiIHJ4PSIyIiBmaWxsPSIjMTcxODFkIi8+PHBhdGggZD0iTTcuNiAxNS42bDIuOSAyLjggNS45LTUuNyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZjZjMzIiBzdHJva2Utd2lkdGg9IjIuNCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+
// @homepageURL  https://github.com/nathanmontalvoGM/Better-Equipment-Reservation
// @supportURL   https://github.com/nathanmontalvoGM/Better-Equipment-Reservation/issues
// @downloadURL  https://raw.githubusercontent.com/nathanmontalvoGM/Better-Equipment-Reservation/main/src/better-checkout.user.js
// @updateURL    https://raw.githubusercontent.com/nathanmontalvoGM/Better-Equipment-Reservation/main/src/better-checkout.user.js
// @match        https://mtsu.getconnect2.com/wizard/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Better Checkout adds a panel to Connect2's equipment checkout (bottom right) and marks up the
 * equipment list. Everything it adds carries its slate logo, so it's never mistaken for Connect2.
 *
 * - Dates: when you'll pick up and return gear. The selected dates show, next to every item on the
 *   list, whether it's available then ("Only show gear that's available" hides the rest). Connect2's own
 *   date-only Availability box is replaced, so dates are set in one place.
 * - Equipment presets: the gear you check out every time, with backups for items that might be taken.
 *   One click adds a list to the basket, using a unit that's free for your dates.
 * - Booking: one booking per date. For each, it adds the gear, fills in the times and stops at
 *   Terms & Conditions. You finish every booking yourself; it never completes one for you.
 * - Problems are explained where they happen: items free for only part of your dates offer
 *   "Use these dates", items that are taken offer something similar, and Connect2's rejections
 *   show its reasons and suggested times.
 *
 * Data (equipment presets, dates, saved availability) stays in this browser, under the Connect2 site.
 * Internal names say "preset" and "c2presets", like the interface.
 */

(function () {
  'use strict';

  // ---------- look ----------
  // Ink and white, with camera-tape yellow as the one accent. Blue stays Connect2's; green, amber
  // and red only ever mean free, partly free and not free.
  const C = {
    ink: '#17181d', ink2: '#2c2e37', paper: '#ffffff', mist: '#f4f5f7', line: '#e2e4e9', line2: '#cdd1d8',
    muted: '#5d6270', tape: '#ffcf33', tapeSoft: '#fff7d6', tapeLine: '#ecd27a', focus: '#2563eb',
    ok: '#146c43', okBg: '#e2f4e9', part: '#8a5200', partBg: '#fff0cf', no: '#b42318', noBg: '#fde8e6', unk: '#3f4552', unkBg: '#eceef2',
  };
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const STRIPES = 'repeating-linear-gradient(135deg, ' + C.ink + ' 0 7px, #ffffff 7px 14px)'; // a clapperboard's sticks

  // The mark: a clapperboard slate with a check. `onDark` draws it for the ink header.
  function logo(size, onDark) {
    const bar = onDark ? '#ffffff' : C.ink, stripes = onDark ? C.ink : '#ffffff';
    const body = onDark ? C.tape : C.ink, check = onDark ? C.ink : C.tape;
    return '<svg class="bc-logo" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<rect x="2" y="3.2" width="20" height="5.3" rx="1.4" fill="' + bar + '"/>' +
      '<path fill="' + stripes + '" d="M6.2 3.2h2.9L6.6 8.5H3.7zM12.2 3.2h2.9l-2.5 5.3H9.7zM18.2 3.2h2.9l-2.5 5.3h-2.9z"/>' +
      '<rect x="2" y="10" width="20" height="11.5" rx="2" fill="' + body + '"/>' +
      '<path d="M7.6 15.6l2.9 2.8 5.9-5.7" fill="none" stroke="' + check + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function logoEl(size, onDark) {
    const span = document.createElement('span');
    span.className = 'bc-mark';
    span.innerHTML = logo(size, onDark);
    return span;
  }

  // Styles for what Better Checkout adds to Connect2's own page (the panel has its own, in a shadow root).
  const PAGE_CSS = `
    body.c2p-own-avail .resource-availability { display: none !important; }
    .bc-mark { display: inline-flex; flex: none; line-height: 0; }
    .bc-btn { font: 600 13px/1.2 ${FONT}; padding: 6px 12px; border-radius: 6px; border: 1px solid ${C.ink}; background: ${C.paper};
      color: ${C.ink}; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
    .bc-btn:hover { background: ${C.ink}; color: #fff; }
    .bc-btn.solid { background: ${C.ink}; color: #fff; }
    .bc-btn.solid:hover { background: ${C.ink2}; }
    .bc-btn.small { font-size: 12.5px; padding: 3px 10px; }
    .bc-btn:focus-visible, .c2p-onlyfree:focus-visible, .c2p-toggle:focus-visible { outline: 2px solid ${C.focus}; outline-offset: 2px; }

    .c2p-avail { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 8px; font: 13px/1.4 ${FONT}; color: ${C.ink}; }
    .bc-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px 2px 3px; border-radius: 999px; font-weight: 600; font-size: 12.5px; }
    .bc-pill .bc-mark { background: #fff; border-radius: 999px; padding: 2px; }
    .bc-pill.ok { background: ${C.okBg}; color: ${C.ok}; } .bc-pill.limited { background: ${C.partBg}; color: ${C.part}; }
    .bc-pill.bad { background: ${C.noBg}; color: ${C.no}; } .bc-pill.unknown { background: ${C.unkBg}; color: ${C.unk}; }
    .bc-pill.pending { background: ${C.mist}; color: ${C.muted}; }
    .bc-detail { font-size: 12.5px; color: ${C.muted}; }
    .c2p-freepart { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; color: ${C.ink}; }

    .c2p-filterbar { position: relative; display: flex; align-items: center; gap: 10px 18px; flex-wrap: wrap; margin: 8px 0 14px;
      padding: 12px 16px 12px 22px; background: ${C.paper}; border: 1px solid ${C.line}; border-radius: 10px;
      box-shadow: 0 1px 2px rgba(23, 24, 29, .06); font: 14px/1.4 ${FONT}; color: ${C.ink}; overflow: hidden; }
    .c2p-filterbar::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 7px; background: ${STRIPES}; }
    .bc-brand { display: inline-flex; align-items: center; gap: 7px; font-weight: 700; font-size: 13px; letter-spacing: -.01em;
      padding-right: 16px; border-right: 1px solid ${C.line}; white-space: nowrap; }
    .c2p-onlyfree { display: inline-flex; align-items: center; gap: 11px; border: 0; background: none; padding: 2px; margin: 0;
      cursor: pointer; font: inherit; color: inherit; text-align: left; }
    .bc-track { position: relative; flex: none; width: 46px; height: 26px; border-radius: 13px; background: #c3c7cf; transition: background .15s; }
    .bc-track.on { background: ${C.ink}; }
    .bc-knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, .35); transition: left .15s; }
    .bc-track.on .bc-knob { left: 23px; background: ${C.tape}; }
    .bc-sw-words { display: flex; flex-direction: column; }
    .bc-sw-title { font-weight: 700; }
    .bc-sw-sub { font-size: 12.5px; color: ${C.muted}; }
    .bc-bar-note { font-size: 13px; color: ${C.muted}; }

    .c2p-availnote { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .bc-side { display: flex; flex-direction: column; gap: 6px; font: 13px/1.4 ${FONT}; color: ${C.ink}; }
    .bc-side-brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12.5px; }
    .bc-side-dates { font-weight: 600; }

    .c2p-toggle { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: 600 13px/1.4 ${FONT};
      padding: 5px 10px; border-radius: 4px; border: 1px solid ${C.ink}; background: ${C.paper}; color: ${C.ink}; cursor: pointer; }
    .c2p-toggle:hover { background: ${C.mist}; }
    .c2p-toggle.saved { background: ${C.tapeSoft}; border-color: ${C.tapeLine}; }
    .c2p-toggle:disabled { background: ${C.mist}; border-color: ${C.line2}; color: ${C.muted}; cursor: not-allowed; }
    .c2p-toggle:disabled .bc-mark { opacity: .45; }
    @media (prefers-reduced-motion: reduce) { .bc-track, .bc-knob { transition: none; } }
  `;
  function ensurePageStyles() {
    if (document.getElementById('bc-page-style')) return;
    const st = document.createElement('style');
    st.id = 'bc-page-style';
    st.textContent = PAGE_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

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
  // showDates / showPresets / showMore: which panel sections are open. activeRange: the selected dates.
  let ui = Object.assign({ open: true, current: '', editing: false, altFor: null, activeRange: 0, editRange: null }, store.get('ui', {}));
  if (!presets[ui.current]) { ui.current = Object.keys(presets)[0] || ''; ui.altFor = null; }
  // ---------- saved availability ----------
  // `${dates.label}|${id}` -> { label, kind: 'ok'|'limited'|'bad'|'unknown', detail, collect, ret, at }
  // Saved in localStorage so changing pages doesn't re-check. Connect2 answers per pair of dates,
  // so changing only the times of a window never needs a new request.
  const CACHE_MINUTES = 30;   // saved results are reused for this long
  const BOOKING_MINUTES = 5;  // adding and booking re-check anything older than this
  const RETRY_MINUTES = 1;    // a failed check is retried after this long (and never saved)
  const CACHE_MAX = 3000;
  const minutesOld = (r) => (Date.now() - (r.at || 0)) / 6e4;

  function readSavedAvailability() {
    const out = {};
    for (const [k, v] of Object.entries(store.get('avail', {}) || {})) {
      if (v && v.at && v.kind !== 'unknown' && minutesOld(v) < CACHE_MINUTES) out[k] = v;
    }
    return out;
  }
  let availability = readSavedAvailability();

  function saveAvailability() {
    let entries = Object.entries(availability).filter(([, v]) => v.kind !== 'unknown' && minutesOld(v) < CACHE_MINUTES);
    if (entries.length > CACHE_MAX) entries = entries.sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX);
    store.set('avail', Object.fromEntries(entries));
  }
  let statusText = store.get('lastStatus', '');

  const savePresets = () => store.set('presets', presets);
  const saveUi = () => store.set('ui', ui);
  // An optional undo shows as a button next to the message, until the next message.
  let statusUndo = null;
  const setStatus = (t, undo) => { statusText = t; statusUndo = undo || null; store.set('lastStatus', t); render(); };

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
      const typeEl = li.querySelector('.resource-type');
      const btn = li.querySelector('.resource-book input[type="submit"]');
      const allowed = !!btn && !btn.disabled;
      return {
        li, id, btn, allowed,
        name: nameEl ? clean(nameEl.textContent) : '',
        note: noteEl ? clean(noteEl.textContent) : '',
        type: typeEl ? clean(typeEl.textContent) : '',
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

  // ---------- step log, for problem reports ----------
  // A short history of what the script did, kept in this browser only. Gear names, dates and
  // Connect2's messages go in; your name, login and the page's hidden session fields never do.
  const VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || 'dev';
  const LOG_MAX = 150;

  function pageTitle() {
    const h = qs('h1[id$="BannerContent_pageTitle"]');
    return h ? clean(h.textContent) : '';
  }
  function stepText() {
    const m = (document.body ? document.body.textContent : '').match(/Step \d+ of \d+/);
    return m ? m[0] : '';
  }
  // Connect2's last wizard step: "Media Arts Equipment - Complete", "Step 6 of 6".
  function isCompletePage() {
    if (/(^|\s-\s)(booking\s+)?complete(d)?\s*$/i.test(pageTitle())) return true;
    const m = stepText().match(/Step (\d+) of (\d+)/);
    return !!m && m[1] === m[2] && Number(m[2]) > 1;
  }
  function pageKind() {
    if (qs('ul.resource-list') && qs('input[id$="FuzzySearchTxt_textbox"]')) return 'list';
    if (qs('input[id$="editResourceBookingsTime_datetime_startDate_textbox"]')) return 'time';
    if (isCompletePage()) return 'complete';
    const t = pageTitle();
    return t ? 'other: ' + t.split(' - ').pop() : 'other';
  }

  function log(ev, detail) {
    try {
      const entries = store.get('log', []) || [];
      entries.push({ t: Date.now(), k: pageKind(), ev, d: detail == null ? '' : String(detail).slice(0, 300) });
      store.set('log', entries.slice(-LOG_MAX));
    } catch (e) { /* the log is best-effort */ }
  }

  const stripHtml = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return clean(d.textContent); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- availability ----------
  const availKey = (d, id) => d.label + '|' + id;
  // A result younger than maxAge minutes, else undefined.
  function availFor(d, id, maxAge = CACHE_MINUTES) {
    const r = d ? availability[availKey(d, id)] : undefined;
    if (!r) return undefined;
    const age = minutesOld(r);
    return age < maxAge && !(r.kind === 'unknown' && age >= RETRY_MINUTES) ? r : undefined;
  }

  // opts.maxAge: re-check if the saved result is older than this many minutes. opts.quiet: don't re-render.
  async function fetchAvailability(id, d, opts = {}) {
    const key = availKey(d, id);
    const saved = availFor(d, id, opts.maxAge || CACHE_MINUTES);
    if (saved) return saved;
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
        // List looks like ["Collect from: 8:00 AM", "Monday, 26 Oct 2026", "Return by: 4:30 PM", "Wednesday, 28 Oct 2026"]
        const list = Array.isArray(data.List) ? data.List.map((x) => clean(stripHtml(String(x)))) : [];
        const limit = (prefix) => {
          const i = list.findIndex((x) => x.toLowerCase().startsWith(prefix));
          const time = i >= 0 ? parseTime12(list[i]) : null;
          return time ? { time, date: parseLongDate(list[i + 1]) } : null;
        };
        const collect = limit('collect from'), ret = limit('return by');
        const limits = [collect && 'collect from ' + time12(collect.time) + (collect.date ? ' ' + shortDay(collect.date) : ''),
          ret && 'return by ' + time12(ret.time) + (ret.date ? ' ' + shortDay(ret.date) : '')].filter(Boolean).join(', ');
        const kind = data.TypeName === 'error' ? 'bad' : data.TypeName === 'warning' ? 'limited' : 'ok';
        // "Only partly free": Connect2 says "A shorter booking is available from Wed, 4 Nov (8:00 AM) -
        // Thu, 5 Nov (12:00 PM)", and its collect/return times are that shorter booking (with years).
        const shorter = kind === 'limited' ? (collect && ret && collect.date && ret.date
          ? { startDate: collect.date, startTime: collect.time, endDate: ret.date, endTime: ret.time }
          : parseShorter(stripHtml(data.Text), d)) : null;
        result = {
          label: data.Title || data.TypeName || '?',
          kind,
          detail: shorter ? 'Available only ' + shortLabel(shorter) : [stripHtml(data.Text), limits].filter(Boolean).join(' · '),
          collect, ret, shorter,
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
      log('check failed', 'item ' + id + ' for ' + d.label + ': ' + result.detail);
    }
    result.at = Date.now();
    availability[key] = result;
    saveAvailability();
    if (!opts.quiet) render();
    await sleep(150); // keep requests gentle on Connect2
    return result;
  }

  // Does a unit's availability fit a booking's actual times? Connect2's range check is per day, but it
  // says when the unit can be collected on the first day and must be back on the last day: that covers
  // cage hours and other people's bookings that start or end mid-day.
  // Returns { kind: 'ok'|'hours'|'limited'|'bad'|'unknown', why }.
  function fitFor(r, b) {
    if (!r) return { kind: 'unknown', why: 'not checked' };
    if (r.kind !== 'ok') {
      return { kind: r.kind, why: r.kind === 'unknown' ? 'couldn\'t check'
        : r.kind === 'limited' ? (r.shorter ? 'only available ' + shortLabel(r.shorter) : 'only partly available') : 'not available' };
    }
    if (!b || !b.startTime) return { kind: 'ok', why: '' };
    const problems = [];
    if (r.collect && minutesAt(b.startDate, b.startTime) < minutesAt(r.collect.date || b.startDate, r.collect.time)) {
      problems.push('collect from ' + time12s(r.collect.time) + ' ' + shortDay(r.collect.date || b.startDate));
    }
    if (r.ret && minutesAt(b.endDate, b.endTime) > minutesAt(r.ret.date || b.endDate, r.ret.time)) {
      problems.push('return by ' + time12s(r.ret.time) + ' ' + shortDay(r.ret.date || b.endDate));
    }
    return problems.length ? { kind: 'hours', why: problems.join(', ') } : { kind: 'ok', why: '' };
  }

  // Check each slot's units in order, stopping at the first one that fits.
  async function checkSlots(p, d, booking, maxAge) {
    for (const slot of p.slots) {
      for (const o of slot.options) {
        const r = await fetchAvailability(o.id, d, { maxAge });
        if (fitFor(r, booking).kind === 'ok') break;
      }
    }
  }

  const RANK = { ok: 0, limited: 1, unknown: 2, hours: 2.5, bad: 3 };
  function orderOptions(options, d, booking) {
    if (!d) return options.slice();
    return options
      .map((o, i) => ({ o, i, r: RANK[fitFor(availFor(d, o.id), booking).kind] }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.o);
  }

  // ---------- date ranges → bookings ----------
  // schedule: { ranges: [{ startDate: 'YYYY-MM-DD', startTime: 'HH:mm', endDate, endTime }] }
  // Each range is one booking: pickup date/time → return date/time.
  const MAX_BOOKING_DAYS = 3;   // Connect2 at MTSU: "3 day maximum booking period"
  const MAX_BOOKING_HOURS = 72; // counted conservatively: both limits must hold

  const pad = (n) => String(n).padStart(2, '0');
  const ymdToUtc = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const addDays = (ymd, n) => new Date(ymdToUtc(ymd) + n * 864e5).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((ymdToUtc(b) - ymdToUtc(a)) / 864e5);
  const minutesAt = (ymd, hm) => ymdToUtc(ymd) / 6e4 + Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const mdy = (ymd) => ymd.slice(5, 7) + '/' + ymd.slice(8, 10) + '/' + ymd.slice(0, 4);
  const time12 = (hm) => { const h = Number(hm.slice(0, 2)); return ((h + 11) % 12 + 1) + ':' + hm.slice(3, 5) + ' ' + (h < 12 ? 'AM' : 'PM'); };
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const shortDay = (ymd) => WEEKDAYS[new Date(ymdToUtc(ymd)).getUTCDay()] + ' ' + Number(ymd.slice(5, 7)) + '/' + Number(ymd.slice(8, 10));
  const todayYmd = () => { const t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); };
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  // "Monday, 26 Oct 2026" → '2026-10-26'
  function parseLongDate(t) {
    const m = String(t || '').match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
    const mon = m && MONTHS[m[2].toLowerCase()];
    return mon ? m[3] + '-' + pad(mon) + '-' + pad(m[1]) : null;
  }
  // "Return by: 4:30 PM" → '16:30'
  function parseTime12(t) {
    const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*([AP])\.?M/i);
    if (!m) return null;
    return pad((Number(m[1]) % 12) + (/p/i.test(m[3]) ? 12 : 0)) + ':' + m[2];
  }
  // "11/2/2026 2:30 PM" → { date: '2026-11-02', time: '14:30' }
  function parseMdyTime(t) {
    const m = String(t || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2}\s*[AP]\.?M)/i);
    return m ? { date: m[3] + '-' + pad(m[1]) + '-' + pad(m[2]), time: parseTime12(m[4]) } : null;
  }
  // "…from Wed, 4 Nov (8:00 AM) - Thu, 5 Nov (12:00 PM)" → a range; the year comes from the dates asked about.
  function parseShorter(text, d) {
    const part = '(?:[A-Za-z]{3,9},?\\s+)?(\\d{1,2})\\s+([A-Za-z]{3})[a-z]*\\.?(?:\\s+(\\d{4}))?\\s*\\(?(\\d{1,2}:\\d{2}\\s*[AP]\\.?M)\\)?';
    const m = String(text || '').match(new RegExp('from\\s+' + part + '\\s*[-–]\\s*' + part, 'i'));
    if (!m) return null;
    const baseYear = Number(((d && d.start) || '').slice(-4)) || new Date().getFullYear();
    const ymd = (day, mon, year) => {
      const mo = MONTHS[mon.toLowerCase()];
      if (!mo) return null;
      let y = Number(year) || baseYear;
      if (!year && d && d.start && mo < Number(d.start.slice(0, 2)) - 6) y += 1; // asked in Dec, free in Jan
      return y + '-' + pad(mo) + '-' + pad(day);
    };
    const startDate = ymd(m[1], m[2], m[3]), endDate = ymd(m[5], m[6], m[7]);
    const startTime = parseTime12(m[4]), endTime = parseTime12(m[8]);
    return startDate && endDate && startTime && endTime ? { startDate, startTime, endDate, endTime } : null;
  }

  // Does a date box's "10/26/2026" (or "11/2/2026") mean this YYYY-MM-DD?
  function sameMdy(text, ymd) {
    const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return !!m && m[3] + '-' + pad(m[1]) + '-' + pad(m[2]) === ymd;
  }
  const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const isHm = (v) => /^\d{2}:\d{2}$/.test(v || '');
  const validRange = (r) => !!r && isYmd(r.startDate) && isHm(r.startTime) && isYmd(r.endDate) && isHm(r.endTime);

  function loadSchedule() {
    const raw = store.get('schedule', {}) || {};
    if (Array.isArray(raw.ranges)) return { ranges: raw.ranges };
    // v0.3.0 stored single shoot days; an earlier return time meant the next day.
    const ranges = (Array.isArray(raw.days) ? raw.days : [])
      .filter((d) => d && isYmd(d.date) && isHm(d.start) && isHm(d.end))
      .map((d) => ({ startDate: d.date, startTime: d.start, endDate: d.end <= d.start ? addDays(d.date, 1) : d.date, endTime: d.end }));
    return { ranges };
  }
  let schedule = loadSchedule();
  const saveSchedule = () => store.set('schedule', schedule);
  saveSchedule();

  // Bookings in pickup order. `index` points back at the range row; `invalid` means it can't be booked as entered.
  function computeBookings(ranges) {
    const today = todayYmd();
    const out = ranges
      .map((r, index) => (validRange(r) ? { startDate: r.startDate, startTime: r.startTime, endDate: r.endDate, endTime: r.endTime, index } : null))
      .filter(Boolean)
      .sort((a, b) => minutesAt(a.startDate, a.startTime) - minutesAt(b.startDate, b.startTime));
    out.forEach((b, i) => {
      b.warnings = [];
      b.days = daysBetween(b.startDate, b.endDate) + 1;
      const hours = (minutesAt(b.endDate, b.endTime) - minutesAt(b.startDate, b.startTime)) / 60;
      b.invalid = hours <= 0;
      if (b.invalid) b.warnings.push('return is not after pickup');
      if (b.startDate < today) b.warnings.push('starts in the past');
      if (hours > MAX_BOOKING_HOURS || b.days > MAX_BOOKING_DAYS) b.warnings.push('longer than the 3-day maximum');
      const prev = out[i - 1];
      if (prev && minutesAt(b.startDate, b.startTime) < minutesAt(prev.endDate, prev.endTime)) b.warnings.push('overlaps another range');
    });
    return out;
  }

  const bookingLabel = (b) => shortDay(b.startDate) + ' ' + time12(b.startTime) + ' → ' +
    (b.endDate === b.startDate ? '' : shortDay(b.endDate) + ' ') + time12(b.endTime);
  // Shorter, for the panel's date list: "Mon 11/2 9 AM → Wed 11/4 4:30 PM"
  const time12s = (hm) => time12(hm).replace(':00 ', ' ');
  const shortLabel = (b) => shortDay(b.startDate) + ' ' + time12s(b.startTime) + ' → ' +
    (b.endDate === b.startDate ? '' : shortDay(b.endDate) + ' ') + time12s(b.endTime);
  // Same shape pageDates() returns, so availability checks and the queue can use it.
  const bookingDates = (b) => ({ kind: 'range', start: mdy(b.startDate), end: mdy(b.endDate), label: mdy(b.startDate) + ' → ' + mdy(b.endDate) });

  // ---------- the selected date range ----------
  // One list of dates. The selected range drives the availability badges on the equipment
  // list and on the preset, and "Add to basket"; "Book" makes one booking per range.
  const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
  const rangeOk = (r) => validRange(r) && minutesAt(r.endDate, r.endTime) > minutesAt(r.startDate, r.startTime);

  // v0.7 had separate "check dates"; fold them into the list and select them.
  (function migrateCheckDates() {
    const sh = store.get('shoot', null);
    if (!sh) return;
    store.del('shoot');
    if (!validRange(sh)) return;
    const same = (r) => r.startDate === sh.startDate && r.startTime === sh.startTime && r.endDate === sh.endDate && r.endTime === sh.endTime;
    let i = schedule.ranges.findIndex(same);
    if (i < 0) {
      schedule.ranges.push({ startDate: sh.startDate, startTime: sh.startTime, endDate: sh.endDate, endTime: sh.endTime });
      i = schedule.ranges.length - 1;
      saveSchedule();
    }
    ui.activeRange = i;
    saveUi();
  })();

  const activeIndex = () => (schedule.ranges.length ? Math.min(ui.activeRange != null ? ui.activeRange : 0, schedule.ranges.length - 1) : -1);
  function activeBooking() {
    const r = schedule.ranges[activeIndex()];
    return rangeOk(r) ? r : null;
  }

  // The dates presets and badges use: the selected range, else Connect2's own Availability box.
  function activeDates() {
    const ab = activeBooking();
    if (ab) return { d: bookingDates(ab), booking: ab, label: bookingLabel(ab), source: 'panel' };
    const d = pageDates();
    return d ? { d, booking: null, label: d.label, source: 'connect2' } : null;
  }

  function selectRange(i) {
    if (activeIndex() === i) return;
    ui.activeRange = i;
    saveUi(); render();
  }

  function addRange() {
    const last = schedule.ranges[schedule.ranges.length - 1];
    if (validRange(last)) {
      const startDate = addDays(last.endDate, 1); // day after the last return, same length and times
      schedule.ranges.push({ startDate, startTime: last.startTime, endDate: addDays(startDate, daysBetween(last.startDate, last.endDate)), endTime: last.endTime });
    } else {
      const d = addDays(todayYmd(), 1);
      schedule.ranges.push({ startDate: d, startTime: '09:00', endDate: d, endTime: '16:30' });
    }
    ui.activeRange = ui.editRange = schedule.ranges.length - 1;
    ui.showDates = true;
    saveSchedule(); saveUi(); render();
  }

  function updateRange(i, field, value) {
    const r = schedule.ranges[i];
    if (!r) return;
    // Moving the pickup date moves the return date with it, keeping the range's length.
    if (field === 'startDate' && isYmd(value) && isYmd(r.startDate) && isYmd(r.endDate)) {
      r.endDate = addDays(r.endDate, daysBetween(r.startDate, value));
    }
    r[field] = value;
    saveSchedule(); render();
  }

  function removeRange(i) {
    const active = activeIndex();
    schedule.ranges.splice(i, 1);
    if (active > i) ui.activeRange = active - 1;
    else if (active === i) ui.activeRange = Math.max(0, Math.min(i, schedule.ranges.length - 1));
    if (ui.editRange === i) ui.editRange = null;
    else if (ui.editRange != null && ui.editRange > i) ui.editRange -= 1;
    saveSchedule(); saveUi(); render();
  }

  function fitTimes(i, fix) {
    if (!schedule.ranges[i] || !fix) return;
    Object.assign(schedule.ranges[i], fix);
    saveSchedule(); render();
  }

  // ---------- which preset items fit a range ----------
  const laterOf = (a, b) => (minutesAt(a.date, a.time) >= minutesAt(b.date, b.time) ? a : b);
  const earlierOf = (a, b) => (minutesAt(a.date, a.time) <= minutesAt(b.date, b.time) ? a : b);

  // The part of booking b this unit is free for, when it's free for only part of it (or null).
  function freePart(r, b) {
    if (!r || !b) return null;
    let st = { date: b.startDate, time: b.startTime };
    let en = { date: b.endDate, time: b.endTime };
    if (r.kind === 'limited') {
      if (!r.shorter) return null;
      st = laterOf(st, { date: r.shorter.startDate, time: r.shorter.startTime });
      en = earlierOf(en, { date: r.shorter.endDate, time: r.shorter.endTime });
    } else if (fitFor(r, b).kind === 'hours') {
      if (r.collect) st = laterOf(st, { date: r.collect.date || b.startDate, time: r.collect.time });
      if (r.ret) en = earlierOf(en, { date: r.ret.date || b.endDate, time: r.ret.time });
    } else {
      return null;
    }
    return minutesAt(en.date, en.time) > minutesAt(st.date, st.time)
      ? { startDate: st.date, startTime: st.time, endDate: en.date, endTime: en.time } : null;
  }

  // From availability already checked: which preset slots have no unit that fits booking b, and
  // narrower times that would fit them all when only the times are the problem. Unchecked slots are skipped.
  function rangeProblems(p, b) {
    const d = bookingDates(b);
    let start = { date: b.startDate, time: b.startTime };
    let end = { date: b.endDate, time: b.endTime };
    let fixable = true;
    const issues = [];
    const problemSlots = [];
    for (const [si, slot] of p.slots.entries()) {
      const units = slot.options.map((o) => { const r = availFor(d, o.id); return { o, r, f: fitFor(r, b) }; });
      if (units.some((u) => u.f.kind === 'ok') || units.every((u) => !u.r)) continue;
      issues.push(slot.options[0].name + ': ' + units[0].f.why + (units.length > 1 ? ' (backups too)' : ''));
      problemSlots.push({ si, text: issues[issues.length - 1] });
      // When units are free for part of the time, narrow the booking to the unit with the most room.
      let best = null;
      for (const u of units) {
        const fp = freePart(u.r, b);
        if (!fp) continue;
        const st = { date: fp.startDate, time: fp.startTime }, en = { date: fp.endDate, time: fp.endTime };
        const room = minutesAt(en.date, en.time) - minutesAt(st.date, st.time);
        if (!best || room > best.room) best = { st, en, room };
      }
      if (!best) { fixable = false; continue; }
      start = laterOf(start, best.st);
      end = earlierOf(end, best.en);
    }
    const fix = fixable && issues.length && minutesAt(end.date, end.time) > minutesAt(start.date, start.time)
      ? { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time } : null;
    return { ok: !issues.length, issues, problemSlots, fix };
  }

  // Check every booking's units against its own times, before a run.
  async function preflight(p, bookings) {
    const reports = {};
    for (const b of bookings) {
      if (b.invalid) continue;
      await checkSlots(p, bookingDates(b), b, BOOKING_MINUTES);
      reports[b.index] = rangeProblems(p, b);
    }
    return reports;
  }

  // ---------- availability badges for the selected range ----------
  // What the badge next to an item on the equipment list says.
  function itemBadge(it) {
    const ab = activeBooking();
    if (!it.allowed || !ab) return null;
    const r = availFor(bookingDates(ab), it.id);
    if (!r) return { text: 'Checking…', kind: 'pending', detail: '' };
    const f = fitFor(r, ab);
    if (f.kind === 'ok') return { text: '✓ Available for your dates', kind: 'ok', detail: '' };
    const part = freePart(r, ab);
    if (f.kind === 'hours') return { text: '⚠ ' + cap(f.why), kind: 'limited', detail: '', part };
    if (f.kind === 'limited') return { text: '⚠ Available for only part of your dates', kind: 'limited', detail: part ? '' : r.detail, part };
    if (f.kind === 'unknown') return { text: '? Couldn\'t check', kind: 'unknown', detail: r.detail };
    return { text: '✗ Not available for your dates', kind: 'bad', detail: r.detail };
  }

  // Badges are left off while the script is adding, booking or scanning: those reload the page constantly.
  const busyElsewhere = () => !!(getRun() || store.get('queue', null) || store.get('scan', null));

  function decorateBadges() {
    ensurePageStyles();
    qsa('.c2p-avail').forEach((b) => b.remove());
    const ab = activeBooking();
    if (ab && isSelectPage() && !busyElsewhere()) {
      for (const it of pageItems()) {
        const bd = itemBadge(it);
        if (!bd) continue;
        const box = document.createElement('div');
        box.className = 'c2p-avail c2p-avail-' + bd.kind;
        const pill = document.createElement('span');
        pill.className = 'bc-pill ' + bd.kind;
        pill.title = 'Better Checkout · for ' + bookingLabel(ab) + (bd.detail ? ': ' + bd.detail : '');
        pill.append(logoEl(14), document.createTextNode(bd.text));
        box.appendChild(pill);
        if (bd.detail && bd.kind !== 'pending') {
          const det = document.createElement('div');
          det.className = 'bc-detail';
          det.textContent = bd.detail;
          box.appendChild(det);
        }
        if (bd.part) box.appendChild(freePartLine(bd.part));
        (it.li.querySelector('.resource-other') || it.li).appendChild(box);
      }
    }
    decorateFilterBar();
  }

  // "Free Wed 11/4 8 AM → Thu 11/5 12 PM  [Use these dates]", under an item on the list.
  function freePartLine(part) {
    const row = document.createElement('div');
    row.className = 'c2p-freepart';
    const t = document.createElement('span');
    t.textContent = 'Available ' + shortLabel(part);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bc-btn small';
    b.textContent = 'Use these dates';
    b.title = 'Change your selected dates to ' + bookingLabel(part);
    b.addEventListener('click', (e) => { e.preventDefault(); useDates(part); });
    row.append(t, b);
    return row;
  }

  // Switch the selected dates to `range` (or add it, when no dates are set), with Undo.
  function useDates(range) {
    const i = activeIndex();
    const next = { startDate: range.startDate, startTime: range.startTime, endDate: range.endDate, endTime: range.endTime };
    if (i < 0) {
      schedule.ranges.push(next);
      ui.activeRange = schedule.ranges.length - 1;
      saveSchedule(); saveUi();
      log('dates', 'added ' + bookingLabel(next));
      return setStatus('Your dates are now ' + shortLabel(next) + '.');
    }
    const prev = Object.assign({}, schedule.ranges[i]);
    Object.assign(schedule.ranges[i], next);
    saveSchedule();
    log('dates', 'changed ' + bookingLabel(prev) + ' to ' + bookingLabel(next));
    setStatus('Your dates are now ' + shortLabel(next) + ' (they were ' + shortLabel(prev) + ').', () => {
      if (!schedule.ranges[i]) return;
      Object.assign(schedule.ranges[i], prev);
      saveSchedule();
      log('dates', 'undid the change');
      setStatus('Your dates are back to ' + shortLabel(prev) + '.');
    });
  }

  // ---------- Connect2's own Availability box ----------
  // It's a second, date-only way to set dates, and it adds its own markers to the list. The helper
  // takes its place: the box is hidden, a small box shows the helper's dates, and dates already set
  // there are carried over once.
  function adoptConnect2Dates() {
    const pd = pageDates();
    if (!pd || schedule.ranges.length || store.get('adoptedC2', '') === pd.label) return;
    store.set('adoptedC2', pd.label);
    const part = (t) => {
      const m = String(t || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
      return m ? { date: m[3] + '-' + pad(m[1]) + '-' + pad(m[2]), time: m[4] ? pad(m[4]) + ':' + m[5] : null } : null;
    };
    const st = part(pd.kind === 'range' ? pd.start : pd.date), en = part(pd.kind === 'range' ? pd.end : pd.date);
    if (!st || !en) return;
    const r = { startDate: st.date, startTime: st.time || '09:00', endDate: en.date, endTime: en.time || '16:30' };
    if (!rangeOk(r)) return;
    schedule.ranges.push(r);
    ui.activeRange = schedule.ranges.length - 1;
    saveSchedule(); saveUi();
    log('dates', 'carried over Connect2 Availability dates ' + pd.label);
    statusText = 'Better Checkout is using the dates from Connect2\'s Availability box: ' + shortLabel(r) + '. You can change them under Dates.';
    store.set('lastStatus', statusText);
  }

  function takeOverAvailabilityBox() {
    ensurePageStyles();
    document.body.classList.add('c2p-own-avail'); // Connect2's own per-item markers would contradict Better Checkout's
    const box = qs('[id$="availabilitySearch_availabilitySetup"]');
    if (!box) return;
    box.style.display = 'none';
    let note = qs('.c2p-availnote');
    if (!note) {
      note = document.createElement('div');
      note.className = 'c2p-availnote searchContent withBorder';
      box.parentNode.insertBefore(note, box.nextSibling);
    }
    note.textContent = '';
    const label = document.createElement('label');
    label.textContent = 'Availability';
    const side = document.createElement('div');
    side.className = 'bc-side';
    const brand = document.createElement('span');
    brand.className = 'bc-side-brand';
    brand.append(logoEl(16), document.createTextNode('Better Checkout'));
    const ab = activeBooking();
    const txt = document.createElement('div');
    if (ab) {
      txt.append(document.createTextNode('Showing what\'s available '));
      const strong = document.createElement('span');
      strong.className = 'bc-side-dates';
      strong.textContent = shortLabel(ab);
      txt.append(strong);
    } else {
      txt.textContent = 'Pick your dates to see what\'s available.';
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'c2p-changedates bc-btn small';
    btn.textContent = ab ? 'Change dates' : 'Pick your dates';
    btn.addEventListener('click', (e) => { e.preventDefault(); pickDatesFromBar(); });
    side.append(brand, txt, btn);
    note.append(label, side);
  }

  // ---------- "Only show gear that's free" switch above Connect2's list ----------
  function setOnlyFree(on) {
    ui.onlyFree = on;
    saveUi();
    log('only-free switch', on ? 'on' : 'off');
    decorateBadges();
    render();
  }

  function pickDatesFromBar() {
    ui.open = true;
    ui.showDates = true;
    if (!schedule.ranges.length) return addRange(); // opens the new window's fields
    ui.editRange = activeIndex();
    saveUi(); render();
  }

  function decorateFilterBar() {
    qsa('.c2p-filterbar').forEach((b) => b.remove());
    qsa('[data-c2p-hidden]').forEach((li) => { li.style.display = ''; li.removeAttribute('data-c2p-hidden'); });
    const list = qs('ul.resource-list');
    if (!list || !isSelectPage() || busyElsewhere()) return;
    const ab = activeBooking();
    const on = !!ui.onlyFree && !!ab;

    const bar = document.createElement('div');
    bar.className = 'c2p-filterbar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Better Checkout');
    const span = (cls, t) => { const sp = document.createElement('span'); sp.className = cls; if (t) sp.textContent = t; return sp; };
    const brand = span('bc-brand');
    brand.append(logoEl(18), document.createTextNode('Better Checkout'));
    bar.appendChild(brand);

    if (!ab) {
      bar.appendChild(span('bc-sw-title', 'See only the gear that\'s available when you need it.'));
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'c2p-pickdates bc-btn solid';
      pick.textContent = 'Pick your dates';
      pick.addEventListener('click', (e) => { e.preventDefault(); pickDatesFromBar(); });
      bar.appendChild(pick);
      list.parentNode.insertBefore(bar, list);
      return;
    }

    // A big, labelled on/off switch.
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'c2p-onlyfree';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(on));
    const track = span('bc-track' + (on ? ' on' : ''));
    track.appendChild(span('bc-knob'));
    const words = span('bc-sw-words');
    words.append(span('bc-sw-title', 'Only show gear that\'s available ' + (on ? '(on)' : '(off)')), span('bc-sw-sub', shortLabel(ab)));
    sw.append(track, words);
    sw.addEventListener('click', (e) => { e.preventDefault(); setOnlyFree(!on); });
    bar.appendChild(sw);

    let hidden = 0, pending = 0;
    if (on) {
      for (const it of pageItems()) {
        const bd = itemBadge(it);
        if (bd && (bd.kind === 'pending' || bd.kind === 'unknown')) { if (bd.kind === 'pending') pending += 1; continue; }
        if (!it.allowed || (bd && bd.kind !== 'ok')) {
          it.li.style.display = 'none';
          it.li.setAttribute('data-c2p-hidden', '');
          hidden += 1;
        }
      }
    }
    const shown = pageItems().length - hidden;
    const note = !on ? 'Turn this on to hide everything that isn\'t available then.'
      : pending ? 'Still checking ' + pending + ' item' + (pending > 1 ? 's' : '') + '…'
      : !shown ? 'Nothing on this page is available then. Try the next page.'
      : 'Hiding ' + hidden + ' item' + (hidden === 1 ? '' : 's') + ' on this page that ' + (hidden === 1 ? 'isn\'t' : 'aren\'t') + ' available then.';
    bar.appendChild(span('bc-bar-note', note));
    list.parentNode.insertBefore(bar, list);
  }

  // Items not yet checked for the active dates: the preset's units first, then this page's items
  // (only for the panel's dates; with Connect2's own Availability box, Connect2 marks the list itself).
  function idsToCheck() {
    const act = activeDates();
    if (!act) return [];
    const ids = [];
    const p = presets[ui.current];
    if (p) for (const sl of p.slots) for (const o of sl.options) ids.push(o.id);
    if (act.source === 'panel' && isSelectPage()) for (const it of pageItems()) if (it.allowed) ids.push(it.id);
    return [...new Set(ids)].filter((id) => !availFor(act.d, id));
  }

  // Check them one at a time (with a pause between requests), stopping if the selected range changes.
  let loadingAvail = false;
  let availTimer = null;
  async function loadAvailability() {
    if (loadingAvail || starting || busyElsewhere()) return;
    const act = activeDates();
    if (!act) return;
    loadingAvail = true;
    const label = act.label;
    const d = act.d;
    const presetIds = new Set();
    const p = presets[ui.current];
    if (p) for (const sl of p.slots) for (const o of sl.options) presetIds.add(o.id);
    let fetched = 0;
    try {
      for (const id of idsToCheck()) {
        const cur = activeDates();
        if (!cur || cur.label !== label || starting || busyElsewhere()) break;
        await fetchAvailability(id, d, { quiet: true });
        fetched += 1;
        decorateBadges();
        presetIds.delete(id);
        if (p && p.slots.length && !presetIds.size && fetched) { presetIds.add('-done-'); render(); } // preset done: show it
      }
    } finally {
      loadingAvail = false;
    }
    if (fetched) render();
  }

  function scheduleAvailability() {
    if (loadingAvail || availTimer || !idsToCheck().length) return;
    availTimer = setTimeout(() => { availTimer = null; loadAvailability(); }, 0);
  }

  function pageSummary() {
    if (!activeBooking() || !isSelectPage() || busyElsewhere()) return '';
    const counts = { ok: 0, limited: 0, bad: 0, unknown: 0, pending: 0 };
    for (const it of pageItems()) { const bd = itemBadge(it); if (bd) counts[bd.kind] += 1; }
    const parts = [];
    if (counts.ok) parts.push(counts.ok + ' available');
    if (counts.limited) parts.push(counts.limited + ' partly available');
    if (counts.bad) parts.push(counts.bad + ' not available');
    if (counts.unknown) parts.push(counts.unknown + ' couldn\'t check');
    if (counts.pending) parts.push('checking ' + counts.pending + '…');
    return parts.length ? 'On this page: ' + parts.join(', ') + '.' : '';
  }

  // ---------- equipment catalog, for suggesting replacements ----------
  // catalog: { [id]: { name, type, note, allowed, category } }, saved from every equipment list page opened.
  let catalog = store.get('catalog', {}) || {};
  const catalogSize = () => Object.keys(catalog).length;

  function recordCatalog() {
    if (!isSelectPage()) return 0;
    const cat = category();
    const items = pageItems();
    for (const it of items) catalog[it.id] = { name: it.name, type: it.type, note: it.note, allowed: it.allowed, category: cat };
    if (items.length) store.set('catalog', catalog);
    if (items.length) store.set('listUrl', location.href.split('#')[0]); // where share links and "next booking" go
    return items.length;
  }

  function listTotal() {
    const el = qs('.wizard-resource-pager-top .pagination-summary');
    const m = el && el.textContent.match(/\((\d+) results?\)/);
    return m ? Number(m[1]) : 0;
  }

  // Name similarity: shared brand, focal lengths, apertures and kind words count most; shelf codes
  // ("A3-A6", "DD4", "#9") and filler words are ignored; the same Connect2 category adds a bonus.
  const STOPWORDS = new Set(['with', 'and', 'for', 'the', 'of', 'a', 'w/', '&', '-', '+', 'to']);
  const KIND_WORDS = new Set(['lens', 'camera', 'light', 'tripod', 'mic', 'microphone', 'recorder', 'monitor', 'stand', 'headphone',
    'lav', 'boompole', 'gimbal', 'slider', 'dolly', 'rig', 'mount', 'battery', 'kit', 'fresnel', 'softbox', 'reflector', 'cable',
    'case', 'filter', 'adapter', 'gel', 'diffusion', 'monolight', 'panel', 'mixer', 'speaker', 'projector', 'drone', 'tablet']);
  const isCode = (t) => /^#?\d{1,2}$/.test(t) || /^[a-z]{1,2}\d{0,2}(-[a-z]{1,2}\d{0,2})?$/.test(t);

  function nameTokens(name) {
    const toks = new Map();
    const add = (t, w) => toks.set(t, Math.max(w, toks.get(t) || 0));
    String(name || '').toLowerCase().replace(/[(),]/g, ' ').split(/\s+/).filter(Boolean).forEach((raw, i) => {
      if (STOPWORDS.has(raw) || isCode(raw)) return;
      const t = raw.length > 3 ? raw.replace(/s$/, '') : raw;
      if (/^\d+(\.\d+)?(-\d+(\.\d+)?)?mm$/.test(t)) { add(t, 3); add('~focal', 2); } // focal length or zoom range
      else if (/^f\/\d/.test(t)) add(t, 2);                                            // aperture
      else if (i === 0 || KIND_WORDS.has(t)) add(t, 2);                                // brand, kind of thing
      else add(t, 1);
    });
    return toks;
  }

  function similarity(a, b) {
    const ta = nameTokens(a.name), tb = nameTokens(b.name);
    let total = 0, shared = 0;
    for (const [t, w] of ta) { total += w; if (tb.has(t)) shared += w; }
    let score = total ? shared / total : 0;
    if (a.type && b.type) score += a.type === b.type ? 0.25 : -0.25;
    return score;
  }

  // Similar items not already in the preset, checked against the booking's times; up to 3 that fit.
  async function findReplacements(orig, b, p) {
    const d = bookingDates(b);
    const inPreset = new Set(p.slots.flatMap((s) => s.options.map((o) => o.id)));
    const base = Object.assign({ name: orig.name }, catalog[orig.id] || {});
    const pool = Object.entries(catalog)
      .filter(([id, c]) => !inPreset.has(id) && c.allowed !== false && (!p.category || !c.category || c.category === p.category))
      .map(([id, c]) => ({ id, name: c.name, type: c.type || '', note: c.note || '', score: similarity(base, c) }))
      .filter((c) => c.score >= 0.35)
      .sort((x, y) => y.score - x.score)
      .slice(0, 8);
    const found = [];
    for (const c of pool) {
      if (fitFor(await fetchAvailability(c.id, d), b).kind === 'ok') found.push(c);
      if (found.length >= 3) break;
    }
    return { found, looked: pool.length };
  }

  // Replacement searches shown in the panel, by key: { loading } or { found, looked }
  let replacements = {};

  async function searchReplacements(key, orig, b, p) {
    replacements[key] = { loading: true };
    render();
    try {
      replacements[key] = await findReplacements(orig, b, p);
    } catch (e) {
      replacements[key] = { found: [], looked: 0, error: String(e.message || e) };
    }
    render();
  }

  // Add an item as the last alternate of the preset slot that holds `origId`.
  function addAlternate(presetName, origId, cand) {
    const p = presets[presetName];
    const pos = p && findOption(p, origId);
    if (!pos || findOption(p, cand.id)) return false;
    p.slots[pos.si].options.push({ id: cand.id, name: cand.name, note: cand.note || '' });
    savePresets();
    return true;
  }

  function renderReplacements(key, orig, b, p, pickLabel, onPick) {
    const st = replacements[key];
    if (!catalogSize()) {
      return el('div', { class: 'repl' },
        el('div', { class: 'muted' }, 'To suggest similar gear, Better Checkout needs to know what else the cage has.'),
        isSelectPage() ? el('button', { onclick: startScan }, 'Scan equipment list') : el('div', { class: 'muted' }, 'Open the equipment list once, or scan it from there.'));
    }
    if (!st) return el('div', { class: 'repl' }, el('button', { onclick: () => searchReplacements(key, orig, b, p) }, 'Find something similar'));
    if (st.loading) return el('div', { class: 'repl muted' }, 'Looking for similar gear that\'s available then…');
    if (!st.found.length) {
      return el('div', { class: 'repl muted' }, st.looked
        ? 'None of the ' + st.looked + ' most similar items are available then.'
        : 'Nothing similar among the ' + catalogSize() + ' items Better Checkout knows' + (listTotal() > catalogSize() ? '. Scan the equipment list to search all of it' : '') + '.');
    }
    return el('div', { class: 'repl' },
      el('div', { class: 'muted' }, 'Available then:'),
      st.found.map((c) => el('div', { class: 'cand' },
        el('span', {}, c.name, c.type ? el('span', { class: 'muted' }, ' · ' + c.type) : null),
        el('button', { onclick: () => onPick(c) }, pickLabel))));
  }

  // ---------- scanning the whole equipment list into the catalog ----------
  // scan: { phase: 'clear'|'rewind'|'walk', loads }
  const nextPageLink = () => qs('[id$="resourcePager_LinkButtonNext"]');
  const prevPageLink = () => qs('[id$="resourcePager_LinkButtonPrevious"], [id$="resourcePager_LinkButtonPrev"], .wizard-resource-pager-top a[aria-label="Previous page"]');

  function startScan() {
    if (!isSelectPage()) return setStatus('Open Book by Category → your equipment list first.');
    if (store.get('queue', null) || getRun()) return setStatus('Finish or stop the current run first.');
    store.set('scan', { phase: 'clear', loads: 0 });
    log('scan', 'started');
    scanTick();
  }

  function scanTick() {
    const sc = store.get('scan', null);
    if (!sc) return;
    if (!isSelectPage()) { store.del('scan'); return setStatus('Scan stopped: this isn\'t an equipment list page.'); }
    sc.loads += 1;
    if (sc.loads > 60) { store.del('scan'); return setStatus('Scan stopped after 60 pages. ' + catalogSize() + ' items saved.'); }
    if (sc.phase === 'clear') {
      sc.phase = 'rewind';
      const box = searchBox();
      if (box && box.value.trim()) { store.set('scan', sc); box.value = ''; searchBtn().click(); return; } // show the full list
    }
    if (sc.phase === 'rewind') {
      const prev = prevPageLink();
      if (prev) { store.set('scan', sc); setStatus('Scanning: going back to page 1…'); prev.click(); return; }
      sc.phase = 'walk';
    }
    recordCatalog();
    const next = nextPageLink();
    if (next) { store.set('scan', sc); log('scan', 'page done, ' + catalogSize() + ' items known'); setStatus('Scanning the equipment list… ' + catalogSize() + ' items saved so far.'); next.click(); return; }
    store.del('scan');
    const total = listTotal();
    log('scan', 'done: ' + catalogSize() + ' items known, list says ' + (total || '?'));
    setStatus('Scan done: Better Checkout now knows ' + catalogSize() + ' items' + (total ? ' (this list has ' + total + ')' : '') + ', so it can suggest similar gear.');
  }

  function stopScan() { store.del('scan'); setStatus('Scan stopped. ' + catalogSize() + ' items saved.'); }

  // ---------- booking run across date ranges (survives page reloads) ----------
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

  async function startRun() {
    const p = presets[ui.current];
    const bookings = computeBookings(schedule.ranges);
    if (!p || !p.slots.length) return setStatus('Pick a preset with items first.');
    if (!bookings.length) return setStatus('Add dates first.');
    if (bookings.some((b) => b.invalid)) return setStatus('Fix the dates marked "return is not after pickup" first.');
    if (!isSelectPage()) return setStatus('Open Book by Category → ' + (p.category || 'your equipment category') + ' first.');
    if (p.category && category() && p.category !== category()) {
      if (!confirm('This preset was made in "' + p.category + '", but this page is "' + category() + '". Continue anyway?')) return;
    }
    if (starting) return;
    starting = true;
    let reports;
    try {
      setStatus('Checking "' + ui.current + '" for ' + (bookings.length > 1 ? 'all ' + bookings.length + ' dates…' : 'those dates…'));
      reports = await preflight(p, bookings);
    } finally {
      starting = false;
    }
    if (getRun()) return;
    const problems = bookings.filter((b) => b.warnings.length || (reports[b.index] && !reports[b.index].ok));
    const lines = bookings.map((b, i) => {
      const r = reports[b.index];
      const notes = b.warnings.concat(r && !r.ok ? r.issues : []);
      return (i + 1) + '. ' + bookingLabel(b) + (notes.length ? '\n     ⚠ ' + notes.join('\n     ⚠ ') : '');
    });
    if (!confirm('Better Checkout: book "' + ui.current + '" for ' + (bookings.length > 1 ? bookings.length + ' dates' : 'these dates') + '?\n\n' + lines.join('\n') +
      (problems.length ? '\n\nSome bookings have problems, and Connect2 will probably reject them as entered. Cancel to fix them first: select those dates in the panel to see what\'s wrong.' : '') +
      '\n\nFor each booking, Better Checkout adds the gear, fills in the times and stops at Terms & Conditions. You finish each booking yourself.')) return;
    saveRun({
      preset: ui.current,
      bookings: bookings.map(({ startDate, startTime, endDate, endTime, days }) => ({ startDate, startTime, endDate, endTime, days })),
      b: 0, stage: 'basket', problem: '', notes: [], done: [],
      listUrl: location.href.split('#')[0],
    });
    log('run', 'started: ' + bookings.length + ' booking(s) of "' + ui.current + '"');
    beginBooking();
  }

  function beginBooking() {
    const run = getRun();
    if (!run) return;
    if (!isSelectPage()) return setStatus('Open Book by Category → ' + ((presets[run.preset] || {}).category || 'your equipment category') + ' first.');
    const n = basketCount();
    if (n > 0 && !confirm('Your basket already has ' + n + ' item(s). They\'ll be included in booking ' + (run.b + 1) + '. Continue?')) return;
    run.stage = 'basket'; run.problem = ''; run.notes[run.b] = ''; run.gate = null;
    saveRun(run);
    startQueue(run.preset, { dates: bookingDates(run.bookings[run.b]), booking: run.bookings[run.b], run: true });
  }

  // A choice in the run's "not free" list: 'alt' (a replacement was added), 'anyway', or 'skip'.
  function decideGate(si, choice) {
    const run = getRun();
    if (!run || run.stage !== 'gate' || !run.gate) return;
    run.gate.decided[si] = choice;
    saveRun(run);
    const open = run.gate.blocked.filter((g) => !run.gate.decided[g.si]);
    if (open.length) return render();
    run.stage = 'basket';
    saveRun(run);
    startQueue(run.preset, { dates: bookingDates(run.bookings[run.b]), booking: run.bookings[run.b], run: true });
  }

  function nextBooking(step) {
    const run = getRun();
    if (!run) return;
    run.b = Math.min(run.b + step, run.bookings.length - 1);
    saveRun(run);
    beginBooking();
  }

  function endRun() { log('run', 'ended by you'); store.del('run'); store.del('queue'); setStatus('Run ended. Bookings you completed stay booked.'); }

  // Connect2 showed its Complete page: that booking is done.
  function completeBooking(run) {
    run.done = run.done || [];
    if (run.done[run.b]) return; // the Complete page was reloaded
    run.done[run.b] = true;
    const n = run.bookings.length;
    log('run', 'booking ' + (run.b + 1) + ' of ' + n + ' complete');
    if (run.b + 1 >= n) {
      store.del('run');
      return setStatus(n > 1
        ? '✓ All ' + n + ' bookings of "' + run.preset + '" are complete. The run has ended.'
        : '✓ Booking complete. The run has ended.');
    }
    run.stage = 'done';
    run.problem = '';
    saveRun(run);
    render();
  }

  // From the Complete page (or anywhere): go back to the equipment list and start the next booking.
  function goToNextBooking() {
    const run = getRun();
    if (!run) return;
    if (isSelectPage()) return nextBooking(1);
    const url = run.listUrl || store.get('listUrl', '');
    if (!url) return setStatus('Open Book by Category → ' + ((presets[run.preset] || {}).category || 'your equipment category') + ' to start booking ' + (run.b + 2) + '.');
    run.autoStart = true;
    saveRun(run);
    log('run', 'going back to the list for booking ' + (run.b + 2));
    location.href = url;
  }

  function handoff(run, problem) {
    run.stage = 'handoff'; run.problem = problem || '';
    saveRun(run);
    log('run', 'booking ' + (run.b + 1) + (problem ? ' stopped: ' + problem : ': pressed Next to Terms & Conditions'));
    render();
  }

  // Called by the basket queue when a run's gear is in the basket.
  function afterRunBasket(run, good, summary) {
    run.notes[run.b] = summary;
    if (!good) return handoff(run, 'Nothing could be added for this booking.');
    const btn = nextBtn();
    if (!btn || btn.disabled) return handoff(run, 'Couldn\'t press Create booking. Press it yourself, set ' + bookingLabel(run.bookings[run.b]) + ', and finish the booking.');
    run.stage = 'create';
    saveRun(run); render();
    log('run', 'booking ' + (run.b + 1) + ': pressed Create booking');
    btn.click(); // "Create booking" → Select time
  }

  // Connect2's explanation and suggested times after it rejects an Update on Select time.
  function clashInfo() {
    const box = qs('[id$="MainWizardContent_suggestionsDv"]');
    if (!box) return null;
    const reasons = qsa('li', box).filter((li) => !/ItemsList$/.test(li.id || '')).map((li) => {
      const ps = li.querySelectorAll('p');
      const title = clean(ps[0] ? ps[0].textContent : '');
      const msg = clean(ps[1] ? ps[1].textContent : li.textContent);
      // Case-sensitive on purpose: item names can contain words like "IS" ("f/4L IS USM Lens").
      const item = (msg.match(/[Bb]ooking of (.+?) (?:must|would|cannot|can not|is not|has been|will not) /) || [])[1];
      const why = /open times/i.test(title) ? 'outside cage hours'
        : /other bookings/i.test(title) ? 'booked by someone else during that time'
        : title.replace(/^clashes with /i, '');
      return item ? { item, why, text: item + ': ' + why } : { item: '', why: '', text: clean(title + ' ' + msg) };
    }).filter((r) => r.text);
    const suggestions = qsa('.suggestions-list a[id*="suggestionLink"]', box).map((a) => {
      const text = clean(a.textContent);
      const [from, to] = text.split(/\s+-\s+/);
      const s = parseMdyTime(from), e = parseMdyTime(to);
      return s && e ? { id: a.id, startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time } : null;
    }).filter(Boolean);
    return reasons.length || suggestions.length ? { reasons: reasons.map((r) => r.text), items: reasons.filter((r) => r.item), suggestions } : null;
  }

  // Use one of Connect2's suggested times: its own link sets the times and posts back,
  // then the run checks the result and presses Next as usual.
  function pickSuggestion(sug) {
    const run = getRun();
    const link = document.getElementById(sug.id);
    if (!run || !link) return;
    run.bookings[run.b] = { startDate: sug.startDate, startTime: sug.startTime, endDate: sug.endDate, endTime: sug.endTime, days: daysBetween(sug.startDate, sug.endDate) + 1 };
    run.stage = 'time';
    run.problem = '';
    saveRun(run);
    log('run', 'picked Connect2\'s suggested time ' + bookingLabel(sug));
    render();
    link.click();
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
    if (!run) return;
    if (isCompletePage()) return completeBooking(run);
    if (run.stage === 'done' && run.autoStart && isSelectPage()) {
      run.autoStart = false;
      saveRun(run);
      return nextBooking(1);
    }
    if (run.stage === 'handoff' || run.stage === 'basket' || run.stage === 'gate' || run.stage === 'done') return;
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
      log('run', 'booking ' + (run.b + 1) + ': filled ' + mdy(bk.startDate) + ' ' + time12(bk.startTime) + ' → ' + mdy(bk.endDate) + ' ' + time12(bk.endTime) + ', pressed Update');
      statusText = 'Booking ' + (run.b + 1) + ' of ' + run.bookings.length + ': setting ' + bookingLabel(bk) + '…';
      render();
      const update = qs('input[id$="editResourceBookingsTime_btnUpdate"]');
      if (!update) return handoff(run, 'Couldn\'t find the Update button. Set ' + bookingLabel(bk) + ' yourself.');
      update.click(); // posts back with the new times
      return;
    }
    // stage 'time': the Update postback has come back
    const clash = clashInfo();
    const errs = timeErrors();
    const next = nextBtn();
    const sd = timeField('startDate'), ed = timeField('endDate');
    const datesStuck = sd && ed && sameMdy(sd.value, bk.startDate) && sameMdy(ed.value, bk.endDate);
    if (clash || errs || !datesStuck || !next || next.disabled) {
      return handoff(run, 'Connect2 didn\'t accept ' + bookingLabel(bk) +
        (clash && clash.reasons.length ? ': ' + clash.reasons.join('; ')
          : errs ? ': ' + errs
          : !datesStuck ? ' (the dates didn\'t stick)'
          : ' (Next is still disabled; an item may be unavailable or the cage closed then)') + '.');
    }
    handoff(run, '');
    next.click(); // → Terms & Conditions; the rest is up to you
  }

  // ---------- add-to-basket queue (survives page reloads) ----------
  // queue: { preset, items: [{ options, fits, first, firstFit }], i, opt, phase: 'find'|'searched'|'searched2'|'clicked',
  //          before, loadsKey, loads, skipped: [], results: [{ ok, line }], note }
  const MAX_LOADS_PER_OPTION = 6;
  let starting = false;

  // opts.dates overrides the page's Availability dates; opts.booking adds times to fit; opts.run marks a booking run.
  async function startQueue(name, opts = {}) {
    const p = presets[name];
    if (!p || !p.slots.length) return setStatus('That preset is empty.');
    if (!isSelectPage()) return setStatus('Open a "Book by Category" equipment list first.');
    if (!opts.run && p.category && category() && p.category !== category()) {
      if (!confirm('This preset was made in "' + p.category + '", but this page is "' + category() + '". Continue anyway?')) return;
    }
    if (starting) return;
    starting = true;
    try {
      const act = opts.dates ? null : activeDates();
      const d = opts.dates || (act && act.d);
      const booking = opts.booking || (act && act.booking) || null;
      let note = '';
      if (d) {
        setStatus('Checking what\'s available ' + (act ? act.label : d.label) + '…');
        await checkSlots(p, d, booking, BOOKING_MINUTES);
      } else if (p.slots.some((s) => s.options.length > 1)) {
        note = 'No dates were picked, so first choices were used. Pick your dates first to let backups stand in for taken gear.';
      }
      let items = p.slots.map((s) => {
        const options = orderOptions(s.options, d, booking);
        const fitOf = (o) => (d ? fitFor(availFor(d, o.id), booking) : { kind: 'nodates', why: '' });
        return { options, fits: options.map(fitOf), first: s.options[0], firstFit: fitOf(s.options[0]) };
      });
      // In a run, stop before adding anything if an item has no unit that fits this booking,
      // so you can pick a replacement, add it anyway, or leave it out.
      const run = opts.run ? getRun() : null;
      if (run && d) {
        const decided = (run.gate && run.gate.decided) || {};
        const blocked = items.map((it, si) => si).filter((si) => !items[si].fits.some((f) => f.kind === 'ok') && !decided[si]);
        if (blocked.length) {
          run.stage = 'gate';
          log('run', 'booking ' + (run.b + 1) + ': not available as booked: ' + blocked.map((si) => items[si].first.name).join('; '));
          run.gate = { decided, blocked: blocked.map((si) => ({ si, id: items[si].first.id, name: items[si].first.name, why: items[si].firstFit.why })) };
          saveRun(run);
          setStatus('Booking ' + (run.b + 1) + ': ' + blocked.length + (blocked.length > 1 ? ' items aren\'t' : ' item isn\'t') + ' available as booked. Nothing was added yet; choose what to do above.');
          return;
        }
        items = items.filter((it, si) => decided[si] !== 'skip');
        if (Object.values(decided).includes('skip')) note = [note, 'Left out: ' + Object.keys(decided).filter((k) => decided[k] === 'skip').map((k) => p.slots[k].options[0].name).join('; ') + '.'].filter(Boolean).join(' ');
      }
      log('adding', '"' + name + '": ' + items.length + ' item(s)' + (d ? ' for ' + (act ? act.label : d.label) : ', no dates'));
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
    log('skip', o.name + ': ' + reason);
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
      log(ok ? 'added' : 'not added', o.name + ' (basket ' + q.before + ' → ' + now + ')' + (ok ? '' : pageMessage() ? ': ' + pageMessage() : ''));
      if (!ok) {
        q.results.push({ ok: false, line: o.name + ': ' + (pageMessage() || 'basket count didn\'t change (already in basket?)') });
      } else {
        const notes = [];
        if (o.id !== it.first.id) {
          const why = q.skipped.slice();
          const ff = it.firstFit || {};
          if (ff.kind === 'hours') why.unshift(it.first.name + ' (' + ff.why + ')');
          else if (ff.kind === 'bad' || ff.kind === 'limited') why.unshift(it.first.name + ' (not available for your dates)');
          notes.push('used ' + o.name + ' instead of ' + it.first.name + (why.length ? ' — skipped ' + why.join('; ') : ''));
        }
        const f = (it.fits || [])[q.opt] || {};
        if (f.kind === 'bad') notes.push(o.name + ' was added, but none of its units are available for your dates');
        else if (f.kind === 'limited') notes.push(o.name + ' is only partly available for your dates');
        else if (f.kind === 'hours') notes.push(o.name + ' was added, but Connect2 says ' + f.why);
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
      log('add', 'pressed Add for ' + o.name + ' (item ' + o.id + '), basket was ' + q.before);
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
    log('search', '"' + text + '"');
    box.value = text;
    btn.click(); // reloads the page with search results
  }

  function finishQueue(q) {
    store.del('queue');
    const good = q.results.filter((r) => r.ok).length;
    const lines = q.results.filter((r) => r.line).map((r) => (r.ok ? '• ' : '✗ ') + r.line);
    let msg = 'Added ' + good + ' of ' + q.results.length + ' from "' + q.preset + '".';
    log('done adding', 'added ' + good + ' of ' + q.results.length);
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

  // ---------- copying, sharing and problem reports ----------
  function copyText(textToCopy, okMsg) {
    const fallback = () => { prompt('Copy this (Ctrl+C or ⌘C), then press OK:', textToCopy); setStatus(okMsg); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(textToCopy).then(() => setStatus(okMsg), fallback);
    else fallback();
  }

  const b64url = (str) => btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64url = (code) => decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4))));

  // A link to the equipment list that adds this preset for anyone with the script installed.
  function shareLink(name) {
    const p = presets[name];
    const data = { v: 1, n: name, c: p.category, s: p.slots.map((sl) => sl.options.map((o) => [o.id, o.name])) };
    const base = (store.get('listUrl', '') || location.origin + '/wizard/').split('#')[0];
    return base + '#c2p=' + b64url(JSON.stringify(data));
  }

  function copyShareLink() {
    if (!presets[ui.current]) return;
    log('share', 'copied link for "' + ui.current + '"');
    copyText(shareLink(ui.current), 'Link copied. Anyone with Better Checkout who opens it while signed in to Connect2 gets "' + ui.current + '".');
  }

  // Opened a share link: offer to add the preset in it.
  function importFromLink() {
    const m = location.hash.match(/^#c2p=([A-Za-z0-9_-]+)/);
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* leave the link as is */ }
    let data = null;
    try { data = JSON.parse(unb64url(m[1])); } catch (e) { data = null; }
    const preset = data && data.n && Array.isArray(data.s) ? normalizePreset({
      category: data.c,
      slots: data.s.map((units) => ({ options: (Array.isArray(units) ? units : []).filter((u) => Array.isArray(u) && u[0] != null)
        .map((u) => ({ id: u[0], name: u[1], note: (catalog[String(u[0])] || {}).note || '' })) })),
    }) : null;
    if (!preset || !preset.slots.length) {
      log('share', 'broken link');
      return setStatus('That share link is broken or incomplete. Ask for a new one.');
    }
    const count = preset.slots.length + (preset.slots.length === 1 ? ' item' : ' items');
    if (!confirm('Better Checkout: add the equipment preset "' + data.n + '" (' + count + ') that was shared with you?')) return log('share', 'declined "' + data.n + '"');
    let name = String(data.n);
    if (presets[name] && !confirm('You already have a preset called "' + name + '". Replace it?')) {
      let k = 2;
      while (presets[name + ' (shared' + (k > 2 ? ' ' + k : '') + ')']) k += 1;
      name = name + ' (shared' + (k > 2 ? ' ' + k : '') + ')';
    }
    presets[name] = preset;
    Object.assign(ui, { current: name, open: true, showPresets: true, editing: false, altFor: null });
    savePresets(); saveUi();
    log('share', 'added "' + name + '" (' + count + ')');
    setStatus('Added the preset "' + name + '" (' + count + ').');
  }

  function problemReport() {
    const yes = (x) => (x ? 'yes' : 'no');
    const ua = (navigator.userAgent.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/) || []);
    const browser = ua[1] ? ({ Edg: 'Edge', OPR: 'Opera', Version: 'Safari' }[ua[1]] || ua[1]) + ' ' + ua[2] : 'unknown browser';
    const btns = qsa('li.resource-list-item .resource-book input[type="submit"]');
    const run = getRun(), q = store.get('queue', null), sc = store.get('scan', null);
    const p = presets[ui.current];
    const ab = activeBooking();
    const when = (t) => { const d = new Date(t); return pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
    const lines = [
      'Better Checkout problem report',
      'Better Checkout ' + VERSION + ' · ' + browser + ' · ' + new Date().toISOString(),
      'Page: ' + location.pathname + ' (' + pageKind() + ')' + (stepText() ? ' · ' + stepText() : '') + (pageTitle() ? ' · "' + pageTitle() + '"' : ''),
      'Found: ' + [
        'list items ' + qsa('li.resource-list-item').length,
        'add buttons ' + btns.filter((b) => !b.disabled).length + ' on / ' + btns.filter((b) => b.disabled).length + ' off',
        'search box ' + yes(searchBox()),
        'next page ' + yes(nextPageLink()),
        'previous page ' + yes(prevPageLink()),
        'list total ' + (listTotal() || '?'),
        'basket ' + (basketCount() >= 0 ? basketCount() : 'not found'),
        'Next/Create button ' + (nextBtn() ? (nextBtn().disabled ? 'disabled' : 'enabled') : 'not found'),
        'time fields ' + yes(timeField('startDate')),
        'clash box ' + yes(qs('[id$="MainWizardContent_suggestionsDv"]')),
      ].join(', '),
      'State: ' + [
        Object.keys(presets).length + ' preset(s)' + (p ? ', selected has ' + p.slots.length + ' item(s)' : ''),
        schedule.ranges.length + ' date window(s)' + (ab ? ', selected ' + bookingLabel(ab) : ''),
        run ? 'run on booking ' + (run.b + 1) + '/' + run.bookings.length + ', stage ' + run.stage + (run.problem ? ' (' + run.problem.slice(0, 160) + ')' : '') : 'no run',
        q ? 'adding item ' + (q.i + 1) + '/' + q.items.length + ', phase ' + q.phase : 'not adding',
        sc ? 'scanning (' + sc.phase + ', ' + sc.loads + ' pages)' : 'not scanning',
        catalogSize() + ' known items',
        Object.keys(availability).length + ' saved results',
        'only-free switch ' + (ui.onlyFree ? 'on' : 'off'),
      ].join('; '),
      '',
      'Recent steps (oldest first):',
    ];
    for (const e of store.get('log', []) || []) lines.push(when(e.t) + '  [' + e.k + '] ' + e.ev + (e.d ? ': ' + e.d : ''));
    return lines.join('\n');
  }

  function copyProblemReport() {
    copyText(problemReport(), 'Problem report copied. Paste it into a message to whoever gave you Better Checkout. It doesn\'t include your name or login.');
  }

  // ---------- preset management ----------
  function newPreset() {
    const name = (prompt('Name your equipment preset (for example "A-cam package" or "Interview audio"):') || '').trim();
    if (!name) return;
    if (presets[name] && !confirm('"' + name + '" already exists. Replace it?')) return;
    presets[name] = { category: category(), slots: [] };
    ui.current = name; ui.editing = true; ui.altFor = null; ui.showPresets = true;
    savePresets(); saveUi();
    setStatus('Now click "+ Preset" on each item you want in "' + name + '". Use Connect2\'s search or categories to find them.');
  }

  function renamePreset() {
    const old = ui.current;
    if (!old) return;
    const name = (prompt('Rename "' + old + '" to:', old) || '').trim();
    if (!name || name === old) return;
    if (presets[name]) return alert('You already have a preset with that name.');
    presets[name] = presets[old]; delete presets[old];
    ui.current = name; savePresets(); saveUi(); render();
  }

  function deletePreset() {
    if (!ui.current || !confirm('Delete the preset "' + ui.current + '"? This can\'t be undone.')) return;
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
    copyText(JSON.stringify(presets, null, 2), 'Copied all your presets as text. Someone else can add them with Import presets.');
  }

  function importPresets() {
    const txt = prompt('Paste the text from Export presets:');
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
      setStatus('Imported ' + n + (n === 1 ? ' preset.' : ' presets.'));
    } catch (e) {
      alert('That text isn\'t from Export presets. Copy it again and try once more.');
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
    *, *::before, *::after { box-sizing: border-box; }
    .panel { position: fixed; right: 16px; bottom: 16px; width: 368px; max-height: min(80vh, 760px); display: flex; flex-direction: column;
      background: ${C.paper}; color: ${C.ink}; border: 1px solid ${C.line2}; border-radius: 12px; overflow: hidden;
      box-shadow: 0 12px 32px rgba(23, 24, 29, .18), 0 2px 6px rgba(23, 24, 29, .08);
      font: 13px/1.45 ${FONT}; z-index: 2147483000; }
    .panel.closed { width: auto; max-width: 368px; border-radius: 999px; border-color: ${C.ink}; }

    header { display: flex; align-items: center; gap: 9px; padding: 11px 14px 10px; background: ${C.ink}; color: #fff;
      cursor: pointer; user-select: none; position: relative; }
    header::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 4px; background: ${STRIPES}; }
    .panel.closed header { padding: 9px 16px 9px 12px; }
    .panel.closed header::before { display: none; }
    .wordmark { font-size: 14.5px; font-weight: 700; letter-spacing: -.015em; white-space: nowrap; }
    .hm { font-size: 12px; color: #c9ccd4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hchev { margin-left: auto; color: #c9ccd4; font-size: 12px; }
    .bc-mark { display: inline-flex; line-height: 0; flex: none; }

    .body { overflow-y: auto; overscroll-behavior: contain; }
    .intro { padding: 12px 16px 2px; color: ${C.muted}; }

    button { font: inherit; color: ${C.ink}; padding: 5px 11px; border: 1px solid ${C.line2}; border-radius: 6px; background: ${C.paper}; cursor: pointer; }
    button:hover { border-color: ${C.ink}; }
    button:disabled { opacity: .45; cursor: default; border-color: ${C.line2}; }
    button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid ${C.focus}; outline-offset: 2px; }
    button.primary { background: ${C.ink}; border-color: ${C.ink}; color: #fff; font-weight: 600; padding: 7px 14px; }
    button.primary:hover { background: ${C.ink2}; }
    button.on { background: ${C.tapeSoft}; border-color: ${C.tapeLine}; }
    button.mini { padding: 2px 9px; font-size: 12px; }
    button.link { border: 0; background: none; padding: 2px 0; font-size: 12.5px; color: ${C.ink}; text-decoration: underline;
      text-decoration-color: ${C.line2}; text-underline-offset: 3px; }
    button.link:hover { text-decoration-color: ${C.ink}; }
    .x { border: 0 !important; background: none !important; color: ${C.muted}; font-size: 17px !important; line-height: 1; padding: 0 4px !important; }
    .x:hover { color: ${C.ink}; }
    select { flex: 1; min-width: 0; font: inherit; color: ${C.ink}; padding: 5px 8px; border: 1px solid ${C.line2}; border-radius: 6px; background: ${C.paper}; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

    .card { border-top: 1px solid ${C.line}; }
    .card:first-child { border-top: 0; }
    .card-h { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; border-radius: 0; background: none; padding: 11px 16px; text-align: left; }
    .card-h:hover { background: ${C.mist}; border: 0; }
    .card-t { font-weight: 700; font-size: 13.5px; }
    .card-m { flex: 1; min-width: 0; text-align: right; color: ${C.muted}; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chev { margin-left: auto; color: ${C.muted}; font-size: 11px; width: 10px; text-align: right; }
    .card-m + .chev { margin-left: 0; }
    .card-b { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 8px; }

    .range { border: 1px solid ${C.line}; border-radius: 8px; padding: 6px 8px; display: flex; flex-direction: column; gap: 5px; }
    .range.active { border: 1.5px solid ${C.ink}; background: ${C.tapeSoft}; padding: 5.5px 7.5px; }
    .range-row { display: flex; align-items: center; gap: 4px; }
    .pick { flex: 1; min-width: 0; display: flex; gap: 8px; align-items: baseline; border: 0; background: none; padding: 2px 0; text-align: left; }
    .pick:hover { border: 0; }
    .dot { width: 10px; flex: none; font-size: 11px; color: ${C.muted}; }
    .range.active .dot { color: ${C.ink}; }
    .rl { flex: 1; min-width: 0; font-weight: 600; }
    .rl .len { display: block; font-weight: 400; font-size: 12px; color: ${C.muted}; }
    .fit { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; font-size: 12.5px; padding: 7px 9px;
      background: ${C.paper}; border: 1px solid ${C.tapeLine}; border-radius: 6px; width: 100%; }
    .extras { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; padding-left: 18px; }
    .day { display: flex; gap: 6px; align-items: center; }
    .day input { font: 12.5px ${FONT}; color: ${C.ink}; padding: 3px 5px; border: 1px solid ${C.line2}; border-radius: 5px; min-width: 0; background: ${C.paper}; }
    .day input[type=date] { flex: 1.4; } .day input[type=time] { flex: 1; }
    .day .lbl { width: 48px; flex: none; font-size: 12px; color: ${C.muted}; }

    ul { list-style: none; margin: 0; padding: 0; border: 1px solid ${C.line}; border-radius: 8px; }
    li.slot { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; border-top: 1px solid ${C.line}; }
    li.slot:first-child { border-top: 0; }
    li.slot.target { background: ${C.tapeSoft}; }
    .opts { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .opt { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
    .opt .nm { flex: 1 1 150px; min-width: 0; } /* keeps names readable: a long badge wraps under the name instead */
    .opt .or { color: ${C.muted}; font-size: 11.5px; }
    .opt.alt { font-size: 12.5px; padding-left: 12px; color: ${C.ink2}; }
    .tools { display: flex; gap: 2px; align-items: center; }
    .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; }
    .ok { background: ${C.okBg}; color: ${C.ok}; } .limited { background: ${C.partBg}; color: ${C.part}; }
    .bad { background: ${C.noBg}; color: ${C.no}; } .unknown { background: ${C.unkBg}; color: ${C.unk}; } .pending { background: ${C.mist}; color: ${C.muted}; }
    .actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding-top: 2px; }

    .warn { width: 100%; color: ${C.part}; font-size: 12px; }
    .detail { width: 100%; color: ${C.muted}; font-size: 11.5px; }
    .muted { color: ${C.muted}; font-size: 12px; }
    .okline { color: ${C.ok}; font-size: 12.5px; font-weight: 600; }
    .hint { background: ${C.tapeSoft}; border: 1px solid ${C.tapeLine}; border-radius: 8px; padding: 7px 10px; font-size: 12.5px; }
    .freepart { width: 100%; display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: 12px; color: ${C.ink2}; }
    .status { position: relative; margin: 12px 16px 4px; white-space: pre-wrap; background: ${C.mist}; border-left: 3px solid ${C.ink};
      border-radius: 6px; padding: 9px 30px 9px 11px; font-size: 12.5px; }
    .status .close { position: absolute; top: 7px; right: 6px; }
    .status .row { margin-top: 7px; white-space: normal; }
    .foot { color: ${C.muted}; font-size: 11.5px; }

    .repl { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; padding-left: 12px; }
    .repl button, .gate button { font-size: 12px; padding: 2px 9px; }
    .cand { display: flex; gap: 8px; align-items: baseline; justify-content: space-between; width: 100%; font-size: 12.5px; }
    .cand button { flex: none; }
    .gate { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid ${C.line}; padding-top: 8px; }
    .sugs { display: flex; flex-direction: column; gap: 5px; align-items: flex-start; }
    .sugs button { font-size: 12px; }
    .run { position: relative; margin: 12px 16px; border: 1.5px solid ${C.ink}; border-radius: 10px; padding: 14px 12px 10px;
      display: flex; flex-direction: column; gap: 7px; overflow: hidden; }
    .run::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 5px; background: ${STRIPES}; }
    .run-t { font-weight: 700; font-size: 13.5px; }
    @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
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

  // A collapsible section. `key` is the ui flag that remembers whether it's open.
  function card(key, defaultOpen, title, meta, body) {
    const open = ui[key] == null ? defaultOpen : !!ui[key];
    return el('section', { class: 'card' },
      el('button', { class: 'card-h', 'aria-expanded': String(open), onclick: () => { ui[key] = !open; saveUi(); render(); } },
        el('span', { class: 'card-t' }, title),
        open ? null : el('span', { class: 'card-m' }, meta || ''), // the summary only matters when it's closed
        el('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▾' : '▸')),
      open ? el('div', { class: 'card-b' }, body) : null);
  }

  // ----- Dates section -----
  function rangeEditor(r, i) {
    return [
      el('div', { class: 'day' },
        el('span', { class: 'lbl' }, 'Pickup'),
        el('input', { type: 'date', value: r.startDate, 'aria-label': 'Pickup date', onchange: (e) => updateRange(i, 'startDate', e.target.value) }),
        el('input', { type: 'time', value: r.startTime, step: 1800, 'aria-label': 'Pickup time', onchange: (e) => updateRange(i, 'startTime', e.target.value) })),
      el('div', { class: 'day' },
        el('span', { class: 'lbl' }, 'Return'),
        el('input', { type: 'date', value: r.endDate, min: r.startDate, 'aria-label': 'Return date', onchange: (e) => updateRange(i, 'endDate', e.target.value) }),
        el('input', { type: 'time', value: r.endTime, step: 1800, 'aria-label': 'Return time', onchange: (e) => updateRange(i, 'endTime', e.target.value) })),
    ];
  }

  // Under the selected range: what's free on this page, and narrower times that would fit the preset.
  // How long ago the oldest result shown for the selected dates was checked.
  function checkedAgo() {
    const act = activeDates();
    if (!act) return null;
    const ids = [];
    const p = presets[ui.current];
    if (p) for (const sl of p.slots) for (const o of sl.options) ids.push(o.id);
    if (isSelectPage()) for (const it of pageItems()) if (it.allowed) ids.push(it.id);
    const ages = ids.map((id) => availFor(act.d, id)).filter(Boolean).map(minutesOld);
    if (!ages.length) return null;
    const m = Math.floor(Math.max(...ages));
    return m < 1 ? 'Checked just now' : 'Checked ' + m + ' min ago';
  }

  // Forget saved results for the active dates and check again.
  function refreshAvailability() {
    const act = activeDates();
    if (!act) return;
    const prefix = act.d.label + '|';
    for (const k of Object.keys(availability)) if (k.startsWith(prefix)) delete availability[k];
    saveAvailability();
    replacements = {};
    render();
  }

  function rangeExtras(p, b, i) {
    const kids = [];
    const sum = pageSummary();
    if (sum) kids.push(el('div', { class: 'muted' }, sum));
    const ago = checkedAgo();
    if (ago && !loadingAvail) {
      kids.push(el('div', { class: 'muted' }, ago + '. ',
        el('button', { class: 'link', title: 'Check these dates again now (results are saved for ' + CACHE_MINUTES + ' minutes)', onclick: refreshAvailability }, 'Refresh')));
    }
    else if (!isSelectPage()) kids.push(el('div', { class: 'muted' }, 'Open the equipment list to see what\'s available then.'));
    const pr = p && p.slots.length ? rangeProblems(p, b) : null;
    if (pr && pr.fix) {
      kids.push(el('div', { class: 'fit' },
        el('span', {}, 'Everything in your preset is available ' + shortLabel(pr.fix) + '.'),
        el('button', { class: 'mini', title: 'Change these dates to ' + bookingLabel(pr.fix), onclick: () => fitTimes(i, pr.fix) }, 'Use those times')));
    }
    return kids.length ? el('div', { class: 'extras' }, kids) : null;
  }

  function renderDates(p) {
    const bookings = computeBookings(schedule.ranges);
    const active = activeIndex();
    const kids = [];
    if (!schedule.ranges.length) {
      kids.push(el('div', { class: 'muted' }, 'Add when you\'ll pick up and return the gear. Every item on the equipment list then shows whether it\'s available.'));
    }
    schedule.ranges.forEach((r, i) => {
      const b = bookings.find((x) => x.index === i);
      const isActive = i === active;
      const editing = ui.editRange === i;
      kids.push(el('div', { class: 'range' + (isActive ? ' active' : '') },
        el('div', { class: 'range-row' },
          el('button', { class: 'pick', 'aria-pressed': String(isActive), title: isActive ? 'Availability shown for these dates' : 'Show availability for these dates', onclick: () => selectRange(i) },
            el('span', { class: 'dot', 'aria-hidden': 'true' }, isActive ? '●' : '○'),
            el('span', { class: 'rl' }, b ? shortLabel(b) : 'Set the dates', b ? el('span', { class: 'len' }, b.days + (b.days > 1 ? ' days' : ' day')) : null)),
          el('button', { class: 'link', title: editing ? 'Done editing' : 'Change these dates', onclick: () => { ui.editRange = editing ? null : i; saveUi(); render(); } }, editing ? 'Done' : 'Edit'),
          el('button', { class: 'x', title: 'Remove these dates', 'aria-label': 'Remove these dates', onclick: () => removeRange(i) }, '×')),
        editing || !b ? rangeEditor(r, i) : null,
        b && b.warnings.length ? el('div', { class: 'warn' }, '⚠ ' + b.warnings.join('; ')) : null,
        isActive && b && !b.invalid ? rangeExtras(p, b, i) : null));
    });
    kids.push(el('div', { class: 'row' }, el('button', { class: 'mini', onclick: addRange }, '+ Add dates')));
    return kids;
  }

  // ----- Preset section -----
  function renderSlot(slot, si, act, p) {
    const editing = !!ui.editing;
    const ab = act && act.source === 'panel' ? act.booking : null;
    const opts = slot.options.map((o, oi) => {
      const a = act ? availFor(act.d, o.id) : null;
      const f = a && act.booking ? fitFor(a, act.booking) : null;
      const kind = !a ? (ab ? 'pending' : null) : f ? (f.kind === 'hours' ? 'limited' : f.kind) : a.kind;
      const part = a && ab ? freePart(a, ab) : null;
      const plain = { ok: 'Available', bad: 'Not available', limited: 'Part of the time', unknown: 'Couldn\'t check' };
      const label = !a ? 'Checking…' : f && f.kind === 'hours' ? cap(f.why) : part ? 'Part of the time' : plain[kind] || a.label;
      return el('div', { class: 'opt' + (oi ? ' alt' : '') },
        oi ? el('span', { class: 'or' }, 'or') : null,
        el('span', { class: 'nm' }, o.name),
        kind ? el('span', { class: 'badge ' + kind, title: a ? a.detail || '' : '' }, label) : null,
        editing && slot.options.length > 1 ? el('button', { class: 'x', title: 'Remove this backup', 'aria-label': 'Remove ' + o.name, onclick: () => removeOption(si, oi) }, '×') : null,
        o.note && WARN_RE.test(o.note) ? el('div', { class: 'warn' }, '⚠ ' + o.note) : null,
        part ? el('div', { class: 'freepart' }, 'Available ' + shortLabel(part)) : null,
        a && kind !== 'ok' && a.detail && !part && !(f && f.kind === 'hours') ? el('div', { class: 'detail' }, a.detail) : null);
    });
    // Nothing in this slot is free for the selected dates: offer something similar.
    const units = ab ? slot.options.map((o) => fitFor(availFor(act.d, o.id), ab)) : [];
    const noFit = ab && !editing && !getRun() && units.length && units.every((f) => f.kind !== 'ok' && f.kind !== 'unknown');
    return el('li', { class: 'slot' + (ui.altFor === si ? ' target' : '') },
      el('div', { class: 'opts' }, opts,
        noFit ? renderReplacements('slot:' + bookingLabel(ab) + ':' + si, slot.options[0], ab, p, 'Add as backup', (c) => {
          addAlternate(ui.current, slot.options[0].id, c);
          replacements = {};
          render();
        }) : null),
      editing ? el('div', { class: 'tools' },
        el('button', { class: 'mini' + (ui.altFor === si ? ' on' : ''), title: 'Add backups for this item: gear that can stand in if it\'s taken', onclick: () => toggleAltMode(si) }, ui.altFor === si ? 'Done' : '+ Backup'),
        el('button', { class: 'x', title: 'Remove from the preset', 'aria-label': 'Remove ' + slot.options[0].name, onclick: () => removeSlot(si) }, '×')) : null);
  }

  const NEW_PRESET = '\u0000new';

  function renderPreset(p, act, queue) {
    const names = Object.keys(presets);
    const kids = [];
    if (!names.length) {
      kids.push(el('div', { class: 'muted' }, 'Save the gear you check out every time. Then one click adds it all to your basket.'));
      kids.push(el('div', { class: 'row' }, el('button', { class: 'mini', onclick: newPreset }, 'New preset')));
      return kids;
    }
    kids.push(el('div', { class: 'row' },
      el('select', { 'aria-label': 'Equipment preset', onchange: (e) => {
        if (e.target.value === NEW_PRESET) { e.target.value = ui.current; return newPreset(); }
        ui.current = e.target.value; ui.editing = false; ui.altFor = null; saveUi(); render();
      } },
        names.map((n) => el('option', { value: n, selected: n === ui.current }, n + ' (' + presets[n].slots.length + ')')),
        el('option', { value: NEW_PRESET }, 'New preset…')),
      p ? el('button', { class: ui.editing ? 'on' : '', onclick: () => { ui.editing = !ui.editing; if (!ui.editing) ui.altFor = null; saveUi(); render(); } }, ui.editing ? 'Done' : 'Edit') : null));
    if (!p) return kids;

    if (ui.editing) {
      kids.push(el('div', { class: 'hint' }, ui.altFor != null && p.slots[ui.altFor]
        ? 'Click "+ Backup" on gear in the equipment list that can stand in for ' + p.slots[ui.altFor].options[0].name + ', in the order you\'d want it.'
        : 'Click "+ Preset" on gear in the equipment list to add it here. "+ Backup" adds stand-ins for an item in case it\'s taken.'));
    }
    if (p.slots.length) kids.push(el('ul', { 'aria-label': ui.current }, p.slots.map((sl, si) => renderSlot(sl, si, act, p))));
    else kids.push(el('div', { class: 'muted' }, ui.editing ? 'Nothing saved yet.' : 'This preset is empty. Press Edit, then "+ Preset" on gear in the equipment list.'));
    if (ui.editing) {
      kids.push(el('div', { class: 'row' },
        el('button', { class: 'link', onclick: renamePreset }, 'Rename'),
        el('button', { class: 'link', onclick: deletePreset }, 'Delete preset')));
      return kids;
    }

    if (p.slots.length) {
      const bookings = computeBookings(schedule.ranges);
      const busy = !!queue || starting || !!getRun();
      const where = isSelectPage();
      const addBtn = (cls, label) => el('button', { class: cls, disabled: busy || !where, title: 'Add one of each item to your basket' + (act ? ' (a unit that\'s available ' + act.label + ')' : ''), onclick: () => startQueue(ui.current) }, label);
      if (bookings.length) {
        kids.push(el('div', { class: 'actions' },
          el('button', { class: 'primary', disabled: busy || !where || bookings.some((b) => b.invalid), title: 'One booking per date. Each stops at Terms & Conditions for you to finish.', onclick: startRun },
            bookings.length > 2 ? 'Book all ' + bookings.length + ' dates' : bookings.length === 2 ? 'Book both dates' : 'Book these dates'),
          addBtn('link', 'Add to basket only')));
      } else {
        kids.push(el('div', { class: 'actions' }, addBtn('primary', 'Add to basket')));
      }
      if (!where) kids.push(el('div', { class: 'muted' }, 'Open Book by Category → ' + (p.category || 'your equipment list') + ' to add or book.'));
    }
    return kids;
  }

  // ----- More section -----
  function renderMore() {
    const names = Object.keys(presets);
    const p = presets[ui.current];
    return [
      el('div', { class: 'row' },
        el('button', { class: 'mini', onclick: copyShareLink, disabled: !p || !p.slots.length, title: 'Copy a link that adds this preset for anyone with Better Checkout' },
          p ? 'Share "' + ui.current + '"' : 'Share a preset'),
        el('button', { class: 'mini', onclick: exportPresets, disabled: !names.length, title: 'Copy all your presets as text' }, 'Export presets'),
        el('button', { class: 'mini', onclick: importPresets, title: 'Add presets from exported text' }, 'Import presets')),
      el('div', { class: 'row' },
        store.get('scan', null)
          ? el('button', { class: 'mini', onclick: stopScan }, 'Stop scan')
          : el('button', { class: 'mini', onclick: startScan, disabled: !isSelectPage() || !!store.get('queue', null) || !!getRun(), title: 'Page through the whole equipment list once, so Better Checkout can suggest similar gear' },
            catalogSize() ? 'Rescan equipment list' : 'Scan equipment list'),
        el('button', { class: 'mini', onclick: copyProblemReport, title: 'Copy what Better Checkout did and found, to send to whoever maintains it' }, 'Copy problem report')),
      el('div', { class: 'foot' }, 'Better Checkout ' + VERSION + '. ' + (catalogSize()
        ? 'Knows ' + catalogSize() + ' items for suggesting similar gear.'
        : 'Scan the equipment list once to get suggestions for similar gear.')),
    ];
  }

  function renderRun(run) {
    const n = run.bookings.length;
    const bk = run.bookings[run.b];
    const last = run.b + 1 >= n;
    const box = el('div', { class: 'run', role: 'region', 'aria-label': 'Booking in progress' },
      el('div', { class: 'run-t' }, 'Booking ' + (run.b + 1) + ' of ' + n),
      el('div', { class: 'muted' }, bookingLabel(bk) + ' · ' + run.preset));
    if (run.stage === 'gate' && run.gate) {
      const p = presets[run.preset];
      box.append(el('div', {}, 'Nothing has been added yet. These items aren\'t available for this booking:'));
      for (const g of run.gate.blocked) {
        const choice = run.gate.decided[g.si];
        if (choice) {
          box.append(el('div', { class: 'okline' }, '✓ ' + g.name + ': ' + (choice === 'skip' ? 'leaving it out' : choice === 'anyway' ? 'adding it anyway' : 'using a replacement')));
          continue;
        }
        box.append(el('div', { class: 'gate' },
          el('div', { class: 'warn' }, '✗ ' + g.name + ': ' + g.why),
          p ? renderReplacements('gate:' + run.b + ':' + g.si, { id: g.id, name: g.name }, bk, p, 'Use', (c) => {
            addAlternate(run.preset, g.id, c);
            decideGate(g.si, 'alt');
          }) : null,
          el('div', { class: 'row' },
            el('button', { onclick: () => decideGate(g.si, 'anyway') }, 'Add it anyway'),
            el('button', { onclick: () => decideGate(g.si, 'skip') }, 'Leave it out'))));
      }
    } else if (run.stage === 'done') {
      box.append(el('div', { class: 'okline' }, '✓ Booking ' + (run.b + 1) + ' of ' + n + ' is complete.'));
      box.append(el('div', { class: 'muted' }, 'Next: ' + bookingLabel(run.bookings[run.b + 1]) + '.'));
    } else if (run.stage !== 'handoff') {
      box.append(el('div', {}, run.stage === 'basket' ? 'Adding your gear to the basket…' : 'Setting the times…'));
    } else {
      if (run.problem) box.append(el('div', { class: 'warn' }, '⚠ ' + run.problem));
      const clash = isTimePage() && run.problem ? clashInfo() : null;
      if (isSelectPage()) {
        box.append(el('div', {}, last
          ? 'That was the last booking. Finish it, and the run ends when Connect2 shows Complete.'
          : 'Finish booking ' + (run.b + 1) + ' first. When Connect2 shows Complete, the next one is one click away.'));
      } else if (isTimePage() && run.problem) {
        box.append(el('div', {}, clash && clash.suggestions.length
          ? 'Pick one of Connect2\'s suggested times to continue, or change the times on this page, press Update, then Next.'
          : 'Change the times on this page, press Update, then Next and finish the booking.'));
        if (clash && clash.suggestions.length) {
          box.append(el('div', { class: 'sugs' }, clash.suggestions.slice(0, 6).map((sug) =>
            el('button', { onclick: () => pickSuggestion(sug) }, bookingLabel(sug)))));
        }
        // Items someone else has booked: offer similar items as alternates for a redo.
        const p = presets[run.preset];
        for (const ci of (clash ? clash.items : []).filter((x) => /someone else/.test(x.why))) {
          const opt = p && p.slots.flatMap((sl) => sl.options).find((o) => clean(o.name) === clean(ci.item));
          if (!opt) continue;
          box.append(el('div', { class: 'gate' },
            el('div', {}, 'Replace ' + ci.item + '?'),
            renderReplacements('clash:' + run.b + ':' + opt.id, opt, bk, p, 'Add as backup', (c) => {
              addAlternate(run.preset, opt.id, c);
              replacements = {};
              setStatus(c.name + ' is now a backup for ' + opt.name + '. To use it for this booking: press Back, empty your basket, then press Redo booking ' + (run.b + 1) + '.');
            })));
        }
      } else {
        box.append(el('div', {}, 'Your turn: Terms & Conditions → Special Requests → Verify → Complete.' +
          (last ? ' The run ends by itself when Connect2 shows Complete.' : ' On the Complete page, this box offers booking ' + (run.b + 2) + '.')));
      }
      if (run.notes[run.b]) box.append(el('div', { class: 'detail' }, run.notes[run.b]));
    }
    const row = el('div', { class: 'row' });
    if (run.stage === 'done' || (run.stage === 'handoff' && isSelectPage() && !last)) {
      row.append(el('button', { class: 'primary', onclick: goToNextBooking }, 'Start booking ' + (run.b + 2) + ' of ' + n));
    }
    if (run.stage === 'handoff' && isSelectPage()) row.append(el('button', { onclick: () => nextBooking(0) }, 'Redo booking ' + (run.b + 1)));
    row.append(el('button', { onclick: endRun }, (run.stage === 'handoff' && last) || run.stage === 'done' ? 'End run' : 'Stop run'));
    box.append(row);
    return box;
  }

  function render() {
    const queue = store.get('queue', null);
    const p = presets[ui.current];
    const act = activeDates();
    root.innerHTML = '';
    root.append(el('style', {}, CSS));

    const ab = activeBooking();
    const head = el('header', { role: 'button', tabindex: '0', 'aria-expanded': String(!!ui.open), title: ui.open ? 'Minimize Better Checkout' : 'Open Better Checkout',
      onclick: () => { ui.open = !ui.open; saveUi(); render(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ui.open = !ui.open; saveUi(); render(); } } });
    head.append(logoEl(20, true), el('span', { class: 'wordmark' }, 'Better Checkout'));
    if (!ui.open && ab) head.append(el('span', { class: 'hm' }, shortLabel(ab)));
    head.append(el('span', { class: 'hchev', 'aria-hidden': 'true' }, ui.open ? '▾' : '▴'));
    const panel = el('div', { class: 'panel' + (ui.open ? '' : ' closed'), role: 'complementary', 'aria-label': 'Better Checkout' }, head);

    if (ui.open) {
      const body = el('div', { class: 'body' });
      const run = getRun();
      if (run) body.append(renderRun(run));
      if (statusText || queue) {
        body.append(el('div', { class: 'status', role: 'status' },
          statusText,
          queue ? el('div', { class: 'row' },
            el('button', { class: 'mini', onclick: () => runQueue(true) }, 'Resume'),
            el('button', { class: 'mini', onclick: stopQueue }, 'Stop')) : null,
          statusUndo && !queue ? el('div', { class: 'row' }, el('button', { class: 'mini', onclick: () => statusUndo() }, 'Undo')) : null,
          !queue ? el('button', { class: 'x close', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => setStatus('') }, '×') : null));
      }
      if (!run && !schedule.ranges.length && !Object.keys(presets).length) {
        body.append(el('div', { class: 'intro' }, 'Pick your dates, save the gear you use, then book it all in one go.'));
      }

      body.append(card('showDates', true, 'Dates',
        schedule.ranges.length ? (ab ? shortLabel(ab) : schedule.ranges.length + ' saved') : 'None yet',
        renderDates(p)));
      body.append(card('showPresets', true, 'Equipment Presets',
        p ? ui.current + ', ' + p.slots.length + (p.slots.length === 1 ? ' item' : ' items') : 'None yet',
        renderPreset(p, act, queue)));
      body.append(card('showMore', false, 'Share and Help', '', renderMore()));
      panel.append(body);
    }
    root.append(panel);
    decorateList();
    scheduleAvailability();
  }

  // Availability badges, and (while picking) preset buttons under Connect2's own Add buttons.
  function decorateList() {
    takeOverAvailabilityBox();
    decorateBadges();
    qsa('.c2p-under').forEach((b) => b.remove());
    const p = presets[ui.current];
    if (!ui.editing || !p) return;
    const altMode = ui.altFor != null && !!p.slots[ui.altFor];
    for (const it of pageItems()) {
      const pos = findOption(p, it.id);
      const b = document.createElement('button');
      b.type = 'button'; // never submits Connect2's form
      b.className = 'c2p-toggle';
      // Same width as Connect2's Add button, on its own line underneath it.
      const w = it.btn ? it.btn.offsetWidth : 0;
      b.style.cssText = 'box-sizing:border-box;width:' + (w ? w + 'px' : '100%') + ';max-width:100%;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      let label;
      if (pos) {
        label = pos.oi ? '✓ Backup' : '✓ Saved';
        b.classList.add('saved');
        b.title = 'Better Checkout: in "' + ui.current + '". Click to remove it.';
      } else if (!it.allowed) {
        label = 'Can\'t book';
        b.title = it.reason;
        b.disabled = true;
      } else {
        label = altMode ? '+ Backup' : '+ Preset';
        b.title = 'Better Checkout: add to "' + ui.current + '"' + (altMode ? ' as a backup for ' + p.slots[ui.altFor].options[0].name : '');
      }
      if (!pos && it.allowed && it.note && WARN_RE.test(it.note)) b.title += '. Note: ' + it.note;
      b.append(logoEl(14), document.createTextNode(label));
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleItem(it); });
      const area = it.li.querySelector('.resource-book') || it.li;
      area.style.flexWrap = 'wrap'; // in case Connect2 lays the area out as a row
      const under = document.createElement('div');
      under.className = 'c2p-under';
      under.style.cssText = 'flex:0 0 100%;display:flex;margin-top:6px;';
      under.appendChild(b);
      area.appendChild(under);
    }
  }

  recordCatalog();
  adoptConnect2Dates();
  log('page', 'opened' + (pageKind() === 'list' ? ': ' + qsa('li.resource-list-item').length + ' items, ' + pageItems().length + ' recognized' : '') + ' · script ' + VERSION);
  render();
  importFromLink();
  if (store.get('scan', null)) scanTick();
  else if (store.get('queue', null)) runQueue(true);
  else runTick();
})();
