// ==UserScript==
// @name         PCCLTCBilling
// @namespace    https://github.com/maywoodmedical/Oscar
// @description  LTC automation with "Smart Match" to prevent getting stuck
// @match        *://*/billing.do*
// @match        *://*/*billing.do*
// @version      2.1
// @grant        none
// @updateURL    https://github.com/maywoodmedical/PCC/raw/refs/heads/main/PCCLTCBilling.user.js
// @downloadURL  https://github.com/maywoodmedical/PCC/raw/refs/heads/main/PCCLTCBilling.user.js
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let actionTaken = false; 

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
            saveBtn.click();
            return;
        }

        // --- STEP B: DATA ENTRY ---
        const form = document.getElementById('selectBillingForm');
        const visitType = document.getElementById('xml_visittype');
        const feeCheck = document.querySelector('input[type="checkbox"][value="98150"]');
        const feeText = document.querySelector('input[name="xml_other1"]');
        const dxInput = document.getElementById('jsonDxSearchInput-1');

        let changesMade = false;

        if (form && !smartMatch(getOptionText('selectBillingForm'), 'Long Term Care')) {
            const idx = Array.from(form.options).findIndex(o => smartMatch(o.text, 'Long Term Care'));
            if (idx !== -1) { 
                form.selectedIndex = idx; 
                form.dispatchEvent(new Event('change', { bubbles: true })); 
                changesMade = true;
            }
        }

        if (visitType && !smartMatch(getOptionText('xml_visittype'), 'Continuing Care facility')) {
            const idx = Array.from(visitType.options).findIndex(o => smartMatch(o.text, 'Continuing Care facility'));
            if (idx !== -1) { 
                visitType.selectedIndex = idx; 
                visitType.dispatchEvent(new Event('change', { bubbles: true })); 
                changesMade = true;
            }
        }

        if (feeCheck && !feeCheck.checked) {
            feeCheck.checked = true;
            feeCheck.dispatchEvent(new Event('change', { bubbles: true }));
            changesMade = true;
        }

        if (feeText && feeText.value !== '98150') {
            feeText.value = '98150';
            feeText.dispatchEvent(new Event('input', { bubbles: true }));
            changesMade = true;
        }

        if (dxInput && dxInput.value !== '2900') {
            dxInput.value = '2900';
            dxInput.dispatchEvent(new Event('input', { bubbles: true }));
            dxInput.dispatchEvent(new Event('blur', { bubbles: true }));
            changesMade = true;
        }

        // If we just mutated the fields, stop here and let the framework digest changes
        if (changesMade) return;

        // --- STEP C: THE "STUCK" PREVENTION ---
        const criticalDataReady = (feeText && feeText.value === '98150') && (dxInput && dxInput.value === '2900');
        const labelsReady = smartMatch(getOptionText('selectBillingForm'), 'Long Term Care') && 
                            smartMatch(getOptionText('xml_visittype'), 'Continuing Care facility');

        const continueBtn = document.querySelector('input[type="submit"][name="Submit"][value="Continue"]');

        if (criticalDataReady && labelsReady && continueBtn) {
            console.log("Verified. Submitting...");
            actionTaken = true;
            continueBtn.click();
        } else if (criticalDataReady && continueBtn) {
            setTimeout(() => {
                if (!actionTaken) {
                    console.log("Safety override: Proceeding despite label mismatch.");
                    actionTaken = true;
                    continueBtn.click();
                }
            }, 1500);
        }
    };

    // Safely observe DOM mutations without creating infinite loops
    let timeout;
    const observer = new MutationObserver(() => {
        clearTimeout(timeout);
        timeout = setTimeout(runAutomation, 50); // Debounce to allow text layouts to finish updating
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    runAutomation();
})();
