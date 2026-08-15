import {
  DRUG_BY_ID,
  LD_AUC,
  LN2,
  MINUTES_PER_DAY,
  MODEL_VERSION,
  REGIMEN_SCHEMA_VERSION
} from "./drugs.js";

export const MAX_DOSES = 64;
export const MAX_DOSE_MG = 20000;
export const MAX_THRESHOLD = 20000;

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

function finiteNumber(value, { label, minimum = 0, maximum, nullable = false, integer = false }, errors) {
  if ((value === "" || value === null || value === undefined) && nullable) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    errors.push(`${label} must be a finite number.`);
    return nullable ? null : minimum;
  }
  if (number < minimum || (maximum !== undefined && number > maximum)) {
    errors.push(`${label} must be between ${minimum} and ${maximum}.`);
  }
  if (integer && !Number.isInteger(number)) errors.push(`${label} must be a whole number.`);
  return Math.min(maximum ?? number, Math.max(minimum, integer ? Math.round(number) : number));
}

export function validateThresholds(onThreshold, dyskinesiaThreshold) {
  const errors = [];
  const on = finiteNumber(onThreshold, {
    label: "Target threshold", minimum: 0, maximum: MAX_THRESHOLD, nullable: true
  }, errors);
  const dyskinesia = finiteNumber(dyskinesiaThreshold, {
    label: "High-exposure threshold", minimum: 0, maximum: MAX_THRESHOLD, nullable: true
  }, errors);
  if (dyskinesia !== null && on === null) {
    errors.push("Set a target threshold before setting a high-exposure threshold.");
  }
  if (on !== null && dyskinesia !== null && dyskinesia <= on) {
    errors.push("High-exposure threshold must be greater than the target threshold.");
  }
  return { onThreshold: on, dyskinesiaThreshold: dyskinesia, errors };
}

export function validateRegimenPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ModelValidationError(["Regimen must be a JSON object."]);
  }
  if (!Array.isArray(payload.doses)) {
    throw new ModelValidationError(["Regimen must contain a doses array."]);
  }
  if (payload.doses.length > MAX_DOSES) {
    throw new ModelValidationError([`A regimen can contain at most ${MAX_DOSES} rows.`]);
  }

  const doses = payload.doses.map((rawDose, index) => {
    const row = index + 1;
    if (!rawDose || typeof rawDose !== "object" || Array.isArray(rawDose)) {
      errors.push(`Row ${row} must be an object.`);
      return null;
    }
    const drug = DRUG_BY_ID[rawDose.drug];
    if (!drug) errors.push(`Row ${row} has an unknown drug.`);
    const time = rawDose.time ?? rawDose.t ?? "08:00";
    if (!isValidTime(time)) errors.push(`Row ${row} has an invalid time.`);
    const dose = finiteNumber(rawDose.dose, {
      label: `Row ${row} dose`, minimum: 0, maximum: MAX_DOSE_MG
    }, errors);
    return drug ? {
      time: isValidTime(time) ? time : "08:00",
      drug: drug.id,
      dose,
      hidden: Boolean(rawDose.hidden)
    } : null;
  }).filter(Boolean);

  const thresholds = validateThresholds(
    payload.onThreshold ?? payload.onThr ?? null,
    payload.dyskinesiaThreshold ?? payload.dysThr ?? null
  );
  errors.push(...thresholds.errors);

  const days = finiteNumber(payload.days ?? 2, {
    label: "Days in treatment", minimum: 1, maximum: 7, integer: true
  }, errors);
  if (errors.length) throw new ModelValidationError(errors);

  return {
    doses,
    onThreshold: thresholds.onThreshold,
    dyskinesiaThreshold: thresholds.dyskinesiaThreshold,
    days,
    example: Boolean(payload.example)
  };
}

export function calculateLedSummary(doses) {
  if (!Array.isArray(doses) || doses.length > MAX_DOSES) {
    throw new ModelValidationError([`A regimen can contain at most ${MAX_DOSES} rows.`]);
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

export function contributionAtMinute(dose, drug, minute, state) {
  if (!drug || !(dose.dose > 0) || !Number.isFinite(minute)) return 0;
  const targetLed = dose.dose * drug.exposure.exposureFactor;
  if (!(targetLed > 0) || !Number.isFinite(targetLed)) return 0;

  const doseMinute = toMinute(dose.time);
  if (!Number.isFinite(doseMinute)) return 0;
  const days = Math.min(7, Math.max(1, state.days));
  let level = 0;

  const peaks = normalizedComponentPeaks(drug, targetLed);
  for (let day = 0; day < days; day += 1) {
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
  return level;
}

export function computeDay(state) {
  if (!state || !Array.isArray(state.doses) || state.doses.length > MAX_DOSES) {
    throw new ModelValidationError([`A regimen can contain at most ${MAX_DOSES} rows.`]);
  }
  const led = calculateLedSummary(state.doses);
  const series = state.doses.map(() => new Float64Array(MINUTES_PER_DAY + 1));
  const total = new Float64Array(MINUTES_PER_DAY + 1);

  for (let minute = 0; minute <= MINUTES_PER_DAY; minute += 1) {
    let sum = 0;
    state.doses.forEach((dose, index) => {
      const value = contributionAtMinute(
        dose,
        DRUG_BY_ID[dose.drug],
        minute,
        state
      );
      if (!Number.isFinite(value)) throw new ModelValidationError([`Row ${index + 1} produced a non-finite result.`]);
      series[index][minute] = value;
      if (!dose.hidden) sum += value;
    });
    total[minute] = sum;
  }

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

export function exportRegimen(state) {
  return {
    schemaVersion: REGIMEN_SCHEMA_VERSION,
    modelVersion: MODEL_VERSION,
    exportedAt: new Date().toISOString(),
    doses: state.doses.map(dose => ({
      time: dose.time,
      drug: dose.drug,
      dose: dose.dose,
      ...(dose.hidden ? { hidden: true } : {})
    })),
    onThreshold: state.onThreshold,
    dyskinesiaThreshold: state.dyskinesiaThreshold,
    days: state.days
  };
}
