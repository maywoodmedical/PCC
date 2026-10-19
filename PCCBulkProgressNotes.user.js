// ==UserScript==
// @name         PCCBulkProgressNotes
// @namespace    maywood-oscar
// @version      1.2
// @description  Scan the 2 West / 2 South resident lists, tick who needs a custom note, and chart the standard Physician Visit note for everyone else.
// @match        https://*.pointclickcare.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------------- Settings ----------------
  const UNITS = ['2 West', '2 South'];
  const NOTE_TYPE = 'Physician Visit';
  const NOTE_TEXT =
    'S: no new nursing issues\n' +
    'O: no unusual behaviours, recent vitals and allied care notes reviewed\n' +
    'A/P: no adverse change, cont current mgmt';
  const NOTE_MARKER = 'no new nursing issues';   // used to recognise a saved standard note
  const TIMEOUT_AUTO = 2 * 60 * 1000;            // max time per note when auto-signing
  const TIMEOUT_MANUAL = 10 * 60 * 1000;         // max time per note when you type the password
  const STALE_HOURS = 12;                        // warn if a unit list is older than this

  // ---------------- Helpers ----------------
  const path = location.pathname;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const visible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  async function waitFor(fn, timeout = 15000, every = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) { /* keep waiting */ }
      await sleep(every);
    }
    return null;
  }

  function findClickable(label, root = document) {
    const want = norm(label);
    const passes = [
      'button, a, input[type=button], input[type=submit], [role=button], [role=tab]',
      'span, div, li, td',
    ];
    for (const sel of passes) {
      for (const el of root.querySelectorAll(sel)) {
        const t = norm(el.tagName === 'INPUT' ? el.value : el.textContent);
        if (t === want && visible(el)) return el;
      }
    }
    return null;
  }

  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    for (const ev of ['input', 'change', 'keyup', 'blur']) el.dispatchEvent(new Event(ev, { bubbles: true }));
  }

  // Dates are kept as YYYY-MM-DD internally.
  function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function isoToMDY(iso, pad) {
    const [y, m, d] = iso.split('-');
    return pad ? `${m}/${d}/${y}` : `${+m}/${+d}/${y}`;
  }
  // The chosen visit date resets to today on a new day.
  function getNoteDate() {
    const s = GM_getValue('noteDate', null);
    return s && s.setOn === isoToday() && s.value <= isoToday() ? s.value : isoToday();
  }
  function parseDate(str) {
    let m = (str || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = (str || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  // Simulated human click and typing — PCC's date box ignores values set directly.
  async function humanClick(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', o)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mousedown', o));
    if (el.focus) el.focus();
    try { el.dispatchEvent(new PointerEvent('pointerup', o)); } catch (e) {}
    el.dispatchEvent(new MouseEvent('mouseup', o));
    el.dispatchEvent(new MouseEvent('click', o));
    await sleep(200);
  }

  async function humanType(el, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (el.select) el.select();
    for (const key of ['Control', 'a']) el.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));
    setter.call(el, '');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    for (const ch of text) {
      const k = { key: ch, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', k));
      el.dispatchEvent(new KeyboardEvent('keypress', k));
      setter.call(el, el.value + ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', k));
      await sleep(40);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findDateField() {
    const byName = document.querySelector('input[name="effective_date_dummy"]');
    if (byName) return byName;
    const label = [...document.querySelectorAll('label, td, th, div, span')]
      .find(e => norm(e.textContent) === 'effective date' && visible(e));
    if (!label) return null;
    return [...document.querySelectorAll('input[type=text], input:not([type])')]
      .find(i => visible(i) && (label.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING));
  }

  // Returns null on success, or an error message.
  async function setEffectiveDate(iso) {
    const want = isoToMDY(iso, true);
    const field = findDateField();
    if (!field) return 'Could not find the Effective Date box.';
    const hidden = document.querySelector('input[name="effective_date"]');
    const ok = () => parseDate(field.value) === iso && (!hidden || parseDate(hidden.value) === iso);
    if (ok()) return null;

    await humanClick(field);
    await humanType(field, want);
    try {
      const $ = unsafeWindow.jQuery;
      if ($) {
        if ($(field).hasClass('hasDatepicker')) $(field).datepicker('setDate', want);
        $(field).trigger('change');
      }
    } catch (e) { /* no page jQuery — native events are enough */ }
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    field.blur();
    await humanClick(document.body); // closes the calendar pop-up if one opened
    await sleep(300);

    if (hidden && parseDate(hidden.value) !== iso) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(hidden, want);
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await sleep(300);
    return ok() ? null : `Effective Date didn't take ${want} (box shows "${field.value}").`;
  }

  // ---------------- State ----------------
  const getRun = () => GM_getValue('run', null);
  const saveRun = r => GM_setValue('run', r);
  const getRoster = () => GM_getValue('roster', {});
  const getSkip = () => GM_getValue('skip', {});
  const current = r => (r && r.queue ? r.queue[r.idx] : null);
  // Anyone not listed as Active (e.g. Hospital) has not been seen and never gets a note.
  const isAway = p => !!norm(p.status) && norm(p.status) !== 'active';

  function setPhase(phase) {
    const r = getRun();
    if (!r) return null;
    r.phase = phase;
    r.phaseTs = Date.now();
    saveRun(r);
    return r;
  }

  function fail(msg) {
    const r = getRun();
    if (!r) return;
    r.paused = true;
    r.error = msg;
    saveRun(r);
    GM_deleteValue('pw');
    renderOverlay();
  }

  function advance(expectedId, status, note) {
    const r = getRun();
    const c = current(r);
    if (!c || c.id !== expectedId) return; // another window already moved on
    r.results.push({ id: c.id, name: c.name, unit: c.unit, status, note: note || '' });
    r.idx++;
    r.attempts = 0;
    r.error = null;
    r.paused = false;
    if (r.idx >= r.queue.length) {
      r.phase = 'finished';
      saveRun(r);
      GM_deleteValue('pw');
      renderOverlay();
      return;
    }
    r.phase = 'goto';
    r.phaseTs = Date.now();
    saveRun(r);
    location.href = r.queue[r.idx].href;
  }

  // ---------------- Client list: scanning + checklist ----------------
  function scrapeList() {
    for (const t of document.querySelectorAll('table')) {
      const rows = [...t.rows];
      const hi = rows.findIndex(row => {
        const c = [...row.cells].map(x => norm(x.textContent));
        return c.includes('name') && c.includes('location');
      });
      if (hi < 0) continue;
      const hc = [...rows[hi].cells].map(x => norm(x.textContent));
      const iName = hc.indexOf('name'), iLoc = hc.indexOf('location'), iStat = hc.indexOf('status');
      const out = [];
      for (const row of rows.slice(hi + 1)) {
        const cell = row.cells[iName];
        if (!cell) continue;
        const a = cell.querySelector('a');
        if (!a) continue;
        const txt = a.textContent.replace(/\s+/g, ' ').trim();
        const m = txt.match(/\((\d+)\)/);
        if (!m) continue;
        out.push({
          id: m[1],
          name: txt,
          href: a.href,
          location: row.cells[iLoc] ? row.cells[iLoc].textContent.trim() : '',
          status: iStat >= 0 && row.cells[iStat] ? row.cells[iStat].textContent.trim() : '',
        });
      }
      if (out.length) return out;
    }
    return [];
  }

  function scanUnit(unit) {
    if (!/residents\s*-\s*current/i.test(document.body.innerText) &&
        !confirm('This doesn\'t look like the CURRENT residents tab. Scan anyway?')) return;
    const list = scrapeList();
    if (!list.length) { alert('No residents found on this page.'); return; }

    const roster = getRoster();
    const other = UNITS.find(u => u !== unit && roster[u]);
    if (other) {
      const otherIds = roster[other].residents.map(p => p.id).sort().join(',');
      if (otherIds === list.map(p => p.id).sort().join(',') &&
          !confirm(`This list is identical to the one saved for ${other}. Did you switch the Unit dropdown and click APPLY? Save it as ${unit} anyway?`)) return;
    }
    if (list.some(p => /^javascript:/i.test(p.href))) {
      alert('Heads up: resident links on this page are not normal URLs, so the script may not be able to open charts. Tell Claude if a run fails at the first patient.');
    }

    roster[unit] = { scannedAt: Date.now(), residents: list };
    GM_setValue('roster', roster);
    renderPanel();
  }

  function buildPanel() {
    if (document.getElementById('bn-panel')) return;
    const style = document.createElement('style');
    style.textContent = `
      #bn-panel{position:fixed;top:90px;right:16px;width:390px;max-height:80vh;overflow:auto;z-index:99999;
        background:#fff;border:2px solid #3d5a2a;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);
        font:14px/1.4 system-ui,sans-serif;color:#222;padding:12px}
      #bn-panel h3{margin:0 0 6px;font-size:16px}
      #bn-panel h4{margin:12px 0 4px;font-size:14px;display:flex;justify-content:space-between}
      #bn-panel .bn-row{display:flex;gap:6px;align-items:center;padding:2px 0}
      #bn-panel .bn-row.skip span{color:#a33;font-weight:600}
      #bn-panel .muted{color:#777;font-size:12px}
      #bn-panel button,#bn-overlay button,.bn-modal button{background:#3d5a2a;color:#fff;border:0;border-radius:6px;
        padding:6px 10px;margin:2px;cursor:pointer;font-size:13px}
      #bn-panel button.sec,#bn-overlay button.sec,.bn-modal button.sec{background:#eee;color:#222}
      #bn-panel .bn-min{float:right}
      #bn-overlay{position:fixed;bottom:16px;right:16px;width:360px;max-height:60vh;overflow:auto;z-index:99999;
        background:#fff;border:2px solid #3d5a2a;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);
        font:13px/1.4 system-ui,sans-serif;color:#222;padding:10px}
      #bn-overlay .err{color:#b00;font-weight:600;margin:6px 0}
      .bn-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100000;display:flex;align-items:center;justify-content:center}
      .bn-modal>div{background:#fff;padding:16px;border-radius:10px;width:340px;font:14px system-ui,sans-serif}
      .bn-modal input{width:100%;box-sizing:border-box;padding:6px;margin:8px 0;font-size:14px}`;
    document.head.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'bn-panel';
    document.body.appendChild(panel);
    renderPanel();
  }

  function renderPanel() {
    const panel = document.getElementById('bn-panel');
    if (!panel) return;
    if (GM_getValue('panelMin', false)) {
      panel.innerHTML = `<button class="sec" id="bn-expand">Bulk notes ▸</button>`;
      panel.style.width = 'auto';
      panel.querySelector('#bn-expand').onclick = () => { GM_setValue('panelMin', false); panel.style.width = ''; renderPanel(); };
      return;
    }
    const roster = getRoster(), skip = getSkip();
    let html = `<button class="sec bn-min" id="bn-min">–</button><h3>Bulk standard notes</h3>
      <div class="muted">Pick a unit in the Unit dropdown, click APPLY, then press that unit's Scan button. Tick anyone who needs a <b>custom note</b>; everyone else gets the standard note.</div>
      <div style="margin-top:6px">${UNITS.map(u => `<button data-scan="${esc(u)}">Scan as ${esc(u)}</button>`).join('')}</div>`;

    let charting = 0, custom = 0, away = 0;
    for (const u of UNITS) {
      const unit = roster[u];
      if (!unit) { html += `<h4>${esc(u)}</h4><div class="muted">Not scanned yet.</div>`; continue; }
      const ageH = (Date.now() - unit.scannedAt) / 3600000;
      html += `<h4><span>${esc(u)} (${unit.residents.length})</span>
        <span class="muted"${ageH > STALE_HOURS ? ' style="color:#b00"' : ''}>scanned ${new Date(unit.scannedAt).toLocaleString()}</span></h4>`;
      for (const p of unit.residents) {
        if (isAway(p)) {
          away++;
          html += `<label class="bn-row" title="Not seen — no note will be written"><input type="checkbox" disabled>
            <span style="color:#b00">${esc(p.name)}</span> <b style="color:#b00">[${esc(p.status)}]</b>
            <span class="muted">no note</span></label>`;
          continue;
        }
        const s = !!skip[p.id];
        s ? custom++ : charting++;
        html += `<label class="bn-row${s ? ' skip' : ''}"><input type="checkbox" data-skip="${esc(p.id)}"${s ? ' checked' : ''}>
          <span>${esc(p.name)}</span><span class="muted">${esc(p.location)}</span></label>`;
      }
    }

    const nd = getNoteDate();
    html += `<hr><div><b>${charting}</b> standard notes · <b>${custom}</b> custom (skipped)${away ? ` · <b style="color:#b00">${away}</b> in hospital (no note)` : ''}</div>
      <label class="bn-row">Visit date <input type="date" id="bn-date" value="${nd}" max="${isoToday()}">
        ${nd !== isoToday() ? '<b style="color:#b00">not today</b>' : '<span class="muted">today</span>'}</label>
      <label class="bn-row"><input type="checkbox" id="bn-auto"${GM_getValue('autoSign', true) ? ' checked' : ''}>
        Sign automatically (asks for your password once per run)</label>
      <div><button class="sec" id="bn-test">Test on 1 patient</button><button id="bn-start">Start charting ${charting}</button>
      <button class="sec" id="bn-clear">Clear ticks</button></div>`;

    const last = GM_getValue('lastRun', null);
    if (last) html += summaryHtml(last, true);

    panel.innerHTML = html;
    panel.querySelector('#bn-min').onclick = () => { GM_setValue('panelMin', true); renderPanel(); };
    panel.querySelectorAll('[data-scan]').forEach(b => { b.onclick = () => scanUnit(b.dataset.scan); });
    panel.querySelectorAll('[data-skip]').forEach(cb => {
      cb.onchange = () => {
        const sk = getSkip();
        if (cb.checked) sk[cb.dataset.skip] = true; else delete sk[cb.dataset.skip];
        GM_setValue('skip', sk);
        renderPanel();
      };
    });
    panel.querySelector('#bn-date').onchange = e => {
      const v = e.target.value;
      if (!v || v > isoToday()) { alert('Pick today or an earlier date.'); renderPanel(); return; }
      GM_setValue('noteDate', { value: v, setOn: isoToday() });
      renderPanel();
    };
    panel.querySelector('#bn-auto').onchange = e => GM_setValue('autoSign', e.target.checked);
    panel.querySelector('#bn-test').onclick = () => startRun(true);
    panel.querySelector('#bn-start').onclick = () => startRun(false);
    panel.querySelector('#bn-clear').onclick = () => { if (confirm('Untick everyone?')) { GM_setValue('skip', {}); renderPanel(); } };
    const dismiss = panel.querySelector('#bn-dismiss');
    if (dismiss) dismiss.onclick = () => { GM_deleteValue('lastRun'); renderPanel(); };
  }

  function askPassword() {
    return new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'bn-modal';
      m.innerHTML = `<div><b>PointClickCare password</b>
        <div style="font-size:12px;color:#666;margin-top:4px">Used only to sign this batch. It is erased when the run ends, pauses on an error, or is stopped.</div>
        <input type="password" id="bn-pw" autocomplete="current-password">
        <div style="text-align:right"><button class="sec" id="bn-pw-cancel">Cancel</button><button id="bn-pw-ok">OK</button></div></div>`;
      document.body.appendChild(m);
      const input = m.querySelector('#bn-pw');
      input.focus();
      const done = v => { m.remove(); resolve(v); };
      m.querySelector('#bn-pw-ok').onclick = () => done(input.value);
      m.querySelector('#bn-pw-cancel').onclick = () => done(null);
      input.onkeydown = e => { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); };
    });
  }

  async function startRun(testOne) {
    if (getRun()) { alert('A run is already in progress. Use the box at the bottom right to resume or stop it.'); return; }
    const roster = getRoster(), skip = getSkip();
    const missing = UNITS.filter(u => !roster[u]);
    const stale = UNITS.filter(u => roster[u] && (Date.now() - roster[u].scannedAt) / 3600000 > STALE_HOURS);
    if (missing.length && !confirm(`${missing.join(', ')} hasn't been scanned. Continue without it?`)) return;
    if (stale.length && !confirm(`${stale.join(', ')} was scanned more than ${STALE_HOURS} h ago. Re-scan first for the latest residents? (OK = continue anyway)`)) return;

    const queue = [], skipped = [], away = [];
    for (const u of UNITS) {
      for (const p of (roster[u] ? roster[u].residents : [])) {
        const item = { ...p, unit: u };
        if (isAway(p)) away.push(item);
        else (skip[p.id] ? skipped : queue).push(item);
      }
    }
    if (!queue.length) { alert('Nobody to chart.'); return; }
    const runQueue = testOne ? queue.slice(0, 1) : queue;
    const noteDate = getNoteDate();
    const dateLine = `Visit date: ${isoToMDY(noteDate, false)}${noteDate === isoToday() ? ' (today)' : ' — NOT today'}`;
    const msg = testOne
      ? `Test run: chart the standard note for ${runQueue[0].name} only?\n\n${dateLine}`
      : `Chart and sign the standard "${NOTE_TYPE}" note for ${queue.length} residents?\n\n${dateLine}\n${skipped.length} ticked for a custom note will be left alone.${away.length ? `\n${away.length} in hospital will get no note.` : ''}\nOnly continue if you saw these residents on that date.`;
    if (!confirm(msg)) return;

    const auto = GM_getValue('autoSign', true);
    if (auto) {
      const pw = await askPassword();
      if (!pw) return;
      GM_setValue('pw', pw);
    }
    saveRun({
      queue: runQueue, skipped, away, noteDate, idx: 0, results: [], phase: 'goto', phaseTs: Date.now(),
      mode: auto ? 'auto' : 'manual', paused: false, error: null, attempts: 0, startedAt: Date.now(),
    });
    location.href = runQueue[0].href;
  }

  // ---------------- Run overlay (shown on main PCC pages) ----------------
  const PHASE_LABEL = {
    goto: 'opening chart', openNote: 'opening Prog Notes', filling: 'writing note',
    signing: 'signing', signed: 'confirming note saved',
  };

  function summaryHtml(r, fromPanel) {
    const by = s => r.results.filter(x => x.status === s);
    const done = by('done'), already = by('already'), failed = r.results.filter(x => !['done', 'already'].includes(x.status));
    let h = `<hr><b>${fromPanel ? 'Last run' : 'Run finished'}:</b> ${done.length} charted`;
    if (already.length) h += `, ${already.length} already had today's note`;
    if (failed.length) h += `, <span style="color:#b00">${failed.length} not charted</span>`;
    if (failed.length) h += `<div>${failed.map(f => `<div style="color:#b00">• ${esc(f.name)} — ${esc(f.note)}</div>`).join('')}</div>`;
    if (r.skipped && r.skipped.length) {
      h += `<div style="margin-top:6px"><b>Custom notes to write (${r.skipped.length}):</b></div>`;
      h += r.skipped.map(p => `<div>• <a href="${esc(p.href)}">${esc(p.name)}</a> <span style="color:#777">${esc(p.unit)}</span></div>`).join('');
    }
    if (r.away && r.away.length) {
      h += `<div style="margin-top:6px"><b>No note — in hospital (${r.away.length}):</b></div>`;
      h += r.away.map(p => `<div style="color:#b00">• ${esc(p.name)} <span style="color:#777">${esc(p.unit)}</span></div>`).join('');
    }
    if (fromPanel) h += `<div><button class="sec" id="bn-dismiss">Dismiss</button></div>`;
    return h;
  }

  function renderOverlay() {
    if (window.top !== window || /newipn|digitalsignature/.test(path)) return;
    let box = document.getElementById('bn-overlay');
    const r = getRun();
    if (!r) { if (box) box.remove(); return; }
    if (!box) {
      if (!document.getElementById('bn-panel') && !document.getElementById('bn-style2')) {
        const st = document.createElement('style');
        st.id = 'bn-style2';
        st.textContent = `#bn-overlay{position:fixed;bottom:16px;right:16px;width:360px;max-height:60vh;overflow:auto;z-index:99999;
          background:#fff;border:2px solid #3d5a2a;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);
          font:13px/1.4 system-ui,sans-serif;color:#222;padding:10px}
          #bn-overlay .err{color:#b00;font-weight:600;margin:6px 0}
          #bn-overlay button,.bn-modal button{background:#3d5a2a;color:#fff;border:0;border-radius:6px;padding:6px 10px;margin:2px;cursor:pointer}
          #bn-overlay button.sec,.bn-modal button.sec{background:#eee;color:#222}
          .bn-modal{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100000;display:flex;align-items:center;justify-content:center}
          .bn-modal>div{background:#fff;padding:16px;border-radius:10px;width:340px;font:14px system-ui,sans-serif}
          .bn-modal input{width:100%;box-sizing:border-box;padding:6px;margin:8px 0;font-size:14px}`;
        document.head.appendChild(st);
      }
      box = document.createElement('div');
      box.id = 'bn-overlay';
      document.body.appendChild(box);
    }
    const c = current(r);
    if (r.phase === 'finished') {
      box.innerHTML = summaryHtml(r, false).replace(/^<hr>/, '') + `<div><button id="bn-close">Close</button></div>`;
      box.querySelector('#bn-close').onclick = () => {
        GM_setValue('lastRun', { results: r.results, skipped: r.skipped, away: r.away, finishedAt: Date.now() });
        GM_deleteValue('run');
        box.remove();
      };
      return;
    }
    box.innerHTML = `<b>Bulk notes</b> — ${r.idx + 1} of ${r.queue.length} · visit date ${isoToMDY(r.noteDate || isoToday(), false)}<br>${esc(c.name)} <span style="color:#777">(${esc(c.unit)})</span><br>
      <span style="color:#777">${r.paused ? 'paused' : esc(PHASE_LABEL[r.phase] || r.phase)}</span>
      ${r.error ? `<div class="err">${esc(r.error)}</div>` : ''}
      <div>${r.paused
        ? `<button id="bn-resume">Resume</button><button class="sec" id="bn-skipone">Skip this resident</button>`
        : `<button class="sec" id="bn-pause">Pause</button>`}
      <button class="sec" id="bn-stop">Stop</button></div>`;
    const q = s => box.querySelector(s);
    if (q('#bn-pause')) q('#bn-pause').onclick = () => { const x = getRun(); x.paused = true; saveRun(x); renderOverlay(); };
    if (q('#bn-resume')) q('#bn-resume').onclick = resumeRun;
    if (q('#bn-skipone')) q('#bn-skipone').onclick = () => advance(c.id, 'failed', 'skipped by you after a problem');
    q('#bn-stop').onclick = () => {
      if (!confirm('Stop the run? Notes already signed stay signed.')) return;
      const x = getRun();
      GM_setValue('lastRun', { results: x.results, skipped: x.skipped.concat(x.queue.slice(x.idx)), away: x.away, finishedAt: Date.now() });
      GM_deleteValue('run');
      GM_deleteValue('pw');
      renderOverlay();
    };
  }

  async function resumeRun() {
    const r = getRun();
    if (r.mode === 'auto' && !GM_getValue('pw', '')) {
      const pw = await askPassword();
      if (!pw) return;
      GM_setValue('pw', pw);
    }
    r.paused = false; r.error = null; r.attempts = 0; r.phase = 'goto'; r.phaseTs = Date.now();
    saveRun(r);
    location.href = current(r).href; // restart this resident; the duplicate check prevents double notes
  }

  function startWatchdog() {
    setInterval(() => {
      const r = getRun();
      if (!r || r.paused || r.phase === 'finished') return;
      const limit = r.mode === 'auto' ? TIMEOUT_AUTO : TIMEOUT_MANUAL;
      if (['filling', 'signing', 'signed'].includes(r.phase) && Date.now() - r.phaseTs > limit) {
        fail(`Timed out on ${current(r).name}. Check whether the note window is still open, then Resume or Skip.`);
      }
    }, 5000);
  }

  // ---------------- Step handlers ----------------
  const onThisResident = c => document.body.innerText.includes(`(${c.id})`);

  function alreadyCharted(iso) {
    const re = new RegExp(`(^|\\D)${isoToMDY(iso, false).replace(/\//g, '\\/')}(\\D|$)`);
    return [...document.querySelectorAll('tr')].some(tr => {
      const t = norm(tr.textContent);
      return re.test(t) && t.includes(norm(NOTE_TYPE)) && t.includes(NOTE_MARKER);
    });
  }

  async function onChartPage(r) {
    const c = current(r);
    if (isAway(c)) return advance(c.id, 'failed', 'in hospital — no note');
    if (!await waitFor(() => onThisResident(c), 10000)) return fail(`Opened the wrong chart — expected ${c.name}.`);
    const tab = await waitFor(() => findClickable('Prog Notes'), 10000);
    if (!tab) return fail('Could not find the PROG NOTES tab.');
    setPhase('openNote');
    tab.click();
  }

  async function onProgNotes(r) {
    const c = current(r);
    if (!await waitFor(() => onThisResident(c), 10000)) return fail(`Progress notes page is not for ${c.name}.`);
    startWatchdog();

    if (r.phase === 'goto' || r.phase === 'openNote') {
      const btn = await waitFor(() => findClickable('Add Progress Note'), 10000);
      if (!btn) return fail('Could not find ADD PROGRESS NOTE.');
      await sleep(800);
      if (alreadyCharted(r.noteDate || isoToday())) return advance(c.id, 'already', 'standard note already charted for that date');
      setPhase('filling');
      btn.click();
    } else if (r.phase === 'signed') {
      await sleep(1500);
      const nd = r.noteDate || isoToday();
      if (alreadyCharted(nd)) return advance(c.id, 'done');
      if (nd !== isoToday() && alreadyCharted(isoToday())) {
        return fail(`${c.name}'s note was saved with TODAY's date instead of ${isoToMDY(nd, false)}. Correct or strike out that note in PCC, then Resume or Skip.`);
      }
      const x = getRun();
      if ((x.attempts || 0) < 3) {
        x.attempts = (x.attempts || 0) + 1;
        saveRun(x);
        await sleep(3000);
        location.reload();
      } else {
        fail(`Couldn't confirm the note was saved for ${c.name}. Check their Prog Notes, then Resume or Skip.`);
      }
    }
    // 'filling' / 'signing': the popup is working; the watchdog covers stalls.
  }

  function findDataBox() {
    const tas = [...document.querySelectorAll('textarea')].filter(visible);
    const label = [...document.querySelectorAll('label, td, th, div, span')]
      .find(e => norm(e.textContent) === 'data' && visible(e));
    if (label) {
      const after = tas.find(t => label.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (after) return after;
    }
    return tas[0];
  }

  async function onNewNote(r) {
    if (r.phase !== 'filling') return;
    const c = current(r);
    if (!await waitFor(() => onThisResident(c), 10000)) {
      fail(`The note window opened for a different resident (expected ${c.name}). Nothing was saved.`);
      alert('Bulk notes stopped: the note window is for the wrong resident. Nothing was signed.');
      return;
    }
    const sel = await waitFor(() => [...document.querySelectorAll('select')]
      .find(s => [...s.options].some(o => norm(o.text) === norm(NOTE_TYPE))), 10000);
    if (!sel) return fail('Could not find the Type dropdown in the note window.');
    const opt = [...sel.options].find(o => norm(o.text) === norm(NOTE_TYPE));
    if (sel.value !== opt.value) { setValue(sel, opt.value); await sleep(1500); }

    const ta = await waitFor(findDataBox, 10000);
    if (!ta) return fail('Could not find the Data box in the note window.');
    ta.focus();
    setValue(ta, NOTE_TEXT);
    await sleep(500);
    if (ta.value.replace(/\r/g, '').trim() !== NOTE_TEXT) return fail('The Data box did not take the note text.');
    const dateErr = await setEffectiveDate(r.noteDate || isoToday());
    if (dateErr) return fail(dateErr + ' Nothing was signed.');

    if (norm(sel.options[sel.selectedIndex].text) !== norm(NOTE_TYPE)) return fail('Type did not stay on Physician Visit.');
    if (ta.value.replace(/\r/g, '').trim() !== NOTE_TEXT) return fail('The Data box lost the note text.');

    const sign = findClickable('Sign');
    if (!sign) return fail('Could not find the SIGN button in the note window.');
    setPhase('signing');
    sign.click();
  }

  async function onSignature(r) {
    if (r.phase !== 'signing') return;
    let marked = false;
    const mark = () => {
      if (marked) return;
      marked = true;
      const x = getRun();
      if (x && x.phase === 'signing') setPhase('signed');
    };
    window.addEventListener('pagehide', mark);

    const pwBox = await waitFor(() => document.querySelector('input[type=password]'), 10000);
    if (!pwBox) return fail('Signature window: password box not found.');

    if (r.mode === 'auto') {
      const pw = GM_getValue('pw', '');
      if (!pw) return fail('Password not available — press Resume to enter it again.');
      setValue(pwBox, pw);
      await sleep(300);
      const btn = findClickable('Sign');
      if (!btn) return fail('Signature window: SIGN button not found.');
      btn.click();
      await sleep(7000);
      if (!marked) fail('The signature did not go through (wrong password?). Check the signature window, then Resume or Skip.');
    } else {
      const b = document.createElement('div');
      b.textContent = 'Bulk notes: type your password and press SIGN — the next resident will open automatically.';
      b.style.cssText = 'background:#3d5a2a;color:#fff;padding:8px;font:14px system-ui;position:sticky;top:0;z-index:99999';
      document.body.prepend(b);
      pwBox.focus();
    }
  }

  // ---------------- Router ----------------
  const isPopup = /newipn\.jsp|digitalsignature/.test(path);

  if (/clientlist\.jsp/.test(path)) buildPanel();

  if (!isPopup && window.top === window) {
    renderOverlay();
    GM_addValueChangeListener('run', (key, oldV, newV, remote) => {
      renderOverlay();
      if (remote && newV && newV.phase === 'signed' && !newV.paused && /progressnotes\.xhtml/.test(path)) {
        // If PCC doesn't refresh the notes list by itself, refresh it so the new note can be confirmed.
        setTimeout(() => {
          const x = getRun();
          if (x && x.phase === 'signed' && !x.paused) location.reload();
        }, 5000);
      }
      if (/clientlist\.jsp/.test(path)) renderPanel();
    });
  }

  const run = getRun();
  if (run && !run.paused && run.phase !== 'finished') {
    if (/newipn\.jsp/.test(path)) onNewNote(run);
    else if (/digitalsignature/.test(path)) onSignature(run);
    else if (window.top === window) {
      if (/progressnotes\.xhtml/.test(path)) onProgNotes(run);
      else if (run.phase === 'goto') onChartPage(run);
    }
  }
})();
