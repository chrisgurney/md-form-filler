// popup.js

// ─── State ────────────────────────────────────────────────────────────────────
let dirHandle = null;        // FileSystemDirectoryHandle
let parsedFiles = [];        // Array of { filename, matchRules, value }
let scanResults = [];        // Array of { filename, fieldSelector, matched, value }

// ─── DOM ──────────────────────────────────────────────────────────────────────
const folderDisplay = document.getElementById('folderDisplay');
const folderPath    = document.getElementById('folderPath');
const filesSection  = document.getElementById('filesSection');
const filesList     = document.getElementById('filesList');
const emptyState    = document.getElementById('emptyState');
const scanBtn       = document.getElementById('scanBtn');
const fillBtn       = document.getElementById('fillBtn');
const statusArea    = document.getElementById('statusArea');
const statusInner   = document.getElementById('statusInner');
const statusIcon    = document.getElementById('statusIcon');
const statusText    = document.getElementById('statusText');

// ─── Init ─────────────────────────────────────────────────────────────────────
// Restore folder name from storage (can't restore handle across sessions, but show name)
chrome.storage.local.get(['lastFolderName'], (res) => {
  if (res.lastFolderName) {
    folderPath.textContent = res.lastFolderName;
    folderPath.classList.add('set');
    folderDisplay.classList.add('has-folder');
    showStatus('info', 'Re-select folder to reload files.');
    scanBtn.style.display = 'flex';
  }
});

// ─── Events ───────────────────────────────────────────────────────────────────
folderDisplay.addEventListener('click', pickFolder);
scanBtn.addEventListener('click', scanPage);
fillBtn.addEventListener('click', fillForm);

// ─── Pick folder ──────────────────────────────────────────────────────────────
async function pickFolder() {
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    folderPath.textContent = dirHandle.name;
    folderPath.classList.add('set');
    folderDisplay.classList.add('has-folder');
    chrome.storage.local.set({ lastFolderName: dirHandle.name });
    await loadFiles();
  } catch (e) {
    if (e.name !== 'AbortError') {
      showStatus('error', 'Could not open folder: ' + e.message);
    }
  }
}

// ─── Load & parse .md files ───────────────────────────────────────────────────
async function loadFiles() {
  parsedFiles = [];
  hideStatus();

  const mdFiles = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.md')) {
      mdFiles.push(entry);
    }
  }

  if (mdFiles.length === 0) {
    filesSection.classList.remove('visible');
    emptyState.style.display = 'block';
    scanBtn.style.display = 'none';
    fillBtn.disabled = true;
    return;
  }

  emptyState.style.display = 'none';

  for (const entry of mdFiles) {
    const file = await entry.getFile();
    const text = await file.text();
    const parsed = parseMarkdownFile(text, entry.name);
    parsedFiles.push(parsed);
  }

  renderFileList(parsedFiles);
  filesSection.classList.add('visible');
  scanBtn.style.display = 'flex';
  fillBtn.disabled = false;
  showStatus('info', `${parsedFiles.length} file${parsedFiles.length !== 1 ? 's' : ''} loaded. Scan or fill.`);
}

// ─── Parse frontmatter + body ──────────────────────────────────────────────────
function parseMarkdownFile(text, filename) {
  const result = {
    filename,
    matchRules: [],
    value: '',
    parseError: null,
  };

  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (!fmMatch) {
    // No frontmatter — use filename stem as a name match, whole text as value
    const stem = filename.replace(/\.md$/i, '');
    result.matchRules = [{ name: stem }, { id: stem }, { label: stem }];
    result.value = text.trim();
    return result;
  }

  const frontmatter = fmMatch[1];
  result.value = fmMatch[2].trim();

  // Parse YAML match block (simple parser, no external deps)
  try {
    result.matchRules = parseMatchRules(frontmatter);
  } catch (e) {
    result.parseError = e.message;
  }

  return result;
}

// ─── Simple YAML match parser ─────────────────────────────────────────────────
// Handles the shape:
//   match:
//     - label: "First Name"
//     - name: fname
//     - placeholder: "Enter first name"
//     - id: field_first
//     - selector: "#custom > input"
function parseMatchRules(yaml) {
  const rules = [];
  const lines = yaml.split(/\r?\n/);
  let inMatch = false;
  let currentRule = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^match\s*:/.test(line)) {
      inMatch = true;
      continue;
    }

    if (inMatch) {
      // New list item
      const listItem = line.match(/^\s*-\s+(\w+)\s*:\s*(.*)/);
      if (listItem) {
        if (currentRule) rules.push(currentRule);
        const key = listItem[1];
        const val = listItem[2].replace(/^["']|["']$/g, '').trim();
        currentRule = { [key]: val };
        continue;
      }

      // Continuation key under same item (indented)
      const subKey = line.match(/^\s{4,}(\w+)\s*:\s*(.*)/);
      if (subKey && currentRule) {
        const key = subKey[1];
        const val = subKey[2].replace(/^["']|["']$/g, '').trim();
        currentRule[key] = val;
        continue;
      }

      // Non-indented non-list line ends the match block
      if (line && !/^\s/.test(line)) {
        inMatch = false;
      }
    }
  }

  if (currentRule) rules.push(currentRule);
  return rules;
}

// ─── Render file list ─────────────────────────────────────────────────────────
function renderFileList(files, withResults = false) {
  filesList.innerHTML = '';
  for (const f of files) {
    const item = document.createElement('div');
    item.className = 'file-item';

    const dot = document.createElement('div');
    dot.className = 'file-dot';

    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = f.filename;

    const status = document.createElement('div');
    status.className = 'file-status';

    if (f.parseError) {
      dot.classList.add('error');
      status.classList.add('error');
      status.textContent = 'parse err';
    } else if (withResults) {
      const r = scanResults.find(r => r.filename === f.filename);
      if (r && r.matched) {
        dot.classList.add('matched');
        status.classList.add('matched');
        status.textContent = 'matched';
      } else {
        dot.classList.add('unmatched');
        status.classList.add('unmatched');
        status.textContent = 'no match';
      }
    }

    item.appendChild(dot);
    item.appendChild(name);
    item.appendChild(status);
    filesList.appendChild(item);
  }
}

// ─── Scan page ────────────────────────────────────────────────────────────────
async function scanPage() {
  if (parsedFiles.length === 0) {
    showStatus('error', 'No files loaded.');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Inject scanner
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scanFields,
    args: [parsedFiles],
  });

  scanResults = results[0].result;

  const matchCount = scanResults.filter(r => r.matched).length;
  renderFileList(parsedFiles, true);

  if (matchCount === 0) {
    showStatus('error', 'No fields matched on this page.');
    fillBtn.disabled = true;
  } else {
    showStatus('info', `${matchCount} of ${parsedFiles.length} fields matched.`);
    fillBtn.disabled = false;
  }
}

// ─── Fill form ────────────────────────────────────────────────────────────────
async function fillForm() {
  if (parsedFiles.length === 0) {
    showStatus('error', 'No files loaded.');
    return;
  }

  fillBtn.disabled = true;
  fillBtn.innerHTML = '<div class="spinner"></div> Filling…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fillFields,
    args: [parsedFiles],
  });

  const { filled, total, details } = results[0].result;
  scanResults = details;
  renderFileList(parsedFiles, true);

  fillBtn.disabled = false;
  fillBtn.innerHTML = `
    <svg viewBox="0 0 14 14" fill="none">
      <path d="M2 7h10M7 2l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Fill Form`;

  if (filled === 0) {
    showStatus('error', 'No fields could be matched or filled.');
  } else if (filled < total) {
    showStatus('info', `Filled ${filled} of ${total} fields. ${total - filled} unmatched.`);
  } else {
    showStatus('success', `All ${filled} field${filled !== 1 ? 's' : ''} filled successfully.`);
  }
}

// ─── Status helpers ───────────────────────────────────────────────────────────
function showStatus(type, message) {
  statusArea.classList.add('visible');
  statusInner.className = 'status-inner ' + type;

  const icons = {
    success: '✓',
    error:   '✕',
    info:    '→',
  };
  statusIcon.textContent = icons[type] || '';
  statusText.textContent = message;
}

function hideStatus() {
  statusArea.classList.remove('visible');
}

// ─── Content-world functions (injected into page) ─────────────────────────────

/**
 * Scans the page to see which files would match a field.
 * Runs in the page context.
 */
function scanFields(files) {
  return files.map(f => {
    const el = findField(f.matchRules);
    return {
      filename: f.filename,
      matched: !!el,
      selector: el ? getSelector(el) : null,
    };
  });
}

/**
 * Fills matched fields with values from the parsed files.
 * Runs in the page context.
 */
function fillFields(files) {
  const details = [];
  let filled = 0;

  for (const f of files) {
    const el = findField(f.matchRules);
    if (!el) {
      details.push({ filename: f.filename, matched: false });
      continue;
    }

    try {
      setFieldValue(el, f.value);
      details.push({ filename: f.filename, matched: true });
      filled++;
    } catch (e) {
      details.push({ filename: f.filename, matched: false, error: e.message });
    }
  }

  return { filled, total: files.length, details };
}

/**
 * Finds a form field element using a list of match rules (tried in order).
 * Each rule is an object with ONE of: label, name, id, placeholder, selector, aria-label, type.
 */
function findField(rules) {
  for (const rule of rules) {
    const el = tryRule(rule);
    if (el) return el;
  }
  return null;
}

function tryRule(rule) {
  // CSS selector — direct query
  if (rule.selector) {
    return document.querySelector(rule.selector) || null;
  }

  // id
  if (rule.id) {
    return document.getElementById(rule.id) || null;
  }

  // name attribute
  if (rule.name) {
    return document.querySelector(`[name="${CSS.escape(rule.name)}"]`) || null;
  }

  // placeholder
  if (rule.placeholder) {
    return (
      document.querySelector(`[placeholder="${CSS.escape(rule.placeholder)}"]`) ||
      findByAttrCaseInsensitive('placeholder', rule.placeholder)
    );
  }

  // aria-label
  if (rule['aria-label']) {
    return (
      document.querySelector(`[aria-label="${CSS.escape(rule['aria-label'])}"]`) ||
      findByAttrCaseInsensitive('aria-label', rule['aria-label'])
    );
  }

  // label text — find <label> whose text matches, then get its associated control
  if (rule.label) {
    const target = findByLabel(rule.label);
    if (target) return target;
  }

  return null;
}

function findByLabel(text) {
  const needle = text.toLowerCase().trim();

  for (const label of document.querySelectorAll('label')) {
    const labelText = label.textContent.toLowerCase().trim();

    // Exact match first, then "contains" match
    if (labelText === needle || labelText.includes(needle)) {
      // Explicit for= association
      if (label.htmlFor) {
        const el = document.getElementById(label.htmlFor);
        if (el) return el;
      }

      // Implicit — label wraps the control
      const child = label.querySelector('input, select, textarea');
      if (child) return child;
    }
  }

  // Also check aria-labelledby: find an element whose id is referenced by a field
  for (const el of document.querySelectorAll('input, select, textarea')) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl && labelEl.textContent.toLowerCase().trim().includes(needle)) {
        return el;
      }
    }
  }

  return null;
}

function findByAttrCaseInsensitive(attr, value) {
  const needle = value.toLowerCase().trim();
  for (const el of document.querySelectorAll(`[${attr}]`)) {
    if ((el.getAttribute(attr) || '').toLowerCase().trim() === needle) return el;
  }
  return null;
}

function setFieldValue(el, value) {
  const tag = el.tagName.toLowerCase();

  if (tag === 'select') {
    // Try to match by option text or value
    for (const opt of el.options) {
      if (
        opt.text.toLowerCase() === value.toLowerCase() ||
        opt.value.toLowerCase() === value.toLowerCase()
      ) {
        el.value = opt.value;
        triggerEvents(el);
        return;
      }
    }
    // Fallback: set value directly
    el.value = value;
    triggerEvents(el);
    return;
  }

  if (el.type === 'checkbox' || el.type === 'radio') {
    const truthy = /^(true|yes|1|on|checked)$/i.test(value.trim());
    el.checked = truthy;
    triggerEvents(el);
    return;
  }

  // Textarea / text input — use React-compatible setter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el), 'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }

  triggerEvents(el);
}

function triggerEvents(el) {
  ['input', 'change', 'blur'].forEach(type => {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  });
}

function getSelector(el) {
  if (el.id) return '#' + el.id;
  if (el.name) return `[name="${el.name}"]`;
  return el.tagName.toLowerCase();
}
