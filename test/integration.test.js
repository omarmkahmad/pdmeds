// Cross-module checks: the modules import each other cleanly, and the real
// analyzeDay() result drives the chart scene, the readout, the file round
// trip and the time sheet handoff together. Unit tests for each module live
// in their own files; this one only tests the seams between them.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { DRUG_BY_ID } from "../src/drugs.js";
import { calculateLedSummary, exportRegimen, validateRegimenPayload } from "../src/model.js";
import { dailyTotals, doseMg, medicineChange, nextDoseDefaults } from "../src/amounts.js";
import {
  analyzeDay,
  buildSheetRows,
  chartDesc,
  compareModel,
  pinSnapshot,
  readoutText,
  sliderValueText
} from "../src/answers.js";
import { buildChartScene, cursorPoint } from "../src/chart.js";
import { sheetFromRows } from "../schedule.js";

const repoPath = path => new URL(`../${path}`, import.meta.url);
const read = path => readFileSync(repoPath(path), "utf8");

const ir = (id, time) => ({ id, time, drug: "sinemet", strength: "25/100", count: 1.5, dose: 150 });
// SPEC test regimen, entered out of order so sorting is exercised.
const TEST_REGIMEN = [
  { id: "d6", time: "21:00", drug: "rytary", strength: "61.25/245", count: 2, dose: 490 },
  ir("d1", "06:00"), ir("d2", "09:00"), ir("d3", "12:00"), ir("d4", "15:00"), ir("d5", "18:00")
];

function walk(tree, visit) {
  visit(tree);
  for (const child of tree.children) walk(child, visit);
}

function byClass(tree, name) {
  const found = [];
  walk(tree, item => {
    if (String(item.attrs.class ?? "").split(" ").includes(name)) found.push(item);
  });
  return found;
}

/* ---------- Import graph ---------- */

const MODULES = ["app.js", "schedule.js", ...readdirSync(repoPath("src")).filter(name => name.endsWith(".js")).map(name => `src/${name}`)];

function importsOf(file) {
  const source = read(file);
  return [...source.matchAll(/^import\s+(?:\{([^}]*)\}\s+from\s+)?"(\.[^"]+)";$/gm)].map(match => ({
    names: (match[1] ?? "").split(",").map(part => part.trim().split(/\s+as\s+/)[0]).filter(Boolean),
    file: normalize(join(dirname(file), match[2]))
  }));
}

test("the page modules import each other with no cycles", () => {
  const graph = new Map(MODULES.map(file => [file, importsOf(file).map(entry => entry.file)]));
  const state = new Map();
  const cycles = [];
  const visit = (file, stack) => {
    if (state.get(file) === "open") {
      cycles.push([...stack.slice(stack.indexOf(file)), file].join(" -> "));
      return;
    }
    if (state.get(file) === "done") return;
    state.set(file, "open");
    for (const next of graph.get(file) ?? []) visit(next, [...stack, file]);
    state.set(file, "done");
  };
  for (const file of graph.keys()) visit(file, []);
  assert.deepEqual(cycles, []);
  // amounts.js sits below model.js (API.md): it must never import it back.
  assert.ok(!graph.get("src/amounts.js").includes("src/model.js"));
});

test("every named import exists in the module it comes from", async () => {
  const missing = [];
  for (const file of MODULES) {
    for (const entry of importsOf(file)) {
      const target = await import(repoPath(entry.file));
      for (const name of entry.names) if (!(name in target)) missing.push(`${file}: ${name} from ${entry.file}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("pure modules never touch the DOM (API.md global rules)", () => {
  for (const file of ["src/time.js", "src/amounts.js", "src/answers.js", "src/model.js", "src/drugs.js", "src/copy.js"]) {
    const code = read(file).replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /\b(document|window|localStorage|sessionStorage)\b/, file);
  }
});

/* ---------- answers.js -> chart.js ---------- */

test("the chart scene follows the real analysis of the test regimen", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  for (const width of [356, 794]) {
    const { root, info } = buildChartScene(analysis, { cursorMinute: analysis.stats.lowestBefore.minute }, width);
    // Curves and triangles line up with analysis.doses (sorted), coloured by preparation.
    const curves = byClass(root, "chart-dose");
    assert.deepEqual(curves.map(curve => curve.attrs["data-dose-id"]), ["d1", "d2", "d3", "d4", "d5", "d6"]);
    for (const curve of curves) assert.equal(curve.attrs.stroke, DRUG_BY_ID[curve.attrs["data-drug"]].style.color);
    assert.equal(byClass(root, "chart-dose-mark").length, 6);
    // Numbered markers match the "Level before each dose" rows.
    assert.deepEqual(info.markers.map(marker => marker.number), analysis.before.map(row => String(row.number)));
    assert.deepEqual(info.markers.map(marker => marker.minute), analysis.before.map(row => row.minute));
    assert.equal(info.markers.length, 6);
    // Reference line always; no shading, target, high or pinned line without lines or a pin.
    assert.equal(byClass(root, "chart-ref").length, 1);
    assert.ok(info.scale.ticks.includes(100));
    for (const name of ["chart-shade-below", "chart-shade-above", "chart-target", "chart-high", "chart-pinned"]) {
      assert.equal(byClass(root, name).length, 0, name);
    }
    // The cursor dot sits on the total at the starting minute (09:00).
    const point = cursorPoint(info, analysis.stats.lowestBefore.minute);
    const dot = byClass(root, "chart-cursor-dot")[0];
    assert.equal(dot.attrs.cx, point.x);
    assert.equal(dot.attrs.cy, point.y);
  }
});

test("the cursor starts at the lowest before a dose and the readout names last night's Rytary", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const minute = analysis.stats.lowestBefore.minute;
  assert.equal(minute, 9 * 60);
  const readout = readoutText(analysis, minute);
  assert.match(readout, /^09:00 · level \d+ · mostly the 06:00 Sinemet IR \(\d+\) and last night's 21:00 Rytary \(\d+\)$/);
  assert.match(sliderValueText(analysis, minute), /^09:00, level \d+$/);
  // The readout level is the value the chart draws at that minute.
  const level = Number(readout.match(/level (\d+)/)[1]);
  assert.equal(level, Math.round(analysis.computed.total[minute]));
});

test("a dose with no amount is left off the chart without shifting the other curves", () => {
  const doses = [...TEST_REGIMEN, { id: "m1", time: "10:00", drug: "sinemetcr", strength: null, count: null, dose: null }];
  const analysis = analyzeDay(doses);
  assert.equal(analysis.doses.length, 6);
  assert.equal(analysis.computed.series.length, 6);
  const { root } = buildChartScene(analysis, {}, 794);
  const ids = byClass(root, "chart-dose").map(curve => curve.attrs["data-dose-id"]);
  assert.ok(!ids.includes("m1"));
  assert.equal(byClass(root, "chart-dose-mark").length, 6);
  assert.deepEqual(analysis.totals, { mg: 1240, led: 995 });
});

test("lines from the analysis draw shading, lines and margin labels", () => {
  const analysis = analyzeDay(TEST_REGIMEN, { target: 100, high: 180 });
  const { root, info } = buildChartScene(analysis, {}, 794);
  assert.equal(byClass(root, "chart-target").length, 1);
  assert.equal(byClass(root, "chart-high").length, 1);
  assert.equal(byClass(root, "chart-shade-below").length, 1);
  assert.equal(byClass(root, "chart-shade-above").length, 1);
  assert.deepEqual(info.labels.map(label => label.text).sort(), ["100 ref.", "High 180", "Target 100"]);
  assert.match(sliderValueText(analysis, 9 * 60), /, below target line$/);
});

test("a pinned snapshot feeds the chart's ghost line and the compare model", () => {
  const pinned = pinSnapshot(analyzeDay(TEST_REGIMEN));
  const moved = TEST_REGIMEN.map(dose => (dose.id === "d5" ? { ...dose, time: "17:00" } : dose));
  const analysis = analyzeDay(moved);
  const { root, info } = buildChartScene(analysis, { pinnedTotal: pinned.total }, 794);
  assert.ok(info.pinned);
  assert.equal(byClass(root, "chart-pinned").length, 1);
  assert.ok(String(root.attrs.class).includes("chart-is-pinned"));
  for (const curve of byClass(root, "chart-dose")) assert.equal(curve.attrs["stroke-opacity"], 0.25);
  assert.ok(info.labels.some(label => label.text === "Pinned"));
  // The y scale leaves room for both totals.
  assert.ok(info.scale.top >= Math.max(pinned.stats.max, analysis.stats.max));
  const compare = compareModel(analysis, pinned);
  assert.match(compare.sentence, /the level before the 21:00 dose falls from \d+ to \d+/);
  assert.doesNotMatch(compare.sentence, /better|worse|because/i);
  // The pin holds its own copy: redrawing the new day never changes it.
  assert.notEqual(pinned.total, analysis.computed.total);
});

test("a single small dose still gets the 100 reference line and one marker", () => {
  const analysis = analyzeDay([{ id: "s1", time: "08:00", drug: "rytary", strength: "61.25/245", count: 1, dose: 245 }]);
  assert.ok(analysis.stats.max < 100);
  const { root, info } = buildChartScene(analysis, {}, 356);
  assert.equal(byClass(root, "chart-ref").length, 1);
  assert.ok(info.scale.ticks.includes(100));
  assert.equal(info.markers.length, 1);
  assert.equal(analysis.stats.lowestBefore, null);
});

test("chartDesc starts with the headline and lists every before value", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const desc = chartDesc(analysis);
  assert.match(desc, /^Lowest of the day: \d+ at 06:00, before the first dose\./);
  assert.match(desc, /Levels before each dose: 06:00 \d+, 09:00 \d+, 12:00 \d+, 15:00 \d+, 18:00 \d+, 21:00 \d+\.$/);
});

/* ---------- model.js / amounts.js -> answers.js ---------- */

test("an imported v1 file analyzes like the typed test regimen and survives a round trip", () => {
  const imported = validateRegimenPayload(JSON.parse(read("test/fixtures/v1-test-regimen.json")));
  const analysis = analyzeDay(imported.doses, { target: imported.onThreshold, high: imported.dyskinesiaThreshold });
  assert.deepEqual(analysis.totals, { mg: 1240, led: 995 });
  assert.deepEqual(analysis.before.map(row => row.label), ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
  assert.ok(analysis.before[0].overnight);
  const typed = analyzeDay(TEST_REGIMEN);
  assert.deepEqual(Array.from(analysis.computed.total), Array.from(typed.computed.total));
  // Inference gave strength × count, and the export -> import round trip keeps it.
  const again = validateRegimenPayload(JSON.parse(JSON.stringify(exportRegimen({ ...imported, doses: imported.doses }))));
  const strip = doses => doses.map(({ time, drug, strength, count, dose }) => ({ time, drug, strength, count, dose }));
  assert.deepEqual(strip(again.doses), strip(imported.doses));
  assert.equal(imported.doses[0].strength, "25/100");
  assert.equal(imported.doses[0].count, 1.5);
});

test("the three daily totals agree: amounts, answers and model", () => {
  const doses = [
    ...TEST_REGIMEN,
    { id: "c1", time: "03:00", drug: "crexont", strength: "52.5/210", count: 2, dose: 420 },
    { id: "i1", time: "13:30", drug: "inbrija", strength: "42", count: 2, dose: 84 },
    { id: "r1", time: "07:15", drug: "sinemetcr", strength: null, count: null, dose: 150 },
    { id: "m1", time: "10:00", drug: "sinemet", strength: null, count: null, dose: null }
  ];
  const analysis = analyzeDay(doses);
  const totals = dailyTotals(doses);
  assert.deepEqual(analysis.totals, totals);
  assert.ok(Math.abs(calculateLedSummary(doses).totalLed - totals.led) < 1e-9);
});

test("doses made by the editor helpers are valid input for the analysis", () => {
  const next = nextDoseDefaults(TEST_REGIMEN, "d5");
  assert.equal(next.time, "21:00");
  assert.equal(next.dose, doseMg(next.drug, next.strength, next.count));
  const changed = medicineChange({ fromDrug: "sinemet", toDrug: "rytary", mode: "strength", intendedMg: 100 });
  const dose = { id: "n1", time: "23:00", drug: "rytary", strength: changed.strength, count: changed.count, dose: changed.dose };
  assert.equal(dose.dose, doseMg("rytary", dose.strength, dose.count));
  const analysis = analyzeDay([...TEST_REGIMEN, { id: "n0", ...next }, dose]);
  assert.equal(analysis.doses.length, 8);
  assert.equal(analysis.computed.series.length, 8);
});

/* ---------- answers.js -> schedule.js (SPEC 7) ---------- */

test("time sheet rows built by the Explorer pass the sheet's own validation", () => {
  const { rows, notes } = buildSheetRows(TEST_REGIMEN);
  assert.deepEqual(notes, []);
  const sheet = sheetFromRows(rows);
  assert.ok(sheet, JSON.stringify(rows));
  assert.deepEqual(sheet.names, ["Sinemet IR 25/100 · 1½ tablets", "Rytary 61.25/245 · 2 capsules"]);
  const marked = sheet.marks.map(marks => marks.flatMap((on, hour) => (on ? [hour] : [])));
  assert.deepEqual(marked, [[6, 9, 12, 15, 18], [21]]);
});

test("the sheet accepts the Explorer's rows at the 12-medicine cap and with off-hour times", () => {
  const drugs = ["sinemet", "sinemetcr", "rytary", "crexont"];
  const doses = [];
  for (let index = 0; index < 14; index += 1) {
    const drug = drugs[index % drugs.length];
    doses.push({ id: `x${index}`, time: `${String(index).padStart(2, "0")}:${index % 2 ? "30" : "00"}`, drug, strength: null, count: null, dose: 100 + index * 10 });
  }
  doses.push({ id: "blank", time: "23:00", drug: "sinemet", strength: null, count: null, dose: null });
  const { rows, notes } = buildSheetRows(doses);
  assert.equal(rows.length, 12);
  assert.equal(notes.length, 2);
  assert.ok(sheetFromRows(rows));
  for (const row of rows) assert.ok(row.name.length <= 60, row.name);
});
