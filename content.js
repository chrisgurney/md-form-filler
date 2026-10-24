// content.js
// This content script is intentionally minimal.
// The heavy lifting (field scanning and filling) is done via
// chrome.scripting.executeScript() from popup.js, which injects
// functions directly into the page context at fill-time.
// This file exists to satisfy manifest content_scripts if needed
// for future messaging-based enhancements.
