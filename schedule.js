const ROWS = 8;
const HOURS = 24;
const STORAGE_KEY = "pdmeds-time-sheet-v1";
const DAY_PARTS = [
  { name: "Night", start: 0 },
  { name: "Morning", start: 6 },
  { name: "Afternoon", start: 12 },
  { name: "Evening", start: 18 }
];

const hourHeader = document.getElementById("hourHeader");
const sheetBody = document.getElementById("sheetBody");
const saveNote = document.getElementById("saveNote");
const tableWrap = document.getElementById("tableWrap");
const cardList = document.getElementById("cardList");
const scrollHint = document.querySelector(".scroll-hint");

const phoneQuery = window.matchMedia("(max-width: 700px)");
let forceTableLayout = false;

function emptySheet() {
  return {
    names: Array.from({ length: ROWS }, () => ""),
    marks: Array.from({ length: ROWS }, () => Array.from({ length: HOURS }, () => false))
  };
}

function loadSheet() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const loaded = emptySheet();
    if (parsed && Array.isArray(parsed.names) && Array.isArray(parsed.marks)) {
      for (let row = 0; row < ROWS; row += 1) {
        if (typeof parsed.names[row] === "string") loaded.names[row] = parsed.names[row].slice(0, 60);
        for (let hour = 0; hour < HOURS; hour += 1) {
          loaded.marks[row][hour] = Boolean(parsed.marks[row]?.[hour]);
        }
      }
    }
    return loaded;
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
  for (let row = 0; row < ROWS; row += 1) {
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
    sheetBody.append(tableRow);
  }
}

function renderCards() {
  cardList.innerHTML = "";
  for (let row = 0; row < ROWS; row += 1) {
    const card = document.createElement("section");
    card.className = "med-card";
    card.setAttribute("aria-label", `Medicine ${row + 1}`);
    card.append(makeNameInput(row));

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
  if (scrollHint) scrollHint.hidden = useCards;
  if (useCards) renderCards();
  else renderTable();
}

document.getElementById("printSheet").addEventListener("click", () => window.print());

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
