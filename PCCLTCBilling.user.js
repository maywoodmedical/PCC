// ==UserScript==
// @name         PCCLTCBilling
// @namespace    https://github.com/maywoodmedical/Oscar
// @description  LTC billing automation + bulk-bill every "To Do" (yellow) appointment on the schedule
// @include      *billing.do*
// @include      *providercontrol.jsp*
// @version      3.4
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @updateURL    https://github.com/maywoodmedical/PCC/raw/refs/heads/main/PCCLTCBilling.user.js
// @downloadURL  https://github.com/maywoodmedical/PCC/raw/refs/heads/main/PCCLTCBilling.user.js
// @run-at       document-end
// ==/UserScript==

    // =====================================================================
    // script detects appointments that appear in yellow on Oscar scheduling page which corresponds to the "To Do" appointment status
    // it bills each appointment for Fee 98150 · Dx 2900 (senile dementia) · Long Term Care / Continuing Care facility.
    // =====================================================================

(function () {
    'use strict';

    const FRAME_NAME = 'oscarBulkBill';
    const TODO_RGB = [253, 254, 199];   // Oscar's default "To Do" colour (#FDFEC7)
    const COLOR_TOLERANCE = 14;
    const SAVE_TIMEOUT = 60000;          // max time for one bill to reach "Save Bill"
    // Placeholder appointments to never bulk-bill: any name containing one of these as a whole word
    // (catches "Time, Lfp", "Lfp, Lwang", "Lfp, JLeong", ...). Add more words here if needed.
    const EXCLUDE_WORDS = ['lfp'];
    const isPlaceholder = name => EXCLUDE_WORDS.some(w => new RegExp(`\\b${w}\\b`, 'i').test(name));

    // =====================================================================
    // PART 1 — billing.do page (unchanged logic from v2.0)
    // =====================================================================
    if (/billing\.do/i.test(location.href)) {
        let actionTaken = false;
        const inBulk = window.name === FRAME_NAME;

        const smartMatch = (actual, target) => {
            if (!actual) return false;
            return actual.toLowerCase().trim().includes(target.toLowerCase().trim());
        };
        const getOptionText = (id) => {
            const el = document.getElementById(id);
            return el ? el.options[el.selectedIndex]?.text : null;
        };

        const runAutomation = () => {
            if (actionTaken) return;

            // --- STEP A: FINAL SAVE (Summary Page) ---
            const saveBtn = document.querySelector('input[type="submit"][name="submit"][value="Save Bill"]');
            if (saveBtn) {
                actionTaken = true;
                if (inBulk) GM_setValue('bbSaveClicked', Date.now());
                saveBtn.click();
                return;
            }

            // --- STEP B: DATA ENTRY ---
            const form = document.getElementById('selectBillingForm');
            const visitType = document.getElementById('xml_visittype');
            const feeCheck = document.querySelector('input[type="checkbox"][value="98150"]');
            const feeText = document.querySelector('input[name="xml_other1"]');
            const dxInput = document.getElementById('jsonDxSearchInput-1');

            if (form && !smartMatch(getOptionText('selectBillingForm'), 'Long Term Care')) {
                const idx = Array.from(form.options).findIndex(o => smartMatch(o.text, 'Long Term Care'));
                if (idx !== -1) { form.selectedIndex = idx; form.dispatchEvent(new Event('change', { bubbles: true })); }
            }
            if (visitType && !smartMatch(getOptionText('xml_visittype'), 'Continuing Care facility')) {
                const idx = Array.from(visitType.options).findIndex(o => smartMatch(o.text, 'Continuing Care facility'));
                if (idx !== -1) { visitType.selectedIndex = idx; visitType.dispatchEvent(new Event('change', { bubbles: true })); }
            }
            if (feeCheck && !feeCheck.checked) {
                feeCheck.checked = true;
                feeCheck.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (feeText && feeText.value !== '98150') {
                feeText.value = '98150';
                feeText.dispatchEvent(new Event('input', { bubbles: true }));
            }
            if (dxInput && dxInput.value !== '2900') {
                dxInput.value = '2900';
                dxInput.dispatchEvent(new Event('input', { bubbles: true }));
                dxInput.dispatchEvent(new Event('blur', { bubbles: true }));
            }

            // --- STEP C: THE "STUCK" PREVENTION ---
            const criticalDataReady = (feeText && feeText.value === '98150') && (dxInput && dxInput.value === '2900');
            const labelsReady = smartMatch(getOptionText('selectBillingForm'), 'Long Term Care') &&
                                smartMatch(getOptionText('xml_visittype'), 'Continuing Care facility');
            const continueBtn = document.querySelector('input[type="submit"][name="Submit"][value="Continue"]');

            if (criticalDataReady && labelsReady && continueBtn) {
                actionTaken = true;
                continueBtn.click();
            } else if (criticalDataReady && continueBtn) {
                setTimeout(() => {
                    if (!actionTaken) {
                        actionTaken = true;
                        continueBtn.click();
                    }
                }, 1500);
            }
        };

        const observer = new MutationObserver(() => runAutomation());
        observer.observe(document.body, { childList: true, subtree: true });
        runAutomation();
        return;
    }

    // =====================================================================
    // PART 2 — schedule page: bulk-bill every yellow "To Do" appointment
    // =====================================================================
    if (window.top !== window) return;

    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function rgbOf(str) {
        const m = (str || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (m) return m[4] !== undefined && +m[4] === 0 ? null : [+m[1], +m[2], +m[3]];
        const h = (str || '').match(/^#?([0-9a-f]{6})$/i);
        return h ? [0, 2, 4].map(i => parseInt(h[1].substr(i, 2), 16)) : null;
    }
    function backgroundOf(el) {
        for (let e = el; e && e !== document.body; e = e.parentElement) {
            const attr = e.getAttribute && e.getAttribute('bgcolor');
            if (attr && rgbOf(attr)) return rgbOf(attr);
            const c = rgbOf(getComputedStyle(e).backgroundColor);
            if (c) return c;
        }
        return null;
    }
    const isTodoColor = rgb => !!rgb && rgb.every((v, i) => Math.abs(v - TODO_RGB[i]) <= COLOR_TOLERANCE);

    function billingUrlOf(a) {
        const src = (a.getAttribute('onclick') || '') + ' ' + (a.getAttribute('href') || '');
        const m = src.match(/['"]([^'"]*billing\.do[^'"]*)['"]/) || src.match(/(\S*billing\.do\S*)/);
        if (!m) return null;
        // Oscar's popupPage() resolves relative to the schedule page
        return new URL(m[1].replace(/&amp;/g, '&'), location.href).href;
    }

    // Finds every unbilled appointment whose background is the To Do yellow
    // (or whose status icon is titled "To Do").
    function findTodoAppointments() {
        const out = [], seen = new Set();
        for (const a of document.querySelectorAll('a')) {
            if (a.textContent.trim() !== 'B') continue;               // "-B" = already billed
            const url = billingUrlOf(a);
            if (!url) continue;
            const apptNo = (url.match(/appointment_no=(\d+)/) || [])[1];
            if (!apptNo || seen.has(apptNo)) continue;
            const cell = a.closest('td') || a.parentElement;
            const titles = [...cell.querySelectorAll('[title], img[alt]')].map(e => (e.title || e.alt || '').toLowerCase());
            const titledTodo = titles.some(t => t.trim() === 'to do' || t.includes('status: to do'));
            if (!isTodoColor(backgroundOf(a)) && !titledTodo) continue;
            const nameLink = [...cell.querySelectorAll('a')].find(x => x !== a && x.textContent.trim().length > 3 && /,/.test(x.textContent));
            const name = nameLink ? nameLink.textContent.trim() : cell.textContent.split('|')[0].trim();
            if (isPlaceholder(name) || isPlaceholder(cell.textContent.split('|')[0])) continue;
            seen.add(apptNo);
            out.push({ apptNo, name, url });
        }
        return out;
    }

    function isBilled(apptNo) {
        return [...document.querySelectorAll('a')].some(a =>
            a.textContent.trim() === '-B' &&
            ((a.getAttribute('onclick') || '') + (a.getAttribute('href') || '')).includes(`appointment_no=${apptNo}`));
    }

    // ---------- UI ----------
    const style = document.createElement('style');
    style.textContent = `
      #bb-btn{position:fixed;bottom:16px;left:16px;z-index:99999;background:#3d5a2a;color:#fff;border:0;border-radius:8px;
        padding:10px 14px;font:14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}
      #bb-panel{position:fixed;top:60px;left:16px;width:440px;max-height:85vh;overflow:auto;z-index:100000;background:#fff;
        border:2px solid #3d5a2a;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.3);font:14px/1.4 system-ui,sans-serif;color:#222;padding:12px}
      #bb-panel h3{margin:0 0 6px;font-size:16px}
      #bb-panel label{display:flex;gap:6px;align-items:center;padding:1px 0}
      #bb-panel button{background:#3d5a2a;color:#fff;border:0;border-radius:6px;padding:6px 10px;margin:2px;cursor:pointer}
      #bb-panel button.sec{background:#eee;color:#222}
      #bb-panel .muted{color:#777;font-size:12px}
      #bb-panel .err{color:#b00;font-weight:600}
      #bb-panel iframe{width:100%;height:260px;border:1px solid #ccc;margin-top:8px}`;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'bb-btn';
    document.body.appendChild(btn);
    const refreshBtn = () => { btn.textContent = `Bill LTC (${findTodoAppointments().length})`; };
    refreshBtn();

    let panel = null, running = false, stopRequested = false, batchStarted = false;

    // The button opens the panel, or minimizes/restores it if it's already open.
    btn.onclick = () => {
        if (!panel) return openPanel();
        if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
        if (running || batchStarted) { panel.style.display = ''; return; }
        panel.remove(); panel = null;   // nothing started yet: rebuild with a fresh list
        openPanel();
    };

    function openPanel() {
        if (panel) return;
        batchStarted = false;
        const list = findTodoAppointments();
        panel = document.createElement('div');
        panel.id = 'bb-panel';
        if (!list.length) {
            panel.innerHTML = `<h3>Bulk billing</h3><p>No unbilled yellow "To Do" appointments found on this page.</p>
              <button class="sec" id="bb-close">Close</button>`;
        } else {
            panel.innerHTML = `<h3>Bill ${list.length} To Do appointment(s)</h3>
              <div class="muted">Fee 98150 · Dx 2900 · Long Term Care / Continuing Care facility. Untick anyone you don't want billed.</div>
              <div style="margin:6px 0"><button class="sec" id="bb-all">All</button><button class="sec" id="bb-none">None</button></div>
              <div id="bb-list">${list.map(p => `<label><input type="checkbox" data-appt="${esc(p.apptNo)}" checked>${esc(p.name)}</label>`).join('')}</div>
              <hr><div id="bb-status"></div>
              <div><button id="bb-go">Bill selected</button><button class="sec" id="bb-close">Close</button></div>`;
        }
        document.body.appendChild(panel);
        const q = s => panel.querySelector(s);
        q('#bb-close').onclick = () => {
            if (running) { stopRequested = true; return; }
            panel.remove(); panel = null; refreshBtn();
        };
        if (!list.length) return;
        const boxes = () => [...panel.querySelectorAll('[data-appt]')];
        const updateGo = () => { q('#bb-go').textContent = `Bill selected (${boxes().filter(b => b.checked).length})`; };
        boxes().forEach(b => { b.onchange = updateGo; });
        q('#bb-all').onclick = () => { boxes().forEach(b => { b.checked = true; }); updateGo(); };
        q('#bb-none').onclick = () => { boxes().forEach(b => { b.checked = false; }); updateGo(); };
        updateGo();
        q('#bb-go').onclick = () => {
            const chosen = list.filter(p => boxes().find(b => b.dataset.appt === p.apptNo && b.checked));
            if (!chosen.length) return;
            if (!confirm(`Bill ${chosen.length} appointment(s) as LTC visit 98150 / Dx 2900?\n\nOnly bill residents you actually saw.`)) return;
            runBatch(chosen);
        };
    }

    // Has the billing window finished saving since `since`?
    // Checks the recorded load time (so a fast save isn't missed) and the page itself.
    function saveFinished(frame, since) {
        if ((frame._lastLoad || 0) > since) return true;
        try {
            const doc = frame.contentDocument;
            return !!doc && doc.readyState === 'complete' &&
                !doc.querySelector('input[type="submit"][value="Save Bill"]') &&
                frame._lastLoad > since - 50;
        } catch (e) { return false; }
    }

    async function runBatch(items) {
        running = true;
        batchStarted = true;
        stopRequested = false;
        const q = s => panel.querySelector(s);
        q('#bb-go').disabled = true;
        q('#bb-close').textContent = 'Stop';
        panel.querySelectorAll('[data-appt], #bb-all, #bb-none').forEach(e => { e.disabled = true; });
        const status = q('#bb-status');
        const frame = document.createElement('iframe');
        frame.name = FRAME_NAME;
        frame._lastLoad = 0;
        frame.addEventListener('load', () => { frame._lastLoad = Date.now(); });
        status.after(frame);

        const results = [];
        for (let i = 0; i < items.length; i++) {
            if (stopRequested) break;
            const p = items[i];
            status.innerHTML = `Billing ${i + 1} of ${items.length}: <b>${esc(p.name)}</b>`;
            GM_deleteValue('bbSaveClicked');
            const start = Date.now();
            frame.src = p.url;

            // wait until the billing page presses "Save Bill"
            let saved = false;
            while (Date.now() - start < SAVE_TIMEOUT && !stopRequested) {
                if (GM_getValue('bbSaveClicked', 0) >= start) { saved = true; break; }
                await sleep(150);
            }
            if (!saved) {
                results.push({ ...p, ok: false, why: stopRequested ? 'stopped' : 'never reached Save Bill' });
                if (!stopRequested) {
                    status.innerHTML = `<div class="err">Stopped at ${esc(p.name)}: the bill never reached "Save Bill". Check the window below, fix or bill this one by hand, then close and start again for the rest.</div>`;
                }
                break;
            }
            // wait for the save to finish (usually well under a second; 8 s safety limit)
            const saveTs = GM_getValue('bbSaveClicked', start);
            const limit = Date.now() + 8000;
            while (Date.now() < limit && !saveFinished(frame, saveTs)) await sleep(150);
            await sleep(400);
            results.push({ ...p, ok: true });
        }

        GM_setValue('bbLastBatch', { at: Date.now(), items: results.filter(r => r.ok).map(r => ({ apptNo: r.apptNo, name: r.name })) });
        const ok = results.filter(r => r.ok).length;
        const notDone = items.filter(p => !results.find(r => r.apptNo === p.apptNo && r.ok));
        status.innerHTML += `<div style="margin-top:6px"><b>${ok} bill(s) saved.</b>${notDone.length ? ` <span class="err">${notDone.length} not billed:</span>` : ''}</div>` +
            notDone.map(p => `<div class="err">• ${esc(p.name)}</div>`).join('') +
            `<div class="muted">Reloading the schedule will confirm each one now shows "-B".</div>`;
        q('#bb-close').textContent = 'Close';
        q('#bb-go').textContent = 'Reload schedule';
        q('#bb-go').disabled = false;
        q('#bb-go').onclick = () => location.reload();
        running = false;
    }

    // After a reload, confirm the last batch really shows as billed.
    const last = GM_getValue('bbLastBatch', null);
    if (last && Date.now() - last.at < 15 * 60000 && last.items.length) {
        GM_deleteValue('bbLastBatch');
        const missing = last.items.filter(p => !isBilled(p.apptNo));
        const note = document.createElement('div');
        note.style.cssText = 'position:fixed;bottom:64px;left:16px;z-index:99999;background:#fff;border:2px solid ' +
            (missing.length ? '#b00' : '#3d5a2a') + ';border-radius:8px;padding:8px 12px;font:13px system-ui;max-width:420px';
        note.innerHTML = missing.length
            ? `<b style="color:#b00">${missing.length} of ${last.items.length} don't show as billed yet:</b><br>${missing.map(p => esc(p.name)).join('<br>')}`
            : `<b>All ${last.items.length} bills confirmed on the schedule.</b>`;
        note.onclick = () => note.remove();
        document.body.appendChild(note);
        setTimeout(() => note.remove(), 20000);
    }
})();
