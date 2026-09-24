// Dose amounts: strength × count, levodopa mg, LEDD text and the notes the
// editor shows. Pure: no DOM. Imports only drugs.js and time.js.
import { DRUG_BY_ID } from "./drugs.js";
import { formatClock, formatCount, formatNumber, parseCount } from "./time.js";

const EPSILON = 1e-6;
const MAX_MG = 2000;
const TABLET_COUNT_BELOW_MG = 25;
const DEFAULT_GAP = 180;
const MIN_GAP = 60;
const MAX_GAP = 360;

const MG_BLANK_NOTE = "Enter the levodopa mg. Until then this dose is not counted.";
const MG_SLASH_ERROR = "Type only the levodopa amount (the second number, e.g. 100), or pick a strength.";
const MG_RANGE_ERROR = "Enter 1 to 2000 mg.";
const NO_AMOUNT_TEXT = "No amount yet · not counted";

// Accept a drug object or its id.
function drugOf(drug) {
  if (typeof drug === "string") return DRUG_BY_ID[drug] ?? null;
  return drug && typeof drug === "object" ? drug : null;
}

function isAmount(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toMinute(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof time === "string" ? time : "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function unitWord(drug, count) {
  return count > 1 ? drug.unit[1] : drug.unit[0];
}

function factorText(drug) {
  return `×${formatNumber(drug.led.value, 2)}`;
}

export function strengthOf(drug, strengthId) {
  const entry = drugOf(drug);
  if (!entry || strengthId === null || strengthId === undefined) return null;
  const id = String(strengthId);
  return entry.strengths.find(strength => strength.id === id)
    ?? entry.strengths.find(strength => strength.label === id)
    ?? null;
}

export function minCount(drug, strengthId) {
  return strengthOf(drug, strengthId)?.halves ? 0.5 : 1;
}

export function countStep(drug, strengthId) {
  return strengthOf(drug, strengthId)?.halves ? 0.5 : 1;
}

// Levodopa mg for strength × count, or null when either is missing.
export function doseMg(drug, strengthId, count) {
  const strength = strengthOf(drug, strengthId);
  if (!strength || typeof count !== "number" || !Number.isFinite(count)) return null;
  return strength.levodopa * count;
}

export function inferStrength(drug, mg) {
  const entry = drugOf(drug);
  if (!entry || !isAmount(mg)) return null;
  const candidates = [];
  entry.strengths.forEach((strength, index) => {
    const step = strength.halves ? 0.5 : 1;
    const count = Math.round(mg / strength.levodopa / step) * step;
    if (count < step || count > entry.maxCount) return;
    if (Math.abs(strength.levodopa * count - mg) >= EPSILON) return;
    candidates.push({ strength, count, index, whole: Number.isInteger(count) });
  });
  const isDefault = candidate => (candidate.strength.id === entry.defaultStrength ? 1 : 0);
  // Whole counts first, then fewest units, then the default strength, then the smaller strength.
  candidates.sort((a, b) => (
    (b.whole - a.whole)
    || (a.count - b.count)
    || (isDefault(b) - isDefault(a))
    || (a.strength.levodopa - b.strength.levodopa)
    || (a.index - b.index)
  ));
  const best = candidates[0];
  return best ? { strength: best.strength.id, count: best.count } : null;
}

function countRangeMessage(drug, strength) {
  const max = drug.maxCount;
  if (strength.halves) return `Choose ½ to ${max} ${drug.unit[1]}, in halves.`;
  if (drug.unit[0] === "tablet") return `This strength is taken as whole tablets. Choose 1 to ${max}.`;
  if (max === 2) return `Choose 1 or 2 ${drug.unit[1]}.`;
  return `Choose 1 to ${max} ${drug.unit[1]}.`;
}

// The hard count error for this strength, or null when the count is fine.
// Returns null in mg mode (no strength). An unreadable count (null, NaN, or
// text parseCount can't read) gets the error too.
export function validateCount(drug, strengthId, count) {
  const entry = drugOf(drug);
  const strength = strengthOf(entry, strengthId);
  if (!entry || !strength) return null;
  const value = typeof count === "string" ? parseCount(count) : count;
  const step = strength.halves ? 0.5 : 1;
  const ok = typeof value === "number"
    && Number.isFinite(value)
    && value >= step - EPSILON
    && value <= entry.maxCount + EPSILON
    && Math.abs(value / step - Math.round(value / step)) < EPSILON;
  return ok ? null : countRangeMessage(entry, strength);
}

// Reads the "Levodopa (mg)" field.
export function parseMg(text) {
  const value = String(text ?? "").trim().toLowerCase();
  if (!value) return { value: null, error: null, note: MG_BLANK_NOTE };
  if (value.includes("/")) return { value: null, error: MG_SLASH_ERROR, note: null };
  const match = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|[.,]\d+)\s*(?:mg)?$/.exec(value);
  if (!match) return { value: null, error: MG_RANGE_ERROR, note: null };
  // "1,500" is a thousands separator; "1,5" is a decimal comma.
  const digits = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(match[1])
    ? match[1].replace(/,/g, "")
    : match[1].replace(",", ".");
  const mg = Number(digits);
  if (!Number.isFinite(mg) || mg < 1 || mg > MAX_MG) return { value: null, error: MG_RANGE_ERROR, note: null };
  if (mg < TABLET_COUNT_BELOW_MG) {
    return {
      value: mg,
      error: null,
      note: `Only ${formatNumber(mg, 2)} mg? That looks like a tablet count. Pick a strength and use Tablets instead.`
    };
  }
  return { value: mg, error: null, note: null };
}

export function ledParts(drug, mg) {
  const entry = drugOf(drug);
  const factor = entry ? entry.led.value : null;
  const amount = isAmount(mg) ? mg : null;
  return {
    mg: amount,
    led: amount !== null && entry ? amount * factor : null,
    factor,
    assumed: Boolean(entry?.ledAssumed)
  };
}

// "150 mg levodopa · counts as 150 mg LEDD (×1)"; a missing amount reads
// "No amount yet · not counted".
export function ledText(drug, mg) {
  const parts = ledParts(drug, mg);
  if (parts.mg === null || parts.led === null) return NO_AMOUNT_TEXT;
  const factor = `×${formatNumber(parts.factor, 2)}${parts.assumed ? ", assumed" : ""}`;
  return `${formatNumber(parts.mg)} mg levodopa · counts as ${formatNumber(parts.led)} mg LEDD (${factor})`;
}

// "1½ × 25/100", "150 mg", "2 × 42 mg", or "" when there is no amount.
export function amountLabel(dose) {
  if (!dose) return "";
  const strength = strengthOf(dose.drug, dose.strength);
  if (strength && isAmount(dose.count)) return `${formatCount(dose.count)} × ${strength.label}`;
  if (isAmount(dose.dose)) return `${formatNumber(dose.dose)} mg`;
  return "";
}

// SPEC 3.3 soft note: mg over the drug's large-dose mark. SPEC 3.3 also names
// "count over 4", but its only approved wording names the mg mark, which is
// false when the mg is under it (Rytary 5 × 95 = 475), so that case is left
// to the owner and not applied here.
export function largeDoseNote(drug, mg) {
  const entry = drugOf(drug);
  if (!entry) return null;
  if (isAmount(mg) && mg > entry.largeDoseMg + EPSILON) {
    return `That is a large single dose for ${entry.shortName} (over ${formatNumber(entry.largeDoseMg)} mg). Check it.`;
  }
  return null;
}

// A single strength means no strength select and so no "Other amount (mg)"
// (SPEC 3.3, Inbrija). Keeping such a drug out of mg mode also keeps it within
// its count cap (owner request 5: Inbrija at most 2 capsules).
function hasMgMode(drug) {
  return drug.strengths.length > 1;
}

// SPEC 3.5. Starts from the intended amount so notes never stack.
export function medicineChange({ fromDrug = null, toDrug, mode = "strength", intendedMg = null }) {
  const to = drugOf(toDrug);
  if (!to) throw new TypeError(`Unknown medicine: ${toDrug}`);
  const from = drugOf(fromDrug);
  const mg = isAmount(intendedMg) ? intendedMg : null;
  const match = mg === null ? null : inferStrength(to, mg);
  // Leaving Inbrija when the intended amount is not one it can hold: Inbrija
  // only showed its default, so the intended mg comes back (in mg mode when no
  // strength matches). This keeps the amount through a round trip via Inbrija
  // (SPEC 3.5), at the cost of ending in mg mode when no strength matches.
  const standIn = Boolean(from) && !hasMgMode(from) && mode !== "mg" && inferStrength(from, mg) === null;

  if (hasMgMode(to) && (mode === "mg" || (standIn && !match))) {
    return { strength: null, count: null, dose: mg, mode: "mg", note: null };
  }

  if (match) {
    const strength = strengthOf(to, match.strength);
    const amount = `${formatCount(match.count)} × ${strength.label} ${unitWord(to, match.count)}`;
    const assumed = to.ledAssumed ? " (assumed)" : "";
    const note = from && from.led.value !== to.led.value
      ? `Same ${formatNumber(mg)} mg levodopa, now ${amount}. ${to.shortName} counts ${factorText(to)}${assumed}, `
        + `so LEDD goes from ${formatNumber(mg * from.led.value)} to ${formatNumber(mg * to.led.value)} mg. `
        + "Products are not mg-for-mg equivalent."
      : null;
    return { strength: match.strength, count: match.count, dose: mg, mode: "strength", note };
  }

  const strength = strengthOf(to, to.defaultStrength);
  const count = to.defaultCount;
  const dose = strength.levodopa * count;
  return {
    strength: strength.id,
    count,
    dose,
    mode: "strength",
    note: `Amount set to ${formatCount(count)} × ${strength.label} ${unitWord(to, count)} (${formatNumber(dose)} mg), `
      + `the usual starting amount for ${to.shortName}. Check it.`
  };
}

// SPEC 3.6. The source is the dose with sourceId, or else the latest by time.
// The gap repeats the one before the source (circular, since the day repeats)
// when it is 60–360 min; otherwise 3 h. No doses: the first-dose defaults.
export function nextDoseDefaults(doses, sourceId = null) {
  const timed = (Array.isArray(doses) ? doses : [])
    .filter(dose => dose && toMinute(dose.time) !== null);
  if (!timed.length) {
    const drug = DRUG_BY_ID.sinemet;
    return {
      time: "08:00",
      drug: drug.id,
      strength: drug.defaultStrength,
      count: drug.defaultCount,
      dose: doseMg(drug, drug.defaultStrength, drug.defaultCount)
    };
  }
  let source = sourceId === null || sourceId === undefined ? null : timed.find(dose => dose.id === sourceId);
  if (!source) {
    // Latest by time; among equal times, the last in list order.
    source = timed.reduce((latest, dose) => (toMinute(dose.time) >= toMinute(latest.time) ? dose : latest));
  }
  const sourceMinute = toMinute(source.time);
  let gap = null;
  for (const dose of timed) {
    const back = (sourceMinute - toMinute(dose.time) + 1440) % 1440;
    if (back > 0 && (gap === null || back < gap)) gap = back;
  }
  if (gap === null || gap < MIN_GAP || gap > MAX_GAP) gap = DEFAULT_GAP;
  return {
    time: formatClock(sourceMinute + gap),
    drug: source.drug,
    strength: source.strength ?? null,
    count: source.count ?? null,
    dose: source.dose ?? null
  };
}

// Only doses with an amount count.
export function dailyTotals(doses) {
  let mg = 0;
  let led = 0;
  for (const dose of Array.isArray(doses) ? doses : []) {
    const drug = drugOf(dose?.drug);
    if (!drug || !isAmount(dose.dose)) continue;
    mg += dose.dose;
    led += dose.dose * drug.led.value;
  }
  return { mg, led };
}
