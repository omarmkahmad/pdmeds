import test from "node:test";
import assert from "node:assert/strict";

import { COMT_OPTIONS, DRUGS, DRUG_BY_ID, LD_AUC } from "../src/drugs.js";
import {
  MAX_DOSES,
  ModelValidationError,
  calculateLedSummary,
  calculateStatistics,
  computeDay,
  contributionAtMinute,
  longestCircularRun,
  modeledInfiniteAuc,
  validateRegimenPayload,
  validateThresholds
} from "../src/model.js";

const baseState = {
  doses: [{ time: "08:00", drug: "sinemet", dose: 100, hidden: false }],
  onThreshold: null,
  dyskinesiaThreshold: null,
  days: 2,
  comt: "none"
};

test("component curves are normalized to their declared exposure area", () => {
  for (const drug of DRUGS.filter(item => item.exposure.kind === "components")) {
    const targetLed = 100 * drug.exposure.exposureFactor;
    const auc = modeledInfiniteAuc(drug, targetLed);
    assert.ok(Math.abs(auc - targetLed * LD_AUC) < 1e-8, drug.id);
  }
});

test("updated Jost conversion factors are represented", () => {
  assert.equal(DRUG_BY_ID.inbrija.led.value, 0.69);
  assert.equal(DRUG_BY_ID.duopa.led.value, 1.11);
  assert.equal(DRUG_BY_ID.vyalev.led.value, 0.75);
  assert.equal(DRUG_BY_ID.gocovri.led.value, 1.25);
  assert.equal(DRUG_BY_ID.sinemetcr.led.value, 0.75);
});

test("fixed and regimen-level LED proposals do not pretend to be dose multipliers", () => {
  const doses = [
    { time: "08:00", drug: "sinemet", dose: 100 },
    { time: "08:00", drug: "safin", dose: 50 },
    { time: "08:00", drug: "istrad", dose: 20 }
  ];
  const summary = calculateLedSummary(doses, "ent");
  assert.equal(summary.rows[0].totalLed, 133);
  assert.equal(summary.rows[1].totalLed, 150);
  assert.equal(summary.rows[2].totalLed, 26.6);
  assert.equal(summary.totalLed, 309.6);
});

test("duplicate fixed-dose adjunct rows only contribute once", () => {
  const doses = [
    { time: "08:00", drug: "safin", dose: 50 },
    { time: "20:00", drug: "safin", dose: 100 }
  ];
  const summary = calculateLedSummary(doses, "none");
  assert.equal(summary.rows[0].totalLed, 150);
  assert.equal(summary.rows[1].totalLed, 0);
});

test("COMT choices produce distinct LED and exposure effects", () => {
  const dose = baseState.doses[0];
  const drug = DRUG_BY_ID.sinemet;
  const baseline = contributionAtMinute(dose, drug, 540, baseState, 100);
  for (const id of ["ent", "opi", "tol"]) {
    const state = { ...baseState, comt: id };
    const rowLed = calculateLedSummary(state.doses, id).rows[0].totalLed;
    const value = contributionAtMinute(dose, drug, 540, state, rowLed);
    assert.ok(Math.abs(value / baseline - COMT_OPTIONS[id].exposureMultiplier) < 1e-10, id);
  }
  assert.equal(calculateLedSummary(baseState.doses, "ent").totalLed, 133);
  assert.equal(calculateLedSummary(baseState.doses, "opi").totalLed, 150);
  assert.equal(calculateLedSummary(baseState.doses, "tol").totalLed, 150);
});

test("invalid and non-finite imported values are rejected", () => {
  assert.throws(() => validateRegimenPayload({
    doses: [{ time: "08:00", drug: "sinemet", dose: Number.POSITIVE_INFINITY }],
    days: 2,
    comt: "none"
  }), ModelValidationError);
  assert.throws(() => validateRegimenPayload({
    doses: [{ time: "25:99", drug: "sinemet", dose: 100 }],
    days: 2,
    comt: "none"
  }), /invalid time/);
  assert.throws(() => validateRegimenPayload({
    doses: Array.from({ length: MAX_DOSES + 1 }, () => ({ time: "08:00", drug: "sinemet", dose: 100 })),
    days: 2,
    comt: "none"
  }), /at most/);
});

test("threshold validation requires an ordered pair", () => {
  assert.deepEqual(validateThresholds(null, 120).errors.length, 1);
  assert.deepEqual(validateThresholds(120, 100).errors.length, 1);
  assert.deepEqual(validateThresholds(50, 120).errors, []);
});

test("legacy exports remain importable and are normalized", () => {
  const state = validateRegimenPayload({
    doses: [{ t: "07:30", drug: "duopa", dose: 1000, dur: 960 }],
    onThr: 50,
    dysThr: 120,
    days: 2,
    comt: "none"
  });
  assert.equal(state.doses[0].time, "07:30");
  assert.equal(state.doses[0].duration, 960);
  assert.equal(state.onThreshold, 50);
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
