import test from "node:test";
import assert from "node:assert/strict";

import { DRUGS, DRUG_BY_ID, LD_AUC } from "../src/drugs.js";
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

const baseState = {
  doses: [{ time: "08:00", drug: "sinemet", dose: 100, hidden: false }],
  onThreshold: null,
  dyskinesiaThreshold: null
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
      doses: [{ time: "08:00", drug: bad, dose: 100 }]
    }), /unknown drug/);
  }
});

test("removed drug ids are rejected as unknown drugs", () => {
  for (const removed of ["madopar", "stalevo", "duopa", "vyalev", "onapgo", "rotig", "rasag", "amant", "istrad"]) {
    assert.throws(() => validateRegimenPayload({
      doses: [{ time: "08:00", drug: removed, dose: 100 }]
    }), /unknown drug/, removed);
  }
});

test("invalid and non-finite imported values are rejected", () => {
  assert.throws(() => validateRegimenPayload({
    doses: [{ time: "08:00", drug: "sinemet", dose: Number.POSITIVE_INFINITY }]
  }), ModelValidationError);
  assert.throws(() => validateRegimenPayload({
    doses: [{ time: "25:99", drug: "sinemet", dose: 100 }]
  }), /invalid time/);
  assert.throws(() => validateRegimenPayload({
    doses: Array.from({ length: MAX_DOSES + 1 }, () => ({ time: "08:00", drug: "sinemet", dose: 100 }))
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

test("the retired days setting is ignored on import and left out of exports", () => {
  for (const days of [1, 7, "abc", null]) {
    const state = validateRegimenPayload({ doses: [{ time: "21:00", drug: "rytary", dose: 245 }], days });
    assert.equal("days" in state, false, String(days));
  }
  const exported = exportRegimen(validateRegimenPayload({ doses: [], days: 2 }));
  assert.equal("days" in exported, false);
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
