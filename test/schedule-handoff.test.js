import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  FILLED_MESSAGE,
  HANDOFF_WAIT_MS,
  MAX_SHEET_NAME,
  MAX_SHEET_ROWS,
  SHEET_HOURS,
  SHEET_READY,
  SHEET_ROWS,
  buildEpicHtml,
  buildEpicText,
  hourText,
  isSheetRowsMessage,
  rowLabel,
  sheetFromRows,
  singleLine
} from "../schedule.js";

const repoPath = path => new URL(`../${path}`, import.meta.url);
const read = path => readFileSync(repoPath(path), "utf8");

const marksAt = (...hours) => Array.from({ length: 24 }, (_, hour) => hours.includes(hour));
const row = (name, hours) => ({ name, hours });

// The SPEC 7.3 names, with the longest (60 characters) last.
const SPEC_ROWS = [
  row("Sinemet IR 25/100 · 1½ tablets", [6, 9, 12, 15, 18]),
  row("Rytary 61.25/245 · 2 capsules", [21]),
  row("Sinemet IR · 150 mg levodopa (at 06:30, 18:30)", [18, 6]),
  row("Inbrija 42 mg · 2 capsules (inhaled) (times not on the hour)", [14])
];

test("handoff constants match SPEC 7", () => {
  assert.equal(SHEET_READY, "pdmeds:sheet-ready");
  assert.equal(SHEET_ROWS, "pdmeds:sheet-rows");
  assert.equal(HANDOFF_WAIT_MS, 5000);
  assert.equal(SHEET_HOURS, 24);
  assert.equal(MAX_SHEET_ROWS, 12);
  assert.equal(MAX_SHEET_NAME, 60);
  assert.equal(FILLED_MESSAGE, "Filled from the Explorer. Nothing is saved; reloading clears it.");
});

test("sheetFromRows turns SPEC 7.3 rows into names and 24-hour marks", () => {
  const sheet = sheetFromRows(SPEC_ROWS);
  assert.deepEqual(sheet.names, SPEC_ROWS.map(({ name }) => name));
  assert.deepEqual(sheet.marks, [
    marksAt(6, 9, 12, 15, 18),
    marksAt(21),
    marksAt(6, 18),
    marksAt(14)
  ]);
  for (const marks of sheet.marks) assert.equal(marks.length, 24);
});

test("sheetFromRows accepts 1 and 12 rows, and the hour edges 0 and 23", () => {
  assert.deepEqual(sheetFromRows([row("A", [0, 23])]), { names: ["A"], marks: [marksAt(0, 23)] });
  const twelve = Array.from({ length: 12 }, (_, i) => row(`Medicine ${i + 1}`, [i]));
  const sheet = sheetFromRows(twelve);
  assert.equal(sheet.names.length, 12);
  assert.deepEqual(sheet.marks[11], marksAt(11));
});

test("sheetFromRows accepts every hour once, and an empty hours list", () => {
  const all = Array.from({ length: 24 }, (_, hour) => 23 - hour);
  assert.deepEqual(sheetFromRows([row("Every hour", all)]).marks[0], Array(24).fill(true));
  assert.deepEqual(sheetFromRows([row("No marks", [])]).marks[0], Array(24).fill(false));
});

test("sheetFromRows keeps names exactly, up to 60 characters", () => {
  const sixty = "x".repeat(60);
  assert.equal(sixty.length, MAX_SHEET_NAME);
  assert.deepEqual(sheetFromRows([row(sixty, [8])]).names, [sixty]);
  assert.deepEqual(sheetFromRows([row(" Padded ", [8])]).names, [" Padded "]);
  assert.deepEqual(sheetFromRows([row("½", [8])]).names, ["½"]);
});

test("sheetFromRows rejects anything that is not an array of 1 to 12 rows", () => {
  for (const rows of [undefined, null, "rows", 3, true, {}, { length: 1, 0: row("A", [1]) }, []]) {
    assert.equal(sheetFromRows(rows), null, JSON.stringify(rows) ?? String(rows));
  }
  const thirteen = Array.from({ length: 13 }, (_, i) => row(`M${i}`, [i]));
  assert.equal(sheetFromRows(thirteen), null);
});

test("sheetFromRows rejects rows that are not plain objects", () => {
  for (const bad of [null, undefined, "Sinemet", 6, ["Sinemet", [6]]]) {
    assert.equal(sheetFromRows([bad]), null, String(bad));
  }
  // A hole in a sparse rows array.
  const sparse = [row("A", [1])];
  sparse[2] = row("B", [2]);
  assert.equal(sheetFromRows(sparse), null);
});

test("sheetFromRows rejects bad names", () => {
  const badNames = [
    undefined, null, 42, ["Sinemet"], { toString: () => "Sinemet" },
    "", "   ", "x".repeat(61), "Sinemet\nIR", "Sinemet\rIR", "Tab\there", "Nul\u0000", "Del\u007f"
  ];
  for (const name of badNames) {
    assert.equal(sheetFromRows([row(name, [6])]), null, JSON.stringify(name) ?? String(name));
  }
  assert.equal(sheetFromRows([{ hours: [6] }]), null, "missing name");
});

test("sheetFromRows rejects bad hours", () => {
  const badHours = [
    undefined, null, "6", 6, { 0: 6, length: 1 },
    [-1], [24], [25], [6.5], ["6"], [null], [NaN], [Infinity], [true], [6, 6], [0, 23, 0],
    Array.from({ length: 25 }, (_, i) => i % 24)
  ];
  for (const hours of badHours) {
    assert.equal(sheetFromRows([row("Sinemet IR", hours)]), null, JSON.stringify(hours) ?? String(hours));
  }
  assert.equal(sheetFromRows([{ name: "Sinemet IR" }]), null, "missing hours");
  const sparse = [6];
  sparse[2] = 9;
  assert.equal(sheetFromRows([row("Sparse", sparse)]), null, "sparse hours");
});

test("sheetFromRows rejects the whole payload when any one row is bad", () => {
  const good = row("Sinemet IR 25/100 · 1 tablet", [6, 9]);
  assert.equal(sheetFromRows([good, row("Rytary", [24])]), null);
  assert.equal(sheetFromRows([good, row("", [21])]), null);
  assert.equal(sheetFromRows([row("Rytary", [21, 21]), good]), null);
  assert.equal(sheetFromRows([good, null]), null);
});

test("sheetFromRows ignores extra fields and does not share arrays with the payload", () => {
  const hours = [6, 9];
  const rows = [{ name: "Sinemet IR", hours, extra: "ignored", type: "x" }];
  const sheet = sheetFromRows(rows);
  assert.deepEqual(sheet, { names: ["Sinemet IR"], marks: [marksAt(6, 9)] });
  hours.push(12);
  rows.push(row("Later", [1]));
  assert.deepEqual(sheet, { names: ["Sinemet IR"], marks: [marksAt(6, 9)] });
});

test("isSheetRowsMessage accepts only a same-origin rows message from the opener", () => {
  const origin = "http://127.0.0.1:4185";
  const opener = { name: "explorer" };
  const other = { name: "other window" };
  const data = { type: SHEET_ROWS, rows: [row("A", [1])] };
  const event = (overrides = {}) => ({ origin, source: opener, data, ...overrides });

  assert.equal(isSheetRowsMessage(event(), origin, opener), true);
  assert.equal(isSheetRowsMessage(event({ origin: "https://evil.example" }), origin, opener), false);
  assert.equal(isSheetRowsMessage(event({ origin: "http://127.0.0.1:4186" }), origin, opener), false);
  assert.equal(isSheetRowsMessage(event({ origin: "null" }), origin, opener), false);
  assert.equal(isSheetRowsMessage(event({ source: other }), origin, opener), false);
  assert.equal(isSheetRowsMessage(event({ source: null }), origin, opener), false);
  assert.equal(isSheetRowsMessage(event({ source: null }), origin, null), false, "no opener");
  assert.equal(isSheetRowsMessage(event(), origin, null), false, "opener already dropped");
  assert.equal(isSheetRowsMessage(event({ data: { type: SHEET_READY } }), origin, opener), false);
  assert.equal(isSheetRowsMessage(event({ data: { type: "pdmeds:other", rows: data.rows } }), origin, opener), false);
  for (const bad of [null, undefined, "pdmeds:sheet-rows", [SHEET_ROWS], 1]) {
    assert.equal(isSheetRowsMessage(event({ data: bad }), origin, opener), false, String(bad));
  }
  assert.equal(isSheetRowsMessage(null, origin, opener), false);
  assert.equal(isSheetRowsMessage(undefined, origin, opener), false);
});

test("an accepted message with a bad payload still leaves the sheet blank", () => {
  // The sheet takes one matching message; an invalid payload is dropped whole.
  const origin = "http://127.0.0.1:4185";
  const opener = {};
  const message = { origin, source: opener, data: { type: SHEET_ROWS, rows: [row("A", [24])] } };
  assert.equal(isSheetRowsMessage(message, origin, opener), true);
  assert.equal(sheetFromRows(message.data.rows), null);
});

test("singleLine turns typed or pasted line breaks into one space", () => {
  assert.equal(singleLine("Sinemet IR\n25/100"), "Sinemet IR 25/100");
  assert.equal(singleLine("a\r\nb\rc\n\n\nd"), "a b c d");
  assert.equal(singleLine("\nlead and trail\n"), " lead and trail ");
  assert.equal(singleLine("Tab\tstays · 1½"), "Tab\tstays · 1½");
  assert.equal(singleLine(""), "");
});

test("hourText and rowLabel", () => {
  assert.equal(hourText(0, false), "00:00");
  assert.equal(hourText(13, false), "13:00");
  assert.equal(hourText(0, true), "12:00 am");
  assert.equal(hourText(11, true), "11:00 am");
  assert.equal(hourText(12, true), "12:00 pm");
  assert.equal(hourText(23, true), "11:00 pm");
  assert.equal(rowLabel(["  Rytary  ", ""], 0), "Rytary");
  assert.equal(rowLabel(["  Rytary  ", ""], 1), "Medicine 2");
  assert.equal(rowLabel(["   "], 0), "Medicine 1");
});

/* ---------- Copy for Epic ---------- */

const specSheet = () => ({ ...sheetFromRows(SPEC_ROWS), rows: [0, 1, 2, 3] });

test("buildEpicText keeps every Explorer name whole, padded not cut (review finding 3)", () => {
  const cols = " | 06:00 | 09:00 | 12:00 | 14:00 | 15:00 | 18:00 | 21:00";
  assert.deepEqual(buildEpicText(specSheet()).split("\n"), [
    "PD Medication Schedule",
    "",
    "Medication".padEnd(60) + cols,
    "-".repeat(60) + "-+------".repeat(7),
    "Sinemet IR 25/100 · 1½ tablets".padEnd(60) + " |   X   |   X   |   X   |       |   X   |   X   |      ",
    "Rytary 61.25/245 · 2 capsules".padEnd(60) + " |       |       |       |       |       |       |   X  ",
    "Sinemet IR · 150 mg levodopa (at 06:30, 18:30)".padEnd(60) + " |   X   |       |       |       |       |   X   |      ",
    "Inbrija 42 mg · 2 capsules (inhaled) (times not on the hour) |       |       |       |   X   |       |       |      ",
    "",
    "X marks a scheduled dose time."
  ]);
});

test("buildEpicText keeps a 60-character name and the grid aligned", () => {
  const sixty = "Sinemet IR · 150 mg levodopa (at 06:30, 09:30, 12:30, 15:30)";
  assert.equal(sixty.length, MAX_SHEET_NAME);
  const sheet = sheetFromRows([row(sixty, [6, 9, 12, 15]), row("Rytary", [21])]);
  const lines = buildEpicText({ ...sheet, rows: [0, 1] }).split("\n");
  const grid = lines.slice(2, 6);
  assert.ok(grid[2].startsWith(`${sixty} | `), grid[2]);
  assert.ok(grid[3].startsWith(`${"Rytary".padEnd(60)} | `), grid[3]);
  assert.equal(new Set(grid.map(line => line.length)).size, 1, "every grid line is the same width");
  for (const line of grid) assert.equal(line.search(/[|+]/), 61, line);
});

test("buildEpicText sizes the name column to the longest name, at least 10", () => {
  const sheet = sheetFromRows([row("IR", [8]), row("CR 50/200", [20])]);
  const lines = buildEpicText({ ...sheet, rows: [0, 1] }).split("\n");
  assert.equal(lines[2], "Medication | 08:00 | 20:00");
  assert.equal(lines[3], "-----------+-------+------");
  assert.equal(lines[4], "IR         |   X   |      ");
  assert.equal(lines[5], "CR 50/200  |       |   X  ");
  const wide = sheetFromRows([row("Sinemet CR 50/200 · 1 tablet", [8])]);
  assert.equal(buildEpicText({ ...wide, rows: [0] }).split("\n")[4], "Sinemet CR 50/200 · 1 tablet |   X  ");
});

test("buildEpicText never cuts a name, even one past the field limit", () => {
  const long = "y".repeat(75);
  const lines = buildEpicText({ names: [long], marks: [marksAt(7)], rows: [0] }).split("\n");
  assert.equal(lines[4], `${long} |   X  `);
});

test("buildEpicText uses only the listed rows, labels blank names, and shows 12-hour times", () => {
  const names = ["Sinemet IR 25/100 · 1 tablet", "", "Skipped"];
  const marks = [marksAt(0, 12), marksAt(21), marksAt(3)];
  const lines = buildEpicText({ names, marks, rows: [0, 1], clock12: true }).split("\n");
  assert.deepEqual(lines.slice(2, 6), [
    "Medication                   | 12:00a | 12:00p | 9:00p",
    "-----------------------------+--------+--------+------",
    "Sinemet IR 25/100 · 1 tablet |   X    |   X    |      ",
    "Medicine 2                   |        |        |   X  "
  ]);
  assert.ok(!lines.join("\n").includes("Skipped"));
});

test("buildEpicText lists full names when no times are marked", () => {
  const name = "Inbrija 42 mg · 2 capsules (inhaled) (times not on the hour)";
  assert.deepEqual(buildEpicText({ names: [name, "  "], marks: [marksAt(), marksAt()], rows: [0, 1] }).split("\n"), [
    "PD Medication Schedule",
    "",
    `${name}: no times marked`,
    "Medicine 2: no times marked"
  ]);
});

test("buildEpicHtml keeps full names, escapes text, and has 24 hour columns", () => {
  const html = buildEpicHtml({ ...specSheet(), patientName: "Pat <O'Neil> & \"Co\"" });
  for (const { name } of SPEC_ROWS) assert.ok(html.includes(`<td align="left">${name}</td>`), name);
  assert.ok(html.startsWith("<p><b>PD Medication Schedule</b> &mdash; Pat &lt;O'Neil&gt; &amp; &quot;Co&quot;</p>"));
  assert.equal((html.match(/<th align="center"/g) ?? []).length, 24);
  assert.ok(html.includes(`<th align="center" bgcolor="#EEEEEE">00</th>`));
  assert.equal((html.match(/<td align="center">X<\/td>/g) ?? []).length, 9);
  assert.ok(html.endsWith("<p>Hours are 24-hour clock (00 = midnight, 12 = noon). X marks a scheduled dose time.</p>"));

  const tricky = buildEpicHtml({ names: ["<img src=x onerror=alert(1)>"], marks: [marksAt(1)], rows: [0], clock12: true });
  assert.ok(tricky.includes("<td align=\"left\">&lt;img src=x onerror=alert(1)&gt;</td>"));
  assert.ok(!tricky.includes("<img"));
  assert.ok(tricky.startsWith("<p><b>PD Medication Schedule</b></p>"), "no dash without a patient name");
  assert.ok(tricky.includes(`<th align="center" bgcolor="#EEEEEE">12:00 am</th>`));
  assert.ok(tricky.endsWith("<p>X marks a scheduled dose time.</p>"));
});

/* ---------- Printed names (review finding 2) ---------- */

test("print shows each whole name as wrapping text, not the form field", () => {
  const css = read("schedule.css");
  const printAt = css.indexOf("@media print");
  const screen = css.slice(0, printAt);
  const print = css.slice(printAt);
  assert.match(screen, /\.med-name-print \{ display: none; \}/);
  assert.match(print, /\.med-cell \.med-name \{ display: none; \}/);
  const printName = print.match(/\.med-name-print \{([^}]*)\}/)?.[1] ?? "";
  assert.match(printName, /display: block;/);
  assert.match(printName, /white-space: normal;/);
  assert.match(printName, /overflow-wrap: anywhere;/);
  assert.doesNotMatch(printName, /overflow: hidden|text-overflow|nowrap/);

  const js = read("schedule.js");
  assert.match(js, /printName\.className = "med-name-print";/);
  assert.match(js, /printName\.textContent = sheet\.names\[row\];/);
  assert.match(js, /if \(printCopy\) printCopy\.textContent = field\.value;/);
  // On screen the name field wraps too, and holds the handoff's longest name.
  assert.match(js, /document\.createElement\("textarea"\);\n\s+field\.className = "med-name";/);
  assert.match(js, /field\.maxLength = MAX_SHEET_NAME;/);
});

/* ---------- Deployment (review finding 1) ---------- */

const MODULE_SPECIFIERS = [
  /\bimport\s+(?:[\w$*{}\s,]+?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:\*|\{[^}]*\})(?:\s+as\s+[\w$]+)?\s+from\s+["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g
];

function moduleSpecifiers(source) {
  return MODULE_SPECIFIERS.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1]));
}

const ASSEMBLE_STEP = "Assemble static site";
const VERSION_STEP = "Stamp deploy date and version every script and stylesheet";

// The commands of one step's "run: |" block in pages.yml.
function stepCommands(name) {
  const lines = read(".github/workflows/pages.yml").split("\n");
  const step = lines.findIndex(line => line.trim() === `- name: ${name}`);
  assert.ok(step >= 0, `pages.yml has a "${name}" step`);
  const run = lines.findIndex((line, index) => index > step && /^\s*run: \|\s*$/.test(line));
  const indent = line => line.match(/^ */)[0].length;
  const commands = [];
  for (let index = run + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "") continue;
    if (indent(lines[index]) <= indent(lines[run])) break;
    commands.push(lines[index].trim());
  }
  return commands;
}

const assembleCommands = () => stepCommands(ASSEMBLE_STEP);

function expandGlob(pattern) {
  if (!pattern.includes("*")) return [pattern];
  const dir = posix.dirname(pattern);
  assert.ok(!dir.includes("*"), `the site check expands * only in file names: ${pattern}`);
  const escaped = posix.basename(pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*");
  const matcher = new RegExp(`^${escaped}$`);
  return readdirSync(repoPath(`${dir}/`)).filter(name => matcher.test(name)).map(name => posix.join(dir, name));
}

function walk(path) {
  if (!statSync(repoPath(path)).isDirectory()) return [path];
  return readdirSync(repoPath(`${path}/`)).flatMap(name => walk(posix.join(path, name)));
}

// Site paths the Pages build copies into _site. Every cp target is a folder
// (the step makes them with mkdir -p first).
function pagesSiteFiles() {
  const files = new Set();
  for (const command of assembleCommands()) {
    const [name, ...args] = command.split(/\s+/);
    if (name === "mkdir") continue;
    assert.equal(name, "cp", `the site check does not understand this Assemble command: ${command}`);
    const recursive = args.some(arg => /^-[a-zA-Z]*[rR]/.test(arg));
    const paths = args.filter(arg => !arg.startsWith("-"));
    const target = paths.pop().replace(/^_site\/?/, "");
    for (const source of paths.flatMap(expandGlob)) {
      for (const file of recursive ? walk(source) : [source]) {
        files.add(posix.join(target, posix.basename(source) + file.slice(source.length)));
      }
    }
  }
  return files;
}

// Files the page loads (scripts, styles, icons) and every module those
// scripts import, plus the pages it links to, as site paths.
function pageNeeds(page) {
  const needed = new Set([page]);
  const queue = [page];
  while (queue.length) {
    const file = queue.shift();
    const source = read(file);
    const refs = file.endsWith(".html")
      ? [...source.matchAll(/\s(?:src|href)="([^"]+)"/g)].map(match => match[1])
      : moduleSpecifiers(source);
    for (const ref of refs) {
      if (/^(?:[a-z][a-z+.-]*:|\/\/|#)/i.test(ref)) continue;
      const path = posix.normalize(posix.join(posix.dirname(file), ref.split(/[?#]/)[0]));
      if (needed.has(path)) continue;
      needed.add(path);
      // Follow scripts; a linked page only has to exist.
      if (path.endsWith(".js") && existsSync(repoPath(path))) queue.push(path);
    }
  }
  return needed;
}

test("schedule.js imports nothing, so the time sheet needs only its one script", () => {
  const js = read("schedule.js");
  assert.deepEqual(moduleSpecifiers(js), []);
  // The specifier scan does find imports.
  assert.deepEqual(moduleSpecifiers('import {\n  a,\n  b\n} from "./src/x.js";\nimport "./y.js";\nexport * from "./z.js";\nimport("./w.js");'),
    ["./src/x.js", "./y.js", "./z.js", "./w.js"]);
  // Importing it here (no document) ran no page code.
  assert.equal(typeof globalThis.document, "undefined");
});

test("every file schedule.html needs is in the site pages.yml assembles", () => {
  const site = pagesSiteFiles();
  assert.ok(site.has("schedule.html") && site.has("schedule.js"), [...site].join(", "));
  const missing = [...pageNeeds("schedule.html")].filter(path => !site.has(path));
  assert.deepEqual(missing, [], `pages.yml does not copy: ${missing.join(", ")}`);
});

test("every file index.html needs is in the site pages.yml assembles", () => {
  const site = pagesSiteFiles();
  const missing = [...pageNeeds("index.html")].filter(path => !site.has(path));
  assert.deepEqual(missing, [], `pages.yml does not copy: ${missing.join(", ")}`);
});

/* ---------- Cache-busting: a deploy never mixes old and new files ---------- */

// GitHub Pages lets browsers keep a file for 10 minutes. With fixed URLs, a
// reload just after a deploy showed the old Explorer, and a new app.js could
// meet an old module it imports. The build therefore moves every script and
// stylesheet into a folder named after the commit.

// Script and stylesheet URLs a built page loads.
function loadedAssets(html) {
  return [...html.matchAll(/\s(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
}

test("the Pages build versions every script and stylesheet the pages load", () => {
  const commands = stepCommands(VERSION_STEP);
  const moved = commands.find(command => command.startsWith("mv "));
  assert.ok(moved, "the step moves the assets into the commit's folder");
  const sources = moved.split(/\s+/).slice(1, -1).map(path => path.replace(/^_site\//, ""));
  assert.equal(moved.split(/\s+/).at(-1), '"_site/${ASSETS}/"');
  assert.match(commands.join("\n"), /ASSETS="assets-\$\{SHORT_SHA\}"/);
  // Everything a page loads as a script or stylesheet is moved, with src/ for the modules.
  for (const page of ["index.html", "schedule.html"]) {
    for (const asset of loadedAssets(read(page))) {
      assert.ok(sources.includes(asset), `${asset} (loaded by ${page}) is moved`);
      const attribute = asset.endsWith(".css") ? "href" : "src";
      assert.ok(commands.some(command => command.startsWith("sed ") && command.includes(`${attribute}=\\"${asset}\\"`) && command.endsWith(`_site/${page}`)),
        `${page}'s ${asset} is rewritten`);
    }
  }
  assert.ok(sources.includes("src"));
  // Every module app.js imports lives under src/ or beside it, so it moves with it.
  const needs = [...pageNeeds("index.html")].filter(path => path.endsWith(".js"));
  for (const path of needs) assert.ok(path === "app.js" || path.startsWith("src/"), path);
  // The pages in the repo keep plain paths: they run as they are from a local
  // server and from the Cloudflare build, which has no build step.
  assert.deepEqual(loadedAssets(read("index.html")), ["styles.css", "app.js"]);
  assert.deepEqual(loadedAssets(read("schedule.html")), ["schedule.css", "schedule.js"]);
});

// The next tests run the build steps for real, in a scratch copy of the
// site's files. The steps use GNU sed (-i with no suffix), as the ubuntu
// runner has, so these tests are skipped on other systems.
const SITE_SOURCES = ["index.html", "styles.css", "app.js", "schedule.html", "schedule.css", "schedule.js", "apple-touch-icon.png", "src"];

function scratchCopy() {
  const root = mkdtempSync(join(tmpdir(), "pdmeds-site-"));
  for (const name of SITE_SOURCES) cpSync(new URL(`../${name}`, import.meta.url), join(root, name), { recursive: true });
  return root;
}

function runStep(root, name, sha = "") {
  execFileSync("bash", ["-e", "-c", stepCommands(name).join("\n")], { cwd: root, env: { ...process.env, GITHUB_SHA: sha }, stdio: "pipe" });
}

function buildSite(sha) {
  const root = scratchCopy();
  runStep(root, ASSEMBLE_STEP);
  runStep(root, VERSION_STEP, sha);
  return root;
}

function siteFiles(root, dir = "") {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => (
    entry.isDirectory() ? siteFiles(root, posix.join(dir, entry.name)) : [posix.join(dir, entry.name)]
  ));
}

test("the built site: pages at the root, every script and stylesheet under the commit's folder", { skip: process.platform !== "linux" }, () => {
  const root = buildSite("0123456789abcdef0123456789abcdef01234567");
  try {
    const site = join(root, "_site");
    const files = siteFiles(site).sort();
    const assets = "assets-01234567";
    const modules = readdirSync(new URL("../src/", import.meta.url)).filter(name => name.endsWith(".js")).map(name => `${assets}/src/${name}`);
    assert.deepEqual(files, [
      "apple-touch-icon.png", "index.html", "schedule.html",
      `${assets}/app.js`, `${assets}/schedule.css`, `${assets}/schedule.js`, `${assets}/styles.css`, ...modules
    ].sort());
    const index = readFileSync(join(site, "index.html"), "utf8");
    const sheet = readFileSync(join(site, "schedule.html"), "utf8");
    assert.deepEqual(loadedAssets(index), [`${assets}/styles.css`, `${assets}/app.js`]);
    assert.deepEqual(loadedAssets(sheet), [`${assets}/schedule.css`, `${assets}/schedule.js`]);
    // The files are the repo's own, unchanged, and every import resolves inside the folder.
    for (const name of ["app.js", "styles.css", "schedule.js", "schedule.css", "src/drugs.js"]) {
      assert.equal(readFileSync(join(site, assets, name), "utf8"), read(name), name);
    }
    for (const file of files.filter(name => name.endsWith(".js"))) {
      for (const specifier of moduleSpecifiers(readFileSync(join(site, file), "utf8"))) {
        const target = posix.normalize(posix.join(posix.dirname(file), specifier));
        assert.ok(target.startsWith(`${assets}/`) && files.includes(target), `${file} imports ${specifier}`);
      }
    }
    // Icons and links between the pages stay at the root, where the pages are.
    for (const html of [index, sheet]) {
      assert.match(html, /<link rel="icon" href="apple-touch-icon\.png">/);
      assert.match(html, /href="index\.html"/);
      assert.match(html, /href="schedule\.html"/);
    }
    // Apart from the asset URLs and the date stamp, the pages are the repo's.
    assert.equal(index.replaceAll(`${assets}/`, ""), read("index.html"));
    assert.match(sheet, /Last updated: <span id="lastUpdated">\d{1,2}\/\d{1,2}\/\d{2}<\/span>/);
    assert.equal(sheet.replaceAll(`${assets}/`, "").replace(/(<span id="lastUpdated">)[^<]*/, "$1"), read("schedule.html").replace(/(<span id="lastUpdated">)[^<]*/, "$1"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the built site: a new commit gives every script and stylesheet a new URL", { skip: process.platform !== "linux" }, () => {
  const roots = ["aaaaaaaa11111111", "bbbbbbbb22222222"].map(buildSite);
  try {
    const [first, second] = roots.map(root => [
      ...loadedAssets(readFileSync(join(root, "_site", "index.html"), "utf8")),
      ...loadedAssets(readFileSync(join(root, "_site", "schedule.html"), "utf8"))
    ]);
    assert.equal(first.length, 4);
    for (const url of first) assert.ok(!second.includes(url), url);
    assert.ok(first.every(url => url.startsWith("assets-aaaaaaaa/")) && second.every(url => url.startsWith("assets-bbbbbbbb/")));
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

test("the build stops if a page loads a script the versioning step does not move", { skip: process.platform !== "linux" }, () => {
  const root = scratchCopy();
  try {
    runStep(root, ASSEMBLE_STEP);
    // A script added to the page later, which the step knows nothing about.
    const page = join(root, "_site", "index.html");
    writeFileSync(page, readFileSync(page, "utf8").replace("</body>", '<script type="module" src="extra.js"></script>\n</body>'));
    cpSync(join(root, "app.js"), join(root, "_site", "extra.js"));
    assert.throws(
      () => runStep(root, VERSION_STEP, "cccccccc33333333"),
      error => /not in assets-cccccccc/.test(String(error.stderr))
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* ---------- Page markup and privacy ---------- */

test("schedule.html has the Pages nav, the status line and the back link", () => {
  const html = read("schedule.html");
  const nav = html.match(/<nav class="page-nav" aria-label="Pages">([\s\S]*?)<\/nav>/)?.[1] ?? "";
  assert.match(nav, /<a href="index.html">Explorer<\/a>/);
  assert.match(nav, /<a href="schedule.html" aria-current="page">Dose time sheet<\/a>/);
  assert.equal((nav.match(/aria-current/g) ?? []).length, 1);
  assert.ok(html.indexOf("<nav") < html.indexOf("<main"), "nav comes before main");
  assert.match(html, /<p class="sheet-status" id="sheetStatus" role="status"><\/p>/);
  assert.match(html, /<a class="back-link" href="index.html">Back to the PD Medication Exposure Explorer<\/a>/);
  assert.match(html, /<input type="text" id="patientName"[^>]*>/);
});

test("schedule.css hides the nav and the status line in print", () => {
  const css = read("schedule.css");
  const print = css.slice(css.indexOf("@media print"));
  const hidden = print.match(/([^{}]*)\{\s*display:\s*none !important;\s*\}/)?.[1] ?? "";
  assert.match(hidden, /\.page-nav/);
  assert.match(hidden, /\.sheet-status/);
});

test("schedule.js stores nothing new and reads nothing from the URL", () => {
  const js = read("schedule.js");
  const writes = js.match(/localStorage\.setItem\(([^,]+),/g) ?? [];
  assert.deepEqual(writes, ["localStorage.setItem(CLOCK_KEY,"]);
  assert.match(js, /localStorage\.removeItem\("pdmeds-time-sheet-v1"\)/);
  assert.doesNotMatch(js, /sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(js, /location\.(search|hash|href)|URLSearchParams/);
  assert.match(js, /window\.opener = null/);
  assert.match(js, /postMessage\(\{ type: SHEET_READY \}, location\.origin\)/);
});
