// The dose time sheet. This file imports nothing on purpose: the Pages build
// copies it and cache-busts it (?v=) as one file, so an imported module could
// be missing or out of date next to it. The pure helpers are exported for
// test/schedule-handoff.test.js; the page code below them runs only in a
// browser.

/* ---------- Pure helpers ---------- */

export const SHEET_HOURS = 24;
export const MAX_SHEET_ROWS = 12;
// The medicine name field's maxLength (UTF-16 code units).
export const MAX_SHEET_NAME = 60;
export const SHEET_READY = "pdmeds:sheet-ready";
export const SHEET_ROWS = "pdmeds:sheet-rows";
export const HANDOFF_WAIT_MS = 5000;
export const FILLED_MESSAGE = "Filled from the Explorer. Nothing is saved; reloading clears it.";

// A name is one line, so a sent name with control characters (line breaks
// included) would not show as sent.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validName(name) {
  return typeof name === "string"
    && name.length >= 1
    && name.length <= MAX_SHEET_NAME
    && name.trim() !== ""
    && !CONTROL_CHARS.test(name);
}

function marksFromHours(hours) {
  if (!Array.isArray(hours) || hours.length > SHEET_HOURS) return null;
  const marks = Array.from({ length: SHEET_HOURS }, () => false);
  // Index loop so holes in a sparse array read as undefined and fail.
  for (let i = 0; i < hours.length; i += 1) {
    const hour = hours[i];
    if (!Number.isInteger(hour) || hour < 0 || hour >= SHEET_HOURS) return null;
    if (marks[hour]) return null;
    marks[hour] = true;
  }
  return marks;
}

// rows: [{ name, hours: [int] }] from the Explorer. Returns the sheet's own
// shape { names, marks } (marks[row] is 24 booleans), or null when anything
// in the payload is invalid; a partly valid payload is rejected whole.
export function sheetFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_SHEET_ROWS) return null;
  const names = [];
  const marks = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!isPlainObject(row) || !validName(row.name)) return null;
    const rowMarks = marksFromHours(row.hours);
    if (!rowMarks) return null;
    names.push(row.name);
    marks.push(rowMarks);
  }
  return { names, marks };
}

// The one message the sheet accepts: same origin, sent by the window that
// opened this tab, with the rows type. The payload is checked separately.
export function isSheetRowsMessage(event, origin, opener) {
  return Boolean(event)
    && opener != null
    && event.origin === origin
    && event.source === opener
    && isPlainObject(event.data)
    && event.data.type === SHEET_ROWS;
}

// The name field wraps but holds one line: typed or pasted breaks become a space.
export function singleLine(text) {
  return text.replace(/[\r\n]+/g, " ");
}

const pad = value => String(value).padStart(2, "0");

function hour12Parts(hour) {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return { time: `${twelve}:00`, suffix };
}

// Plain-text form for aria labels, the Epic table, and the text flavor.
export function hourText(hour, clock12) {
  if (!clock12) return `${pad(hour)}:00`;
  const { time, suffix } = hour12Parts(hour);
  return `${time} ${suffix}`;
}

export function rowLabel(names, row) {
  return names[row].trim() || `Medicine ${row + 1}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Epic's rich-text editor keeps only primitive HTML on paste, and this
// page's Content Security Policy makes the browser's clipboard sanitizer
// drop style attributes -- so the table is built from legacy HTML
// attributes only (border/align/bgcolor, <b>), with a plain "X" for marks.
// rows lists the sheet row indexes to include.
export function buildEpicHtml({ names, marks, rows, clock12 = false, patientName = "" }) {
  const parts = [];
  parts.push(`<p><b>PD Medication Schedule</b>${patientName ? ` &mdash; ${escapeHtml(patientName)}` : ""}</p>`);
  parts.push(`<table border="1" cellspacing="0" cellpadding="3">`);
  let header = `<tr><th align="left" bgcolor="#EEEEEE">Medication</th>`;
  for (let hour = 0; hour < SHEET_HOURS; hour += 1) header += `<th align="center" bgcolor="#EEEEEE">${clock12 ? hourText(hour, true) : pad(hour)}</th>`;
  parts.push(header + "</tr>");
  for (const row of rows) {
    let line = `<tr><td align="left">${escapeHtml(rowLabel(names, row))}</td>`;
    for (let hour = 0; hour < SHEET_HOURS; hour += 1) {
      line += `<td align="center">${marks[row][hour] ? "X" : "&nbsp;"}</td>`;
    }
    parts.push(line + "</tr>");
  }
  parts.push("</table>");
  parts.push(clock12
    ? `<p>X marks a scheduled dose time.</p>`
    : `<p>Hours are 24-hour clock (00 = midnight, 12 = noon). X marks a scheduled dose time.</p>`);
  return parts.join("");
}

// Plain-text flavor: a compact aligned grid in the style of Epic's own
// SmartLink tables, using only the hours that have marked doses. This is
// what Epic's classic note editor receives on direct paste (it reads only
// RTF and plain text from the clipboard, and browsers cannot write RTF).
// Names are padded, never cut: an Explorer name can end with its real
// times, such as " (at 06:30, 18:30)".
export function buildEpicText({ names, marks, rows, clock12 = false }) {
  const hoursUsed = [];
  for (let hour = 0; hour < SHEET_HOURS; hour += 1) {
    if (rows.some(row => marks[row][hour])) hoursUsed.push(hour);
  }
  const shortLabel = hour => {
    if (!clock12) return `${pad(hour)}:00`;
    const { time, suffix } = hour12Parts(hour);
    return `${time}${suffix[0]}`;
  };

  const lines = ["PD Medication Schedule", ""];
  if (!hoursUsed.length) {
    for (const row of rows) lines.push(`${rowLabel(names, row)}: no times marked`);
    return lines.join("\n");
  }

  const labels = rows.map(row => rowLabel(names, row));
  const nameWidth = Math.min(MAX_SHEET_NAME, Math.max(10, ...labels.map(label => label.length)));
  const columns = hoursUsed.map(hour => ({ hour, label: shortLabel(hour) }));
  const cell = (content, width) => {
    const left = Math.floor((width - content.length) / 2);
    return " ".repeat(Math.max(0, left)) + content + " ".repeat(Math.max(0, width - content.length - left));
  };

  let header = "Medication".padEnd(nameWidth);
  let rule = "-".repeat(nameWidth);
  for (const column of columns) {
    header += ` | ${column.label}`;
    rule += `-+-${"-".repeat(column.label.length)}`;
  }
  lines.push(header, rule);
  rows.forEach((row, index) => {
    let line = labels[index].padEnd(nameWidth);
    for (const column of columns) {
      line += ` | ${cell(marks[row][column.hour] ? "X" : "", column.label.length)}`;
    }
    lines.push(line);
  });
  lines.push("", "X marks a scheduled dose time.");
  return lines.join("\n");
}

/* ---------- Page ---------- */

const DEFAULT_ROWS = 2;
const MIN_ROWS = 1;
const DAY_PARTS = [
  { name: "Night", start: 0 },
  { name: "Morning", start: 6 },
  { name: "Afternoon", start: 12 },
  { name: "Evening", start: 18 }
];
const CLOCK_KEY = "pdmeds-clock-format";
const CAPTION_24 = "Hours of the day: 00 is midnight/12:00am, 06 is 6:00am, 12 is noon/12:00pm, and 18 is 6:00pm.";
const CAPTION_12 = "Times run from 12:00 am (midnight) through 11:00 pm; 12:00 pm is noon.";

// Page elements, looked up by startSheet() (browser only).
let hourHeader, sheetBody, tableWrap, cardList, hoursNote, scrollHint;
let addMedicineButton, sheetStatus, copyStatus, phoneQuery;

let forceTableLayout = false;
let clock12 = false;
let copyStatusTimer = null;
let fitQueued = false;

function emptyRowMarks() {
  return Array.from({ length: SHEET_HOURS }, () => false);
}

function emptySheet(rows = DEFAULT_ROWS) {
  return {
    names: Array.from({ length: rows }, () => ""),
    marks: Array.from({ length: rows }, () => emptyRowMarks())
  };
}

function rowHasData(loaded, row) {
  return loaded.names[row].trim() !== "" || loaded.marks[row].some(Boolean);
}

const sheet = emptySheet();

function rowCount() {
  return sheet.names.length;
}

// Stacked two-line form so 12-hour labels fit the narrow grid columns.
function hourLabelHtml(hour) {
  if (!clock12) return pad(hour);
  const { time, suffix } = hour12Parts(hour);
  return `${time}<span class="ampm">${suffix}</span>`;
}

function applyClockFormatChrome() {
  document.body.classList.toggle("clock12", clock12);
  const toggle = document.getElementById("clockToggle");
  toggle.setAttribute("aria-checked", String(clock12));
  document.getElementById("clockLabel24").classList.toggle("is-active", !clock12);
  document.getElementById("clockLabel12").classList.toggle("is-active", clock12);
  document.getElementById("hoursCaption").textContent = clock12 ? CAPTION_12 : CAPTION_24;
  hoursNote.textContent = clock12 ? CAPTION_12 : CAPTION_24;
}

// Grows each shown name field to fit its wrapped name (one line when short).
// All heights are read before any is set, to lay out once.
function fitNameFields(fields = document.querySelectorAll(".med-name")) {
  const shown = [...fields].filter(field => field.getClientRects().length > 0);
  for (const field of shown) field.style.height = "auto";
  const heights = shown.map(field => field.scrollHeight + field.offsetHeight - field.clientHeight);
  shown.forEach((field, index) => {
    field.style.height = `${heights[index]}px`;
  });
}

function queueFitNameFields() {
  if (fitQueued) return;
  fitQueued = true;
  window.requestAnimationFrame(() => {
    fitQueued = false;
    fitNameFields();
  });
}

// A wrapping textarea, not a one-line input, so a long name (the Explorer
// sends up to 60 characters) stays readable in the narrow name column.
// printCopy is the table's print-only text, kept in step with the field.
function makeNameInput(row, printCopy = null) {
  const field = document.createElement("textarea");
  field.className = "med-name";
  field.rows = 1;
  field.maxLength = MAX_SHEET_NAME;
  field.placeholder = `Medicine ${row + 1}`;
  field.value = sheet.names[row];
  field.setAttribute("aria-label", `Name of medicine ${row + 1}`);
  field.addEventListener("beforeinput", event => {
    if (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph") event.preventDefault();
  });
  field.addEventListener("input", () => {
    const flat = singleLine(field.value);
    if (flat !== field.value) {
      const caret = singleLine(field.value.slice(0, field.selectionStart)).length;
      field.value = flat;
      field.setSelectionRange(caret, caret);
    }
    sheet.names[row] = field.value;
    if (printCopy) printCopy.textContent = field.value;
    fitNameFields([field]);
  });
  return field;
}

function makeToggle(row, hour, className, label) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  if (className === "hour-btn") control.innerHTML = hourLabelHtml(hour);
  else control.textContent = label;
  control.setAttribute("aria-pressed", String(sheet.marks[row][hour]));
  control.setAttribute("aria-label", `Medicine ${row + 1} at ${hourText(hour, clock12)}`);
  control.addEventListener("click", () => {
    sheet.marks[row][hour] = !sheet.marks[row][hour];
    control.setAttribute("aria-pressed", String(sheet.marks[row][hour]));
  });
  return control;
}

function removeRow(row) {
  if (rowCount() <= MIN_ROWS) return;
  if (rowHasData(sheet, row) && !window.confirm(`Remove ${rowLabel(sheet.names, row)} and its marked times?`)) return;
  sheet.names.splice(row, 1);
  sheet.marks.splice(row, 1);
  render();
}

function makeRemoveButton(row, className) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  control.textContent = className === "remove-med" ? "✕" : "Remove";
  control.setAttribute("aria-label", `Remove ${rowLabel(sheet.names, row)}`);
  control.disabled = rowCount() <= MIN_ROWS;
  control.addEventListener("click", () => removeRow(row));
  return control;
}

function updateAddButton() {
  addMedicineButton.disabled = rowCount() >= MAX_SHEET_ROWS;
  addMedicineButton.textContent = rowCount() >= MAX_SHEET_ROWS
    ? `Limit of ${MAX_SHEET_ROWS} medicines reached`
    : "＋ Add another medicine";
}

function renderTable() {
  hourHeader.innerHTML = `<th scope="col" class="med-col"><span class="sr-only">Medicine name</span></th>`;
  for (let hour = 0; hour < SHEET_HOURS; hour += 1) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.className = "hour-label";
    cell.innerHTML = hourLabelHtml(hour);
    hourHeader.append(cell);
  }

  sheetBody.innerHTML = "";
  for (let row = 0; row < rowCount(); row += 1) {
    const tableRow = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.className = "med-cell";
    // Print shows this wrapping text instead of the field, which would cut
    // the name off at the field's height.
    const printName = document.createElement("span");
    printName.className = "med-name-print";
    printName.setAttribute("aria-hidden", "true");
    printName.textContent = sheet.names[row];
    nameCell.append(makeNameInput(row, printName), printName);
    tableRow.append(nameCell);
    for (let hour = 0; hour < SHEET_HOURS; hour += 1) {
      const cell = document.createElement("td");
      cell.append(makeToggle(row, hour, "slot", "✕"));
      tableRow.append(cell);
    }
    const removeCell = document.createElement("td");
    removeCell.className = "remove-cell";
    removeCell.append(makeRemoveButton(row, "remove-med"));
    tableRow.append(removeCell);
    sheetBody.append(tableRow);
  }
}

function renderCards() {
  cardList.innerHTML = "";
  for (let row = 0; row < rowCount(); row += 1) {
    const card = document.createElement("section");
    card.className = "med-card";
    card.setAttribute("aria-label", `Medicine ${row + 1}`);

    const head = document.createElement("div");
    head.className = "card-head";
    head.append(makeNameInput(row));
    head.append(makeRemoveButton(row, "remove-card"));
    card.append(head);

    const grid = document.createElement("div");
    grid.className = "hour-grid";
    for (const part of DAY_PARTS) {
      const label = document.createElement("span");
      label.className = "part-label";
      label.textContent = part.name;
      grid.append(label);
      for (let offset = 0; offset < 6; offset += 1) {
        const hour = part.start + offset;
        grid.append(makeToggle(row, hour, "hour-btn", ""));
      }
    }
    card.append(grid);
    cardList.append(card);
  }
}

function render() {
  applyClockFormatChrome();
  const useCards = phoneQuery.matches && !forceTableLayout;
  cardList.hidden = !useCards;
  tableWrap.hidden = useCards;
  hoursNote.hidden = !useCards;
  if (scrollHint) scrollHint.hidden = useCards;
  if (useCards) renderCards();
  else renderTable();
  updateAddButton();
  fitNameFields();
}

/* ---------- Copy for Epic (rich-text clipboard) ---------- */

function setCopyStatus(message) {
  copyStatus.textContent = message;
  if (copyStatusTimer) window.clearTimeout(copyStatusTimer);
  if (message) copyStatusTimer = window.setTimeout(() => { copyStatus.textContent = ""; }, 6000);
}

function rowsWithData() {
  return sheet.names.map((_, row) => row).filter(row => rowHasData(sheet, row));
}

function copyViaSelection(html) {
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.style.position = "fixed";
  holder.style.left = "-9999px";
  holder.innerHTML = html;
  document.body.append(holder);
  const range = document.createRange();
  range.selectNodeContents(holder);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const copied = document.execCommand("copy");
  selection.removeAllRanges();
  holder.remove();
  return copied;
}

async function copyForEpic() {
  const rows = rowsWithData();
  if (!rows.length) {
    setCopyStatus("Nothing to copy yet — name a medicine or mark a time first.");
    return;
  }
  const content = { names: sheet.names, marks: sheet.marks, rows, clock12 };
  const html = buildEpicHtml({ ...content, patientName: document.getElementById("patientName").value.trim() });
  const text = buildEpicText(content);
  let copied = false;
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })]);
      copied = true;
    } catch {
      copied = false;
    }
  }
  if (!copied) copied = copyViaSelection(html);
  setCopyStatus(copied
    ? "Copied. Paste into the Epic note with Ctrl+V (Cmd+V on Mac)."
    : "Copy was blocked by the browser — select the table and copy manually.");
}

/* ---------- Handoff from the Explorer ("Make a dose time sheet") ---------- */

// Only a tab the Explorer opened has an opener. It says it is ready, takes
// one reply for a few seconds, then drops the opener, so a plain load, a
// bookmark or a reload always starts blank.
function receiveExplorerRows() {
  const opener = window.opener;
  if (!opener) return;
  let timer = null;

  function finish() {
    window.removeEventListener("message", onMessage);
    window.clearTimeout(timer);
    window.opener = null;
  }

  function onMessage(event) {
    if (!isSheetRowsMessage(event, location.origin, opener)) return;
    finish();
    const filled = sheetFromRows(event.data.rows);
    if (!filled) return;
    sheet.names = filled.names;
    sheet.marks = filled.marks;
    render();
    sheetStatus.textContent = FILLED_MESSAGE;
  }

  window.addEventListener("message", onMessage);
  timer = window.setTimeout(finish, HANDOFF_WAIT_MS);
  try {
    opener.postMessage({ type: SHEET_READY }, location.origin);
  } catch {
    finish();
  }
}

function startSheet() {
  hourHeader = document.getElementById("hourHeader");
  sheetBody = document.getElementById("sheetBody");
  tableWrap = document.getElementById("tableWrap");
  cardList = document.getElementById("cardList");
  hoursNote = document.getElementById("hoursNote");
  scrollHint = document.querySelector(".scroll-hint");
  addMedicineButton = document.getElementById("addMedicine");
  sheetStatus = document.getElementById("sheetStatus");
  copyStatus = document.getElementById("copyStatus");
  phoneQuery = window.matchMedia("(max-width: 700px)");

  // The sheet lives in memory only: every page load starts a fresh, blank
  // session, so no previous patient's schedule lingers on shared
  // workstations. Older versions stored the sheet in localStorage; clear
  // any such leftover data.
  try {
    window.localStorage.removeItem("pdmeds-time-sheet-v1");
  } catch {
    // Storage unavailable; nothing to clean.
  }
  try {
    clock12 = window.localStorage.getItem(CLOCK_KEY) === "12";
  } catch {
    clock12 = false;
  }

  document.getElementById("clockToggle").addEventListener("click", () => {
    clock12 = !clock12;
    try {
      window.localStorage.setItem(CLOCK_KEY, clock12 ? "12" : "24");
    } catch {
      // Preference simply will not persist.
    }
    render();
  });

  addMedicineButton.addEventListener("click", () => {
    if (rowCount() >= MAX_SHEET_ROWS) return;
    sheet.names.push("");
    sheet.marks.push(emptyRowMarks());
    render();
    const inputs = document.querySelectorAll(phoneQuery.matches ? ".med-card .med-name" : ".med-cell .med-name");
    inputs[inputs.length - 1]?.focus();
  });

  document.getElementById("printSheet").addEventListener("click", () => window.print());
  document.getElementById("copyEpic").addEventListener("click", copyForEpic);

  document.getElementById("clearSheet").addEventListener("click", () => {
    if (!window.confirm("Clear every mark and medicine name?")) return;
    const fresh = emptySheet();
    sheet.names = fresh.names;
    sheet.marks = fresh.marks;
    sheetStatus.textContent = "";
    render();
  });

  phoneQuery.addEventListener("change", render);
  // The name column's width follows the window, and so do the wrapped names.
  window.addEventListener("resize", queueFitNameFields);

  // Phones print the full table layout, not the tap cards.
  window.addEventListener("beforeprint", () => {
    if (!phoneQuery.matches) return;
    forceTableLayout = true;
    render();
  });
  // afterprint can fire while print styles still hide the fields, so they
  // are fitted again once the screen layout is back.
  window.addEventListener("afterprint", () => {
    if (forceTableLayout) {
      forceTableLayout = false;
      render();
    }
    queueFitNameFields();
  });
  window.matchMedia("print").addEventListener("change", queueFitNameFields);

  render();
  receiveExplorerRows();
}

if (typeof document !== "undefined") startSheet();
