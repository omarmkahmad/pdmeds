import test from "node:test";
import assert from "node:assert/strict";

import { DRUGS, DRUG_BY_ID, LD_AUC } from "../src/drugs.js";
import {
  MAX_DOSES,
  ModelValidationError,
  calculateLedSummary,
  calculateStatistics,
  computeDay,
  longestCircularRun,
  modeledInfiniteAuc,
  validateRegimenPayload,
  validateThresholds
} from "../src/model.js";

const baseState = {
  doses: [{ time: "08:00", drug: "sinemet", dose: 100, hidden: false }],
  onThreshold: null,
  dyskinesiaThreshold: null,
  days: 2
};

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

test("prototype-key drug ids are rejected as unknown drugs", () => {
  for (const bad of ["__proto__", "constructor", "toString"]) {
    assert.throws(() => validateRegimenPayload({
      doses: [{ time: "08:00", drug: bad, dose: 100 }],
      days: 2
    }), /unknown drug/);
  }
});

test("removed drug ids are rejected as unknown drugs", () => {
  for (const removed of ["madopar", "stalevo", "duopa", "vyalev", "onapgo", "rotig", "rasag", "amant", "istrad"]) {
    assert.throws(() => validateRegimenPayload({
      doses: [{ time: "08:00", drug: removed, dose: 100 }],
      days: 2
    }), /unknown drug/, removed);
  }
});

test("invalid and non-finite imported values are rejected", () => {
  assert.throws(() => validateRegimenPayload({
    doses: [{ time: "08:00", drug: "sinemet", dose: Number.POSITIVE_INFINITY }],
    days: 2
  }), ModelValidationError);
  assert.throws(() => validateRegimenPayload({
    doses: [{ time: "25:99", drug: "sinemet", dose: 100 }],
    days: 2
  }), /invalid time/);
  assert.throws(() => validateRegimenPayload({
    doses: Array.from({ length: MAX_DOSES + 1 }, () => ({ time: "08:00", drug: "sinemet", dose: 100 })),
    days: 2
  }), /at most/);
});

test("threshold validation requires an ordered pair", () => {
  assert.deepEqual(validateThresholds(null, 120).errors.length, 1);
  assert.deepEqual(validateThresholds(120, 100).errors.length, 1);
  assert.deepEqual(validateThresholds(50, 120).errors, []);
});

test("legacy exports remain importable; retired fields are ignored", () => {
  const state = validateRegimenPayload({
    doses: [{ t: "07:30", drug: "sinemet", dose: 100, dur: 960 }],
    onThr: 50,
    dysThr: 120,
    days: 2,
    comt: "ent"
  });
  assert.equal(state.doses[0].time, "07:30");
  assert.equal(state.doses[0].duration, undefined);
  assert.equal(state.onThreshold, 50);
  assert.equal("comt" in state, false);
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
