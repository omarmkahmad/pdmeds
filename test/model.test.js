import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import { DRUGS, DRUG_BY_ID, LD_AUC, MODEL_VERSION, REGIMEN_SCHEMA_VERSION } from "../src/drugs.js";
import { dailyTotals, largeDoseNote } from "../src/amounts.js";
import {
  MAX_DOSES,
  ModelValidationError,
  calculateLedSummary,
  calculateStatistics,
  computeDay,
  contributionAtMinute,
  exportRegimen,
  longestCircularRun,
  modeledInfiniteAuc,
  normalizedComponentPeaks,
  validateRegimenPayload,
  validateThresholds
} from "../src/model.js";

const NOT_A_SCHEDULE = "This isn't a schedule file.";
const NEWER_VERSION = "This file was made by a newer version of the Explorer. Reload the page and try again.";
const DAYS_NOTE = "The old \"days\" setting is no longer used.";

const baseState = {
  doses: [{ time: "08:00", drug: "sinemet", dose: 100 }],
  onThreshold: null,
  dyskinesiaThreshold: null
};

function fixtureText(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

function fixture(name) {
  return JSON.parse(fixtureText(name));
}

// The messages a rejected import carries (fails if it does not throw).
function importErrors(payload) {
  try {
    validateRegimenPayload(payload);
  } catch (error) {
    assert.ok(error instanceof ModelValidationError, `expected ModelValidationError, got ${error}`);
    assert.ok(Array.isArray(error.messages));
    return error.messages;
  }
  assert.fail("expected the import to be rejected");
}

function oneDose(fields) {
  return { schemaVersion: 2, doses: [{ time: "08:00", drug: "sinemet", ...fields }] };
}

function amountOf(dose) {
  return { strength: dose.strength, count: dose.count, dose: dose.dose };
}

/* ---------- Drugs, LEDD and the steady state ---------- */

test("only the five levodopa preparations are modeled", () => {
  assert.deepEqual(DRUGS.map(drug => drug.id).sort(), ["crexont", "inbrija", "rytary", "sinemet", "sinemetcr"]);
  assert.ok(DRUGS.every(drug => drug.isLevodopa && drug.exposure.kind === "components"));
});

test("component curves are normalized to their declared exposure area", () => {
  for (const drug of DRUGS) {
    const targetLed = 100 * drug.exposure.exposureFactor;
    const auc = modeledInfiniteAuc(drug, targetLed);
    assert.ok(Math.abs(auc - targetLed * LD_AUC) < 1e-8, drug.id);
  }
});

test("Jost conversion factors are represented", () => {
  assert.equal(DRUG_BY_ID.sinemet.led.value, 1);
  assert.equal(DRUG_BY_ID.sinemetcr.led.value, 0.75);
  assert.equal(DRUG_BY_ID.rytary.led.value, 0.5);
  assert.equal(DRUG_BY_ID.crexont.led.value, 0.5);
  assert.equal(DRUG_BY_ID.inbrija.led.value, 0.69);
});

test("LEDD sums dose x factor across rows", () => {
  const summary = calculateLedSummary([
    { time: "08:00", drug: "sinemet", dose: 150 },
    { time: "21:00", drug: "sinemetcr", dose: 200 },
    { time: "12:00", drug: "inbrija", dose: 84 }
  ]);
  assert.equal(summary.rows[0].totalLed, 150);
  assert.equal(summary.rows[1].totalLed, 150);
  assert.ok(Math.abs(summary.rows[2].totalLed - 57.96) < 1e-9);
  assert.ok(Math.abs(summary.totalLed - 357.96) < 1e-9);
});

test("doses without an amount add nothing to LEDD", () => {
  const summary = calculateLedSummary([
    { time: "08:00", drug: "sinemet", dose: 150 },
    { time: "12:00", drug: "sinemet", dose: null },
    { time: "16:00", drug: "rytary", dose: 0 },
    { time: "20:00", drug: "rytary" }
  ]);
  assert.deepEqual(summary.rows.map(row => row.totalLed), [150, 0, 0, 0]);
  assert.equal(summary.totalLed, 150);
});

test("a repeating daily schedule joins up with itself at midnight", () => {
  // The closed-form tail for doses two or more days back assumes every
  // component peaks within a day.
  assert.ok(DRUGS.every(drug => drug.exposure.values.every(component => component.peakTime < 1440)));
  for (const drug of DRUGS) {
    for (const time of ["00:00", "07:00", "21:00", "23:30"]) {
      const { total, maximum } = computeDay({ ...baseState, doses: [{ time, drug: drug.id, dose: 100 }] });
      assert.ok(Math.abs(total[0] - total[1440]) <= 1e-9 * maximum, `${drug.id} at ${time}`);
    }
  }
});

test("the closed-form steady state matches summing 30 days of doses", () => {
  const bruteForce = (dose, drug, minute) => {
    const peaks = normalizedComponentPeaks(drug, dose.dose * drug.exposure.exposureFactor);
    const [hours, minutes] = dose.time.split(":").map(Number);
    let level = 0;
    for (let day = 0; day < 30; day += 1) {
      const elapsed = minute - (hours * 60 + minutes) + 1440 * day;
      if (elapsed < 0) continue;
      drug.exposure.values.forEach((component, index) => {
        level += elapsed <= component.peakTime
          ? peaks[index] * elapsed / component.peakTime
          : peaks[index] * Math.pow(0.5, (elapsed - component.peakTime) / component.halfLife);
      });
    }
    return level;
  };
  for (const drug of DRUGS) {
    for (const time of ["00:00", "06:30", "21:00", "23:59"]) {
      const dose = { time, drug: drug.id, dose: 100 };
      for (const minute of [0, 1, 359, 720, 1260, 1439]) {
        const expected = bruteForce(dose, drug, minute);
        assert.ok(Math.abs(contributionAtMinute(dose, drug, minute) - expected) <= 1e-9 * Math.max(1, expected), `${drug.id} ${time} minute ${minute}`);
      }
    }
  }
});

test("bedtime doses carry into the next morning", () => {
  const { total } = computeDay({ ...baseState, doses: [{ time: "22:00", drug: "rytary", dose: 245 }] });
  assert.ok(total[6 * 60] > 0);
});

test("longest low interval joins runs across midnight", () => {
  assert.equal(longestCircularRun([true, true, false, false, true], Boolean), 3);
  assert.equal(longestCircularRun([true, true, true], Boolean), 3);
});

test("empty and example day computations remain finite", () => {
  const empty = computeDay({ ...baseState, doses: [] });
  assert.equal(empty.minimum, 0);
  assert.equal(empty.maximum, 0);

  const computed = computeDay(baseState);
  assert.ok(computed.maximum > 0);
  assert.ok(Array.from(computed.total).every(Number.isFinite));
  const stats = calculateStatistics(computed, { ...baseState, onThreshold: 50, dyskinesiaThreshold: 120 });
  assert.ok(Number.isFinite(stats.ledd));
  assert.ok(stats.longestLowMinutes >= 0 && stats.longestLowMinutes <= 1440);
});

/* ---------- computeDay: every dose counts, missing amounts are skipped ---------- */

test("computeDay counts every dose: a leftover hidden flag changes nothing", () => {
  const doses = [
    { time: "07:00", drug: "sinemet", dose: 100 },
    { time: "13:00", drug: "rytary", dose: 245 },
    { time: "21:00", drug: "sinemetcr", dose: 200 }
  ];
  const plain = computeDay({ doses });
  const flagged = computeDay({ doses: doses.map(dose => ({ ...dose, hidden: true })) });
  assert.deepEqual(Array.from(flagged.total), Array.from(plain.total));
  assert.equal(flagged.maximum, plain.maximum);
  assert.equal(flagged.minimum, plain.minimum);
  assert.equal(flagged.led.totalLed, plain.led.totalLed);
  for (const minute of [0, 420, 800, 1439, 1440]) {
    const sum = plain.series.reduce((total, series) => total + series[minute], 0);
    assert.ok(Math.abs(plain.total[minute] - sum) < 1e-9, `minute ${minute}`);
  }
});

test("computeDay skips doses without an amount and keeps series aligned to the input", () => {
  const counted = { time: "08:00", drug: "sinemet", dose: 150 };
  const alone = computeDay({ doses: [counted] });
  const doses = [
    { time: "06:00", drug: "rytary", dose: null },
    counted,
    { time: "12:00", drug: "sinemet", dose: 0 },
    { time: "18:00", drug: "sinemetcr" },
    { time: "20:00", drug: "crexont", dose: Number.NaN },
    // Not a number: LEDD ignores it, so the chart must too.
    { time: "22:00", drug: "sinemet", dose: "150" }
  ];
  const computed = computeDay({ doses });
  assert.equal(computed.series.length, doses.length);
  for (const index of [0, 2, 3, 4, 5]) {
    assert.equal(computed.series[index].length, 1441);
    assert.ok(computed.series[index].every(value => value === 0), `dose ${index} should be all zero`);
  }
  assert.deepEqual(Array.from(computed.series[1]), Array.from(alone.series[0]));
  assert.deepEqual(Array.from(computed.total), Array.from(alone.total));
  assert.equal(computed.maximumMinute, alone.maximumMinute);
  assert.equal(computed.led.totalLed, 150);
});

test("computeDay with only missing amounts is an all-zero day", () => {
  const computed = computeDay({ doses: [{ time: "08:00", drug: "sinemet", dose: null }] });
  assert.ok(computed.total.every(value => value === 0));
  assert.equal(computed.maximum, 0);
  assert.equal(computed.minimum, 0);
  assert.equal(computed.led.totalLed, 0);
});

test("computeDay rejects more than 64 doses", () => {
  const doses = Array.from({ length: MAX_DOSES + 1 }, () => ({ time: "08:00", drug: "sinemet", dose: 100 }));
  assert.throws(() => computeDay({ doses }), ModelValidationError);
  assert.doesNotThrow(() => computeDay({ doses: doses.slice(0, MAX_DOSES) }));
});

/* ---------- Thresholds ---------- */

test("threshold validation: each line is optional, 0 is not set, and ordering is not an error", () => {
  assert.deepEqual(validateThresholds(null, null), { onThreshold: null, dyskinesiaThreshold: null, errors: [] });
  assert.deepEqual(validateThresholds(50, 120), { onThreshold: 50, dyskinesiaThreshold: 120, errors: [] });
  // A high line without a target, at the target, or below it is a UI note now.
  assert.deepEqual(validateThresholds(null, 120), { onThreshold: null, dyskinesiaThreshold: 120, errors: [] });
  assert.deepEqual(validateThresholds(120, 100), { onThreshold: 120, dyskinesiaThreshold: 100, errors: [] });
  assert.deepEqual(validateThresholds(80, 80), { onThreshold: 80, dyskinesiaThreshold: 80, errors: [] });
  assert.deepEqual(validateThresholds(0, 0), { onThreshold: null, dyskinesiaThreshold: null, errors: [] });
  assert.deepEqual(validateThresholds("", undefined), { onThreshold: null, dyskinesiaThreshold: null, errors: [] });
  assert.deepEqual(validateThresholds("50", "20000"), { onThreshold: 50, dyskinesiaThreshold: 20000, errors: [] });
  assert.deepEqual(validateThresholds(0.5, 12.5), { onThreshold: 0.5, dyskinesiaThreshold: 12.5, errors: [] });
});

test("threshold validation rejects values outside 0 to 20,000", () => {
  const target = "The target line must be a level from 0 to 20,000.";
  const high = "The high line must be a level from 0 to 20,000.";
  for (const bad of [-1, 20000.5, 1e9, "abc", Number.NaN, Number.POSITIVE_INFINITY, true, {}, [50]]) {
    assert.deepEqual(validateThresholds(bad, null).errors, [target], String(bad));
    assert.deepEqual(validateThresholds(null, bad).errors, [high], String(bad));
  }
  assert.deepEqual(validateThresholds(-5, 30000), { onThreshold: null, dyskinesiaThreshold: null, errors: [target, high] });
});

/* ---------- Import: file shape and version ---------- */

test("anything that is not a schedule object is rejected with one plain message", () => {
  for (const payload of [null, undefined, 42, "text", true, [], [{ time: "08:00" }]]) {
    assert.deepEqual(importErrors(payload), [NOT_A_SCHEDULE], JSON.stringify(payload));
  }
  for (const payload of [{}, { doses: "x" }, { doses: {} }, { doses: null }, { schemaVersion: 2, dose: [] }]) {
    assert.deepEqual(importErrors(payload), [NOT_A_SCHEDULE], JSON.stringify(payload));
  }
});

test("files with no schemaVersion, version 1 and version 2 import", () => {
  const doses = [{ time: "08:00", drug: "sinemet", dose: 100 }];
  for (const schemaVersion of [undefined, null, 1, 2, "1", "2"]) {
    const imported = validateRegimenPayload({ schemaVersion, doses });
    assert.equal(imported.doses.length, 1, String(schemaVersion));
  }
  assert.equal(REGIMEN_SCHEMA_VERSION, 2);
});

test("a schemaVersion above 2 gets the newer-version error and nothing else", () => {
  for (const schemaVersion of [3, 4, 99, 2.5, "3"]) {
    assert.deepEqual(importErrors({ schemaVersion, doses: [] }), [NEWER_VERSION], String(schemaVersion));
  }
  // The version is checked before the rest of the file, whose shape may have changed.
  assert.deepEqual(importErrors({ schemaVersion: 3 }), [NEWER_VERSION]);
  assert.deepEqual(importErrors({ schemaVersion: 3, doses: [{ time: "99:99", drug: "levodopa-x" }] }), [NEWER_VERSION]);
});

test("an unreadable schemaVersion is not a schedule file", () => {
  for (const schemaVersion of [0, -1, 1.5, "abc", "", true, {}, [2]]) {
    assert.deepEqual(importErrors({ schemaVersion, doses: [] }), [NOT_A_SCHEDULE], JSON.stringify(schemaVersion));
  }
});

test("more than 64 doses is an error; exactly 64 imports", () => {
  const dose = { time: "08:00", drug: "sinemet", dose: 100 };
  assert.deepEqual(importErrors({ doses: Array.from({ length: MAX_DOSES + 1 }, () => dose) }), [
    "This file has 65 doses. 64 doses is the limit."
  ]);
  assert.deepEqual(importErrors({ doses: Array.from({ length: 1200 }, () => dose) }), [
    "This file has 1,200 doses. 64 doses is the limit."
  ]);
  assert.equal(validateRegimenPayload({ doses: Array.from({ length: MAX_DOSES }, () => dose) }).doses.length, MAX_DOSES);
});

test("an empty dose list imports as an empty schedule", () => {
  assert.deepEqual(validateRegimenPayload({ schemaVersion: 2, doses: [] }), {
    doses: [], onThreshold: null, dyskinesiaThreshold: null, example: false, notes: []
  });
});

/* ---------- Import: errors name doses by time ---------- */

test("validation errors name doses by time, never by row", () => {
  assert.deepEqual(importErrors({ doses: [{ time: "25:00", drug: "sinemet", dose: 100 }] }), [
    "The 25:00 dose has a time that can't be read."
  ]);
  assert.deepEqual(importErrors({ doses: [{ time: "08:00", drug: "levodopa-x", dose: 100 }] }), [
    "The 08:00 dose has an unknown medicine."
  ]);
  assert.deepEqual(importErrors({ doses: [{ time: "08:00", drug: "sinemet", dose: "abc" }] }), [
    "The 08:00 dose has an amount that can't be read."
  ]);
  assert.deepEqual(importErrors({ doses: [{ time: "08:00", drug: "sinemet", dose: 20001 }] }), [
    "The 08:00 dose has an amount outside 0 to 20,000 mg."
  ]);
  assert.deepEqual(importErrors({ doses: [{ time: "08:00", drug: "sinemet", dose: -5 }] }), [
    "The 08:00 dose has an amount outside 0 to 20,000 mg."
  ]);
});

test("every error is listed, in dose order, and identical ones are not repeated", () => {
  const messages = importErrors({
    onThreshold: -1,
    doses: [
      { time: "07:00", drug: "sinemet", dose: 100 },
      { time: "25:00", drug: "stalevo", dose: 100 },
      { time: "12:00", drug: "sinemet", dose: Number.POSITIVE_INFINITY },
      { time: "6:30", drug: "rytary", dose: 245 },
      { drug: "madopar", dose: 100 },
      { drug: "madopar", dose: 100 },
      "08:00 sinemet 100",
      { time: "", drug: "sinemet", dose: 100 },
      { time: "x".repeat(40), drug: "sinemet", dose: 100 },
      { time: 800, drug: "sinemet", dose: 100 },
      { time: "09:00", drug: "sinemet", dose: 100, strength: "25/100", count: 99 }
    ]
  });
  assert.deepEqual(messages, [
    "The 25:00 dose has a time that can't be read.",
    "The 25:00 dose has an unknown medicine.",
    "The 12:00 dose has an amount that can't be read.",
    "The 6:30 dose has a time that can't be read.",
    "The 08:00 dose has an unknown medicine.",
    "A dose in this file can't be read.",
    "A dose has a time that can't be read.",
    "The 800 dose has a time that can't be read.",
    "The target line must be a level from 0 to 20,000."
  ]);
  assert.ok(messages.every(message => !/\brow\b/i.test(message)));
});

test("prototype-key drug ids are rejected as unknown medicines", () => {
  for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.deepEqual(importErrors({
      doses: [{ time: "08:00", drug: bad, dose: 100 }]
    }), ["The 08:00 dose has an unknown medicine."], bad);
  }
  for (const bad of [null, 1, { toString: () => "sinemet" }, ["sinemet"]]) {
    assert.deepEqual(importErrors({
      doses: [{ time: "08:00", drug: bad, dose: 100 }]
    }), ["The 08:00 dose has an unknown medicine."], String(bad));
  }
});

test("removed drug ids are rejected as unknown medicines", () => {
  for (const removed of ["madopar", "stalevo", "duopa", "vyalev", "onapgo", "rotig", "rasag", "amant", "istrad"]) {
    assert.deepEqual(importErrors({
      doses: [{ time: "08:00", drug: removed, dose: 100 }]
    }), ["The 08:00 dose has an unknown medicine."], removed);
  }
});

test("invalid and non-finite imported values are rejected", () => {
  for (const dose of [Number.POSITIVE_INFINITY, Number.NaN, "12abc", true, {}, [100]]) {
    assert.deepEqual(importErrors(oneDose({ dose })), ["The 08:00 dose has an amount that can't be read."], String(dose));
  }
  for (const time of ["25:99", "24:00", "8:00", "08:60", "0800", "08:00:00", " 08:00"]) {
    assert.deepEqual(importErrors({ doses: [{ time, drug: "sinemet", dose: 100 }] }), [
      `The ${time.trim()} dose has a time that can't be read.`
    ], time);
  }
});

/* ---------- Import: amounts ---------- */

test("a dose of 0 imports as missing, never 0, with a note", () => {
  const imported = validateRegimenPayload(oneDose({ dose: 0, strength: "25/100", count: 1 }));
  assert.deepEqual(amountOf(imported.doses[0]), { strength: null, count: null, dose: null });
  assert.deepEqual(imported.notes, ["1 dose had no amount. Add one to count it."]);
});

test("blank, null and absent amounts also import as missing", () => {
  const imported = validateRegimenPayload({
    doses: [
      { time: "06:00", drug: "sinemet", dose: null },
      { time: "07:00", drug: "rytary", dose: "" },
      { time: "08:00", drug: "inbrija" },
      { time: "09:00", drug: "crexont", dose: "  " },
      { time: "10:00", drug: "sinemet", dose: 100 }
    ]
  });
  assert.deepEqual(imported.doses.map(dose => dose.dose), [null, null, null, null, 100]);
  assert.ok(imported.doses.slice(0, 4).every(dose => dose.strength === null && dose.count === null));
  // The API.md template: only "dose" takes a plural (SPEC 5.7 gives only the singular).
  assert.deepEqual(imported.notes, ["4 doses had no amount. Add one to count it."]);
});

test("amounts up to 20,000 mg import; over 2,000 mg keeps the large-dose soft note", () => {
  const imported = validateRegimenPayload({
    doses: [
      { time: "08:00", drug: "sinemet", dose: 2500 },
      { time: "12:00", drug: "sinemet", dose: 20000 },
      { time: "16:00", drug: "sinemet", dose: "150" },
      { time: "20:00", drug: "sinemet", dose: 0.5 }
    ]
  });
  assert.deepEqual(imported.doses.map(dose => dose.dose), [2500, 20000, 150, 0.5]);
  // No strength fits 2,500 mg within 8 tablets, so it opens in mg mode.
  assert.deepEqual(amountOf(imported.doses[0]), { strength: null, count: null, dose: 2500 });
  assert.equal(largeDoseNote("sinemet", imported.doses[0].dose), "That is a large single dose for Sinemet IR (over 400 mg). Check it.");
  assert.deepEqual(amountOf(imported.doses[2]), { strength: "25/100", count: 1.5, dose: 150 });
  assert.deepEqual(imported.notes, []);
});

test("strength inference on import follows the SPEC 3.4 table", () => {
  const cases = [
    ["sinemet", 150, "25/100", 1.5],
    ["sinemet", 200, "25/100", 2],
    ["sinemet", 250, "25/250", 1],
    ["sinemetcr", 100, "25/100", 1],
    ["sinemetcr", 200, "50/200", 1],
    ["rytary", 490, "61.25/245", 2],
    ["crexont", 420, "52.5/210", 2],
    ["inbrija", 84, "42", 2],
    ["rytary", 150, null, null]
  ];
  for (const [drug, dose, strength, count] of cases) {
    const imported = validateRegimenPayload({ doses: [{ time: "08:00", drug, dose }] });
    assert.deepEqual(amountOf(imported.doses[0]), { strength, count, dose }, `${drug} ${dose}`);
  }
});

test("a valid, matching strength and count are kept even when inference would pick another", () => {
  const cases = [
    [{ drug: "sinemet", dose: 200, strength: "10/100", count: 2 }, "10/100", 2],
    [{ drug: "sinemetcr", dose: 100, strength: "50/200", count: 0.5 }, "50/200", 0.5],
    [{ drug: "sinemet", dose: 125, strength: "25/250", count: 0.5 }, "25/250", 0.5],
    [{ drug: "inbrija", dose: 42, strength: "42", count: 1 }, "42", 1],
    // The Inbrija label is accepted and stored as the strength id.
    [{ drug: "inbrija", dose: 84, strength: "42 mg", count: 2 }, "42", 2],
    [{ drug: "rytary", dose: 190, strength: "23.75/95", count: 2 }, "23.75/95", 2]
  ];
  for (const [fields, strength, count] of cases) {
    const imported = validateRegimenPayload(oneDose(fields));
    assert.deepEqual(amountOf(imported.doses[0]), { strength, count, dose: fields.dose }, JSON.stringify(fields));
  }
});

test("a strength or count that is invalid or does not match the dose is worked out again", () => {
  const cases = [
    // [file fields, expected strength, expected count]
    [{ drug: "sinemet", dose: 150, strength: "25/250", count: 1 }, "25/100", 1.5],
    [{ drug: "sinemet", dose: 150, strength: "25/100" }, "25/100", 1.5],
    [{ drug: "sinemet", dose: 150, count: 1.5 }, "25/100", 1.5],
    [{ drug: "sinemet", dose: 150, strength: "25/100", count: "1.5" }, "25/100", 1.5],
    [{ drug: "sinemet", dose: 25, strength: "25/100", count: 0.25 }, null, null],
    [{ drug: "sinemet", dose: 1000, strength: "25/100", count: 10 }, "25/250", 4],
    [{ drug: "crexont", dose: 420, strength: "61.25/245", count: 2 }, "52.5/210", 2],
    [{ drug: "crexont", dose: 420, strength: { id: "52.5/210" }, count: 2 }, "52.5/210", 2],
    [{ drug: "sinemetcr", dose: 150, strength: "25/100", count: 1.5 }, null, null],
    [{ drug: "rytary", dose: 150, strength: "61.25/245", count: 1 }, null, null],
    [{ drug: "inbrija", dose: 84, strength: "42", count: 1 }, "42", 2],
    [{ drug: "inbrija", dose: 126, strength: "42", count: 3 }, null, null]
  ];
  for (const [fields, strength, count] of cases) {
    const imported = validateRegimenPayload(oneDose(fields));
    assert.deepEqual(amountOf(imported.doses[0]), { strength, count, dose: fields.dose }, JSON.stringify(fields));
    assert.deepEqual(imported.notes, [], JSON.stringify(fields));
  }
  // In a v2 file, one field without the other is invalid too, not an mg-mode dose.
  for (const fields of [
    { drug: "sinemet", dose: 150, strength: null, count: 1.5 },
    { drug: "sinemet", dose: 150, strength: "25/100", count: null }
  ]) {
    const imported = validateRegimenPayload(oneDose(fields));
    assert.deepEqual(amountOf(imported.doses[0]), { strength: "25/100", count: 1.5, dose: 150 }, JSON.stringify(fields));
  }
});

test("a v2 dose saved without strength and count stays in mg mode even when a strength fits", () => {
  // Each of these has an exact strength match (SPEC 3.4 table).
  const cases = [
    ["sinemet", 150],
    ["sinemet", 200],
    ["sinemetcr", 100],
    ["sinemetcr", 200],
    ["rytary", 490],
    ["crexont", 420],
    ["inbrija", 84]
  ];
  for (const [drug, dose] of cases) {
    for (const schemaVersion of [2, "2"]) {
      for (const fields of [{ dose }, { dose, strength: null, count: null }]) {
        const imported = validateRegimenPayload({ schemaVersion, doses: [{ time: "15:00", drug, ...fields }] });
        assert.deepEqual(amountOf(imported.doses[0]), { strength: null, count: null, dose }, `${drug} ${dose} v${schemaVersion} ${JSON.stringify(fields)}`);
        assert.deepEqual(imported.notes, []);
      }
    }
    // Files from before schema 2 never saved a strength, so it is worked out.
    for (const schemaVersion of [undefined, null, 1, "1"]) {
      const imported = validateRegimenPayload({ schemaVersion, doses: [{ time: "15:00", drug, dose }] });
      assert.notEqual(imported.doses[0].strength, null, `${drug} ${dose} v${schemaVersion}`);
      assert.equal(imported.doses[0].dose, dose);
    }
  }
});

test("every v2 mg-mode dose from 1 to 2,000 mg survives a round trip", () => {
  const changed = [];
  for (const drug of DRUGS) {
    for (let dose = 1; dose <= 2000; dose += 0.5) {
      const file = { schemaVersion: 2, doses: [{ time: "15:00", drug: drug.id, dose }] };
      const exported = exportRegimen(validateRegimenPayload(file));
      if (!isDeepStrictEqual(exported.doses, file.doses)) changed.push(`${drug.id} ${dose}`);
    }
  }
  assert.deepEqual(changed, []);
});

test("a count a hair off its step is snapped to the step on import", () => {
  const cases = [
    [{ drug: "sinemet", dose: 150, strength: "25/100", count: 1.4999999999 }, "25/100", 1.5],
    [{ drug: "sinemet", dose: 150, strength: "25/100", count: 1.5000000001 }, "25/100", 1.5],
    [{ drug: "sinemet", dose: 50, strength: "25/100", count: 0.49999999999 }, "25/100", 0.5],
    [{ drug: "rytary", dose: 490, strength: "61.25/245", count: 2.0000000001 }, "61.25/245", 2],
    [{ drug: "sinemetcr", dose: 100, strength: "25/100", count: 0.9999999999 }, "25/100", 1]
  ];
  for (const [fields, strength, count] of cases) {
    const imported = validateRegimenPayload(oneDose(fields));
    assert.deepEqual(amountOf(imported.doses[0]), { strength, count, dose: fields.dose }, JSON.stringify(fields));
    // So the next saved file is clean too.
    assert.equal(exportRegimen(imported).doses[0].count, count, JSON.stringify(fields));
  }
});

/* ---------- Import: legacy fields, notes, ids ---------- */

test("legacy aliases t, onThr and dysThr are kept; the modern names win when both exist", () => {
  const imported = validateRegimenPayload({
    doses: [{ t: "07:30", drug: "sinemet", dose: 100, dur: 960 }],
    onThr: 50,
    dysThr: 120,
    comt: "ent"
  });
  assert.equal(imported.doses[0].time, "07:30");
  assert.equal(imported.doses[0].duration, undefined);
  assert.equal(imported.onThreshold, 50);
  assert.equal(imported.dyskinesiaThreshold, 120);
  assert.equal("comt" in imported, false);

  const both = validateRegimenPayload({
    doses: [{ time: "09:00", t: "07:30", drug: "sinemet", dose: 100 }],
    onThreshold: 70, onThr: 50, dyskinesiaThreshold: 150, dysThr: 120
  });
  assert.equal(both.doses[0].time, "09:00");
  assert.equal(both.onThreshold, 70);
  assert.equal(both.dyskinesiaThreshold, 150);
});

test("a missing time defaults to 08:00", () => {
  const imported = validateRegimenPayload({ doses: [{ drug: "sinemet", dose: 100 }, { time: null, t: null, drug: "sinemet", dose: 100 }] });
  assert.deepEqual(imported.doses.map(dose => dose.time), ["08:00", "08:00"]);
});

test("the retired days setting is ignored with a note and left out of exports", () => {
  for (const days of [1, 7, 0, "abc", false]) {
    const imported = validateRegimenPayload({ doses: [{ time: "21:00", drug: "rytary", dose: 245 }], days });
    assert.equal("days" in imported, false, String(days));
    assert.deepEqual(imported.notes, [DAYS_NOTE], String(days));
  }
  for (const days of [null, undefined]) {
    assert.deepEqual(validateRegimenPayload({ doses: [], days }).notes, [], String(days));
  }
  const exported = exportRegimen(validateRegimenPayload({ doses: [], days: 2 }));
  assert.equal("days" in exported, false);
});

test("hidden is ignored with a counted note, and every dose counts", () => {
  const one = validateRegimenPayload({
    doses: [
      { time: "08:00", drug: "sinemet", dose: 100, hidden: true },
      { time: "12:00", drug: "sinemet", dose: 100, hidden: false }
    ]
  });
  assert.deepEqual(one.notes, ["This file had 1 dose hidden from the total. All doses now count."]);
  assert.ok(one.doses.every(dose => !("hidden" in dose)));

  const three = validateRegimenPayload({
    doses: Array.from({ length: 3 }, (_, index) => ({ time: `0${index + 6}:00`, drug: "sinemet", dose: 100, hidden: true }))
  });
  assert.deepEqual(three.notes, ["This file had 3 doses hidden from the total. All doses now count."]);

  // The old app read hidden with Boolean(), so any truthy value hid the dose.
  for (const hidden of [true, 1, "true", "yes"]) {
    const imported = validateRegimenPayload({ doses: [{ time: "08:00", drug: "sinemet", dose: 100, hidden }] });
    assert.deepEqual(imported.notes, ["This file had 1 dose hidden from the total. All doses now count."], JSON.stringify(hidden));
  }
  for (const hidden of [false, 0, "", null, undefined]) {
    const imported = validateRegimenPayload({ doses: [{ time: "08:00", drug: "sinemet", dose: 100, hidden }] });
    assert.deepEqual(imported.notes, [], String(hidden));
  }
});

test("notes come in a fixed order: days, hidden, then missing amounts", () => {
  const imported = validateRegimenPayload({
    days: 2,
    doses: [
      { time: "08:00", drug: "sinemet", dose: 0, hidden: true },
      { time: "12:00", drug: "sinemet", dose: 0 }
    ]
  });
  assert.deepEqual(imported.notes, [
    DAYS_NOTE,
    "This file had 1 dose hidden from the total. All doses now count.",
    "2 doses had no amount. Add one to count it."
  ]);
});

test("imported doses get fresh ids and exactly the state fields", () => {
  const imported = validateRegimenPayload({
    doses: [
      { id: "d9", time: "08:00", drug: "sinemet", dose: 150, hidden: true, pin: true, color: "#000" },
      { id: "d9", time: "12:00", drug: "rytary", dose: 0 },
      { time: "16:00", drug: "inbrija", dose: 84 }
    ]
  });
  assert.deepEqual(imported.doses.map(dose => dose.id), ["d1", "d2", "d3"]);
  for (const dose of imported.doses) {
    assert.deepEqual(Object.keys(dose), ["id", "time", "drug", "strength", "count", "dose"]);
  }
});

test("example is true only for example: true", () => {
  assert.equal(validateRegimenPayload({ doses: [], example: true }).example, true);
  for (const example of [undefined, false, "true", 1, {}]) {
    assert.equal(validateRegimenPayload({ doses: [], example }).example, false, String(example));
  }
});

test("thresholds on import: 0 means not set, ordering is allowed, range is checked", () => {
  const read = (onThreshold, dyskinesiaThreshold) => {
    const { onThreshold: on, dyskinesiaThreshold: high } = validateRegimenPayload({ doses: [], onThreshold, dyskinesiaThreshold });
    return [on, high];
  };
  assert.deepEqual(read(0, 0), [null, null]);
  assert.deepEqual(read(null, 120), [null, 120]);
  assert.deepEqual(read(120, 100), [120, 100]);
  assert.deepEqual(read(100, 100), [100, 100]);
  assert.deepEqual(read(20000, 0), [20000, null]);
  assert.deepEqual(importErrors({ doses: [], onThreshold: 20001 }), ["The target line must be a level from 0 to 20,000."]);
  assert.deepEqual(importErrors({ doses: [], dysThr: "high" }), ["The high line must be a level from 0 to 20,000."]);
});

test("importing does not change the payload", () => {
  const payload = fixture("v1-legacy-fields.json");
  const copy = structuredClone(payload);
  validateRegimenPayload(payload);
  assert.deepEqual(payload, copy);
});

/* ---------- Regression fixtures (SPEC 10) ---------- */

test("fixture: v1 with days, hidden, t, onThr and dysThr imports with notes", () => {
  const imported = validateRegimenPayload(fixture("v1-legacy-fields.json"));
  assert.deepEqual(imported.doses, [
    { id: "d1", time: "07:30", drug: "sinemet", strength: "25/100", count: 1, dose: 100 },
    { id: "d2", time: "11:30", drug: "sinemet", strength: "25/100", count: 1, dose: 100 },
    { id: "d3", time: "15:30", drug: "sinemetcr", strength: "50/200", count: 1, dose: 200 },
    { id: "d4", time: "08:00", drug: "rytary", strength: "61.25/245", count: 1, dose: 245 }
  ]);
  // The high line sits below the target: allowed now (a UI note, not an error).
  assert.equal(imported.onThreshold, 50);
  assert.equal(imported.dyskinesiaThreshold, 45);
  assert.equal(imported.example, false);
  assert.deepEqual(imported.notes, [
    DAYS_NOTE,
    "This file had 2 doses hidden from the total. All doses now count."
  ]);
  // The formerly hidden doses now count in the total and in LEDD.
  const computed = computeDay(imported);
  const sum = computed.series.reduce((total, series) => total + series[900], 0);
  assert.ok(Math.abs(computed.total[900] - sum) < 1e-9);
  assert.ok(computed.series[1][900] > 0 && computed.series[2][900] > 0);
  assert.equal(computed.led.totalLed, 100 + 100 + 150 + 122.5);
});

test("fixture: file with no schemaVersion imports", () => {
  const imported = validateRegimenPayload(fixture("legacy-no-version.json"));
  assert.deepEqual(imported.doses.map(dose => [dose.time, dose.drug, dose.strength, dose.count, dose.dose]), [
    ["08:00", "sinemet", "25/100", 1, 100],
    ["20:00", "inbrija", "42", 2, 84]
  ]);
  assert.equal(imported.onThreshold, 40);
  assert.equal(imported.dyskinesiaThreshold, null);
  assert.deepEqual(imported.notes, [DAYS_NOTE]);
});

test("fixture: v1 with a 0 mg dose imports it as missing", () => {
  const imported = validateRegimenPayload(fixture("v1-zero-dose.json"));
  assert.deepEqual(imported.doses[1], { id: "d2", time: "13:00", drug: "sinemet", strength: null, count: null, dose: null });
  assert.equal(imported.onThreshold, null);
  assert.equal(imported.dyskinesiaThreshold, null);
  assert.deepEqual(imported.notes, ["1 dose had no amount. Add one to count it."]);
  // Left out of the chart and LEDD.
  const computed = computeDay(imported);
  assert.ok(computed.series[1].every(value => value === 0));
  assert.equal(computed.led.totalLed, 100 + 150);
  assert.deepEqual(dailyTotals(imported.doses), { mg: 300, led: 250 });
  // And left out of the saved file.
  assert.deepEqual(exportRegimen(imported).doses.map(dose => dose.time), ["07:00", "19:00"]);
});

test("fixture: v1 test regimen infers 25/100 × 1½ and 61.25/245 × 2", () => {
  const imported = validateRegimenPayload(fixture("v1-test-regimen.json"));
  assert.equal(imported.doses.length, 6);
  for (const dose of imported.doses.slice(0, 5)) {
    assert.deepEqual(amountOf(dose), { strength: "25/100", count: 1.5, dose: 150 }, dose.time);
  }
  assert.deepEqual(amountOf(imported.doses[5]), { strength: "61.25/245", count: 2, dose: 490 });
  assert.deepEqual(imported.notes, []);
  assert.deepEqual(dailyTotals(imported.doses), { mg: 1240, led: 995 });
  assert.equal(computeDay(imported).led.totalLed, 995);
});

test("fixture: a v2 file survives a round trip unchanged", () => {
  const text = fixtureText("v2-round-trip.json");
  const original = JSON.parse(text);
  const imported = validateRegimenPayload(original);
  assert.deepEqual(imported.notes, []);
  assert.equal(imported.onThreshold, 60);
  assert.equal(imported.dyskinesiaThreshold, 150);
  // The mg-mode doses stay in mg mode, even IR 150, which 25/100 × 1½ would
  // fit; the chosen strengths are kept.
  assert.deepEqual(amountOf(imported.doses[4]), { strength: null, count: null, dose: 150 });
  assert.deepEqual(amountOf(imported.doses[7]), { strength: null, count: null, dose: 150 });
  assert.equal(imported.doses[7].drug, "sinemet");
  assert.deepEqual(amountOf(imported.doses[1]), { strength: "10/100", count: 2, dose: 200 });

  const exported = exportRegimen({ ...imported, pinned: { total: [] }, example: true });
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.modelVersion, MODEL_VERSION);
  // Only the save time and the model that saved it may differ.
  const again = { ...exported, modelVersion: original.modelVersion, exportedAt: original.exportedAt };
  assert.equal(`${JSON.stringify(again, null, 2)}\n`, text);
  // And a second trip is stable too.
  const twice = exportRegimen(validateRegimenPayload(exported));
  assert.deepEqual({ ...twice, exportedAt: exported.exportedAt }, exported);
});

test("fixture: v2 with strengths that don't match their doses keeps the mg and works out the strength", () => {
  const imported = validateRegimenPayload(fixture("v2-strength-mismatch.json"));
  assert.deepEqual(imported.doses.map(amountOf), [
    { strength: "25/100", count: 1.5, dose: 150 },
    { strength: "52.5/210", count: 2, dose: 420 },
    { strength: null, count: null, dose: 150 },
    { strength: null, count: null, dose: 150 },
    { strength: "42", count: 2, dose: 84 }
  ]);
  assert.deepEqual(imported.notes, []);
});

test("fixture: schemaVersion 3 is rejected", () => {
  assert.deepEqual(importErrors(fixture("v3-newer.json")), [NEWER_VERSION]);
});

/* ---------- Export ---------- */

test("export writes schema 2 with the model version and a save time", () => {
  const exported = exportRegimen({ doses: [], onThreshold: null, dyskinesiaThreshold: null });
  assert.deepEqual(Object.keys(exported), ["schemaVersion", "modelVersion", "exportedAt", "doses", "onThreshold", "dyskinesiaThreshold"]);
  assert.equal(exported.schemaVersion, 2);
  assert.equal(exported.modelVersion, MODEL_VERSION);
  assert.match(exported.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(exported.doses, []);
});

test("export leaves out doses with no amount and writes strength and count only when set", () => {
  const exported = exportRegimen({
    doses: [
      { id: "d1", time: "06:00", drug: "sinemet", strength: "25/100", count: 1.5, dose: 150, hidden: true, pinned: true },
      { id: "d2", time: "09:00", drug: "sinemet", strength: null, count: null, dose: null },
      { id: "d3", time: "12:00", drug: "rytary", strength: null, count: null, dose: 150 },
      { id: "d4", time: "15:00", drug: "sinemet", strength: null, count: null, dose: 0 },
      { id: "d5", time: "18:00", drug: "crexont", strength: "52.5/210", count: null, dose: 420 },
      { id: "d6", time: "21:00", drug: "rytary", strength: "61.25/245", count: 2, dose: 490 },
      { id: "d7", time: "22:00", drug: "sinemet" }
    ],
    onThreshold: 0,
    dyskinesiaThreshold: 120,
    days: 2,
    example: true,
    pinned: { total: [1, 2] }
  });
  assert.deepEqual(exported.doses, [
    { time: "06:00", drug: "sinemet", dose: 150, strength: "25/100", count: 1.5 },
    { time: "12:00", drug: "rytary", dose: 150 },
    { time: "18:00", drug: "crexont", dose: 420 },
    { time: "21:00", drug: "rytary", dose: 490, strength: "61.25/245", count: 2 }
  ]);
  assert.deepEqual(Object.keys(exported.doses[0]), ["time", "drug", "dose", "strength", "count"]);
  assert.equal(exported.onThreshold, null);
  assert.equal(exported.dyskinesiaThreshold, 120);
  for (const key of ["days", "hidden", "example", "pinned", "pin", "notes"]) {
    assert.equal(key in exported, false, key);
  }
});

test("export writes a count only with its strength", () => {
  const exported = exportRegimen({
    doses: [
      { id: "d1", time: "06:00", drug: "sinemet", strength: null, count: 2, dose: 150 },
      { id: "d2", time: "09:00", drug: "sinemet", strength: "", count: 1.5, dose: 150 },
      { id: "d3", time: "12:00", drug: "rytary", count: 2, dose: 490 },
      { id: "d4", time: "15:00", drug: "sinemet", strength: "25/100", count: 0, dose: 150 }
    ],
    onThreshold: null,
    dyskinesiaThreshold: null
  });
  assert.deepEqual(exported.doses, [
    { time: "06:00", drug: "sinemet", dose: 150 },
    { time: "09:00", drug: "sinemet", dose: 150 },
    { time: "12:00", drug: "rytary", dose: 490 },
    { time: "15:00", drug: "sinemet", dose: 150 }
  ]);
  for (const dose of exported.doses) assert.deepEqual(Object.keys(dose), ["time", "drug", "dose"], dose.time);
});

test("export matches the SPEC 10 example shape", () => {
  const exported = exportRegimen({
    doses: [
      { id: "a", time: "06:00", drug: "sinemet", strength: "25/100", count: 1.5, dose: 150 },
      { id: "b", time: "21:00", drug: "rytary", strength: "61.25/245", count: 2, dose: 490 }
    ],
    onThreshold: null,
    dyskinesiaThreshold: null
  });
  assert.deepEqual({ ...exported, exportedAt: "2026-09-24T14:02:00.000Z", modelVersion: "3.1.0" }, {
    schemaVersion: 2, modelVersion: "3.1.0", exportedAt: "2026-09-24T14:02:00.000Z",
    doses: [
      { time: "06:00", drug: "sinemet", dose: 150, strength: "25/100", count: 1.5 },
      { time: "21:00", drug: "rytary", dose: 490, strength: "61.25/245", count: 2 }
    ],
    onThreshold: null,
    dyskinesiaThreshold: null
  });
});

test("an exported file imports back to the same schedule", () => {
  const state = {
    doses: [
      { id: "x1", time: "07:00", drug: "sinemet", strength: "25/100", count: 1, dose: 100 },
      { id: "x2", time: "11:00", drug: "sinemetcr", strength: "50/200", count: 1.5, dose: 300 },
      { id: "x3", time: "15:00", drug: "rytary", strength: null, count: null, dose: 300 },
      { id: "x4", time: "19:00", drug: "crexont", strength: "87.5/350", count: 1, dose: 350 },
      { id: "x5", time: "23:00", drug: "inbrija", strength: "42", count: 1, dose: 42 },
      // mg mode, though 25/100 × 1½ fits.
      { id: "x6", time: "23:30", drug: "sinemet", strength: null, count: null, dose: 150 }
    ],
    onThreshold: 40,
    dyskinesiaThreshold: 30
  };
  const imported = validateRegimenPayload(JSON.parse(JSON.stringify(exportRegimen(state))));
  assert.deepEqual(imported.doses.map(({ id, ...dose }) => dose), state.doses.map(({ id, ...dose }) => dose));
  assert.equal(imported.onThreshold, 40);
  assert.equal(imported.dyskinesiaThreshold, 30);
  assert.deepEqual(imported.notes, []);
});
