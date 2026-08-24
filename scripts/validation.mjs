// Validation study for the pdmeds exposure model.
//
// Part 1 (face validity): computes the tool's single-dose curves with the
// model code actually shipped in src/, extracts pharmacokinetic landmarks
// (Tmax, dose-normalized Cmax ratio vs IR, apparent post-peak half-life,
// duration above 50% Cmax, AUC per mg relative to IR), for comparison
// against published label / study values collected in docs/validation.md.
//
// Part 2 (model comparison): simulates the published population
// pharmacokinetic model of oral levodopa/carbidopa from Othman & Dutta
// 2014 (Br J Clin Pharmacol 78:94-105; two-compartment disposition,
// first-order absorption ktr 2.4 h^-1, CL/F 24.8 L/h, Vc/F 58.5 L,
// Q/F 6.8 L/h, Vp/F 72.9 L) and compares its curve shapes against the
// tool's for a single 100 mg dose and for the example 4 x 100 mg regimen.
//
// Usage: node scripts/validation.mjs   (writes docs/validation/data.json)

import { writeFileSync } from "node:fs";
import { DRUG_BY_ID } from "../src/drugs.js";
import { contributionAtMinute } from "../src/model.js";

const MINUTES = 24 * 60;

/* ---------- Part 1: tool curves and landmarks ---------- */

function toolSingleDoseCurve(drugId, doseMg) {
  const drug = DRUG_BY_ID[drugId];
  const dose = { time: "00:00", drug: drugId, dose: doseMg };
  const state = { doses: [dose], days: 1 };
  const values = new Array(MINUTES + 1);
  for (let minute = 0; minute <= MINUTES; minute += 1) {
    values[minute] = contributionAtMinute(dose, drug, minute, state);
  }
  return values;
}

function landmarks(values, doseMg) {
  let cmax = 0;
  let tmax = 0;
  for (let t = 0; t <= MINUTES; t += 1) {
    if (values[t] > cmax) { cmax = values[t]; tmax = t; }
  }
  const half = cmax / 2;
  const quarter = cmax / 4;
  let up50 = null, down50 = null, down25 = null;
  for (let t = 0; t <= MINUTES; t += 1) {
    if (up50 === null && values[t] >= half) up50 = t;
    if (t > tmax && down50 === null && values[t] <= half) down50 = t;
    if (t > tmax && down25 === null && values[t] <= quarter) down25 = t;
  }
  let auc = 0;
  for (let t = 0; t < MINUTES; t += 1) auc += (values[t] + values[t + 1]) / 2;
  return {
    tmaxMin: tmax,
    cmaxPerMg: cmax / doseMg,
    durationAbove50Min: down50 !== null && up50 !== null ? down50 - up50 : null,
    apparentPostPeakHalfLifeMin: down50 !== null && down25 !== null ? down25 - down50 : null,
    aucPerMgUnitH: auc / 60 / doseMg
  };
}

const CASES = [
  { id: "sinemet", dose: 100 },
  { id: "sinemetcr", dose: 100 },
  { id: "rytary", dose: 390 },   // dose used in Hsu 2015 (2 x ER capsules)
  { id: "crexont", dose: 140 },
  { id: "inbrija", dose: 84 }
];

const tool = {};
for (const { id, dose } of CASES) {
  const curve = toolSingleDoseCurve(id, dose);
  tool[id] = { dose, curve, ...landmarks(curve, dose) };
}
const irRef = tool.sinemet;
for (const { id } of CASES) {
  tool[id].cmaxRatioVsIr = tool[id].cmaxPerMg / irRef.cmaxPerMg;
  tool[id].aucRatioVsIr = tool[id].aucPerMgUnitH / irRef.aucPerMgUnitH;
}

/* ---------- Part 2: population PK reference model ---------- */
/* Othman & Dutta 2014, oral levodopa/carbidopa tablets in advanced PD. */

const POPPK = {
  ka: 2.4,     // h^-1 (transit absorption; mean absorption time 25 min)
  CL: 24.8,    // L/h
  Vc: 58.5,    // L
  Q: 6.8,      // L/h
  Vp: 72.9     // L
};

// RK4 over [depot, central amount, peripheral amount]; concentrations mg/L.
function simulatePopPk(dosesMgAtMin, totalMinutes) {
  const dt = 1 / 60; // 1-minute steps in hours
  const k10 = POPPK.CL / POPPK.Vc;
  const k12 = POPPK.Q / POPPK.Vc;
  const k21 = POPPK.Q / POPPK.Vp;
  let depot = 0, central = 0, peripheral = 0;
  const doseAt = new Map(dosesMgAtMin.map(d => [d.minute, d.mg]));
  const conc = new Array(totalMinutes + 1);

  const deriv = (a, c, p) => [
    -POPPK.ka * a,
    POPPK.ka * a - k10 * c - k12 * c + k21 * p,
    k12 * c - k21 * p
  ];

  for (let minute = 0; minute <= totalMinutes; minute += 1) {
    if (doseAt.has(minute)) depot += doseAt.get(minute);
    conc[minute] = (central / POPPK.Vc) * 1000; // mg/L -> ng/mL
    const k1 = deriv(depot, central, peripheral);
    const k2 = deriv(depot + k1[0] * dt / 2, central + k1[1] * dt / 2, peripheral + k1[2] * dt / 2);
    const k3 = deriv(depot + k2[0] * dt / 2, central + k2[1] * dt / 2, peripheral + k2[2] * dt / 2);
    const k4 = deriv(depot + k3[0] * dt, central + k3[1] * dt, peripheral + k3[2] * dt);
    depot += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    central += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    peripheral += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  }
  return conc;
}

function normalizeToUnitAuc(values) {
  let auc = 0;
  for (let t = 0; t < values.length - 1; t += 1) auc += (values[t] + values[t + 1]) / 2;
  auc /= 60;
  return values.map(v => v / auc);
}

function curveMetrics(reference, candidate) {
  // Both curves AUC-normalized on the same grid.
  const peak = Math.max(...reference);
  let sumSq = 0;
  for (let t = 0; t < reference.length; t += 1) {
    sumSq += (reference[t] - candidate[t]) ** 2;
  }
  return {
    nrmsePctOfRefPeak: Math.sqrt(sumSq / reference.length) / peak * 100,
    refTmaxMin: reference.indexOf(peak),
    candTmaxMin: candidate.indexOf(Math.max(...candidate))
  };
}

// Single 100 mg dose, 8-hour window.
const WINDOW = 8 * 60;
const popSingle = simulatePopPk([{ minute: 0, mg: 100 }], WINDOW);
const toolSingle = tool.sinemet.curve.slice(0, WINDOW + 1);
const popSingleN = normalizeToUnitAuc(popSingle);
const toolSingleN = normalizeToUnitAuc(toolSingle);

// Apparent post-peak half-life of the reference model (t50 -> t25 after peak).
const popLm = landmarks(popSingle, 100);

// Example regimen: 100 mg at 07:00, 11:00, 15:00, 19:00 over 24 h.
const regimenTimes = [7, 11, 15, 19].map(h => h * 60);
const popDay = simulatePopPk(regimenTimes.map(minute => ({ minute, mg: 100 })), MINUTES);
const dayDoses = regimenTimes.map(minute => ({
  time: `${String(minute / 60).padStart(2, "0")}:00`, drug: "sinemet", dose: 100
}));
const dayState = { doses: dayDoses, days: 1 };
const toolDay = new Array(MINUTES + 1).fill(0);
for (let minute = 0; minute <= MINUTES; minute += 1) {
  for (const dose of dayDoses) {
    toolDay[minute] += contributionAtMinute(dose, DRUG_BY_ID.sinemet, minute, dayState);
  }
}
const popDayN = normalizeToUnitAuc(popDay);
const toolDayN = normalizeToUnitAuc(toolDay);

function peakTroughStats(values, startMin, endMin) {
  let peak = 0, trough = Infinity;
  for (let t = startMin; t <= endMin; t += 1) {
    if (values[t] > peak) peak = values[t];
    if (values[t] < trough) trough = values[t];
  }
  return { peak, trough, ratio: trough > 0 ? peak / trough : null };
}

const output = {
  generated: "run `node scripts/validation.mjs` to regenerate",
  popPkParameters: POPPK,
  tool: Object.fromEntries(Object.entries(tool).map(([id, v]) => [id, {
    dose: v.dose,
    tmaxMin: v.tmaxMin,
    cmaxPerMg: v.cmaxPerMg,
    cmaxRatioVsIr: v.cmaxRatioVsIr,
    aucRatioVsIr: v.aucRatioVsIr,
    durationAbove50Min: v.durationAbove50Min,
    apparentPostPeakHalfLifeMin: v.apparentPostPeakHalfLifeMin,
    curve: v.curve.filter((_, t) => t % 5 === 0)
  }])),
  popPk: {
    singleDoseNgMl: popSingle.filter((_, t) => t % 5 === 0),
    singleDoseLandmarks: popLm,
    dayNgMl: popDay.filter((_, t) => t % 5 === 0)
  },
  comparison: {
    singleDose: {
      ...curveMetrics(popSingleN, toolSingleN),
      refCurveNormalized: popSingleN.filter((_, t) => t % 5 === 0),
      toolCurveNormalized: toolSingleN.filter((_, t) => t % 5 === 0)
    },
    day: {
      ...curveMetrics(popDayN, toolDayN),
      refCurveNormalized: popDayN.filter((_, t) => t % 5 === 0),
      toolCurveNormalized: toolDayN.filter((_, t) => t % 5 === 0),
      // Window starts one hour after the first dose so the pre-absorption
      // zero at 07:00 does not masquerade as the daytime trough.
      refPeakTrough: peakTroughStats(popDayN, 8 * 60, 23 * 60),
      toolPeakTrough: peakTroughStats(toolDayN, 8 * 60, 23 * 60)
    }
  }
};

writeFileSync(new URL("../docs/validation/data.json", import.meta.url), JSON.stringify(output));
console.log("tool landmarks:");
for (const { id } of CASES) {
  const v = tool[id];
  console.log(`  ${id}: Tmax ${v.tmaxMin} min, Cmax ratio vs IR ${v.cmaxRatioVsIr.toFixed(2)}, ` +
    `T>50% ${v.durationAbove50Min} min, post-peak t1/2 ${v.apparentPostPeakHalfLifeMin} min, AUC ratio ${v.aucRatioVsIr.toFixed(2)}`);
}
console.log(`popPK single 100 mg: Cmax ${Math.max(...popSingle).toFixed(0)} ng/mL, ` +
  `Tmax ${popLm.tmaxMin} min, T>50% ${popLm.durationAbove50Min} min, post-peak t1/2 ${popLm.apparentPostPeakHalfLifeMin} min`);
console.log(`single-dose shape divergence (NRMSE % of ref peak): ${output.comparison.singleDose.nrmsePctOfRefPeak.toFixed(1)}`);
console.log(`day regimen shape divergence (NRMSE % of ref peak): ${output.comparison.day.nrmsePctOfRefPeak.toFixed(1)}`);
