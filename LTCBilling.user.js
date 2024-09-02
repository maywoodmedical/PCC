// ==UserScript==
// @name        LTC Billing
// @namespace   https://github.com/maywoodmedical/Oscar
// @description Automatically select LTC billing form, service location, and enter reg visit
// @include     *billing.do?billRegion=BC&billForm=GP&hotclick=*
// @require http://ajax.googleapis.com/ajax/libs/jquery/1.3/jquery.min.js
// @updateURL https://github.com/maywoodmedical/PCC/blob/main/LTCBilling.user.js
// @downloadURL https://github.com/maywoodmedical/PCC/blob/main/LTCBilling.user.js
// @version 1.0
// @grant       none
// ==/UserScript==

(function() {
    'use strict';

    // Function to select the option from a dropdown
    function selectOptionByText(dropdownId, optionText) {
        let dropdown = document.getElementById(dropdownId);
        if (dropdown) {
            for (let i = 0; i < dropdown.options.length; i++) {
                if (dropdown.options[i].text === optionText) {
                    dropdown.selectedIndex = i;
                    dropdown.dispatchEvent(new Event('change')); // Trigger change event if needed
                    break;
                }
            }
        }
    }

    // Function to tick the checkbox
    function tickCheckboxByValue(checkboxValue) {
        let checkboxes = document.querySelectorAll(`input[type="checkbox"][value="${checkboxValue}"]`);
        checkboxes.forEach(checkbox => {
            if (!checkbox.checked) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event('change')); // Trigger change event if needed
            }
        });
    }

    // Function to fill the text box
    function fillTextBoxByName(inputName, value) {
        let textBox = document.querySelector(`input[type="text"][name="${inputName}"]`);
        if (textBox) {
            textBox.value = value;
            textBox.dispatchEvent(new Event('input')); // Trigger input event if needed
        }
    }

    // Function to set up the page
    function setupPage() {
        selectOptionByText('selectBillingForm', 'Long Term Care');
        selectOptionByText('xml_visittype', 'Continuing Care facility');
        tickCheckboxByValue('00114');
        fillTextBoxByName('xml_other1', '00114');
    }

    // Run the function when the page is fully loaded
    window.addEventListener('load', setupPage);
})();
