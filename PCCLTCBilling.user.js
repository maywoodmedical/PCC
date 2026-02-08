// ==UserScript==
// @name        PCCLTCBilling
// @namespace   https://github.com/maywoodmedical/Oscar
// @description Automatically select LTC billing form and service location 
// @include     *billing.do?billRegion=BC&billForm=GP&hotclick=*
// @require http://ajax.googleapis.com/ajax/libs/jquery/1.3/jquery.min.js
// @updateURL https://github.com/maywoodmedical/PCC/blob/main/LTCBilling.user.js
// @downloadURL https://github.com/maywoodmedical/PCC/blob/main/LTCBilling.user.js
// @version 1.3
// @grant       none
// ==/UserScript==

(function() {
    'use strict';

    // Function to select the option from a dropdown and trigger a change event
    function selectOptionByText(dropdownId, optionText) {
        let dropdown = document.getElementById(dropdownId);
        if (dropdown) {
            for (let i = 0; i < dropdown.options.length; i++) {
                if (dropdown.options[i].text === optionText) {
                    dropdown.selectedIndex = i;
                    dropdown.dispatchEvent(new Event('change', { bubbles: true })); // Trigger change event
                    console.log(`Selected "${optionText}" in dropdown with ID "${dropdownId}".`);
                    break;
                }
            }
        } else {
            console.warn(`Dropdown with ID "${dropdownId}" not found.`);
        }
    }

    // Function to tick the checkbox and trigger a change event
    function tickCheckboxByValue(checkboxValue) {
        let checkboxes = document.querySelectorAll(`input[type="checkbox"][value="${checkboxValue}"]`);
        checkboxes.forEach(checkbox => {
            if (!checkbox.checked) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event('change', { bubbles: true })); // Trigger change event
                console.log(`Checked checkbox with value "${checkboxValue}".`);
            }
        });
    }

    // Function to fill the text box and trigger an input event
    function fillTextBoxByName(inputName, value) {
        let textBox = document.querySelector(`input[type="text"][name="${inputName}"]`);
        if (textBox) {
            textBox.value = value;
            textBox.dispatchEvent(new Event('input', { bubbles: true })); // Trigger input event
            console.log(`Filled text box with name "${inputName}" with value "${value}".`);
        } else {
            console.warn(`Text box with name "${inputName}" not found.`);
        }
    }

    // Function to set up the page
    function setupPage() {
        selectOptionByText('selectBillingForm', 'Long Term Care');
        selectOptionByText('xml_visittype', 'Continuing Care facility');
        tickCheckboxByValue('98150');
        fillTextBoxByName('xml_other1', '98150');
    }

    // Ensure elements are available before running the setup
    function waitForElement(selector, callback) {
        const observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList' && document.querySelector(selector)) {
                    observer.disconnect();
                    callback();
                    break;
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    // Run the function when the page is fully loaded
    window.addEventListener('load', () => {
        waitForElement('#selectBillingForm', setupPage);
    });
})();
