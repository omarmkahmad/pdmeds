import {
  DRUG_BY_ID,
  LD_AUC,
  LN2,
  MINUTES_PER_DAY,
  MODEL_VERSION,
  REGIMEN_SCHEMA_VERSION
} from "./drugs.js";
import { countStep, doseMg, inferStrength, strengthOf, validateCount } from "./amounts.js";

export const MAX_DOSES = 64;
export const MAX_DOSE_MG = 20000;
export const MAX_THRESHOLD = 20000;

const EPSILON = 1e-6;
const NOT_A_SCHEDULE = "This isn't a schedule file.";
const NEWER_VERSION = "This file was made by a newer version of the Explorer. Reload the page and try again.";
const DAYS_NOTE = "The old \"days\" setting is no longer used.";
const DOSE_LIMIT = `${MAX_DOSES} doses is the limit.`;
// Longest time text quoted back in an error; longer text reads "A dose".
const MAX_NAMED_TIME = 16;

export class ModelValidationError extends Error {
  constructor(messages) {
    super(messages.join(" "));
    this.name = "ModelValidationError";
    this.messages = messages;
  }
}

export function isValidTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function toMinute(value) {
  if (!isValidTime(value)) return Number.NaN;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function formatClock(value) {
  const wrapped = ((Math.round(value) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatDuration(value) {
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours} h ${remainder} min`;
  if (hours) return `${hours} h`;
  return `${remainder} min`;
}

function isPositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function countOf(count, one, many) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function isAbsent(value) {
  return value === undefined || value === null;
}

// A number from a file: null when blank, NaN when unreadable. Numeric strings
// are read as numbers, as the old importer did.
function readNumber(value) {
  if (isAbsent(value)) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : Number.NaN;
}

function readLine(value, name, errors) {
  const number = readNumber(value);
  if (number === null) return null;
  if (Number.isNaN(number) || number < 0 || number > MAX_THRESHOLD) {
    errors.push(`The ${name} must be a level from 0 to ${MAX_THRESHOLD.toLocaleString("en-US")}.`);
    return null;
  }
  // 0 means not set.
  return number > 0 ? number : null;
}

// Each line is optional and independent. A high line at or below the target
// (or without one) is a UI note, not an error.
export function validateThresholds(onThreshold, dyskinesiaThreshold) {
  const errors = [];
  const on = readLine(onThreshold, "target line", errors);
  const high = readLine(dyskinesiaThreshold, "high line", errors);
  return { onThreshold: on, dyskinesiaThreshold: high, errors };
}

// The file's schema version, or null for the oldest files, which have none.
function readSchemaVersion(version) {
  if (isAbsent(version)) return null;
  const number = readNumber(version);
  if (number > REGIMEN_SCHEMA_VERSION) throw new ModelValidationError([NEWER_VERSION]);
  if (!Number.isInteger(number) || number < 1) throw new ModelValidationError([NOT_A_SCHEDULE]);
  return number;
}

// Errors name a dose by the time written in the file, never by row number.
function doseName(time) {
  let text = "";
  if (typeof time === "string") text = time.trim();
  else if (typeof time === "number" && Number.isFinite(time)) text = String(time);
  return text && text.length <= MAX_NAMED_TIME ? `The ${text} dose` : "A dose";
}

// Strength and count are kept only when the strength belongs to the drug, the
// count fits its step and range, and together they give the dose. Otherwise
// they are worked out from the mg, and no exact fit means mg mode.
// From schema 2 on, a dose saved with neither was in mg mode, so it stays in
// mg mode even when a strength fits (so the file survives a round trip).
function amountFields(drug, raw, dose, savesMode) {
  if (dose === null) return { strength: null, count: null };
  if (savesMode && isAbsent(raw.strength) && isAbsent(raw.count)) return { strength: null, count: null };
  const strength = strengthOf(drug, raw.strength);
  if (strength && typeof raw.count === "number" && validateCount(drug, strength.id, raw.count) === null) {
    const step = countStep(drug, strength.id);
    const count = Math.round(raw.count / step) * step;
    if (Math.abs(doseMg(drug, strength.id, count) - dose) < EPSILON) return { strength: strength.id, count };
  }
  const inferred = inferStrength(drug, dose);
  return inferred ? { strength: inferred.strength, count: inferred.count } : { strength: null, count: null };
}

function readDose(raw, savesMode, errors) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("A dose in this file can't be read.");
    return null;
  }
  const time = raw.time ?? raw.t ?? "08:00";
  const name = doseName(time);
  const timeOk = isValidTime(time);
  if (!timeOk) errors.push(`${name} has a time that can't be read.`);
  const drug = typeof raw.drug === "string" ? DRUG_BY_ID[raw.drug] : undefined;
  if (!drug) errors.push(`${name} has an unknown medicine.`);
  const amount = readNumber(raw.dose);
  if (Number.isNaN(amount)) {
    errors.push(`${name} has an amount that can't be read.`);
  } else if (amount !== null && (amount < 0 || amount > MAX_DOSE_MG)) {
    errors.push(`${name} has an amount outside 0 to ${MAX_DOSE_MG.toLocaleString("en-US")} mg.`);
  }
  if (!timeOk || !drug || Number.isNaN(amount)) return null;
  // 0, blank and missing all mean "no amount yet" (never 0).
  const dose = isPositive(amount) && amount <= MAX_DOSE_MG ? amount : null;
  return { time, drug: drug.id, ...amountFields(drug, raw, dose, savesMode), dose };
}

export function validateRegimenPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ModelValidationError([NOT_A_SCHEDULE]);
  }
  // Checked first: a newer file may not have a doses array at all.
  const version = readSchemaVersion(payload.schemaVersion);
  if (!Array.isArray(payload.doses)) throw new ModelValidationError([NOT_A_SCHEDULE]);
  if (payload.doses.length > MAX_DOSES) {
    throw new ModelValidationError([`This file has ${countOf(payload.doses.length, "dose", "doses")}. ${DOSE_LIMIT}`]);
  }

  const errors = [];
  const savesMode = version !== null && version >= 2;
  const read = payload.doses.map(raw => readDose(raw, savesMode, errors));
  const thresholds = validateThresholds(
    payload.onThreshold ?? payload.onThr ?? null,
    payload.dyskinesiaThreshold ?? payload.dysThr ?? null
  );
  errors.push(...thresholds.errors);
  if (errors.length) throw new ModelValidationError([...new Set(errors)]);

  const doses = read.map((dose, index) => ({ id: `d${index + 1}`, ...dose }));
  const notes = [];
  // The model always shows a day that repeats, so "days" has no meaning now.
  if (payload.days !== undefined && payload.days !== null) notes.push(DAYS_NOTE);
  const hidden = payload.doses.filter(raw => Boolean(raw.hidden)).length;
  if (hidden) {
    notes.push(`This file had ${countOf(hidden, "dose", "doses")} hidden from the total. All doses now count.`);
  }
  const missing = doses.filter(dose => dose.dose === null).length;
  if (missing) notes.push(`${countOf(missing, "dose", "doses")} had no amount. Add one to count it.`);

  return {
    doses,
    onThreshold: thresholds.onThreshold,
    dyskinesiaThreshold: thresholds.dyskinesiaThreshold,
    example: payload.example === true,
    notes
  };
}

export function calculateLedSummary(doses) {
  if (!Array.isArray(doses) || doses.length > MAX_DOSES) {
    throw new ModelValidationError([DOSE_LIMIT]);
  }
  const rows = doses.map((dose, index) => {
    const drug = DRUG_BY_ID[dose.drug];
    if (!drug || !Number.isFinite(dose.dose) || dose.dose <= 0) {
      return { index, totalLed: 0 };
    }
    return { index, totalLed: dose.dose * drug.led.value };
  });

  return {
    rows,
    totalLed: rows.reduce((sum, row) => sum + row.totalLed, 0)
  };
}

export function componentShapeAuc(component) {
  return component.fraction * component.weight * (component.peakTime / 2 + component.halfLife / LN2);
}

export function normalizedComponentPeaks(drug, targetExposureLed) {
  if (drug.exposure.kind !== "components") return [];
  const shapeAuc = drug.exposure.values.reduce((sum, component) => sum + componentShapeAuc(component), 0);
  if (!(shapeAuc > 0) || !(targetExposureLed > 0)) return drug.exposure.values.map(() => 0);
  const scale = targetExposureLed * LD_AUC / shapeAuc;
  return drug.exposure.values.map(component => scale * component.fraction * component.weight);
}

export function modeledInfiniteAuc(drug, targetExposureLed) {
  if (drug.exposure.kind !== "components") return null;
  const peaks = normalizedComponentPeaks(drug, targetExposureLed);
  return drug.exposure.values.reduce((sum, component, index) => (
    sum + peaks[index] * (component.peakTime / 2 + component.halfLife / LN2)
  ), 0);
}

// The schedule repeats every day, so each dose also contributes from the
// same clock time on every earlier day. Today's and yesterday's doses are
// summed directly. Doses from two or more days back are all past their peak
// (every peakTime is under a day), so their decaying tails form a geometric
// series with ratio 0.5^(1440 / halfLife), added here in closed form. The
// result is the exact steady state of a schedule repeated daily.
export function contributionAtMinute(dose, drug, minute) {
  if (!drug || !(dose.dose > 0) || !Number.isFinite(minute)) return 0;
  const targetLed = dose.dose * drug.exposure.exposureFactor;
  if (!(targetLed > 0) || !Number.isFinite(targetLed)) return 0;

  const doseMinute = toMinute(dose.time);
  if (!Number.isFinite(doseMinute)) return 0;
  let level = 0;

  const peaks = normalizedComponentPeaks(drug, targetLed);
  for (let day = 0; day < 2; day += 1) {
    const elapsed = minute - doseMinute + MINUTES_PER_DAY * day;
    if (elapsed < 0) continue;
    drug.exposure.values.forEach((component, index) => {
      if (component.peakTime > 0 && elapsed <= component.peakTime) {
        level += peaks[index] * elapsed / component.peakTime;
      } else {
        level += peaks[index] * Math.pow(
          0.5,
          (elapsed - Math.max(component.peakTime, 0)) / component.halfLife
        );
      }
    });
  }
  const elapsedTwoDaysBack = minute - doseMinute + 2 * MINUTES_PER_DAY;
  drug.exposure.values.forEach((component, index) => {
    const dailyRatio = Math.pow(0.5, MINUTES_PER_DAY / component.halfLife);
    level += peaks[index] * Math.pow(
      0.5,
      (elapsedTwoDaysBack - Math.max(component.peakTime, 0)) / component.halfLife
    ) / (1 - dailyRatio);
  });
  return level;
}

// Every dose counts. A dose without an amount (dose not > 0) keeps an
// all-zero series and adds nothing to the total.
export function computeDay(state) {
  if (!state || !Array.isArray(state.doses) || state.doses.length > MAX_DOSES) {
    throw new ModelValidationError([DOSE_LIMIT]);
  }
  const led = calculateLedSummary(state.doses);
  const series = state.doses.map(() => new Float64Array(MINUTES_PER_DAY + 1));
  const total = new Float64Array(MINUTES_PER_DAY + 1);

  state.doses.forEach((dose, index) => {
    if (!isPositive(dose.dose)) return;
    const drug = DRUG_BY_ID[dose.drug];
    const values = series[index];
    for (let minute = 0; minute <= MINUTES_PER_DAY; minute += 1) {
      const value = contributionAtMinute(dose, drug, minute);
      if (!Number.isFinite(value)) throw new ModelValidationError([`The ${dose.time} dose produced a non-finite result.`]);
      values[minute] = value;
      total[minute] += value;
    }
  });

  let maximum = 0;
  let maximumMinute = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let minimumMinute = 0;
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
    if (total[minute] > maximum) {
      maximum = total[minute];
      maximumMinute = minute;
    }
    if (total[minute] < minimum) {
      minimum = total[minute];
      minimumMinute = minute;
    }
  }
  if (!Number.isFinite(minimum)) minimum = 0;
  return { series, total, maximum, maximumMinute, minimum, minimumMinute, led };
}

export function classifyLevel(value, onThreshold, dyskinesiaThreshold) {
  if (dyskinesiaThreshold !== null && dyskinesiaThreshold > 0 && value >= dyskinesiaThreshold) return "high";
  if (onThreshold !== null && onThreshold > 0 && value >= onThreshold) return "target";
  if (onThreshold !== null && onThreshold > 0) return "low";
  return "unclassified";
}

export function longestCircularRun(values, predicate) {
  const length = values.length;
  if (!length) return 0;
  const firstBreak = values.findIndex(value => !predicate(value));
  if (firstBreak === -1) return length;
  let longest = 0;
  let current = 0;
  for (let offset = 1; offset <= length; offset += 1) {
    const value = values[(firstBreak + offset) % length];
    if (predicate(value)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function calculateStatistics(computed, state) {
  const values = Array.from(computed.total.slice(0, MINUTES_PER_DAY));
  const mean = values.reduce((sum, value) => sum + value, 0) / MINUTES_PER_DAY;
  const result = {
    ledd: computed.led.totalLed,
    peak: computed.maximum,
    peakMinute: computed.maximumMinute,
    trough: computed.minimum,
    troughMinute: computed.minimumMinute,
    fluctuationIndex: mean > 0 ? (computed.maximum - computed.minimum) / mean : null
  };
  if (state.onThreshold !== null && state.onThreshold > 0) {
    result.targetMinutes = values.filter(value => value >= state.onThreshold).length;
    result.lowMinutes = MINUTES_PER_DAY - result.targetMinutes;
    result.longestLowMinutes = longestCircularRun(values, value => value < state.onThreshold);
  }
  if (state.dyskinesiaThreshold !== null && state.dyskinesiaThreshold > 0) {
    result.highMinutes = values.filter(value => value >= state.dyskinesiaThreshold).length;
  }
  return result;
}

// Schema 2. The levodopa mg stays the source of truth; strength and count are
// written only when set (not in mg mode). Doses without an amount are left
// out, and ids, days, hidden and the pin are never written.
export function exportRegimen(state) {
  const doses = (Array.isArray(state?.doses) ? state.doses : [])
    .filter(dose => dose && isPositive(dose.dose))
    .map(dose => {
      const entry = { time: dose.time, drug: dose.drug, dose: dose.dose };
      if (typeof dose.strength === "string" && dose.strength && isPositive(dose.count)) {
        entry.strength = dose.strength;
        entry.count = dose.count;
      }
      return entry;
    });
  return {
    schemaVersion: REGIMEN_SCHEMA_VERSION,
    modelVersion: MODEL_VERSION,
    exportedAt: new Date().toISOString(),
    doses,
    onThreshold: isPositive(state?.onThreshold) ? state.onThreshold : null,
    dyskinesiaThreshold: isPositive(state?.dyskinesiaThreshold) ? state.dyskinesiaThreshold : null
  };
}
