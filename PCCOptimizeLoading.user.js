// ==UserScript==
// @name         PCCOptimizeLoading
// @namespace    PhysicianWorkflows
// @match        https://www60.pointclickcare.com/clinical/client/progressnotesviewall.xhtml*
// @match        https://www60.pointclickcare.com/care/chart/wandv/viewallclientvitals.jsp*
// @updateURL    https://github.com/maywoodmedical/PCC/raw/refs/heads/main/PCCOptimizeLoading.user.js
// @downloadURL  https://github.com/maywoodmedical/PCC/raw/refs/heads/main/PCCOptimizeLoading.user.js
// @grant        none
// @version      1.2
// @author       AI Assistant
// @description  Combined script: Auto-loads all notes and unchecks reduced date range for vitals.
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const url = window.location.href;

    // --- LOGIC FOR PROGRESS NOTES PAGE ---
    // Executed at 'document-start' to prevent visual flashing and stop the page from loading twice
    if (url.includes("progressnotesviewall.xhtml")) {
        const currentUrl = new URL(url);
        const viewOption = currentUrl.searchParams.get("viewAllOption");

        if (viewOption !== "0") {
            currentUrl.searchParams.set("viewAllOption", "0");
            window.location.replace(currentUrl.href);
            return; // Terminate execution since page is redirecting
        }
    }

    // --- LOGIC FOR VITALS PAGE ---
    if (url.includes("viewallclientvitals.jsp")) {
        let actionAttempts = 0;

        const handleVitalsCheckbox = () => {
            const checkbox = document.querySelector('input[name="showReducedDateRange"]');
            
            if (checkbox) {
                if (checkbox.checked) {
                    checkbox.checked = false;
                    
                    // Attempt PCC's native execution first via window scope context
                    if (typeof window.showReducedDateRangeFunction === 'function') {
                        window.showReducedDateRangeFunction(false);
                    } else if (typeof showReducedDateRangeFunction === 'function') {
                        showReducedDateRangeFunction(false);
                    } else {
                        // Safe fallback mimicking absolute human click interaction patterns
                        checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                    }
                    console.log("PCC Optimize: Unchecked reduced date range constraint.");
                }
                clearInterval(checkInterval);
            }

            // Stop pooling after 10 seconds to save machine memory if element doesn't exist
            actionAttempts++;
            if (actionAttempts > 100) {
                clearInterval(checkInterval);
            }
        };

        // Continually look for the dynamic element to bypass varying server delivery delay rates
        const checkInterval = setInterval(handleVitalsCheckbox, 100);
    }

})();
