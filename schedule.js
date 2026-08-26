const HOURS = 24;
const DEFAULT_ROWS = 2;
const MIN_ROWS = 1;
const MAX_ROWS = 12;
const STORAGE_KEY = "pdmeds-time-sheet-v1";
const DAY_PARTS = [
  { name: "Night", start: 0 },
  { name: "Morning", start: 6 },
  { name: "Afternoon", start: 12 },
  { name: "Evening", start: 18 }
];

const hourHeader = document.getElementById("hourHeader");
const sheetBody = document.getElementById("sheetBody");
const tableWrap = document.getElementById("tableWrap");
const cardList = document.getElementById("cardList");
const hoursNote = document.getElementById("hoursNote");
const scrollHint = document.querySelector(".scroll-hint");
const addMedicineButton = document.getElementById("addMedicine");

const phoneQuery = window.matchMedia("(max-width: 700px)");
let forceTableLayout = false;

function emptyRowMarks() {
  return Array.from({ length: HOURS }, () => false);
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

function loadSheet() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    if (!parsed || !Array.isArray(parsed.names) || !Array.isArray(parsed.marks)) return emptySheet();
    const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, parsed.names.length));
    const loaded = emptySheet(rows);
    for (let row = 0; row < rows; row += 1) {
      if (typeof parsed.names[row] === "string") loaded.names[row] = parsed.names[row].slice(0, 60);
      for (let hour = 0; hour < HOURS; hour += 1) {
        loaded.marks[row][hour] = Boolean(parsed.marks[row]?.[hour]);
      }
    }
    // Drop empty trailing rows left over from older fixed-size sheets.
    while (loaded.names.length > DEFAULT_ROWS && !rowHasData(loaded, loaded.names.length - 1)) {
      loaded.names.pop();
      loaded.marks.pop();
    }
    return loaded;
  } catch {
    return emptySheet();
  }
}

const sheet = loadSheet();

function rowCount() {
  return sheet.names.length;
}

function saveSheet() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet));
  } catch {
    // Storage unavailable (private browsing, quota): the sheet still works
    // for the current visit and for printing.
  }
}

const pad = value => String(value).padStart(2, "0");

/* ---------- Clock format (24-hour vs 12-hour am/pm) ---------- */

const CLOCK_KEY = "pdmeds-clock-format";
let clock12 = false;
try {
  clock12 = window.localStorage.getItem(CLOCK_KEY) === "12";
} catch {
  clock12 = false;
}

function hour12Parts(hour) {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return { time: `${twelve}:00`, suffix };
}

// Plain-text form for aria labels, the Epic table, and the text flavor.
function hourText(hour) {
  if (!clock12) return `${pad(hour)}:00`;
  const { time, suffix } = hour12Parts(hour);
  return `${time} ${suffix}`;
}

// Stacked two-line form so 12-hour labels fit the narrow grid columns.
function hourLabelHtml(hour) {
  if (!clock12) return pad(hour);
  const { time, suffix } = hour12Parts(hour);
  return `${time}<span class="ampm">${suffix}</span>`;
}

const CAPTION_24 = "Hours of the day: 00 is midnight/12:00am, 06 is 6:00am, 12 is noon/12:00pm, and 18 is 6:00pm.";
const CAPTION_12 = "Times run from 12:00 am (midnight) through 11:00 pm; 12:00 pm is noon.";

function applyClockFormatChrome() {
  document.body.classList.toggle("clock12", clock12);
  const toggle = document.getElementById("clockToggle");
  toggle.setAttribute("aria-checked", String(clock12));
  document.getElementById("clockLabel24").classList.toggle("is-active", !clock12);
  document.getElementById("clockLabel12").classList.toggle("is-active", clock12);
  document.getElementById("hoursCaption").textContent = clock12 ? CAPTION_12 : CAPTION_24;
  hoursNote.textContent = clock12 ? CAPTION_12 : CAPTION_24;
}

function rowLabel(row) {
  return sheet.names[row].trim() || `Medicine ${row + 1}`;
}

function makeNameInput(row) {
  const input = document.createElement("input");
  input.className = "med-name";
  input.type = "text";
  input.maxLength = 60;
  input.placeholder = `Medicine ${row + 1}`;
  input.value = sheet.names[row];
  input.setAttribute("aria-label", `Name of medicine ${row + 1}`);
  input.addEventListener("input", () => {
    sheet.names[row] = input.value;
    saveSheet();
  });
  return input;
}

function makeToggle(row, hour, className, label) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  if (className === "hour-btn") control.innerHTML = hourLabelHtml(hour);
  else control.textContent = label;
  control.setAttribute("aria-pressed", String(sheet.marks[row][hour]));
  control.setAttribute("aria-label", `Medicine ${row + 1} at ${hourText(hour)}`);
  control.addEventListener("click", () => {
    sheet.marks[row][hour] = !sheet.marks[row][hour];
    control.setAttribute("aria-pressed", String(sheet.marks[row][hour]));
    saveSheet();
  });
  return control;
}

function removeRow(row) {
  if (rowCount() <= MIN_ROWS) return;
  if (rowHasData(sheet, row) && !window.confirm(`Remove ${rowLabel(row)} and its marked times?`)) return;
  sheet.names.splice(row, 1);
  sheet.marks.splice(row, 1);
  saveSheet();
  render();
}

function makeRemoveButton(row, className) {
  const control = document.createElement("button");
  control.type = "button";
  control.className = className;
  control.textContent = className === "remove-med" ? "✕" : "Remove";
  control.setAttribute("aria-label", `Remove ${rowLabel(row)}`);
  control.disabled = rowCount() <= MIN_ROWS;
  control.addEventListener("click", () => removeRow(row));
  return control;
}

function updateAddButton() {
  addMedicineButton.disabled = rowCount() >= MAX_ROWS;
  addMedicineButton.textContent = rowCount() >= MAX_ROWS
    ? `Limit of ${MAX_ROWS} medicines reached`
    : "＋ Add another medicine";
}

function renderTable() {
  hourHeader.innerHTML = `<th scope="col" class="med-col"><span class="sr-only">Medicine name</span></th>`;
  for (let hour = 0; hour < HOURS; hour += 1) {
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
    nameCell.append(makeNameInput(row));
    tableRow.append(nameCell);
    for (let hour = 0; hour < HOURS; hour += 1) {
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
  if (rowCount() >= MAX_ROWS) return;
  sheet.names.push("");
  sheet.marks.push(emptyRowMarks());
  saveSheet();
  render();
  const inputs = document.querySelectorAll(phoneQuery.matches ? ".med-card .med-name" : ".med-cell .med-name");
  inputs[inputs.length - 1]?.focus();
});

document.getElementById("printSheet").addEventListener("click", () => window.print());

/* ---------- Copy for Epic (rich-text clipboard) ---------- */

const copyStatus = document.getElementById("copyStatus");
let copyStatusTimer = null;

function setCopyStatus(message) {
  copyStatus.textContent = message;
  if (copyStatusTimer) window.clearTimeout(copyStatusTimer);
  if (message) copyStatusTimer = window.setTimeout(() => { copyStatus.textContent = ""; }, 6000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function rowsWithData() {
  return sheet.names.map((_, row) => row).filter(row => rowHasData(sheet, row));
}

// Epic's rich-text editor keeps only primitive HTML on paste, and this
// page's Content Security Policy makes the browser's clipboard sanitizer
// drop style attributes -- so the table is built from legacy HTML
// attributes only (border/align/bgcolor, <b>), with a plain "X" for marks.
function buildEpicHtml(rows) {
  const parts = [];
  const patientName = document.getElementById("patientName").value.trim();
  parts.push(`<p><b>PD Medication Schedule</b>${patientName ? ` &mdash; ${escapeHtml(patientName)}` : ""}</p>`);
  parts.push(`<table border="1" cellspacing="0" cellpadding="3">`);
  let header = `<tr><th align="left" bgcolor="#EEEEEE">Medication</th>`;
  for (let hour = 0; hour < HOURS; hour += 1) header += `<th align="center" bgcolor="#EEEEEE">${clock12 ? hourText(hour) : pad(hour)}</th>`;
  parts.push(header + "</tr>");
  for (const row of rows) {
    let line = `<tr><td align="left">${escapeHtml(rowLabel(row))}</td>`;
    for (let hour = 0; hour < HOURS; hour += 1) {
      line += `<td align="center">${sheet.marks[row][hour] ? "X" : "&nbsp;"}</td>`;
    }
    parts.push(line + "</tr>");
  }
  parts.push("</table>");
  parts.push(clock12
    ? `<p>X marks a scheduled dose time.</p>`
    : `<p>Hours are 24-hour clock (00 = midnight, 12 = noon). X marks a scheduled dose time.</p>`);
  return parts.join("");
}

function buildEpicText(rows) {
  const lines = ["PD Medication Schedule"];
  for (const row of rows) {
    const times = [];
    for (let hour = 0; hour < HOURS; hour += 1) {
      if (sheet.marks[row][hour]) times.push(hourText(hour));
    }
    lines.push(`${rowLabel(row)}: ${times.length ? times.join(", ") : "no times marked"}`);
  }
  return lines.join("\n");
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

/* ---------- Download for Word (RTF bridge for Epic's classic editor) ----------
   Epic's classic note editor pastes RTF, not HTML, and browsers cannot write
   RTF to the clipboard. Word can: this button downloads the schedule as a
   real RTF table so the user can open it in Word, copy, and paste into Epic. */

function escapeRtf(value) {
  let out = "";
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    if (ch === "\\" || ch === "{" || ch === "}") out += "\\" + ch;
    else if (code < 128) out += ch;
    else out += `\\u${code > 32767 ? code - 65536 : code}?`;
  }
  return out;
}

function buildRtf(rows) {
  const MED_WIDTH = 2000;   // twips; landscape letter leaves ~14400 usable
  const HOUR_WIDTH = 510;
  const borders = "\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10";
  const rowDefinition = shaded => {
    let definition = "\\trowd\\trgaph40" + (shaded ? "\\trhdr" : "");
    let edge = MED_WIDTH;
    definition += borders + (shaded ? "\\clcbpat2" : "") + `\\cellx${edge}`;
    for (let hour = 0; hour < HOURS; hour += 1) {
      edge += HOUR_WIDTH;
      definition += borders + (shaded ? "\\clcbpat2" : "") + `\\cellx${edge}`;
    }
    return definition;
  };

  const parts = [];
  parts.push("{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fswiss Arial;}}{\\colortbl;\\red0\\green0\\blue0;\\red238\\green238\\blue238;}");
  parts.push("\\paperw15840\\paperh12240\\landscape\\margl720\\margr720\\margt720\\margb720\\f0\\fs18");
  const patientName = document.getElementById("patientName").value.trim();
  parts.push(`{\\b\\fs24 PD Medication Schedule}${patientName ? ` \\endash  ${escapeRtf(patientName)}` : ""}\\par\\par`);
  parts.push(rowDefinition(true));
  parts.push("\\pard\\intbl\\ql{\\b\\fs16 Medication}\\cell");
  for (let hour = 0; hour < HOURS; hour += 1) {
    parts.push(`\\pard\\intbl\\qc{\\b\\fs14 ${clock12 ? hourText(hour) : pad(hour)}}\\cell`);
  }
  parts.push("\\row");
  for (const row of rows) {
    parts.push(rowDefinition(false));
    parts.push(`\\pard\\intbl\\ql{\\fs16 ${escapeRtf(rowLabel(row))}}\\cell`);
    for (let hour = 0; hour < HOURS; hour += 1) {
      parts.push(`\\pard\\intbl\\qc{\\b\\fs16 ${sheet.marks[row][hour] ? "X" : ""}}\\cell`);
    }
    parts.push("\\row");
  }
  parts.push("\\pard\\par ");
  parts.push(clock12
    ? "X marks a scheduled dose time."
    : "Hours are 24-hour clock (00 = midnight, 12 = noon). X marks a scheduled dose time.");
  parts.push("\\par}");
  return parts.join("\n");
}

document.getElementById("downloadWord").addEventListener("click", () => {
  const rows = rowsWithData();
  if (!rows.length) {
    setCopyStatus("Nothing to download yet — name a medicine or mark a time first.");
    return;
  }
  const blob = new Blob([buildRtf(rows)], { type: "application/rtf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "PD-Medication-Schedule.rtf";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setCopyStatus("Word file downloaded. Open it, press Ctrl+A then Ctrl+C, and paste into Epic.");
});

document.getElementById("copyEpic").addEventListener("click", async () => {
  const rows = rowsWithData();
  if (!rows.length) {
    setCopyStatus("Nothing to copy yet — name a medicine or mark a time first.");
    return;
  }
  const html = buildEpicHtml(rows);
  const text = buildEpicText(rows);
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
});

document.getElementById("clearSheet").addEventListener("click", () => {
  if (!window.confirm("Clear every mark and medicine name?")) return;
  const fresh = emptySheet();
  sheet.names = fresh.names;
  sheet.marks = fresh.marks;
  saveSheet();
  render();
});

phoneQuery.addEventListener("change", render);

// Phones print the full table layout, not the tap cards.
window.addEventListener("beforeprint", () => {
  if (!phoneQuery.matches) return;
  forceTableLayout = true;
  render();
});
window.addEventListener("afterprint", () => {
  if (!forceTableLayout) return;
  forceTableLayout = false;
  render();
});

render();
