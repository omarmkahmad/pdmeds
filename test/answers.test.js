import test from "node:test";
import assert from "node:assert/strict";

import { computeDay, formatDuration } from "../src/model.js";
import { formatClock, formatNumber } from "../src/time.js";
import {
  analyzeDay,
  answerBarLow,
  beforeEachDose,
  buildSheetRows,
  chartDesc,
  compareModel,
  doseGroups,
  headlineSentences,
  hourlyRows,
  lowestBeforeLabel,
  pinSnapshot,
  rangeLabel,
  rangeText,
  rangesAbove,
  rangesBelow,
  readoutText,
  sliderValueText,
  statusMessage,
  tileModel
} from "../src/answers.js";

// Levels come from the pharmacokinetic model, which will be refit. Tests
// therefore check counts, order, flags and the direction of change, and
// build exact strings from values the analysis itself computed.

const minuteOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const wrap = minute => ((minute % 1440) + 1440) % 1440;
const r = value => formatNumber(Math.round(value), 0);
const oneDecimal = value => value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const span = values => {
  const rounded = values.map(Math.round);
  const low = Math.min(...rounded);
  const high = Math.max(...rounded);
  return low === high ? r(low) : `${r(low)}–${r(high)}`;
};

const ir = (id, time, count = 1.5, strength = "25/100") => ({ id, time, drug: "sinemet", strength, count, dose: 100 * count });
const irMg = (id, time, dose) => ({ id, time, drug: "sinemet", strength: null, count: null, dose });
const rytary = (id, time) => ({ id, time, drug: "rytary", strength: "61.25/245", count: 2, dose: 490 });

const TEST_REGIMEN = [
  ir("d1", "06:00"), ir("d2", "09:00"), ir("d3", "12:00"), ir("d4", "15:00"), ir("d5", "18:00"), rytary("d6", "21:00")
];
const MOVED = TEST_REGIMEN.map(dose => (dose.id === "d5" ? { ...dose, time: "17:00" } : dose));
const EXAMPLE = [
  ir("e1", "07:00", 1), ir("e2", "11:00", 1), ir("e3", "15:00", 1), ir("e4", "19:00", 1),
  { id: "e5", time: "21:00", drug: "sinemetcr", strength: "50/200", count: 1, dose: 200 }
];
const RYTARY_BID = [rytary("r1", "07:00"), rytary("r2", "19:00")];
const BANNED = /\b(better|worse|because)\b/i;

// A synthetic day: total[m] = fn(m) for m = 0…1440.
function curve(fn) {
  const total = new Float64Array(1441);
  for (let minute = 0; minute <= 1440; minute += 1) total[minute] = fn(minute);
  return total;
}

const groupsAt = (...times) => doseGroups(times.map((time, index) => irMg(`g${index}`, time, 100)));

/* ---------- analyzeDay ---------- */

test("analyzeDay counts only doses with an amount, sorted by time (stable)", () => {
  const doses = [
    rytary("late", "21:00"),
    irMg("blank", "07:00", null),
    irMg("zero", "08:00", 0),
    ir("b", "09:00"),
    ir("a", "06:00"),
    ir("b2", "09:00", 1)
  ];
  const analysis = analyzeDay(doses);
  assert.deepEqual(analysis.doses.map(dose => dose.id), ["a", "b", "b2", "late"]);
  assert.equal(analysis.doses[0], doses[4], "keeps the input dose objects");
  assert.equal(analysis.computed.series.length, 4);
  assert.deepEqual(analysis.totals, { mg: 150 + 150 + 100 + 490, led: 150 + 150 + 100 + 245 });
});

test("analyzeDay series line up with analysis.doses and every dose counts", () => {
  const analysis = analyzeDay([...TEST_REGIMEN].reverse().map(dose => ({ ...dose, hidden: dose.id === "d6" })));
  assert.deepEqual(analysis.doses.map(dose => dose.time), ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
  analysis.doses.forEach((dose, index) => {
    const alone = computeDay({ doses: [{ time: dose.time, drug: dose.drug, dose: dose.dose }] }).total;
    for (const minute of [0, 540, 1260]) assert.ok(Math.abs(analysis.computed.series[index][minute] - alone[minute]) < 1e-9);
  });
  // A stale hidden flag must not drop a dose from the total.
  const plain = analyzeDay(TEST_REGIMEN);
  for (const minute of [0, 300, 540, 1300]) assert.ok(Math.abs(analysis.computed.total[minute] - plain.computed.total[minute]) < 1e-9);
});

test("analyzeDay stats: fluctuation = (max − min) ÷ mean over the day", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const values = Array.from(analysis.computed.total.slice(0, 1440));
  const mean = values.reduce((sum, value) => sum + value, 0) / 1440;
  assert.ok(Math.abs(analysis.stats.mean - mean) < 1e-9);
  assert.equal(analysis.stats.max, Math.max(...values));
  assert.equal(analysis.stats.min, Math.min(...values));
  assert.equal(analysis.computed.total[analysis.stats.maxMinute], analysis.stats.max);
  assert.equal(analysis.computed.total[analysis.stats.minMinute], analysis.stats.min);
  assert.ok(Math.abs(analysis.stats.fluctuation - (analysis.stats.max - analysis.stats.min) / mean) < 1e-12);
});

test("analyzeDay with no counted doses is empty but safe", () => {
  const analysis = analyzeDay([irMg("a", "08:00", null)]);
  assert.deepEqual(analysis.doses, []);
  assert.deepEqual(analysis.groups, []);
  assert.deepEqual(analysis.before, []);
  assert.equal(analysis.stats.lowestBefore, null);
  assert.equal(analysis.stats.fluctuation, null);
  assert.deepEqual(headlineSentences(analysis), []);
  assert.equal(chartDesc(analysis), "");
  assert.equal(statusMessage(analysis, 1), "Updated. 1 dose.");
});

test("lines that are blank, zero or negative count as not set", () => {
  const analysis = analyzeDay(TEST_REGIMEN, { target: 0, high: -5 });
  assert.deepEqual(analysis.lines, { target: null, high: null });
  assert.equal(analysis.below, null);
  assert.equal(analysis.above, null);
  assert.equal(analysis.belowMinutes, null);
  assert.equal(analysis.aboveMinutes, null);
  assert.equal(analysis.targetFraction, null);
  assert.equal(tileModel(analysis).length, 4);
  assert.deepEqual(analyzeDay(TEST_REGIMEN).lines, { target: null, high: null });
});

/* ---------- Grouping ---------- */

test("doseGroups: times 45 min or less apart share a group (07:00 + 07:15)", () => {
  const groups = doseGroups([
    irMg("c", "13:00", 100),
    irMg("a", "07:00", 100),
    { id: "b", time: "07:15", drug: "rytary", strength: null, count: null, dose: 245 }
  ]);
  assert.deepEqual(groups, [
    { start: 420, end: 435, times: [420, 435], ids: ["a", "b"] },
    { start: 780, end: 780, times: [780], ids: ["c"] }
  ]);
  assert.equal(groupsAt("07:00", "07:45").length, 1, "exactly 45 min groups");
  assert.equal(groupsAt("07:00", "07:46").length, 2, "46 min does not");
  assert.deepEqual(groupsAt("07:00", "07:40", "08:20").map(group => group.times), [[420, 460, 500]], "chains");
});

test("doseGroups: the day is circular, so 23:40 and 00:10 share one group", () => {
  const groups = groupsAt("00:10", "12:00", "23:40");
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0], { start: 1420, end: 10, times: [1420, 10], ids: ["g2", "g0"] });
  assert.deepEqual(groups[1].times, [720]);
  const rows = beforeEachDose(new Float64Array(1441), groups);
  assert.equal(rows[0].label, "23:40 + 00:10");
  assert.equal(rows[0].groupStart, 1420);
  assert.equal(rows[0].sinceLast, 1420 - 720);
  assert.equal(rows[1].sinceLast, 720 - 10);
});

test("doseGroups: duplicate times are one time; doses without an amount are ignored", () => {
  const groups = doseGroups([irMg("a", "08:00", 100), irMg("b", "08:00", 50), irMg("c", "10:00", null), irMg("d", "12:00", 0)]);
  assert.deepEqual(groups, [{ start: 480, end: 480, times: [480], ids: ["a", "b"] }]);
  assert.deepEqual(doseGroups([]), []);
  assert.deepEqual(doseGroups(undefined), []);
});

/* ---------- Level before each dose: the algorithm on synthetic curves ---------- */

test("beforeEachDose: the low runs from the peak after the previous dose to dose + 60 min", () => {
  // 06:00 dose: 5 at 06:00, rising to 100 at 07:00, then down to 20 at 09:00.
  // Starting at the peak keeps the not-yet-risen 5 at 06:00 from being the low.
  const total = curve(minute => {
    if (minute >= 360 && minute <= 420) return 5 + (minute - 360) * 95 / 60;
    if (minute > 420 && minute <= 540) return 100 - (minute - 420) * 80 / 120;
    if (minute > 540 && minute <= 600) return 20 + (minute - 540);
    return 5;
  });
  const [, second] = beforeEachDose(total, groupsAt("06:00", "09:00"));
  assert.equal(second.minute, 540);
  assert.equal(second.level, 20);
  assert.equal(second.early, false);
  assert.equal(second.peakAfter, 80);
  assert.equal(second.peakAfterMinute, 600);
});

test("beforeEachDose: early only when the low is more than 10 min before the dose", () => {
  // Peak 110 at 07:00, down to 10 at the dip, then rising again.
  const dipAt = dip => curve(minute => {
    if (minute < 360) return 50;
    if (minute <= 420) return 50 + (minute - 360);
    if (minute <= dip) return 110 - (minute - 420) * 100 / (dip - 420);
    return 10 + (minute - dip);
  });
  const groups = groupsAt("06:00", "09:00");
  const early = beforeEachDose(dipAt(529), groups)[1];
  assert.equal(early.minute, 529);
  assert.equal(early.early, true, "11 min before");
  const edge = beforeEachDose(dipAt(530), groups)[1];
  assert.equal(edge.minute, 530);
  assert.equal(edge.early, false, "exactly 10 min before");
});

test("beforeEachDose: the low may sit up to 60 min after the dose, never later", () => {
  const fallingUntil = end => curve(minute => {
    if (minute < 360) return 30;
    if (minute <= 420) return 30 + (minute - 360);
    return Math.max(0, 90 - (Math.min(minute, end) - 420) * 0.1);
  });
  const groups = groupsAt("06:00", "09:00");
  assert.equal(beforeEachDose(fallingUntil(570), groups)[1].minute, 570);
  assert.equal(beforeEachDose(fallingUntil(700), groups)[1].minute, 600, "the search ends at dose + 60 min");
  assert.equal(beforeEachDose(fallingUntil(570), groups)[1].early, false);
});

test("beforeEachDose: since last dose and the overnight flag", () => {
  const flat = new Float64Array(1441);
  const rows = beforeEachDose(flat, groupsAt("06:00", "07:00", "07:30", "13:00", "21:00"));
  assert.deepEqual(rows.map(row => row.label), ["06:00", "07:00 + 07:30", "13:00", "21:00"]);
  assert.deepEqual(rows.map(row => row.number), [1, 2, 3, 4]);
  assert.deepEqual(rows.map(row => row.sinceLast), [540, 60, 330, 480]);
  assert.deepEqual(rows.map(row => row.overnight), [true, false, false, false]);
  assert.deepEqual(rows.map(row => row.previousEnd), [1260, 360, 450, 780]);

  // Every 4 h around the clock: no gap of 6 h, so nothing is overnight.
  const even = beforeEachDose(flat, groupsAt("00:00", "04:00", "08:00", "12:00", "16:00", "20:00"));
  assert.ok(even.every(row => !row.overnight));
  // Equal longest gaps: only the first is flagged.
  assert.deepEqual(beforeEachDose(flat, groupsAt("08:00", "20:00")).map(row => row.overnight), [true, false]);
  // One dose a day: the gap is the whole day.
  const single = beforeEachDose(flat, groupsAt("08:00"));
  assert.equal(single.length, 1);
  assert.equal(single[0].sinceLast, 1440);
  assert.deepEqual(beforeEachDose(flat, []), []);
});

/* ---------- Level before each dose: real regimens ---------- */

test("test regimen: 6 rows at the dose times, row 1 overnight, lows at the doses", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const rows = analysis.before;
  assert.equal(analysis.groups.length, 6);
  assert.deepEqual(rows.map(row => row.label), ["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
  assert.deepEqual(rows.map(row => row.number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rows.map(row => row.overnight), [true, false, false, false, false, false]);
  assert.deepEqual(rows.map(row => row.sinceLast), [540, 180, 180, 180, 180, 180]);
  for (const row of rows) {
    assert.equal(row.early, false, row.label);
    assert.ok(wrap(row.groupStart - row.minute) <= 10 || wrap(row.minute - row.groupStart) <= 60, row.label);
    assert.ok(row.peakAfter > row.level, row.label);
    const next = rows[row.number % rows.length].groupStart;
    assert.ok(wrap(row.peakAfterMinute - row.groupStart) <= wrap(next - row.groupStart), row.label);
  }
  // The overnight low is the lowest of all, and it is the day's minimum.
  assert.ok(rows.slice(1).every(row => row.level > rows[0].level));
  assert.ok(Math.abs(analysis.stats.min - rows[0].level) < 1e-9);
  // Lowest before a dose: the lowest non-overnight row (09:00 in SPEC 11).
  const low = analysis.stats.lowestBefore;
  assert.equal(low.overnight, false);
  assert.ok(rows.filter(row => !row.overnight).every(row => row.level >= low.level));
});

// An order check, not a level: rerun after a model refit (SPEC appendix).
test("SPEC 11: in the test regimen the lowest before a dose is the 09:00 row", () => {
  assert.equal(analyzeDay(TEST_REGIMEN).stats.lowestBefore.label, "09:00");
});

test("example regimen: 5 rows, the 07:00 row is overnight", () => {
  const rows = analyzeDay(EXAMPLE).before;
  assert.deepEqual(rows.map(row => row.label), ["07:00", "11:00", "15:00", "19:00", "21:00"]);
  assert.deepEqual(rows.map(row => row.overnight), [true, false, false, false, false]);
  assert.ok(rows.slice(1).every(row => row.level > rows[0].level));
});

test("Rytary twice a day: 2 rows, each low within 10 min before the dose; no mid-curve dip", () => {
  const analysis = analyzeDay(RYTARY_BID);
  assert.equal(analysis.before.length, 2);
  for (const row of analysis.before) {
    assert.ok(wrap(row.groupStart - row.minute) <= 10, `${row.label} low at ${formatClock(row.minute)}`);
    assert.equal(row.early, false);
  }
  assert.deepEqual(analysis.before.map(row => row.overnight), [true, false]);
});

test("a single dose gives one row and no 'lowest before a dose'", () => {
  const analysis = analyzeDay([{ id: "s", time: "11:30", drug: "rytary", strength: "61.25/245", count: 1, dose: 245 }]);
  assert.equal(analysis.before.length, 1);
  assert.equal(analysis.stats.lowestBefore, null);
  const { stats } = analysis;
  assert.deepEqual(headlineSentences(analysis), [
    `One dose time a day: highest ${r(stats.max)} at ${formatClock(stats.maxMinute)}, lowest ${r(stats.min)} at ${formatClock(stats.minMinute)}.`
  ]);
  const [lowestBefore] = tileModel(analysis);
  assert.equal(lowestBefore.value, "—");
  assert.equal(lowestBefore.note, "Needs 2 or more dose times.");
  assert.equal(statusMessage(analysis, 1),
    `Updated. 1 dose, 245 mg levodopa = 122.5 mg LEDD a day. Lowest ${r(stats.min)} at ${formatClock(stats.minMinute)}. `
    + `Highest ${r(stats.max)} at ${formatClock(stats.maxMinute)}.`);
});

test("07:00 + 07:15 share one row", () => {
  const doses = [irMg("a", "07:00", 100), { id: "b", time: "07:15", drug: "rytary", dose: 245 }, irMg("c", "13:00", 100)];
  const analysis = analyzeDay(doses);
  assert.deepEqual(analysis.before.map(row => row.label), ["07:00 + 07:15", "13:00"]);
  assert.deepEqual(analysis.groups[0].ids, ["a", "b"]);
  assert.equal(analysis.before[1].previousEnd, 435);
  assert.ok(chartDesc(analysis).includes("07:00 + 07:15 "));
  // Only two doses in one group: one dose time a day.
  assert.match(headlineSentences(analyzeDay(doses.slice(0, 2)))[0], /^One dose time a day: /);
});

/* ---------- Ranges ---------- */

test("rangesBelow merges a stretch across midnight into one range", () => {
  const total = curve(minute => ((minute >= 600 && minute < 660) || minute >= 1320 || minute < 120 ? 10 : 90));
  const below = rangesBelow(total, 50);
  assert.deepEqual(below, [
    { start: 600, end: 660, minutes: 60 },
    { start: 1320, end: 120, minutes: 240 }
  ]);
  assert.equal(rangeText(below), "10:00–11:00, 22:00–02:00");
  const above = rangesAbove(total, 50);
  assert.deepEqual(above, [
    { start: 120, end: 600, minutes: 480 },
    { start: 660, end: 1320, minutes: 660 }
  ]);
});

test("ranges: starting or ending at midnight, the whole day, none, and at the line", () => {
  const fromMidnight = curve(minute => (minute < 60 ? 10 : 90));
  assert.deepEqual(rangesBelow(fromMidnight, 50), [{ start: 0, end: 60, minutes: 60 }]);
  const toMidnight = curve(minute => (minute >= 1380 && minute < 1440 ? 10 : 90));
  assert.deepEqual(rangesBelow(toMidnight, 50), [{ start: 1380, end: 0, minutes: 60 }]);
  assert.equal(rangeLabel({ start: 1380, end: 0, minutes: 60 }), "23:00–00:00");

  const flat = curve(() => 50);
  assert.deepEqual(rangesBelow(flat, 60), [{ start: 0, end: 0, minutes: 1440 }]);
  assert.equal(rangeLabel(rangesBelow(flat, 60)[0]), "00:00–24:00");
  assert.deepEqual(rangesBelow(flat, 50), [], "at the line is not below");
  assert.deepEqual(rangesAbove(flat, 50), [{ start: 0, end: 0, minutes: 1440 }], "at the line counts as at or above");
  assert.deepEqual(rangesAbove(flat, 51), []);
  for (const bad of [null, undefined, 0, -1, Number.NaN, ""]) assert.deepEqual(rangesBelow(flat, bad), []);
});

test("below and at-or-above minutes always add up to the day", () => {
  const { computed } = analyzeDay(TEST_REGIMEN);
  for (const line of [30, 100, 150]) {
    const minutes = ranges => ranges.reduce((sum, range) => sum + range.minutes, 0);
    assert.equal(minutes(rangesBelow(computed.total, line)) + minutes(rangesAbove(computed.total, line)), 1440);
  }
});

/* ---------- Headline ---------- */

test("headline for the test regimen: S1 before the first dose, then S2 with ranges", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const { stats, before } = analysis;
  const daytime = before.filter(row => !row.overnight);
  const sentences = headlineSentences(analysis);
  assert.deepEqual(sentences, [
    `Lowest of the day: ${r(stats.min)} at ${formatClock(stats.minMinute)}, before the first dose.`,
    `During the day it drops to ${span(daytime.map(row => row.level))} before each dose and rises to ${span(daytime.map(row => row.peakAfter))} after.`
  ]);
  assert.match(sentences[1], /^During the day it drops to \d+–\d+ before each dose and rises to \d+–\d+ after\.$/);
});

test("headline S2 collapses a range whose ends round the same", () => {
  const analysis = analyzeDay(["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"].map((time, index) => irMg(`q${index}`, time, 100)));
  const [row] = analysis.before;
  assert.equal(headlineSentences(analysis)[1], `During the day it drops to ${r(row.level)} before each dose and rises to ${r(row.peakAfter)} after.`);
});

test("headline S2 with one daytime group names that dose", () => {
  const analysis = analyzeDay(RYTARY_BID);
  const row = analysis.before[1];
  assert.equal(headlineSentences(analysis)[1], `During the day it drops to ${r(row.level)} before the 19:00 dose.`);
});

test("headline S1 leaves out 'before the first dose' when the low is elsewhere", () => {
  // 08:00 is the first dose; the small morning dose is gone by 20:00.
  const analysis = analyzeDay([irMg("a", "08:00", 100), irMg("b", "20:00", 500)]);
  assert.ok(wrap(480 - analysis.stats.minMinute) > 60);
  assert.equal(headlineSentences(analysis)[0], `Lowest of the day: ${r(analysis.stats.min)} at ${formatClock(analysis.stats.minMinute)}.`);
  assert.equal(tileModel(analysis)[1].note, `at ${formatClock(analysis.stats.minMinute)}`);
});

test("headline S3 with a target line, and its edge cases", () => {
  const analysis = analyzeDay(TEST_REGIMEN, { target: 100, high: null });
  const longest = analysis.below.reduce((best, range) => (range.minutes > best.minutes ? range : best));
  assert.equal(headlineSentences(analysis)[2],
    `Below your target line for ${formatDuration(analysis.belowMinutes)} a day; the longest stretch is ${rangeLabel(longest)}.`);
  // With no evening dose, the longest stretch below the line crosses midnight.
  const daytimeOnly = analyzeDay(["07:00", "11:00", "15:00", "19:00"].map((time, index) => (
    { id: `ir${index}`, time, drug: "sinemet", strength: "25/100", count: 1, dose: 100 }
  )), { target: 50, high: null });
  const overnight = daytimeOnly.below.reduce((best, range) => (range.minutes > best.minutes ? range : best));
  assert.ok(overnight.start > overnight.end, "the longest stretch runs across midnight");
  assert.match(headlineSentences(daytimeOnly)[2], new RegExp(`the longest stretch is ${rangeLabel(overnight)}\\.$`));
  assert.equal(headlineSentences(analyzeDay(TEST_REGIMEN, { target: 1, high: null }))[2], "Never below your target line.");
  assert.equal(headlineSentences(analyzeDay(TEST_REGIMEN, { target: 1000, high: null }))[2], "Below your target line all day.");
  assert.equal(headlineSentences(analyzeDay(TEST_REGIMEN, { target: null, high: 100 })).length, 2, "a high line alone adds nothing");
});

/* ---------- Tiles ---------- */

test("tiles: four with no lines, labels, info keys and formats", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const tiles = tileModel(analysis);
  const { stats } = analysis;
  assert.deepEqual(tiles.map(tile => [tile.key, tile.label, tile.info]), [
    ["lowestBefore", "Daytime low", null],
    ["lowest", "Lowest", "lowest"],
    ["highest", "Highest", "highest"],
    ["fluctuation", "Fluctuation index", "fluctuation"]
  ]);
  const low = stats.lowestBefore;
  assert.equal(tiles[0].value, r(low.level));
  assert.equal(tiles[0].note, `at ${formatClock(low.minute)}, ${formatDuration(wrap(low.minute - low.previousEnd))} after the 06:00 dose`);
  assert.equal(tiles[1].value, r(stats.min));
  assert.equal(tiles[1].note, `at ${formatClock(stats.minMinute)}, before the first dose`);
  assert.equal(tiles[2].value, r(stats.max));
  assert.equal(tiles[2].note, `at ${formatClock(stats.maxMinute)} · ${oneDecimal(stats.max / 100)} × one IR peak`);
  assert.match(tiles[2].note, / · \d+\.\d × one IR peak$/);
  assert.equal(tiles[3].value, oneDecimal(stats.fluctuation));
  assert.match(tiles[3].value, /^\d+\.\d$/);
  assert.equal(tiles[3].note, "bigger number = bigger swings");
  assert.ok(tiles.every(tile => !("was" in tile)));
});

test("the first tile is named for what it counts", () => {
  // With an overnight gap it leaves out the first dose, whose lower level is the "Lowest" tile.
  const analysis = analyzeDay(TEST_REGIMEN);
  assert.equal(lowestBeforeLabel(analysis), "Daytime low");
  assert.ok(analysis.stats.min < analysis.stats.lowestBefore.level);
  // Every 4 h around the clock: no overnight gap, so every dose counts.
  const even = analyzeDay(["00:00", "04:00", "08:00", "12:00", "16:00", "20:00"].map((time, index) => irMg(`e${index}`, time, 100)));
  assert.ok(even.before.every(row => !row.overnight));
  assert.equal(lowestBeforeLabel(even), "Lowest before a dose");
  assert.equal(tileModel(even)[0].label, "Lowest before a dose");
  assert.match(statusMessage(even, 6), / Lowest before a dose \d+ at \d\d:\d\d\. /);
});

test("answerBarLow: the phone bar's second line stays short", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const low = analysis.stats.lowestBefore;
  assert.equal(answerBarLow(analysis), `Dips to ${r(low.level)} at ${formatClock(low.minute)} ↓`);
  const moved = analyzeDay(MOVED);
  const snapshot = pinSnapshot(analysis);
  const movedLow = moved.stats.lowestBefore;
  assert.notEqual(r(movedLow.level), r(low.level));
  assert.equal(answerBarLow(moved, snapshot), `Dips to ${r(movedLow.level)} (was ${r(low.level)}) ↓`, "the was form drops the time");
  assert.equal(answerBarLow(analysis, snapshot), `Dips to ${r(low.level)} at ${formatClock(low.minute)} ↓`, "no 'was' when unchanged");
  const single = analyzeDay([rytary("s", "08:00")]);
  assert.equal(answerBarLow(single), `Lowest: ${r(single.stats.min)} at ${formatClock(single.stats.minMinute)} ↓`);
  // About 176 px on a 320 px phone: 24 characters, with room for 3-digit levels.
  for (const text of [answerBarLow(analysis), answerBarLow(moved, snapshot), answerBarLow(single)]) {
    assert.ok(text.length <= 24 - 2, `"${text}" leaves room for 3-digit levels`);
  }
});

test("tiles: a low more than 10 min before the dose says 'before the … dose'", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const row = { ...analysis.stats.lowestBefore, early: true, minute: 520, groupStart: 540 };
  const tiles = tileModel({ ...analysis, stats: { ...analysis.stats, lowestBefore: row } });
  assert.equal(tiles[0].note, "at 08:40, before the 09:00 dose");
});

test("tiles: line tiles appear for each line that is set", () => {
  const both = analyzeDay(TEST_REGIMEN, { target: 100, high: 180 });
  const tiles = tileModel(both);
  assert.deepEqual(tiles.map(tile => tile.key), ["lowestBefore", "lowest", "highest", "fluctuation", "below", "above"]);
  const longest = ranges => ranges.reduce((best, range) => (range.minutes > best.minutes ? range : best));
  const percent = Math.round((1440 - both.belowMinutes) / 1440 * 100);
  assert.deepEqual(tiles[4], {
    key: "below",
    label: "Below target line",
    value: formatDuration(both.belowMinutes),
    note: `longest ${rangeLabel(longest(both.below))} · at or above target ${percent}% of the day`,
    info: "target"
  });
  assert.ok(Math.abs(both.targetFraction - (1440 - both.belowMinutes) / 1440) < 1e-12);
  assert.ok(both.above.length > 0, "the test regimen peaks above 180");
  assert.deepEqual(tiles[5], {
    key: "above",
    label: "At or above high line",
    value: formatDuration(both.aboveMinutes),
    note: `longest ${rangeLabel(longest(both.above))}`,
    info: "high"
  });

  const highOnly = tileModel(analyzeDay(TEST_REGIMEN, { target: null, high: 1000 }));
  assert.deepEqual(highOnly.map(tile => tile.key), ["lowestBefore", "lowest", "highest", "fluctuation", "above"]);
  assert.equal(highOnly[4].value, "0 min");
  assert.equal(highOnly[4].note, "none");

  const never = tileModel(analyzeDay(TEST_REGIMEN, { target: 1, high: null }))[4];
  assert.equal(never.value, "0 min");
  assert.equal(never.note, "at or above target 100% of the day");
});

/* ---------- Readout and slider ---------- */

function expectedSources(analysis, minute) {
  const sources = analysis.doses
    .map((dose, index) => ({ dose, value: analysis.computed.series[index][minute] }))
    .filter(source => source.value >= 2)
    .sort((a, b) => b.value - a.value)
    .slice(0, 2)
    .map(({ dose, value }) => `${minuteOf(dose.time) > minute ? "last night's" : "the"} ${dose.time} ${dose.drug === "rytary" ? "Rytary" : "Sinemet IR"} (${r(value)})`);
  return sources.length ? `mostly ${sources.join(" and ")}` : "almost nothing left from any dose";
}

test("readout at 09:00 names the 06:00 Sinemet IR and last night's 21:00 Rytary", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const minute = 540;
  const text = readoutText(analysis, minute);
  assert.equal(text, `${formatClock(minute)} · level ${r(analysis.computed.total[minute])} · ${expectedSources(analysis, minute)}`);
  assert.ok(text.includes("mostly the 06:00 Sinemet IR ("), text);
  assert.ok(text.includes(" and last night's 21:00 Rytary ("), text);
});

test("readout: one source, no source, and last night's alone", () => {
  const single = analyzeDay([irMg("a", "08:00", 100)]);
  const level = r(single.computed.total[540]);
  assert.equal(readoutText(single, 540), `09:00 · level ${level} · mostly the 08:00 Sinemet IR (${level})`);
  assert.equal(readoutText(single, 240), "04:00 · level 0 · almost nothing left from any dose");
  const night = analyzeDay([rytary("r", "21:00")]);
  const value = r(night.computed.total[540]);
  assert.equal(readoutText(night, 540), `09:00 · level ${value} · mostly last night's 21:00 Rytary (${value})`);
});

test("readout: at most two sources, largest first; same time and medicine is one source", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const text = readoutText(analysis, 13 * 60);
  assert.equal((text.match(/\(\d+\)/g) ?? []).length, 2);
  const [first, second] = [...text.matchAll(/\((\d+)\)/g)].map(match => Number(match[1]));
  assert.ok(first >= second);

  const twins = analyzeDay([irMg("a", "06:00", 100), irMg("b", "06:00", 100), irMg("c", "12:00", 100)]);
  const both = twins.computed.series[0][420] + twins.computed.series[1][420];
  assert.equal(readoutText(twins, 420), `07:00 · level ${r(twins.computed.total[420])} · mostly the 06:00 Sinemet IR (${r(both)})`);
});

test("readout and slider add the line status after the level", () => {
  const minute = 540;
  const base = analyzeDay(TEST_REGIMEN);
  const level = base.computed.total[minute];
  const withLines = lines => analyzeDay(TEST_REGIMEN, lines);
  const sources = expectedSources(base, minute);
  assert.equal(readoutText(withLines({ target: Math.ceil(level) + 20, high: null }), minute),
    `09:00 · level ${r(level)} · below target line · ${sources}`);
  assert.equal(readoutText(withLines({ target: Math.floor(level) - 20, high: null }), minute),
    `09:00 · level ${r(level)} · at or above target · ${sources}`);
  assert.equal(readoutText(withLines({ target: 10, high: Math.floor(level) - 5 }), minute),
    `09:00 · level ${r(level)} · at or above high line · ${sources}`);
  assert.equal(readoutText(withLines({ target: null, high: Math.ceil(level) + 50 }), minute),
    `09:00 · level ${r(level)} · ${sources}`, "below a high line alone has no status");

  assert.equal(sliderValueText(base, minute), `09:00, level ${r(level)}`);
  assert.equal(sliderValueText(withLines({ target: Math.ceil(level) + 20, high: null }), minute), `09:00, level ${r(level)}, below target line`);
  assert.equal(sliderValueText(withLines({ target: Math.floor(level) - 20, high: null }), minute), `09:00, level ${r(level)}, at or above target`);
  assert.equal(sliderValueText(withLines({ target: null, high: Math.floor(level) - 5 }), minute), `09:00, level ${r(level)}, at or above high line`);
  assert.equal(sliderValueText(base, 1440), `00:00, level ${r(base.computed.total[0])}`);
});

/* ---------- Pin to compare ---------- */

test("pinSnapshot is an independent plain copy", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const snapshot = pinSnapshot(analysis);
  assert.ok(snapshot.total instanceof Float64Array);
  assert.notEqual(snapshot.total, analysis.computed.total);
  const before = snapshot.total[540];
  analysis.computed.total[540] = -1;
  analysis.before[0].level = -1;
  analysis.stats.lowestBefore.level = -1;
  assert.equal(snapshot.total[540], before);
  assert.notEqual(snapshot.before[0].level, -1);
  assert.notEqual(snapshot.lowestBefore.level, -1);
  assert.deepEqual(snapshot.totals, { mg: 1240, led: 995 });
  assert.equal(snapshot.doseCount, 6);
});

test("compare, 18:00 moved to 17:00: the 21:00 low falls, the highest rises", () => {
  const pinnedAnalysis = analyzeDay(TEST_REGIMEN);
  const snapshot = pinSnapshot(pinnedAnalysis);
  const analysis = analyzeDay(MOVED);
  const compare = compareModel(analysis, snapshot);
  assert.equal(compare.note, "Comparing with the day you pinned (grey dashed line).");

  // Every group is matched; 17:00 takes the pinned 18:00 value.
  const pinnedRows = pinnedAnalysis.before;
  assert.deepEqual([...compare.beforeWas.keys()], [1, 2, 3, 4, 5, 6]);
  analysis.before.forEach((row, index) => assert.equal(compare.beforeWas.get(row.number), `(was ${r(pinnedRows[index].level)})`));
  assert.deepEqual(compare.unmatched, []);
  assert.equal(compare.wasNote, true);

  const now21 = analysis.before[5];
  const was21 = pinnedRows[5];
  assert.ok(Math.round(was21.level) - Math.round(now21.level) >= 5, "the 21:00 low falls");
  assert.ok(Math.round(analysis.stats.max) - Math.round(pinnedAnalysis.stats.max) >= 5, "the highest rises");
  // The 21:00 fall is the largest fall.
  const falls = analysis.before.map((row, index) => Math.round(pinnedRows[index].level) - Math.round(row.level));
  assert.equal(Math.max(...falls), falls[5]);

  assert.equal(compare.sentence,
    `Compared with the pinned day: the level before the 21:00 dose falls from ${r(was21.level)} to ${r(now21.level)}; `
    + `the highest level rises from ${r(pinnedAnalysis.stats.max)} to ${r(analysis.stats.max)} (now at ${formatClock(analysis.stats.maxMinute)}). `
    + "Daily levodopa is the same (1,240 mg).");
  assert.doesNotMatch(compare.sentence, BANNED);

  const tiles = tileModel(analysis, snapshot);
  const highest = tiles.find(tile => tile.key === "highest");
  const delta = Math.round(analysis.stats.max) - Math.round(pinnedAnalysis.stats.max);
  assert.equal(highest.was, `was ${r(pinnedAnalysis.stats.max)} · +${delta}`);
  const lowestBefore = tiles.find(tile => tile.key === "lowestBefore");
  assert.match(lowestBefore.was, /^was \d+ · −\d+$/, "the lowest before a dose falls, with a U+2212 minus");
  for (const tile of tiles) assert.match(tile.was, /^(same as pinned|was \d+(\.\d)? · [+−]\d+(\.\d)?)$/, tile.key);
  assert.match(tiles.find(tile => tile.key === "fluctuation").was, /^(same as pinned|was \d\.\d · [+−]\d\.\d)$/);
});

test("compare with a target line adds the time-below clause when it moves 5 min or more", () => {
  const lines = { target: 100, high: null };
  const snapshot = pinSnapshot(analyzeDay(TEST_REGIMEN));
  const analysis = analyzeDay(MOVED, lines);
  const pinnedBelow = rangesBelow(snapshot.total, 100).reduce((sum, range) => sum + range.minutes, 0);
  const clause = `time below your target line goes from ${formatDuration(pinnedBelow)} to ${formatDuration(analysis.belowMinutes)}`;
  const sentence = compareModel(analysis, snapshot).sentence;
  assert.equal(sentence.includes(clause), Math.abs(analysis.belowMinutes - pinnedBelow) >= 5);
  if (sentence.includes(clause)) assert.ok(sentence.indexOf("the highest level") < sentence.indexOf(clause), "clause order");
  // The lines are shared, so a line set after pinning still gets a "was".
  const below = tileModel(analysis, snapshot).find(tile => tile.key === "below");
  const delta = analysis.belowMinutes - pinnedBelow;
  assert.equal(below.was, delta === 0 ? "same as pinned" : `was ${formatDuration(pinnedBelow)} · ${delta > 0 ? "+" : "−"}${formatDuration(Math.abs(delta))}`);
});

test("compare with the same day: almost the same, every tile 'same as pinned'", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const snapshot = pinSnapshot(analyzeDay(TEST_REGIMEN));
  const compare = compareModel(analysis, snapshot);
  assert.equal(compare.sentence, "The curve is almost the same as the pinned day. Daily levodopa is the same (1,240 mg).");
  analysis.before.forEach(row => assert.equal(compare.beforeWas.get(row.number), `(was ${r(row.level)})`));
  assert.ok(tileModel(analysis, snapshot).every(tile => tile.was === "same as pinned"));
  assert.equal(compareModel(analysis, null), null);
});

test("compare: a removed dose is listed as no longer in the table; totals change", () => {
  const snapshot = pinSnapshot(analyzeDay(TEST_REGIMEN));
  const analysis = analyzeDay(TEST_REGIMEN.filter(dose => dose.id !== "d5"));
  const compare = compareModel(analysis, snapshot);
  assert.deepEqual(compare.unmatched.map(item => [item.number, item.label, r(item.level)]), [[5, "18:00", r(snapshot.before[4].level)]]);
  assert.ok([...compare.beforeWas.values()].every(text => text.startsWith("(was ")));
  assert.ok(compare.sentence.startsWith("Compared with the pinned day: the level before the 21:00 dose falls from "), compare.sentence);
  assert.ok(compare.sentence.endsWith(". Daily levodopa goes from 1,240 to 1,090 mg (LEDD 995 → 845)."), compare.sentence);
  assert.doesNotMatch(compare.sentence, BANNED);
});

test("compare: an added dose is (new); matching is one-to-one, closest first, within 90 min", () => {
  const added = compareModel(analyzeDay([...TEST_REGIMEN, ir("x", "03:00")]), pinSnapshot(analyzeDay(TEST_REGIMEN)));
  assert.equal(added.beforeWas.get(1), "(new)");
  assert.deepEqual(added.unmatched, []);

  const pinned = pinSnapshot(analyzeDay([irMg("a", "08:00", 100), irMg("b", "14:00", 100)]));
  const current = analyzeDay([irMg("a", "07:00", 100), irMg("c", "08:30", 100), irMg("b", "14:00", 100)]);
  const compare = compareModel(current, pinned);
  assert.equal(compare.beforeWas.get(1), "(new)", "07:00 loses 08:00 to the closer 08:30");
  assert.equal(compare.beforeWas.get(2), `(was ${r(pinned.before[0].level)})`);
  assert.equal(compare.beforeWas.get(3), `(was ${r(pinned.before[1].level)})`);

  const far = compareModel(analyzeDay([irMg("a", "09:31", 100)]), pinSnapshot(analyzeDay([irMg("a", "08:00", 100)])));
  assert.equal(far.beforeWas.get(1), "(new)", "91 min is too far");
  assert.deepEqual(far.unmatched.map(item => item.label), ["08:00"]);
  assert.equal(far.wasNote, false);

  const acrossMidnight = compareModel(analyzeDay([irMg("a", "00:30", 100)]), pinSnapshot(analyzeDay([irMg("a", "23:30", 100)])));
  assert.match(acrossMidnight.beforeWas.get(1), /^\(was \d+\)$/);
  assert.equal(acrossMidnight.wasNote, true);
});

test("compare totals: same mg with a different LEDD says so", () => {
  const pinned = pinSnapshot(analyzeDay([ir("a", "08:00", 2)]));
  const current = analyzeDay([{ id: "a", time: "08:00", drug: "sinemetcr", strength: "50/200", count: 1, dose: 200 }]);
  assert.ok(compareModel(current, pinned).sentence.endsWith("Daily levodopa is the same (200 mg; LEDD 200 → 150)."));
});

/* ---------- Hour-by-hour ---------- */

test("hourlyRows: 24 rows, the level at each hour and the doses taken in it", () => {
  const analysis = analyzeDay([...TEST_REGIMEN, ir("x", "06:30", 1)]);
  const rows = hourlyRows(analysis);
  assert.equal(rows.length, 24);
  assert.deepEqual(rows.map(row => row.time), Array.from({ length: 24 }, (_, hour) => formatClock(hour * 60)));
  rows.forEach((row, hour) => assert.equal(row.level, r(analysis.computed.total[hour * 60])));
  assert.equal(rows[6].doses, "06:00 Sinemet IR 150 mg, 06:30 Sinemet IR 100 mg");
  assert.equal(rows[21].doses, "21:00 Rytary 490 mg");
  assert.equal(rows[7].doses, "");
  assert.ok(rows.every(row => row.compared === ""));
});

test("hourlyRows: 'Compared with your lines' when lines are set", () => {
  const lines = { target: 100, high: 180 };
  const analysis = analyzeDay(TEST_REGIMEN, lines);
  const rows = hourlyRows(analysis);
  rows.forEach((row, hour) => {
    const value = analysis.computed.total[hour * 60];
    const expected = value >= 180 ? "at or above high" : value < 100 ? "below target" : "at or above target";
    assert.equal(row.compared, expected, row.time);
  });
  assert.ok(rows.some(row => row.compared === "below target"));
  assert.ok(rows.some(row => row.compared === "at or above target"));
});

/* ---------- Text alternative and status ---------- */

test("chartDesc is the headline plus the levels before each dose", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const levels = analysis.before.map(row => `${row.label} ${r(row.level)}`).join(", ");
  assert.equal(chartDesc(analysis), `${headlineSentences(analysis).join(" ")} Levels before each dose: ${levels}.`);
  assert.ok(chartDesc(analysis).includes("Levels before each dose: 06:00 "));
});

test("statusMessage summarizes the day (SPEC 4.9)", () => {
  const analysis = analyzeDay(TEST_REGIMEN);
  const { stats } = analysis;
  assert.equal(statusMessage(analysis, 6),
    `Updated. 6 doses, 1,240 mg levodopa = 995 mg LEDD a day. Daytime low ${r(stats.lowestBefore.level)} at `
    + `${formatClock(stats.lowestBefore.minute)}. Highest ${r(stats.max)} at ${formatClock(stats.maxMinute)}.`);
  assert.match(statusMessage(analysis, 7), /^Updated\. 7 doses, /, "the count includes doses without an amount");
});

/* ---------- Dose time sheet rows ---------- */

test("buildSheetRows: the test regimen gives two named rows with their hours", () => {
  assert.deepEqual(buildSheetRows(TEST_REGIMEN), {
    rows: [
      { name: "Sinemet IR 25/100 · 1½ tablets", hours: [6, 9, 12, 15, 18] },
      { name: "Rytary 61.25/245 · 2 capsules", hours: [21] }
    ],
    notes: []
  });
});

test("buildSheetRows: names for every form", () => {
  const { rows } = buildSheetRows([
    { id: "a", time: "07:00", drug: "inbrija", strength: "42", count: 2, dose: 84 },
    irMg("b", "08:00", 150),
    ir("c", "09:00", 1),
    ir("d", "10:00", 0.5),
    { id: "e", time: "11:00", drug: "crexont", strength: "52.5/210", count: 1, dose: 210 },
    // A count that no longer matches the mg: the mg is the truth.
    { id: "f", time: "12:00", drug: "sinemetcr", strength: "50/200", count: 1, dose: 300 }
  ]);
  assert.deepEqual(rows.map(row => row.name), [
    "Inbrija 42 mg · 2 capsules (inhaled)",
    "Sinemet IR · 150 mg levodopa",
    "Sinemet IR 25/100 · 1 tablet",
    "Sinemet IR 25/100 · ½ tablet",
    "Crexont 52.5/210 · 1 capsule",
    "Sinemet CR · 300 mg levodopa"
  ]);
});

test("buildSheetRows: groups by medicine, strength and count (or mg), ordered by first time", () => {
  const { rows } = buildSheetRows([
    ir("a", "13:00", 1),
    ir("b", "05:00", 1),
    ir("c", "09:00", 1.5),
    ir("d", "07:00", 1, "10/100"),
    irMg("e", "20:00", 150),
    irMg("f", "08:00", 150),
    ir("g", "13:00", 1)
  ]);
  assert.deepEqual(rows, [
    { name: "Sinemet IR 25/100 · 1 tablet", hours: [5, 13] },
    { name: "Sinemet IR 10/100 · 1 tablet", hours: [7] },
    { name: "Sinemet IR · 150 mg levodopa", hours: [8, 20] },
    { name: "Sinemet IR 25/100 · 1½ tablets", hours: [9] }
  ]);
});

test("buildSheetRows: times off the hour go in the name only within 60 characters", () => {
  const { rows } = buildSheetRows([
    ir("a", "06:30"), ir("b", "18:30"), ir("c", "12:00"), ir("d", "06:45"),
    ...["06:30", "09:30", "12:30", "15:30"].map((time, index) => ({ id: `r${index}`, time, drug: "rytary", strength: "61.25/245", count: 2, dose: 490 })),
    ...["07:10", "11:10", "15:10"].map((time, index) => ({ id: `n${index}`, time, drug: "inbrija", strength: "42", count: 2, dose: 84 }))
  ]);
  assert.deepEqual(rows, [
    { name: "Sinemet IR 25/100 · 1½ tablets (at 06:30, 06:45, 18:30)", hours: [6, 12, 18] },
    { name: "Rytary 61.25/245 · 2 capsules (times not on the hour)", hours: [6, 9, 12, 15] },
    { name: "Inbrija 42 mg · 2 capsules (inhaled) (times not on the hour)", hours: [7, 11, 15] }
  ]);
  assert.ok(rows.every(row => row.name.length <= 60));
});

test("buildSheetRows: at most 12 rows, and doses without an amount are left off", () => {
  const doses = [];
  for (let index = 0; index < 13; index += 1) doses.push(ir(`i${index}`, formatClock(index * 60), (index + 1) / 2));
  const capped = buildSheetRows(doses);
  assert.equal(capped.rows.length, 12);
  assert.equal(capped.rows[0].name, "Sinemet IR 25/100 · ½ tablet");
  assert.deepEqual(capped.rows.map(row => row.hours[0]), Array.from({ length: 12 }, (_, hour) => hour));
  assert.deepEqual(capped.notes, ["The time sheet holds 12 medicines. The first 12 were sent."]);

  const one = buildSheetRows([...TEST_REGIMEN, irMg("m", "22:00", null)]);
  assert.equal(one.rows.length, 2);
  assert.deepEqual(one.notes, ["1 dose without an amount was left off."]);
  const two = buildSheetRows([irMg("m", "22:00", null), irMg("n", "23:00", null)]);
  assert.deepEqual(two, { rows: [], notes: ["2 doses without an amount were left off."] });

  for (const row of buildSheetRows(EXAMPLE).rows) {
    assert.ok(row.name.length >= 1 && row.name.length <= 60);
    assert.ok(row.hours.every(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23));
    assert.equal(new Set(row.hours).size, row.hours.length);
  }
});
