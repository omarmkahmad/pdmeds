import test from "node:test";
import assert from "node:assert/strict";

import { DRUG_BY_ID, DRUGS } from "../src/drugs.js";
import { componentUnitArea, normalizedComponentPeaks } from "../src/model.js";

// Single-dose curve for `mg` of a preparation, one value per minute for 24 h.
// No earlier doses: these are compared with single-dose studies.
function singleDose(drug, mg) {
  const peaks = normalizedComponentPeaks(drug, mg * drug.exposure.exposureFactor);
  return Array.from({ length: 1441 }, (_, minute) => drug.exposure.values.reduce((sum, component, index) => (
    sum + (minute <= component.peakTime
      ? peaks[index] * minute / component.peakTime
      : peaks[index] * Math.pow(0.5, (minute - component.peakTime) / component.halfLife))
  ), 0));
}

function landmarks(drugId) {
  const values = singleDose(DRUG_BY_ID[drugId], 100);
  const peak = Math.max(...values);
  return {
    // Peak per mg relative to immediate-release levodopa (100 mg IR peaks at 100).
    peakRatio: peak / 100,
    hoursAboveHalfPeak: values.filter(value => value >= peak / 2).length / 60
  };
}

// Published single-dose ranges, fasted. Time above half of peak uses the
// same convention as the IR reference (mean of individual durations in
// advanced PD, Modi 2019: IR 1.9 h, Rytary 3.9 h, Crexont 4.7 h). Peak per mg
// comes from dose-normalized Cmax (Modi 2019; FDA reviews; labels). The
// ranges are the evidence spread the fit must stay inside.
const TARGETS = {
  sinemet: { hours: [1.4, 2.1], peak: [1, 1] },
  sinemetcr: { hours: [2.1, 3.4], peak: [0.35, 0.78] },
  rytary: { hours: [3.7, 4.3], peak: [0.30, 0.37] },
  crexont: { hours: [4.4, 5.1], peak: [0.34, 0.40] },
  inbrija: { hours: [1.9, 2.3], peak: [0.45, 0.60] }
};

test("each preparation's single-dose curve sits inside the published ranges", () => {
  for (const [drugId, target] of Object.entries(TARGETS)) {
    const { peakRatio, hoursAboveHalfPeak } = landmarks(drugId);
    assert.ok(hoursAboveHalfPeak >= target.hours[0] && hoursAboveHalfPeak <= target.hours[1],
      `${drugId}: ${hoursAboveHalfPeak.toFixed(2)} h above half of peak, expected ${target.hours.join("–")}`);
    assert.ok(peakRatio >= target.peak[0] - 1e-9 && peakRatio <= target.peak[1] + 1e-9,
      `${drugId}: peak per mg ${peakRatio.toFixed(3)} of IR, expected ${target.peak.join("–")}`);
  }
});

test("Crexont stays above half its peak longer than Rytary, as in the head-to-head study", () => {
  assert.ok(landmarks("crexont").hoursAboveHalfPeak > landmarks("rytary").hoursAboveHalfPeak);
});

test("curve area follows each label's relative bioavailability, not the LEDD factor", () => {
  const expected = { sinemet: 1, sinemetcr: 0.85, rytary: 0.7, crexont: 0.88, inbrija: 0.69 };
  for (const [drugId, factor] of Object.entries(expected)) {
    assert.equal(DRUG_BY_ID[drugId].exposure.exposureFactor, factor, drugId);
  }
  // LEDD keeps the Jost 2023 factors.
  assert.equal(DRUG_BY_ID.rytary.led.value, 0.5);
  assert.equal(DRUG_BY_ID.crexont.led.value, 0.5);
});

test("each component's share of the area equals its stated fraction", () => {
  for (const drug of DRUGS) {
    const fractions = drug.exposure.values.map(component => component.fraction);
    assert.ok(Math.abs(fractions.reduce((sum, value) => sum + value, 0) - 1) < 1e-12, `${drug.id} fractions sum to 1`);
    const peaks = normalizedComponentPeaks(drug, 100);
    const areas = drug.exposure.values.map((component, index) => peaks[index] * componentUnitArea(component));
    const total = areas.reduce((sum, value) => sum + value, 0);
    areas.forEach((area, index) => {
      assert.ok(Math.abs(area / total - fractions[index]) < 1e-12, `${drug.id} component ${index}`);
    });
  }
});

test("Crexont uses the reported 25% immediate-release / 75% extended-release split (LeWitt 2023)", () => {
  assert.deepEqual(DRUG_BY_ID.crexont.exposure.values.map(component => component.fraction), [0.25, 0.75]);
});
