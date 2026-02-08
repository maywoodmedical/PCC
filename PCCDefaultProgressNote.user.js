// ==UserScript==
// @name          PCC Default Progress Note (Fast & Responsive)
// @namespace     https://github.com/maywoodmedical/Oscar
// @description   Uses a fast interval to apply settings as soon as elements appear
// @include       *chart/ipn/newipn.jsp*
// @require       http://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @version       1.7
// ==/UserScript==

(function() {
    'use strict';

    let hasRun = false;

    function getFormattedFriday() {
        let d = new Date();
        let day = d.getDay();
        let diff = (day + 7 - 5) % 7; 
        d.setDate(d.getDate() - diff);
        return (d.getMonth() + 1).toString().padStart(2, '0') + '/' +
               d.getDate().toString().padStart(2, '0') + '/' +
               d.getFullYear();
    }

    // This function will run repeatedly until it succeeds once
    const checkExist = setInterval(function() {
        const $dropdown = $('select[name="pn_type_id"]');
        const $dateField = $('input[name="effective_date_dummy"]');
        const $hiddenField = $('input[name="effective_date"]');

        // Check if the specific fields we need are rendered
        if ($dropdown.length && $dateField.length && !hasRun) {
            
            const friday = getFormattedFriday();

            // 1. Set Dropdown
            $dropdown.val($dropdown.find('option:contains("Physician Visit")').val());

            // 2. Set Date Fields
            $dateField.val(friday);
            if ($hiddenField.length) {
                $hiddenField.val(friday);
            }

            // 3. Trigger events to lock the value in the site's memory
            $dateField[0].dispatchEvent(new Event('input', { bubbles: true }));
            $dateField[0].dispatchEvent(new Event('change', { bubbles: true }));
            $dateField[0].dispatchEvent(new Event('blur', { bubbles: true }));

            console.log("PCC Fast-Load: Success.");
            
            // 4. Clean up: Stop the interval and lock the script
            hasRun = true;
            clearInterval(checkExist); 
        }
    }, 100); // Check every 100ms (0.1 seconds)

    // Safety: If for some reason the elements never appear, stop checking after 10 seconds
    setTimeout(() => clearInterval(checkExist), 10000);

})();
