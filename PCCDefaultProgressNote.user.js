// ==UserScript==
// @name         PCCDefaultProgressNote
// @namespace    https://github.com/maywoodmedical/Oscar
// @description  Sets default Physician Visit, Friday's date, and auto-focuses text box
// @include      *chart/ipn/newipn.jsp*
// @require      http://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js
// @version      1.8
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

    const checkExist = setInterval(function() {
        const $dropdown = $('select[name="pn_type_id"]');
        const $dateField = $('input[name="effective_date_dummy"]');
        const $hiddenField = $('input[name="effective_date"]');
        const $textArea = $('#spellcheck0'); // Target the ID you provided

        // Check if the essential fields and the textarea are ready
        if ($dropdown.length && $dateField.length && $textArea.length && !hasRun) {
            
            const friday = getFormattedFriday();

            // 1. Set Dropdown
            $dropdown.val($dropdown.find('option:contains("Physician Visit")').val());

            // 2. Set Date Fields
            $dateField.val(friday);
            if ($hiddenField.length) {
                $hiddenField.val(friday);
            }

            // 3. Trigger events for the date field
            $dateField[0].dispatchEvent(new Event('input', { bubbles: true }));
            $dateField[0].dispatchEvent(new Event('change', { bubbles: true }));

            // 4. AUTO-FOCUS TEXT AREA
            // We use a slight timeout (10ms) to ensure the browser is ready to accept focus
            setTimeout(() => {
                $textArea.focus();
                // Optional: This moves the cursor to the end if there's existing text
                const val = $textArea.val();
                $textArea.val('').val(val); 
            }, 10);

            console.log("PCC Fast-Load: Fields set and cursor focused.");
            
            hasRun = true;
            clearInterval(checkExist); 
        }
    }, 100);

    setTimeout(() => clearInterval(checkExist), 10000);
})();
