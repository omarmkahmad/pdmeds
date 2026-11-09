// Amantadine IR and Gocovri (added in model 4.1.0, curves refit to the
// figures of Hauser 2019 in 4.2.0): the drug data, the curves against their
// published steady-state values, LEDD, the editor arithmetic, the analysis
// text and the second chart panel. Levodopa behaviour is covered by
// the other test files, which this feature leaves as they were.
import test from "node:test";
import assert from "node:assert/strict";

import {
  AMANTADINE_AUC,
  AMANTADINE_DRUGS,
  AMANTADINE_ORDER,
  DRUGS,
  DRUG_BY_ID,
  DRUG_ORDER,
  GOCOVRI_HCL_PER_MG,
  MEDICINES,
  MEDICINE_ORDER,
  MODEL_VERSION,
  analyteOf,
  ledPerMg
} from "../src/drugs.js";
import {
  calculateLedSummary,
  componentShape,
  componentUnitArea,
  computeDay,
  contributionAtMinute,
  exportRegimen,
  modeledInfiniteAuc,
  normalizedComponentPeaks,
  validateRegimenPayload
} from "../src/model.js";
import {
  amountLabel,
  dailyTotalText,
  dailyTotals,
  doseMg,
  hasMgMode,
  inferStrength,
  largeDoseNote,
  ledParts,
  ledText,
  leddParts,
  medicineChange,
  nextDoseDefaults,
  parseMg,
  strengthMg,
  strengthOf,
  validateCount
} from "../src/amounts.js";
import {
  amantadineDesc,
  amantadinePanel,
  amantadineReadout,
  amantadineSentences,
  amantadineValueText,
  analyzeDay,
  answerBarLow,
  buildSheetRows,
  compareModel,
  doseGroups,
  headlineSentences,
  hourlyRows,
  ngText,
  pinSnapshot,
  statusMessage
} from "../src/answers.js";
import {
  AMANTADINE_TITLE,
  CHART_CLASSES,
  buildChartScene,
  chartGeometry,
  curveStyle,
  shortScale
} from "../src/chart.js";
import { TIPS } from "../src/copy.js";
import { sheetFromRows } from "../schedule.js";

const ir = (id, time, count = 1) => ({ id, time, drug: "sinemet", strength: "25/100", count, dose: 100 * count });
const amantadine = (id, time, count = 1) => ({ id, time, drug: "amantadine", strength: "100", count, dose: 100 * count });
const gocovri = (id, time, count = 2) => ({ id, time, drug: "gocovri", strength: "137", count, dose: 137 * count });

const LEVODOPA_DAY = [ir("l1", "07:00"), ir("l2", "11:00"), ir("l3", "15:00"), ir("l4", "19:00")];
const WITH_GOCOVRI = [...LEVODOPA_DAY, gocovri("g1", "22:00")];
const WITH_IR = [...LEVODOPA_DAY, amantadine("a1", "08:00"), amantadine("a2", "16:00")];

const minuteOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const within = (value, low, high, what) => assert.ok(value >= low && value <= high, `${what}: ${value.toFixed(1)}, expected ${low}–${high}`);

function average(values, from, to) {
  let sum = 0;
  for (let minute = from; minute < to; minute += 1) sum += values[minute];
  return sum / (to - from);
}

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

/* ---------- Drug data ---------- */

test("amantadine IR and Gocovri are listed apart from the five levodopa preparations", () => {
  assert.equal(MODEL_VERSION, "4.2.0");
  assert.deepEqual(AMANTADINE_ORDER, ["amantadine", "gocovri"]);
  assert.deepEqual(AMANTADINE_DRUGS.map(drug => drug.id), AMANTADINE_ORDER);
  assert.deepEqual(MEDICINE_ORDER, [...DRUG_ORDER, ...AMANTADINE_ORDER]);
  assert.deepEqual(MEDICINES.map(drug => drug.id), MEDICINE_ORDER);
  assert.deepEqual(Object.keys(DRUG_BY_ID), MEDICINE_ORDER);
  // DRUGS stays the levodopa list, so nothing that loops over it picks up amantadine.
  assert.ok(DRUGS.every(drug => drug.isLevodopa && analyteOf(drug) === "levodopa" && drug.doseBasis === "levodopa"));
  assert.ok(AMANTADINE_DRUGS.every(drug => !drug.isLevodopa && analyteOf(drug) === "amantadine"));
  // The two amantadine products count different things, so neither carries an amount to the other.
  assert.equal(DRUG_BY_ID.amantadine.doseBasis, "amantadine-hcl");
  assert.equal(DRUG_BY_ID.gocovri.doseBasis, "amantadine");
});

test("amantadine strengths, units, limits and curve styles", () => {
  const ama = DRUG_BY_ID.amantadine;
  const goc = DRUG_BY_ID.gocovri;
  assert.deepEqual(ama.strengths, [{ id: "100", label: "100 mg", amantadine: 100, halves: false }]);
  assert.deepEqual(goc.strengths.map(strength => [strength.id, strength.amantadine]), [["68.5", 68.5], ["137", 137]]);
  assert.equal(strengthMg(strengthOf("gocovri", "137")), 137);
  assert.equal(strengthMg(strengthOf("sinemet", "25/250")), 250);
  assert.equal(strengthMg(null), null);
  // Gocovri's default is the label's recommended dose: two 137 mg capsules.
  assert.equal(doseMg(goc, goc.defaultStrength, goc.defaultCount), 274);
  assert.equal(goc.largeDoseMg, 274);
  assert.equal(largeDoseNote("gocovri", 274), null);
  assert.equal(largeDoseNote("gocovri", 411), "That is a large single dose for Gocovri (over 274 mg). Check it.");
  assert.equal(largeDoseNote("amantadine", 200), null);
  assert.equal(largeDoseNote("amantadine", 300), "That is a large single dose for Amantadine IR (over 200 mg). Check it.");
  assert.deepEqual(ama.unit, ["capsule or tablet", "capsules or tablets"]);
  // Every medicine has its own colour and dash.
  const styles = MEDICINES.map(drug => `${drug.style.color}|${drug.style.dash}`);
  assert.equal(new Set(styles).size, MEDICINES.length);
  assert.equal(new Set(MEDICINES.map(drug => drug.style.color.toLowerCase())).size, MEDICINES.length);
  for (const drug of AMANTADINE_DRUGS) assert.deepEqual(curveStyle(drug.id), drug.style);
  // Every medicine says whether it has "Other amount (mg)"; only Inbrija does not.
  for (const drug of MEDICINES) assert.equal(hasMgMode(drug), drug.id !== "inbrija", drug.id);
  for (const drug of AMANTADINE_DRUGS) {
    assert.equal(typeof drug.editorNote, "string");
    assert.equal(typeof drug.mgHint, "string");
    assert.ok(drug.sources.length >= 3);
  }
});

/* ---------- LEDD (Jost 2023) ---------- */

test("LEDD: amantadine IR x1; Gocovri x1.25 of its hydrochloride mg", () => {
  assert.equal(DRUG_BY_ID.amantadine.led.value, 1);
  assert.equal(DRUG_BY_ID.gocovri.led.value, 1.25);
  assert.equal(ledPerMg(DRUG_BY_ID.amantadine), 1);
  assert.equal(ledPerMg(DRUG_BY_ID.sinemetcr), 0.75);
  // Jost 2023, Table 1: 340 mg of extended-release amantadine hydrochloride a
  // day counts as 425 mg. 340 mg of the hydrochloride is 274 mg of Gocovri.
  assert.ok(Math.abs(274 * GOCOVRI_HCL_PER_MG - 340) < 1e-9);
  assert.ok(Math.abs(274 * ledPerMg(DRUG_BY_ID.gocovri) - 425) < 1e-9);
  assert.ok(Math.abs(137 * ledPerMg(DRUG_BY_ID.gocovri) - 212.5) < 1e-9);
  assert.ok(AMANTADINE_DRUGS.every(drug => drug.ledAssumed === false));
  const summary = calculateLedSummary([ir("a", "08:00", 1.5), gocovri("g", "22:00"), amantadine("b", "08:00", 2)]);
  assert.ok(Math.abs(summary.totalLed - (150 + 425 + 200)) < 1e-9);
});

test("ledText names the drug, and shows Gocovri's hydrochloride mg", () => {
  assert.equal(ledText("amantadine", 100), "100 mg amantadine HCl · counts as 100 mg LEDD (×1)");
  assert.equal(ledText("gocovri", 274), "274 mg amantadine (= 340 mg HCl) · counts as 425 mg LEDD (×1.25)");
  assert.equal(ledText("gocovri", 68.5), "68.5 mg amantadine (= 85 mg HCl) · counts as 106.3 mg LEDD (×1.25)");
  assert.equal(ledText("gocovri", null), "No amount yet · not counted");
  assert.deepEqual(ledParts("gocovri", 137), { mg: 137, led: 212.5, factor: 1.25, assumed: false, basisMg: 170 });
  assert.deepEqual(ledParts("amantadine", 100), { mg: 100, led: 100, factor: 1, assumed: false });
  assert.equal(amountLabel(gocovri("g", "22:00")), "2 × 137 mg");
  assert.equal(amountLabel({ drug: "amantadine", strength: null, count: null, dose: 150 }), "150 mg");
});

test("daily totals: mg is levodopa only, LEDD counts amantadine too", () => {
  assert.deepEqual(dailyTotals(LEVODOPA_DAY), { mg: 400, led: 400 });
  assert.deepEqual(dailyTotals(WITH_GOCOVRI), { mg: 400, led: 825 });
  assert.deepEqual(leddParts(LEVODOPA_DAY), { levodopa: 400, amantadine: null });
  assert.deepEqual(leddParts(WITH_GOCOVRI), { levodopa: 400, amantadine: 425 });
  assert.deepEqual(leddParts(WITH_IR), { levodopa: 400, amantadine: 200 });
  // Without amantadine the line is the one the app always had.
  assert.equal(dailyTotalText(LEVODOPA_DAY), "400 mg levodopa = 400 mg LEDD/day");
  assert.equal(dailyTotalText(WITH_GOCOVRI), "400 mg levodopa (LEDD 400) + amantadine (LEDD 425) = 825 mg LEDD/day");
  assert.equal(dailyTotalText([gocovri("g", "22:00")], " a day"), "0 mg levodopa (LEDD 0) + amantadine (LEDD 425) = 425 mg LEDD a day");
  // A dose without an amount counts for nothing.
  assert.deepEqual(leddParts([{ id: "x", time: "22:00", drug: "gocovri", strength: null, count: null, dose: null }]), { levodopa: 0, amantadine: null });
  const analysis = analyzeDay(WITH_GOCOVRI);
  assert.deepEqual(analysis.totals, dailyTotals(WITH_GOCOVRI));
  assert.deepEqual(analysis.ledd, leddParts(WITH_GOCOVRI));
  assert.ok(Math.abs(calculateLedSummary(WITH_GOCOVRI).totalLed - analysis.totals.led) < 1e-9);
});

/* ---------- The curve model ---------- */

test("a component's lag delays its rise and is left out of its area", () => {
  const component = { fraction: 1, lag: 180, peakTime: 480, halfLife: 960 };
  assert.equal(componentShape(component, 0), 0);
  assert.equal(componentShape(component, 180), 0);
  assert.equal(componentShape(component, 330), 0.5);
  assert.equal(componentShape(component, 480), 1);
  assert.equal(componentShape(component, 480 + 960), 0.5);
  assert.equal(componentUnitArea(component), (480 - 180) / 2 + 960 / Math.log(2));
  // No lag: the shape the levodopa preparations always had.
  const plain = { fraction: 1, peakTime: 60, halfLife: 81 };
  assert.equal(componentShape(plain, 30), 0.5);
  assert.equal(componentShape(plain, 60 + 81), 0.5);
  assert.equal(componentUnitArea(plain), 60 / 2 + 81 / Math.log(2));
  // The area is what a 1-minute sum of the shape gives.
  let sum = 0;
  for (let minute = 0; minute < 1440 * 30; minute += 1) sum += componentShape(component, minute);
  assert.ok(Math.abs(sum / componentUnitArea(component) - 1) < 1e-3);
});

test("amantadine curves have the declared area, in ng·min/mL per mg of hydrochloride", () => {
  // 57.66 ng·h/mL per mg in healthy adults at steady state (FDA review of NDA
  // 208944, study PK-111) × 1.6 for PD patients (Hauser 2019).
  assert.ok(Math.abs(AMANTADINE_AUC - 57.66 * 1.6 * 60) < 1e-9);
  for (const drug of AMANTADINE_DRUGS) {
    assert.equal(drug.exposure.unitAuc, AMANTADINE_AUC);
    const hclMg = 100 * drug.exposure.exposureFactor;
    assert.ok(Math.abs(modeledInfiniteAuc(drug, hclMg) - hclMg * AMANTADINE_AUC) < 1e-6, drug.id);
    const fractions = drug.exposure.values.map(component => component.fraction);
    assert.ok(Math.abs(fractions.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    // The closed-form tail for earlier days needs every peak within a day.
    assert.ok(drug.exposure.values.every(component => component.peakTime < 1440 && (component.lag ?? 0) < component.peakTime));
  }
  // Same exposure per mg of hydrochloride: Gocovri's factor is only the salt conversion.
  assert.equal(DRUG_BY_ID.amantadine.exposure.exposureFactor, 1);
  assert.equal(DRUG_BY_ID.gocovri.exposure.exposureFactor, GOCOVRI_HCL_PER_MG);
  // The daily average is dose × area ÷ 24 h, whatever the shape.
  const day = computeDay({ doses: [gocovri("g", "22:00")] });
  assert.ok(Math.abs(average(day.total, 0, 1440) - 340 * AMANTADINE_AUC / 1440) < 1);
});

test("the closed-form steady state matches summing 40 days of amantadine doses", () => {
  for (const drug of AMANTADINE_DRUGS) {
    const peaks = normalizedComponentPeaks(drug, 100 * drug.exposure.exposureFactor);
    for (const time of ["00:00", "08:00", "22:00", "23:59"]) {
      const dose = { time, drug: drug.id, dose: 100 };
      for (const minute of [0, 1, 359, 720, 1260, 1439]) {
        let expected = 0;
        for (let day = 0; day < 40; day += 1) {
          const elapsed = minute - minuteOf(time) + 1440 * day;
          if (elapsed < 0) continue;
          drug.exposure.values.forEach((component, index) => { expected += peaks[index] * componentShape(component, elapsed); });
        }
        const actual = contributionAtMinute(dose, drug, minute);
        assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, expected), `${drug.id} ${time} minute ${minute}`);
      }
      const { total, maximum } = computeDay({ doses: [dose] });
      assert.ok(Math.abs(total[0] - total[1440]) <= 1e-9 * maximum, `${drug.id} at ${time} joins up at midnight`);
    }
  }
});

test("levodopa and amantadine are never added into one level", () => {
  assert.throws(() => computeDay({ doses: [ir("a", "08:00"), gocovri("g", "22:00")] }), TypeError);
  assert.throws(() => computeDay({ doses: [ir("a", "08:00"), amantadine("b", "08:00")] }), TypeError);
  // The two amantadine products are the same drug in the blood, so they do add.
  const both = computeDay({ doses: [amantadine("b", "08:00"), gocovri("g", "22:00")] });
  const one = computeDay({ doses: [gocovri("g", "22:00")] });
  assert.ok(both.maximum > one.maximum);
  // A dose with no amount does not count as a second analyte.
  assert.doesNotThrow(() => computeDay({ doses: [ir("a", "08:00"), { time: "22:00", drug: "gocovri", dose: null }] }));
  // Adding amantadine leaves the levodopa level exactly as it was.
  const alone = analyzeDay(LEVODOPA_DAY);
  const mixed = analyzeDay(WITH_GOCOVRI);
  assert.deepEqual(Array.from(mixed.computed.total), Array.from(alone.computed.total));
  assert.deepEqual(mixed.before, alone.before);
  assert.deepEqual(mixed.stats, alone.stats);
  assert.deepEqual(mixed.doses.map(dose => dose.id), ["l1", "l2", "l3", "l4"]);
  assert.equal(alone.amantadine, null);
  assert.deepEqual(doseGroups(WITH_GOCOVRI), doseGroups(LEVODOPA_DAY));
  assert.deepEqual(headlineSentences(mixed), headlineSentences(alone));
});

/* ---------- Published values the curves must stay inside ---------- */

// Hauser RA, et al. Clin Pharmacokinet. 2019;58:77-88 (doi:10.1007/s40262-018-0663-4).
// Healthy adults, day 7 of dosing (study 2, n = 23): mean plasma amantadine
// by hour after the 20:00 dose, read from the plotted points.
// Fig. 1c: Gocovri (ADS-5102) 137 mg once daily.
const MEASURED_GOCOVRI_137 = [
  [0, 311], [1, 304], [2, 295], [3, 310], [4, 385], [6, 481], [8, 482], [10, 492], [12, 473],
  [13, 464], [14, 473], [15, 455], [16, 434], [18, 416], [20, 390], [22, 363], [24, 336]
];
// Fig. 3b: immediate release, 100 mg of the hydrochloride at 20:00 and 08:00.
const MEASURED_IR_100_BID = [
  [0, 382], [1, 441], [2, 545], [3, 555], [4, 540], [6, 490], [8, 432], [10, 402], [12, 382],
  [13, 471], [14, 598], [15, 585], [16, 565], [18, 509], [20, 481], [22, 442], [24, 416]
];
// The model is scaled for PD patients: 1.6 times the healthy level.
const PD_SCALE = 1.6;

function worstMiss(total, doseHour, measured) {
  return Math.max(...measured.map(([hour, level]) => Math.abs(total[((doseHour + hour) % 24) * 60] / PD_SCALE / level - 1)));
}

test("Gocovri follows the measured steady-state profile hour by hour (Hauser 2019, Fig. 1c)", () => {
  const day = computeDay({ doses: [gocovri("g", "20:00", 1)] });
  const miss = worstMiss(day.total, 20, MEASURED_GOCOVRI_137);
  assert.ok(miss <= 0.07, `worst miss ${(miss * 100).toFixed(1)}% at a sampled hour, expected 7% or less`);
  // The features the paper describes: lowest in the first 3 h after the dose,
  // then a plateau from about 6 to 14 h, with the top of it 8 to 10 h after.
  const hoursAfterDose = minute => ((minute - 20 * 60 + 1440) % 1440) / 60;
  within(hoursAfterDose(day.minimumMinute), 1.5, 3.5, "hours from dose to the lowest level");
  within(hoursAfterDose(day.maximumMinute), 6, 12, "hours from dose to the highest level");
  const plateau = [6, 8, 10, 12, 14].map(hour => day.total[((20 + hour) % 24) * 60]);
  assert.ok(Math.min(...plateau) / Math.max(...plateau) > 0.9, "6 to 14 h after the dose is flat to within 10%");
  // Lowest to highest: 295 to 492 in the measured mean curve.
  within(day.minimum / day.maximum, 0.55, 0.65, "lowest ÷ highest (measured 0.60)");
});

test("immediate-release amantadine follows its measured steady-state profile (Hauser 2019, Fig. 3b)", () => {
  const day = computeDay({ doses: [amantadine("a", "20:00"), amantadine("b", "08:00")] });
  const miss = worstMiss(day.total, 20, MEASURED_IR_100_BID);
  assert.ok(miss <= 0.10, `worst miss ${(miss * 100).toFixed(1)}% at a sampled hour, expected 10% or less`);
});

// PD patients. Measured in the phase 2/3 trial 9 to 17 h after a 274 mg
// bedtime dose: mean about 1,410 ng/mL, "approximately 1,500" in the text.
// The paper's own simulation (Fig. 4) sits about 9% above the model at every
// hour: peak 1,690, 06:00-18:00 average 1,536, lowest about 1,080.
test("Gocovri 274 mg at 22:00 in PD patients: the measured level, and the published simulation", () => {
  const day = computeDay({ doses: [gocovri("g", "22:00")] });
  within(average(day.total, 7 * 60, 15 * 60), 1350, 1560, "level 9–17 h after the dose (measured about 1,410–1,500)");
  within(day.maximum, 1480, 1700, "peak (simulated 1,690)");
  within(average(day.total, 6 * 60, 18 * 60), 1360, 1580, "06:00–18:00 average (simulated 1,536)");
  // The simulated curve by hour after the dose (Fig. 4). The model has the
  // same shape, a little lower: every ratio falls in one narrow band.
  const simulated = [[0, 1137], [2, 1084], [4, 1338], [6, 1621], [8, 1683], [10, 1667], [12, 1623], [14, 1553], [16, 1474], [18, 1390], [20, 1307], [22, 1223]];
  const ratios = simulated.map(([hour, level]) => day.total[((22 + hour) % 24) * 60] / level);
  within(Math.min(...ratios), 0.84, 1, "lowest model ÷ simulation");
  within(Math.max(...ratios), 0.84, 1, "highest model ÷ simulation");
  assert.ok(Math.max(...ratios) - Math.min(...ratios) < 0.1, "the shape matches: ratios within 10 points of each other");
  // High on waking and through the day, lower in the evening.
  assert.equal(day.maximumMinute, 8 * 60);
  assert.equal(day.minimumMinute, 30);
  assert.ok(day.total[8 * 60] > day.total[20 * 60] * 1.2, "higher at 08:00 than at 20:00");
});

test("immediate-release amantadine 100 mg: published twice- and three-times-daily values", () => {
  const twice = computeDay({ doses: [amantadine("a", "08:00"), amantadine("b", "16:00")] });
  within(twice.maximum, 900, 1035, "08:00 + 16:00 peak (published 967)");
  within(twice.minimum, 495, 580, "08:00 + 16:00 lowest (published simulation: about 536)");
  within(average(twice.total, 6 * 60, 18 * 60), 700, 805, "08:00 + 16:00 daytime average (published 751)");
  const thrice = computeDay({ doses: [amantadine("a", "08:00"), amantadine("b", "12:00"), amantadine("c", "16:00")] });
  within(thrice.maximum, 1395, 1605, "three times a day peak (published 1,500)");
  within(average(thrice.total, 6 * 60, 18 * 60), 1045, 1205, "three times a day daytime average (published 1,125)");
  // Morning and afternoon doses peak in the evening, after 17:00 (Hauser 2019).
  assert.ok(thrice.maximumMinute >= 17 * 60);
  assert.ok(twice.minimumMinute <= 9 * 60, "lowest around the morning dose");
});

test("Gocovri at bedtime gives higher daytime levels than IR, 1.4 to 2 times (Hauser 2019)", () => {
  const daytime = doses => average(computeDay({ doses }).total, 6 * 60, 18 * 60);
  const er = daytime([gocovri("g", "22:00")]);
  within(er / daytime([amantadine("a", "08:00"), amantadine("b", "16:00")]), 1.85, 2.2, "vs twice daily (published 2.0)");
  within(er / daytime([amantadine("a", "08:00"), amantadine("b", "12:00"), amantadine("c", "16:00")]), 1.25, 1.5, "vs three times daily (published 1.4)");
});

test("healthy-volunteer values come back when the PD scaling is taken out", () => {
  // Hauser 2019, Table 3 (the same study as the FDA review's PK-111), day 7.
  // The table's Cmax and Cmin average each person's own highest and lowest
  // value, whenever it came, so they sit outside the mean curve: Gocovri
  // 137 mg, 536 and 285 (mean curve 492 and 295); IR 100 mg every 12 h, 612
  // and 366 (mean curve 598 and 382). The average level is the same either way.
  const er = computeDay({ doses: [gocovri("g", "20:00", 1)] });
  within(er.maximum / 1.6, 455, 540, "Gocovri highest (492 to 536)");
  within(er.minimum / 1.6, 265, 315, "Gocovri lowest (285 to 295)");
  within(average(er.total, 0, 1440) / 1.6, 395, 435, "Gocovri Cavg (414)");
  const irDay = computeDay({ doses: [amantadine("a", "08:00"), amantadine("b", "20:00")] });
  within(irDay.maximum / 1.6, 550, 660, "IR highest (598 to 612)");
  within(irDay.minimum / 1.6, 345, 405, "IR lowest (366 to 382)");
  within(average(irDay.total, 0, 1440) / 1.6, 455, 505, "IR Cavg (481)");
});

test("single doses: IR peaks at 2–4 h, Gocovri at 6–20 h with little absorbed early", () => {
  const single = (drug, mg) => {
    const peaks = normalizedComponentPeaks(drug, mg * drug.exposure.exposureFactor);
    return Array.from({ length: 1440 * 8 }, (_, minute) => drug.exposure.values.reduce((sum, component, index) => (
      sum + peaks[index] * componentShape(component, minute)
    ), 0));
  };
  const irCurve = single(DRUG_BY_ID.amantadine, 100);
  const irPeak = Math.max(...irCurve);
  within(irCurve.indexOf(irPeak) / 60, 2, 4, "IR time to peak (label 2–4 h; Hauser 2019: median 3 h)");
  // Label: 0.22–0.24 µg/mL after 100 mg in healthy adults.
  within(irPeak / 1.6, 200, 260, "IR single-dose peak in healthy adults");
  const erCurve = single(DRUG_BY_ID.gocovri, 137);
  const erPeak = Math.max(...erCurve);
  within(erCurve.indexOf(erPeak) / 60, 6, 20, "Gocovri time to peak (label: median 12 h, range 6–20)");
  // Nothing in the first 2 h: the lag was 2 to 4 h in every dose group (Hauser 2019, Table 2).
  assert.equal(erCurve[120], 0);
  assert.ok(erCurve[240] > 0);
  // Share of the total area in the first 8 h: 8% for Gocovri, 28% for IR (Hauser 2019).
  const early = curve => curve.slice(0, 480).reduce((a, b) => a + b, 0) / curve.reduce((a, b) => a + b, 0);
  within(early(erCurve) * 100, 5, 11, "Gocovri share of area in the first 8 h (8%)");
  within(early(irCurve) * 100, 21, 31, "IR share of area in the first 8 h (28%)");
  // Per mg of hydrochloride, Gocovri's peak is about a third lower than IR's.
  within((erPeak / 170) / (irPeak / 100), 0.6, 0.9, "peak per mg of hydrochloride, Gocovri vs IR (0.66)");
});

/* ---------- Editor arithmetic ---------- */

test("counts and strengths: Gocovri capsules are whole, amounts are inferred", () => {
  assert.equal(validateCount("gocovri", "137", 2), null);
  assert.equal(validateCount("gocovri", "137", 1.5), "Choose 1 to 4 capsules.");
  assert.equal(validateCount("amantadine", "100", 5), "Choose 1 to 4 capsules or tablets.");
  assert.deepEqual(inferStrength("gocovri", 274), { strength: "137", count: 2 });
  assert.deepEqual(inferStrength("gocovri", 68.5), { strength: "68.5", count: 1 });
  // The label's dose for moderate renal impairment after titration: 137 + 68.5.
  assert.deepEqual(inferStrength("gocovri", 205.5), { strength: "68.5", count: 3 });
  assert.equal(inferStrength("gocovri", 100), null);
  assert.deepEqual(inferStrength("amantadine", 200), { strength: "100", count: 2 });
  assert.equal(inferStrength("amantadine", 50), null);
});

test("an amount never carries between levodopa and amantadine, or between the two amantadine products", () => {
  const set = (count, label, unit, mg) => `Amount set to ${count} × ${label} ${unit} (${mg} mg). This is not a converted dose. Check it.`;
  for (const mode of ["strength", "mg"]) {
    for (const intendedMg of [null, 100, 150, 274, 2000]) {
      for (const fromDrug of DRUG_ORDER) {
        assert.deepEqual(medicineChange({ fromDrug, toDrug: "gocovri", mode, intendedMg }), {
          strength: "137", count: 2, dose: 274, mode: "strength", note: set(2, "137 mg", "capsules", 274)
        }, `${fromDrug} ${mode} ${intendedMg}`);
        assert.deepEqual(medicineChange({ fromDrug, toDrug: "amantadine", mode, intendedMg }), {
          strength: "100", count: 1, dose: 100, mode: "strength", note: set(1, "100 mg", "capsule or tablet", 100)
        }, `${fromDrug} ${mode} ${intendedMg}`);
      }
      // 100 mg of amantadine hydrochloride is not 100 mg of Gocovri, and Gocovri's
      // label says it is not substitutable with other amantadine products.
      assert.equal(medicineChange({ fromDrug: "amantadine", toDrug: "gocovri", mode, intendedMg }).dose, 274);
      assert.equal(medicineChange({ fromDrug: "gocovri", toDrug: "amantadine", mode, intendedMg }).dose, 100);
      // Back to levodopa with nothing kept: the levodopa medicine's own default.
      assert.deepEqual(medicineChange({ fromDrug: "gocovri", toDrug: "sinemet", mode, intendedMg }), {
        strength: "25/100", count: 1, dose: 100, mode: "strength", note: set(1, "25/100", "tablet", 100)
      });
    }
  }
  // No note ever reads "Same … mg" across the two kinds of drug.
  for (const fromDrug of MEDICINE_ORDER) {
    for (const toDrug of MEDICINE_ORDER) {
      if (fromDrug === toDrug || DRUG_BY_ID[fromDrug].doseBasis === DRUG_BY_ID[toDrug].doseBasis) continue;
      const result = medicineChange({ fromDrug, toDrug, mode: "strength", intendedMg: 100, earlierMg: 100 });
      assert.ok(!String(result.note ?? "").startsWith("Same"), `${fromDrug} -> ${toDrug}: ${result.note}`);
    }
  }
});

test("coming back to a medicine restores the amount it had (earlierMg)", () => {
  // 1½ × 25/100, a look at Gocovri, and back.
  const there = medicineChange({ fromDrug: "sinemet", toDrug: "gocovri", mode: "strength", intendedMg: 150, earlierMg: null });
  assert.equal(there.dose, 274);
  assert.deepEqual(medicineChange({ fromDrug: "gocovri", toDrug: "sinemet", mode: there.mode, intendedMg: null, earlierMg: 150 }), {
    strength: "25/100", count: 1.5, dose: 150, mode: "strength", note: null
  });
  // An amount no strength matches comes back in mg mode.
  assert.deepEqual(medicineChange({ fromDrug: "gocovri", toDrug: "sinemet", mode: "strength", intendedMg: 274, earlierMg: 122 }), {
    strength: null, count: null, dose: 122, mode: "mg", note: null
  });
  // One Gocovri capsule, a look at IR, and back.
  assert.deepEqual(medicineChange({ fromDrug: "amantadine", toDrug: "gocovri", mode: "strength", intendedMg: 100, earlierMg: 137 }), {
    strength: "137", count: 1, dose: 137, mode: "strength", note: null
  });
  // mg mode does not carry across: a blank mg field for the wrong drug helps no one.
  assert.equal(medicineChange({ fromDrug: "sinemet", toDrug: "amantadine", mode: "mg", intendedMg: null }).mode, "strength");
  // earlierMg is ignored between medicines that count the same thing.
  assert.equal(medicineChange({ fromDrug: "sinemet", toDrug: "sinemetcr", mode: "strength", intendedMg: 200, earlierMg: 100 }).dose, 200);
});

test("parseMg words its notes for the medicine", () => {
  assert.equal(parseMg("", "gocovri").note, "Enter the mg. Until then this dose is not counted.");
  assert.equal(parseMg("", "sinemet").note, "Enter the levodopa mg. Until then this dose is not counted.");
  assert.equal(parseMg("25/100", "amantadine").error, "Type only the amount in mg (e.g. 100), or pick a strength.");
  assert.equal(parseMg("2", "gocovri").note, "Only 2 mg? That looks like a capsule count. Pick a strength and use Capsules instead.");
  assert.equal(parseMg("2", "amantadine").note, "Only 2 mg? That looks like a capsule or tablet count. Pick a strength and use Capsules or tablets instead.");
  assert.deepEqual(parseMg("50", "amantadine"), { value: 50, error: null, note: null });
  assert.deepEqual(parseMg("205.5", "gocovri"), { value: 205.5, error: null, note: null });
});

test("Add dose follows the latest levodopa dose, not a bedtime amantadine dose", () => {
  assert.deepEqual(nextDoseDefaults(WITH_GOCOVRI), { time: "23:00", drug: "sinemet", strength: "25/100", count: 1, dose: 100 });
  // Only amantadine so far: the first-dose default.
  assert.deepEqual(nextDoseDefaults([gocovri("g", "22:00")]), { time: "08:00", drug: "sinemet", strength: "25/100", count: 1, dose: 100 });
  // "Add next dose" from an amantadine dose copies it; only amantadine doses set the gap.
  assert.deepEqual(nextDoseDefaults([...LEVODOPA_DAY, amantadine("a1", "08:00")], "a1"), {
    time: "11:00", drug: "amantadine", strength: "100", count: 1, dose: 100
  });
  assert.equal(nextDoseDefaults([...LEVODOPA_DAY, amantadine("a1", "08:00"), amantadine("a2", "12:00")], "a2").time, "16:00");
  // The levodopa gap ignores an amantadine dose that sits between two levodopa doses.
  assert.equal(nextDoseDefaults([ir("l1", "08:00"), amantadine("a1", "10:00"), ir("l2", "12:00")], "l2").time, "16:00");
});

/* ---------- Files ---------- */

test("a schedule with amantadine survives a save and open", () => {
  const state = { doses: [...WITH_GOCOVRI, { id: "m", time: "08:00", drug: "amantadine", strength: null, count: null, dose: 50 }] };
  const file = JSON.parse(JSON.stringify(exportRegimen(state)));
  assert.equal(file.schemaVersion, 2);
  assert.equal(file.modelVersion, "4.2.0");
  assert.deepEqual(file.doses.at(-2), { time: "22:00", drug: "gocovri", dose: 274, strength: "137", count: 2 });
  assert.deepEqual(file.doses.at(-1), { time: "08:00", drug: "amantadine", dose: 50 });
  const opened = validateRegimenPayload(file);
  const strip = doses => doses.map(({ time, drug, strength, count, dose }) => ({ time, drug, strength, count, dose }));
  assert.deepEqual(strip(opened.doses), strip(state.doses));
  assert.deepEqual(opened.notes, []);
  // A file written without strength and count gets them back from the mg.
  const inferred = validateRegimenPayload({ schemaVersion: 1, doses: [{ time: "22:00", drug: "gocovri", dose: 274 }] });
  assert.deepEqual([inferred.doses[0].strength, inferred.doses[0].count], ["137", 2]);
});

/* ---------- Analysis and text ---------- */

test("ng/mL are shown to the nearest 10", () => {
  assert.equal(ngText(1635.8), "1,640");
  assert.equal(ngText(881.9), "880");
  assert.equal(ngText(104), "100");
  assert.equal(ngText(99.4), "99");
  assert.equal(ngText(0), "0");
  assert.equal(ngText(Number.NaN), "0");
});

test("the amantadine analysis: its own total, and the level at each levodopa dose", () => {
  const analysis = analyzeDay(WITH_GOCOVRI);
  const { amantadine: result } = analysis;
  assert.deepEqual(result.doses.map(dose => dose.id), ["g1"]);
  assert.equal(result.computed.series.length, 1);
  const alone = computeDay({ doses: [gocovri("g1", "22:00")] });
  assert.deepEqual(Array.from(result.computed.total), Array.from(alone.total));
  assert.equal(result.stats.max, alone.maximum);
  assert.equal(result.stats.maxMinute, alone.maximumMinute);
  assert.equal(result.stats.min, alone.minimum);
  // One entry per row of the "Level before each dose" table, at the dose time.
  assert.deepEqual(result.atDoses.map(item => [item.number, item.label, item.minute]), analysis.before.map(row => [row.number, row.label, row.groupStart]));
  for (const item of result.atDoses) {
    assert.equal(item.level, alone.total[item.minute]);
    assert.ok(Math.abs(item.share - item.level / alone.maximum) < 1e-12);
    assert.ok(item.share > 0 && item.share <= 1);
  }
  // Bedtime Gocovri falls through the day: highest at the first levodopa dose.
  const levels = result.atDoses.map(item => item.level);
  assert.deepEqual([...levels].sort((a, b) => b - a), levels);
  // Immediate release in the morning and afternoon is the other way round.
  const irLevels = analyzeDay(WITH_IR).amantadine.atDoses.map(item => item.level);
  assert.ok(irLevels.at(-1) > irLevels[0]);
  // Amantadine doses in the same hour as levodopa doses stay out of the levodopa groups.
  assert.equal(analyzeDay([...LEVODOPA_DAY, amantadine("a", "07:00")]).before.length, 4);
});

test("amantadine sentences say when it is high and low, and what it is at the levodopa doses", () => {
  const analysis = analyzeDay(WITH_GOCOVRI);
  const { stats, atDoses } = analysis.amantadine;
  const [first, second] = amantadineSentences(analysis);
  assert.equal(first, `Amantadine is highest at 08:00 (about ${ngText(stats.max)} ng/mL) and lowest at 00:30 (about ${ngText(stats.min)}).`);
  assert.equal(second, `At your levodopa dose times it is between ${ngText(atDoses.at(-1).level)} and ${ngText(atDoses[0].level)} ng/mL `
    + `(${Math.round(atDoses.at(-1).share * 100)}–${Math.round(atDoses[0].share * 100)}% of its peak): lowest at the 19:00 dose, highest at the 07:00 dose.`);
  // One levodopa dose time.
  const one = analyzeDay([ir("l1", "08:00"), gocovri("g", "22:00")]);
  assert.match(amantadineSentences(one)[1], /^At the 08:00 levodopa dose it is about [\d,]+ ng\/mL \(\d+% of its peak\)\.$/);
  // No levodopa: only the first sentence. No amantadine: nothing.
  assert.equal(amantadineSentences(analyzeDay([gocovri("g", "22:00")])).length, 1);
  assert.deepEqual(amantadineSentences(analyzeDay(LEVODOPA_DAY)), []);
  assert.equal(amantadineReadout(analyzeDay(LEVODOPA_DAY), 600), "");
  assert.equal(amantadinePanel(analyzeDay(LEVODOPA_DAY)), null);
  assert.equal(amantadineDesc(analyzeDay(LEVODOPA_DAY)), "");
  // Nothing judges the schedule.
  for (const sentence of amantadineSentences(analysis)) assert.doesNotMatch(sentence, /\b(better|worse|because|should)\b/i);
});

test("the amantadine readout and description follow the curve", () => {
  const analysis = analyzeDay(WITH_GOCOVRI);
  const total = analysis.amantadine.computed.total;
  assert.equal(amantadineValueText(analysis, 540), `amantadine about ${ngText(total[540])} ng/mL`);
  assert.equal(amantadineReadout(analysis, 540), `09:00 · amantadine about ${ngText(total[540])} ng/mL · ${Math.round(total[540] / analysis.amantadine.stats.max * 100)}% of its peak`);
  assert.equal(amantadineReadout(analysis, 480), `08:00 · amantadine about ${ngText(total[480])} ng/mL · 100% of its peak`);
  const desc = amantadineDesc(analysis);
  assert.ok(desc.startsWith(amantadineSentences(analysis).join(" ")));
  assert.match(desc, /Amantadine at each levodopa dose: 07:00 [\d,]+, 11:00 [\d,]+, 15:00 [\d,]+, 19:00 [\d,]+\.$/);
});

test("status, answer bar and hour table include amantadine", () => {
  const analysis = analyzeDay(WITH_GOCOVRI);
  const status = statusMessage(analysis, 5);
  assert.match(status, /^Updated\. 5 doses, 400 mg levodopa \(LEDD 400\) \+ amantadine \(LEDD 425\) = 825 mg LEDD a day\. /);
  assert.match(status, / Amantadine highest about 1,5\d0 ng\/mL at 08:00\.$/);
  // Levodopa only: the message is the one the app always had.
  assert.match(statusMessage(analyzeDay(LEVODOPA_DAY), 4), /^Updated\. 4 doses, 400 mg levodopa = 400 mg LEDD a day\. .* Highest \d+ at \d\d:\d\d\.$/);
  // Amantadine only.
  const only = analyzeDay([gocovri("g", "22:00")]);
  assert.match(statusMessage(only, 1), /^Updated\. 1 dose, 0 mg levodopa \(LEDD 0\) \+ amantadine \(LEDD 425\) = 425 mg LEDD a day\. Amantadine highest about [\d,]+ ng\/mL at 08:00\.$/);
  assert.equal(answerBarLow(only), "Amantadine peaks at 08:00 ↓");
  assert.deepEqual(headlineSentences(only), []);
  assert.match(answerBarLow(analysis), /^Dips to \d+ at \d\d:\d\d ↓$/);
  const rows = hourlyRows(analysis);
  assert.equal(rows.length, 24);
  assert.equal(rows[22].doses, "22:00 Gocovri 274 mg");
  assert.equal(rows[7].doses, "07:00 Sinemet IR 100 mg");
  assert.equal(rows[9].amantadine, ngText(analysis.amantadine.computed.total[540]));
  assert.ok(!("amantadine" in hourlyRows(analyzeDay(LEVODOPA_DAY))[0]));
  // Doses of both kinds in one hour are listed in time order.
  assert.equal(hourlyRows(analyzeDay([...LEVODOPA_DAY, amantadine("a", "07:30")]))[7].doses, "07:00 Sinemet IR 100 mg, 07:30 Amantadine IR 100 mg");
});

test("pin to compare keeps the amantadine curve and names what changed", () => {
  const pinned = pinSnapshot(analyzeDay(WITH_GOCOVRI));
  assert.ok(pinned.amantadine.total instanceof Float64Array);
  assert.notEqual(pinned.amantadine.total, analyzeDay(WITH_GOCOVRI).amantadine.computed.total);
  assert.equal(pinSnapshot(analyzeDay(LEVODOPA_DAY)).amantadine, null);
  // Same day: nothing to say about amantadine.
  assert.equal(compareModel(analyzeDay(WITH_GOCOVRI), pinned).sentence, "The curve is almost the same as the pinned day. Daily levodopa is the same (400 mg).");
  // Gocovri moved to the morning: same height, different time.
  const moved = compareModel(analyzeDay([...LEVODOPA_DAY, gocovri("g1", "08:00")]), pinned);
  assert.equal(moved.sentence, "Compared with the pinned day: the amantadine peak moves from 08:00 to 18:00. Daily levodopa is the same (400 mg).");
  // Swapped for immediate release: lower, later, and a different LEDD.
  const swapped = compareModel(analyzeDay(WITH_IR), pinned);
  assert.match(swapped.sentence, /^Compared with the pinned day: the highest amantadine level falls from 1,5\d0 to 1,0\d0 ng\/mL \(now at 18:30\)\. Daily levodopa is the same \(400 mg; LEDD 825 → 600\)\.$/);
  // Added and removed.
  assert.match(compareModel(analyzeDay(WITH_GOCOVRI), pinSnapshot(analyzeDay(LEVODOPA_DAY))).sentence, /amantadine is added \(highest about [\d,]+ ng\/mL at 08:00\)/);
  assert.match(compareModel(analyzeDay(LEVODOPA_DAY), pinned).sentence, /amantadine is removed\. Daily levodopa is the same \(400 mg; LEDD 825 → 400\)\.$/);
  for (const result of [moved, swapped]) assert.doesNotMatch(result.sentence, /\b(better|worse|because)\b/i);
});

test("time sheet rows name amantadine doses and pass the sheet's own validation", () => {
  const { rows, notes } = buildSheetRows([...WITH_GOCOVRI, { id: "m", time: "08:00", drug: "amantadine", strength: null, count: null, dose: 150 }, amantadine("a", "16:00", 2)]);
  assert.deepEqual(notes, []);
  assert.deepEqual(rows.map(row => row.name), [
    "Sinemet IR 25/100 · 1 tablet",
    "Amantadine IR · 150 mg amantadine HCl",
    "Amantadine IR 100 mg · 2 capsules or tablets",
    "Gocovri 137 mg · 2 capsules"
  ]);
  assert.deepEqual(rows.at(-1).hours, [22]);
  for (const row of rows) assert.ok(row.name.length <= 60, row.name);
  assert.ok(sheetFromRows(rows));
});

/* ---------- The second chart panel ---------- */

test("the amantadine panel shares the levodopa chart's clock and margins, and is shorter", () => {
  for (const width of [300, 356, 559, 560, 794, 1100]) {
    const tall = chartGeometry(width);
    const short = chartGeometry(width, { short: true });
    for (const key of ["width", "plotLeft", "plotRight", "plotWidth", "hourStep", "gridStep", "compact"]) {
      assert.equal(short[key], tall[key], `${key} at ${width}`);
    }
    assert.ok(short.height < tall.height);
    assert.ok(short.plotHeight >= 120);
  }
  assert.equal(chartGeometry(356, { short: true }).height, 190);
  assert.equal(chartGeometry(560, { short: true }).height, 200);
  assert.equal(chartGeometry(1200, { short: true }).height, 240);
  assert.equal(chartGeometry(300, { printing: true, short: true }).height, 170);
  assert.equal(chartGeometry(300, { printing: true, short: true }).plotWidth, chartGeometry(300, { printing: true }).plotWidth);
});

test("the short axis has at most 4 round steps and no floor at 100", () => {
  assert.deepEqual(shortScale([1636]), { top: 2000, step: 500, ticks: [0, 500, 1000, 1500, 2000] });
  assert.deepEqual(shortScale([991]), { top: 1500, step: 500, ticks: [0, 500, 1000, 1500] });
  assert.deepEqual(shortScale([581]), { top: 800, step: 200, ticks: [0, 200, 400, 600, 800] });
  assert.deepEqual(shortScale([60]).ticks, [0, 20, 40, 60, 80]);
  assert.deepEqual(shortScale([]).ticks, [0, 10]);
  assert.deepEqual(shortScale([Number.NaN, 300]).ticks, [0, 100, 200, 300, 400]);
  for (const peak of [1, 37, 240, 999, 1001, 2600, 4900, 12000]) {
    const scale = shortScale([peak]);
    assert.ok(scale.top >= peak * 1.08 - 1e-9 || scale.top >= 10, String(peak));
    assert.ok(scale.ticks.length <= 5 && scale.ticks.at(-1) === scale.top);
  }
});

test("scene: the amantadine panel draws its own doses, levodopa dose markers, and no 100 line", () => {
  const analysis = analyzeDay(WITH_IR);
  const panel = amantadinePanel(analysis);
  assert.deepEqual(panel.doses.map(dose => dose.id), ["a1", "a2"]);
  assert.deepEqual(panel.lines, { target: null, high: null });
  assert.deepEqual(panel.before.map(row => [row.number, row.minute]), analysis.before.map(row => [row.number, row.groupStart]));
  for (const width of [356, 794]) {
    const levodopa = buildChartScene(analysis, { cursorMinute: 600 }, width);
    const { root, info } = buildChartScene(panel, { variant: "amantadine", cursorMinute: 600 }, width);
    // Same plot edges, so one clock time sits at one x in both charts.
    assert.equal(info.geometry.plotLeft, levodopa.info.geometry.plotLeft);
    assert.equal(info.geometry.plotRight, levodopa.info.geometry.plotRight);
    assert.deepEqual(info.hours.map(hour => hour.x), levodopa.info.hours.map(hour => hour.x));
    assert.equal(byClass(root, "chart-cursor-line")[0].attrs.x1, byClass(levodopa.root, "chart-cursor-line")[0].attrs.x1);
    // Curves and triangles: the amantadine doses only, in their own colour.
    const curves = byClass(root, "chart-dose");
    assert.deepEqual(curves.map(curve => curve.attrs["data-dose-id"]), ["a1", "a2"]);
    for (const curve of curves) assert.equal(curve.attrs.stroke, DRUG_BY_ID.amantadine.style.color);
    assert.equal(byClass(root, "chart-dose-mark").length, 2);
    assert.deepEqual(byClass(levodopa.root, "chart-dose").map(curve => curve.attrs["data-drug"]), ["sinemet", "sinemet", "sinemet", "sinemet"]);
    // No 100 reference, no lines, no shading: those belong to the levodopa scale.
    for (const name of ["chart-ref", "chart-ref-label", "chart-target", "chart-high", "chart-shade-below", "chart-shade-above"]) {
      assert.equal(byClass(root, name).length, 0, name);
    }
    assert.ok(!info.labels.some(label => label.key === "ref"));
    assert.deepEqual(info.scale, shortScale([analysis.amantadine.stats.max]));
    // One numbered marker per levodopa dose time, at that time.
    assert.deepEqual(info.markers.map(marker => [marker.number, marker.minute]), analysis.before.map(row => [String(row.number), row.groupStart]));
    assert.equal(root.attrs["aria-label"], AMANTADINE_TITLE);
    // Only classes the stylesheet contract knows.
    const hooks = new Set(Object.values(CHART_CLASSES));
    walk(root, item => {
      for (const name of String(item.attrs.class ?? "").split(" ")) if (name) assert.ok(hooks.has(name), name);
    });
  }
  // The levodopa chart is untouched by the variant.
  const plain = buildChartScene(analysis, {}, 794);
  assert.equal(byClass(plain.root, "chart-ref").length, 1);
  assert.equal(plain.root.attrs["aria-label"], "Levodopa level over a typical day");
});

test("scene: a pinned amantadine day draws as the grey dashed line and sets the axis", () => {
  const pinned = pinSnapshot(analyzeDay(WITH_GOCOVRI));
  const analysis = analyzeDay(WITH_IR);
  const { root, info } = buildChartScene(amantadinePanel(analysis), { variant: "amantadine", pinnedTotal: pinned.amantadine.total }, 794);
  assert.equal(byClass(root, "chart-pinned").length, 1);
  assert.ok(info.scale.top >= pinned.amantadine.max);
  assert.deepEqual(info.labels.map(label => label.text), ["Pinned"]);
  // Printing: 720 px wide and no cursor, like the levodopa chart.
  const printed = buildChartScene(amantadinePanel(analysis), { variant: "amantadine", printing: true }, 300);
  assert.equal(printed.info.geometry.width, 720);
  assert.equal(byClass(printed.root, "chart-cursor").length, 0);
});

/* ---------- Copy ---------- */

test("the amantadine tips state the scale, the kidney caveat and the LEDD arithmetic", () => {
  assert.match(TIPS.amantadineLevel, /ng\/mL/);
  assert.match(TIPS.amantadineLevel, /kidney/);
  assert.match(TIPS.amantadineLevel, /by time, not by height/);
  assert.match(TIPS.leddAmantadine, /immediate release ×1, Gocovri ×1\.25 \(Jost 2023\)/);
  assert.match(TIPS.leddAmantadine, /340 × 1\.25 = 425 mg/);
  assert.match(TIPS.leddAmantadine, /not a dose-conversion tool/);
});
