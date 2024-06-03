// ==UserScript==
// @name           PCC Default Progress Note
// @namespace      https://github.com/maywoodmedical/Oscar
// @description    Sets the default for Point Click Care progress note settings
// @include        *chart/ipn/newipn.jsp*
// @require   http://ajax.googleapis.com/ajax/libs/jquery/1.3/jquery.min.js
// @updateURL 
// @downloadURL 
// @version 1.0
// ==/UserScript==

//========Get Path============
var elements = (window.location.pathname.split('/', 2))
firstElement = (elements.slice(1))
vPath = ('https://' + location.host + '/' + firstElement + '/') //=====Get Parameters============
var params = {};
if (location.search) {
    var parts = location.search.substring(1).split('&');
    for (var i = 0; i < parts.length; i++) {
        var nv = parts[i].split('=');
        if (!nv[0]) continue;
        params[nv[0]] = nv[1] || true;
    }
} //alert(params.docType)

// Choose Physician Visit in the drop down visit type
var theDefault = 'Physician Visit';
var theOptions = document.getElementsByName('pn_type_id')[0].options;
for (var theOption of theOptions) {
    if (typeof(theOption) == 'object') {
        if (theOption.text == theDefault) {
            theOption.selected = true;
            break;
        }
    }
}


/// Function to get the date of the previous Friday
function getPreviousFridayDate() {
    var today = new Date();
    var day = today.getDay();
    var daysToFriday = (day + 7 - 5) % 7; // Calculate how many days to go back to reach Friday
    var previousFriday = new Date(today);
    previousFriday.setDate(today.getDate() - daysToFriday); // Set the date to the previous Friday

    return previousFriday;
}

// Function to format the date as 'MM/DD/YYYY'
function formatDate(date) {
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    var year = date.getFullYear();
    return month + '/' + day + '/' + year;
}

// Get the previous Friday date
var previousFridayDate = getPreviousFridayDate();

// Format the date
var formattedDate = formatDate(previousFridayDate);

// Set the value of the text box 'effective_date_dummy' to the previous Friday date
document.getElementsByName('effective_date_dummy')[0].value = formattedDate;
