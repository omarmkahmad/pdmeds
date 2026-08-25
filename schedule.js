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
  control.textContent = label;
  control.setAttribute("aria-pressed", String(sheet.marks[row][hour]));
  control.setAttribute("aria-label", `Medicine ${row + 1} at ${pad(hour)}:00`);
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
    cell.textContent = pad(hour);
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
        grid.append(makeToggle(row, hour, "hour-btn", pad(hour)));
      }
    }
    card.append(grid);
    cardList.append(card);
  }
}

function render() {
  const useCards = phoneQuery.matches && !forceTableLayout;
  cardList.hidden = !useCards;
  tableWrap.hidden = useCards;
  hoursNote.hidden = !useCards;
  if (scrollHint) scrollHint.hidden = useCards;
  if (useCards) renderCards();
  else renderTable();
  updateAddButton();
}

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
  for (let hour = 0; hour < HOURS; hour += 1) header += `<th align="center" bgcolor="#EEEEEE">${pad(hour)}</th>`;
  parts.push(header + "</tr>");
  for (const row of rows) {
    let line = `<tr><td align="left">${escapeHtml(rowLabel(row))}</td>`;
    for (let hour = 0; hour < HOURS; hour += 1) {
      line += `<td align="center">${sheet.marks[row][hour] ? "<b>X</b>" : "&nbsp;"}</td>`;
    }
    parts.push(line + "</tr>");
  }
  parts.push("</table>");
  parts.push(`<p>Hours are 24-hour clock (00 = midnight, 12 = noon). X marks a scheduled dose time.</p>`);
  return parts.join("");
}

function buildEpicText(rows) {
  const lines = ["PD Medication Schedule"];
  for (const row of rows) {
    const times = [];
    for (let hour = 0; hour < HOURS; hour += 1) {
      if (sheet.marks[row][hour]) times.push(`${pad(hour)}:00`);
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
