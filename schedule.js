const ROWS = 8;
const HOURS = 24;
const STORAGE_KEY = "pdmeds-time-sheet-v1";

const hourHeader = document.getElementById("hourHeader");
const sheetBody = document.getElementById("sheetBody");
const saveNote = document.getElementById("saveNote");

function emptySheet() {
  return {
    names: Array.from({ length: ROWS }, () => ""),
    marks: Array.from({ length: ROWS }, () => Array.from({ length: HOURS }, () => false))
  };
}

function loadSheet() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const sheet = emptySheet();
    if (parsed && Array.isArray(parsed.names) && Array.isArray(parsed.marks)) {
      for (let row = 0; row < ROWS; row += 1) {
        if (typeof parsed.names[row] === "string") sheet.names[row] = parsed.names[row].slice(0, 60);
        for (let hour = 0; hour < HOURS; hour += 1) {
          sheet.marks[row][hour] = Boolean(parsed.marks[row]?.[hour]);
        }
      }
    }
    return sheet;
  } catch {
    return emptySheet();
  }
}

const sheet = loadSheet();

function saveSheet() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sheet));
  } catch {
    saveNote.textContent = "Saving is not available on this device; use Print instead.";
  }
}

const pad = value => String(value).padStart(2, "0");

for (let hour = 0; hour < HOURS; hour += 1) {
  const cell = document.createElement("th");
  cell.scope = "col";
  cell.className = "hour-label";
  cell.textContent = pad(hour);
  hourHeader.append(cell);
}

for (let row = 0; row < ROWS; row += 1) {
  const tableRow = document.createElement("tr");

  const nameCell = document.createElement("td");
  nameCell.className = "med-cell";
  const nameInput = document.createElement("input");
  nameInput.className = "med-name";
  nameInput.type = "text";
  nameInput.maxLength = 60;
  nameInput.placeholder = `Medicine ${row + 1}`;
  nameInput.value = sheet.names[row];
  nameInput.setAttribute("aria-label", `Name of medicine ${row + 1}`);
  nameInput.addEventListener("input", () => {
    sheet.names[row] = nameInput.value;
    saveSheet();
  });
  nameCell.append(nameInput);
  tableRow.append(nameCell);

  for (let hour = 0; hour < HOURS; hour += 1) {
    const cell = document.createElement("td");
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "slot";
    slot.textContent = "✕";
    slot.setAttribute("aria-pressed", String(sheet.marks[row][hour]));
    slot.setAttribute("aria-label", `Medicine ${row + 1} at ${pad(hour)}:00`);
    slot.addEventListener("click", () => {
      sheet.marks[row][hour] = !sheet.marks[row][hour];
      slot.setAttribute("aria-pressed", String(sheet.marks[row][hour]));
      saveSheet();
    });
    cell.append(slot);
    tableRow.append(cell);
  }

  sheetBody.append(tableRow);
}

document.getElementById("printSheet").addEventListener("click", () => window.print());

document.getElementById("clearSheet").addEventListener("click", () => {
  if (!window.confirm("Clear every mark and medicine name?")) return;
  const fresh = emptySheet();
  sheet.names = fresh.names;
  sheet.marks = fresh.marks;
  saveSheet();
  sheetBody.querySelectorAll(".med-name").forEach(input => { input.value = ""; });
  sheetBody.querySelectorAll(".slot").forEach(slot => slot.setAttribute("aria-pressed", "false"));
});
