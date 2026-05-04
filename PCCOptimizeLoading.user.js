// ==UserScript==
// @name        PCCOptimizeLoading
// @namespace   PhysicianWorkflows
// @match       https://www60.pointclickcare.com/clinical/client/progressnotesviewall.xhtml*
// @match       https://www60.pointclickcare.com/care/chart/wandv/viewallclientvitals.jsp*
// @uploadURL   https://github.com/maywoodmedical/PCC/raw/refs/heads/main/PCCOptimizeLoading.user.js
// @downloadURL https://github.com/maywoodmedical/PCC/raw/refs/heads/main/PCCOptimizeLoading.user.js
// @grant       none
// @version     1.1
// @author      Gemini
// @description Combined script: Auto-loads all notes and unchecks reduced date range for vitals.
// ==/UserScript==

(function() {
    'use strict';

    const url = window.location.href;

    // --- LOGIC FOR PROGRESS NOTES PAGE ---
    if (url.includes("progressnotesviewall.xhtml")) {
        const currentUrl = new URL(url);
        const viewOption = currentUrl.searchParams.get("viewAllOption");

        if (viewOption !== "0") {
            currentUrl.searchParams.set("viewAllOption", "0");
            window.location.replace(currentUrl.href);
        }
    }

    // --- LOGIC FOR VITALS PAGE ---
    if (url.includes("viewallclientvitals.jsp")) {
        const handleVitalsCheckbox = () => {
            const checkbox = document.querySelector('input[name="showReducedDateRange"]');
            
            if (checkbox && checkbox.checked) {
                checkbox.checked = false;
                
                // Invoke PCC's native function to refresh the data
                if (typeof showReducedDateRangeFunction === 'function') {
                    showReducedDateRangeFunction(false);
                } else {
                    checkbox.dispatchEvent(new Event('click'));
                }
            }
        };

        // Execute immediately and once more shortly after for dynamic loading
        handleVitalsCheckbox();
        setTimeout(handleVitalsCheckbox, 800);
    }

})();
