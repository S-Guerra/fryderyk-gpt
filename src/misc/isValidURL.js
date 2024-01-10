"use strict";

// verifies if valid URL
function isValidURL(url) {
    try {
        return Boolean(new URL(url));
    } catch (err) {
        return false;
    }
}

module.exports = isValidURL;
