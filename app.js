import { DRUGS, DRUG_BY_ID, DRUG_ORDER, MODEL_VERSION } from "./src/drugs.js";
import {
  MAX_DOSES,
  ModelValidationError,
  exportRegimen,
  formatDuration,
  validateRegimenPayload
} from "./src/model.js";
import {
  describeTimeInput,
  formatClock,
  formatCount,
  formatNumber,
  parseCount,
  parseTimes,
  shiftTime
} from "./src/time.js";
import {
  amountLabel,
  countStep,
  dailyTotals,
  doseMg,
  largeDoseNote,
  ledText,
  medicineChange,
  minCount,
  nextDoseDefaults,
  parseMg,
  strengthOf,
  validateCount
} from "./src/amounts.js";
import {
  analyzeDay,
  buildSheetRows,
  chartDesc,
  compareModel,
  headlineSentences,
  hourlyRows,
  pinSnapshot,
  rangeText,
  readoutText,
  sliderValueText,
  statusMessage,
  tileModel
} from "./src/answers.js";
import { createChart } from "./src/chart.js";
import { TIPS, TIP_LABELS } from "./src/copy.js";

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const REFERENCES = [
  "Jost ST, et al. Levodopa dose equivalency in Parkinson's disease: updated systematic review and proposals. Mov Disord. 2023;38(7):1236–1252. doi:10.1002/mds.29410.",
  "Modi NB, Mittur A, Rubens R, Khanna S, Gupta S. Single-dose pharmacokinetics and pharmacodynamics of IPX203 in patients with advanced Parkinson disease: a comparison with immediate-release and extended-release carbidopa-levodopa. Clin Neuropharmacol. 2019;42(1):4–8. doi:10.1097/WNF.0000000000000314.",
  "Modi NB, Mittur A, Dinh P, Rubens R, Gupta S. Pharmacodynamics, efficacy, and safety of IPX203 in Parkinson disease patients with motor fluctuations. Clin Neuropharmacol. 2019;42(5):149–156. doi:10.1097/WNF.0000000000000354.",
  "LeWitt P, et al. Improving levodopa delivery: IPX203, a novel extended-release carbidopa-levodopa formulation. Clin Park Relat Disord. 2023;8:100197. doi:10.1016/j.prdoa.2023.100197.",
  "Hsu A, Yao HM, Gupta S, Modi NB. Comparison of the pharmacokinetics of an oral extended-release capsule formulation of carbidopa-levodopa (IPX066) with immediate-release, sustained-release, and carbidopa-levodopa-entacapone. J Clin Pharmacol. 2015;55(9):995–1003. doi:10.1002/jcph.514.",
  "Mittur A, Gupta S, Modi NB. Pharmacokinetics of Rytary, an extended-release capsule formulation of carbidopa-levodopa. Clin Pharmacokinet. 2017;56(9):999–1014. doi:10.1007/s40262-017-0511-y.",
  "Mao Z, Hsu A, Gupta S, Modi NB. Population pharmacodynamics of IPX066: an oral extended-release capsule formulation of carbidopa-levodopa, and immediate-release carbidopa-levodopa in patients with advanced Parkinson's disease. J Clin Pharmacol. 2013;53(5):523–531. doi:10.1002/jcph.63.",
  "Wach A, Kopra J, Marjanovic I, Knecht M, Jenner P. Population pharmacokinetic analyses comparing immediate-release levodopa/carbidopa, controlled-release levodopa/carbidopa, and IPX203. J Neural Transm. 2026. doi:10.1007/s00702-026-03233-w.",
  "Nutt JG. Pharmacokinetics and pharmacodynamics of levodopa. Mov Disord. 2008;23(Suppl 3):S580–S584. doi:10.1002/mds.22037.",
  "Contin M, Martinelli P. Pharmacokinetics of levodopa. J Neurol. 2010;257(Suppl 2):S253–S261. doi:10.1007/s00415-010-5728-8.",
  "US prescribing information: Sinemet, Sinemet CR, Rytary, Crexont, and Inbrija (accessdata.fda.gov), and the FDA clinical pharmacology reviews for NDA 203312 (Rytary), 217186 (Crexont), and 209184 (Inbrija)."
];

const wideQuery = window.matchMedia("(min-width: 820px)");
const finePointer = window.matchMedia("(pointer: fine)");

/* ---------- State ---------- */

let nextId = 1;
const newId = () => `d${nextId++}`;

const state = {
  doses: [],
  lines: { target: null, high: null },
  example: false
};

const ui = {
  openId: null,
  isNew: false,
  editSnapshot: null,
  intendedMg: null,
  notes: {},
  pinned: null,
  undo: null,
  cursorMinute: 0,
  cursorTouched: false,
  openTip: null,
  hoverId: null
};

let analysis = null;
let chart = null;
let statusTimer = null;
let pendingSheet = null;

const els = {
  doseCount: $("doseCount"),
  exampleBadge: $("exampleBadge"),
  emptyDoses: $("emptyDoses"),
  doseList: $("doseList"),
  addFirst: $("addFirst"),
  tryExample: $("tryExample"),
  addDoseWide: $("addDoseWide"),
  addDoseBar: $("addDoseBar"),
  dailyTotal: $("dailyTotal"),
  dailyTotalText: $("dailyTotalText"),
  toolsRow: $("toolsRow"),
  makeSheet: $("makeSheet"),
  clearAll: $("clearAll"),
  sheetMessage: $("sheetMessage"),
  undoMessage: $("undoMessage"),
  undoActions: $("undoActions"),
  undoButton: $("undoButton"),
  dismissUndo: $("dismissUndo"),
  answerBar: $("answerBar"),
  answerLink: $("answerLink"),
  barLedd: $("barLedd"),
  barLow: $("barLow"),
  resultsTitle: $("resultsTitle"),
  pinButton: $("pinButton"),
  resultsEmpty: $("resultsEmpty"),
  resultsBody: $("resultsBody"),
  headline: $("headline"),
  pinnedNote: $("pinnedNote"),
  compareSentence: $("compareSentence"),
  tiles: $("tiles"),
  tileTip: $("tip-tiles"),
  readout: $("readout"),
  chart: $("chart"),
  chartDesc: $("chartDesc"),
  slider: $("timeSlider"),
  sliderHint: $("sliderHint"),
  chartKey: $("chartKey"),
  beforeBody: $("beforeBody"),
  beforeNotes: $("beforeNotes"),
  rangeLists: $("rangeLists"),
  linesDetails: $("linesDetails"),
  linesSummary: $("linesSummary"),
  targetInput: $("targetInput"),
  highInput: $("highInput"),
  targetError: $("targetError"),
  highError: $("highError"),
  highNote: $("highNote"),
  removeLines: $("removeLines"),
  hourHead: $("hourHead"),
  hourBody: $("hourBody"),
  saveFile: $("saveFile"),
  openFile: $("openFile"),
  fileInput: $("fileInput"),
  pasteText: $("pasteText"),
  openPasted: $("openPasted"),
  fileMessages: $("fileMessages"),
  fileDetails: $("fileDetails"),
  drugCards: $("drugCards"),
  references: $("references"),
  limits: $("limits"),
  howItWorksLink: $("howItWorksLink"),
  footerVersion: $("footerVersion"),
  statusRegion: $("statusRegion"),
  printHeader: $("printHeader"),
  printDoses: $("printDoses")
};

/* ---------- Small helpers ---------- */

const drugOf = dose => DRUG_BY_ID[dose.drug];
const hasAmount = dose => dose.dose !== null && dose.dose > 0;
const doseById = id => state.doses.find(dose => dose.id === id) ?? null;
const minuteOf = time => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
const byTime = (left, right) => minuteOf(left.time) - minuteOf(right.time);
const sortedDoses = () => state.doses
  .map((dose, index) => ({ dose, index }))
  .sort((left, right) => byTime(left.dose, right.dose) || left.index - right.index)
  .map(item => item.dose);
const cloneDoses = doses => doses.map(dose => ({ ...dose }));
const isOvernight = dose => minuteOf(dose.time) < 5 * 60;
const circled = number => (number >= 1 && number <= 20 ? String.fromCharCode(0x2460 + number - 1) : `(${number})`);

function lineSwatch(style, width = 2.5, className = "line-swatch") {
  const dash = style.dash ? ` stroke-dasharray="${style.dash}"` : "";
  return `<svg class="${className}" viewBox="0 0 28 10" aria-hidden="true" focusable="false"><line x1="0" y1="5" x2="28" y2="5" stroke="${style.color}" stroke-width="${width}"${dash}/></svg>`;
}

function infoButton(key, controls = `tip-${key}`) {
  return `<button class="info" type="button" data-tip="${key}" aria-label="${escapeHtml(TIP_LABELS[key])}" aria-expanded="false" aria-controls="${controls}">i</button>`;
}

function doseTitle(dose) {
  return `${dose.time} ${drugOf(dose).shortName}`;
}

/* ---------- Dose list ---------- */

function rowLine2(dose) {
  if (!hasAmount(dose)) return { text: "No amount yet · not counted", html: "No amount yet · not counted", missing: true };
  const led = ledText(drugOf(dose), dose.dose);
  const split = led.indexOf(" · ");
  const first = split >= 0 ? led.slice(0, split) : led;
  const rest = split >= 0 ? led.slice(split + 3) : "";
  const flags = [];
  if (isOvernight(dose)) flags.push("overnight");
  if (largeDoseNote(drugOf(dose), dose.dose)) flags.push("check amount");
  const flagText = flags.map(flag => ` · ${flag}`).join("");
  return {
    text: `${led}${flagText}`,
    html: `${escapeHtml(first)}${rest ? ` · <span class="nowrap">${escapeHtml(rest)}</span>` : ""}${flags.map(flag => ` · <span class="flag">${escapeHtml(flag)}</span>`).join("")}`,
    missing: false
  };
}

function rowHtml(dose) {
  const drug = drugOf(dose);
  const line2 = rowLine2(dose);
  const open = ui.openId === dose.id;
  return `<button type="button" class="dose-row${line2.missing ? " missing" : ""}" data-row="${dose.id}" aria-expanded="${open}" aria-controls="editor-${dose.id}">
    <span class="dose-time">${dose.time}</span>
    ${lineSwatch(drug.style, 3)}
    <span class="dose-name"><strong>${escapeHtml(drug.shortName)}</strong> <span class="dose-amount">${hasAmount(dose) || dose.strength ? escapeHtml(amountLabel(dose)) : ""}</span></span>
    <span class="dose-line2">${line2.html}<span class="sr-only">, edit</span></span>
  </button>`;
}

function strengthOptions(drug, dose) {
  const options = drug.strengths.map(strength => (
    `<option value="${escapeHtml(strength.id)}"${dose.strength === strength.id ? " selected" : ""}>${escapeHtml(strength.label)}</option>`
  ));
  options.push(`<option value="other"${dose.strength === null ? " selected" : ""}>Other amount (mg)</option>`);
  return options.join("");
}

function countLabels(drug, strengthId) {
  const unit = drug.unit;
  const half = countStep(drug, strengthId) === 0.5;
  return {
    label: unit[1][0].toUpperCase() + unit[1].slice(1),
    minus: half ? `Half a ${unit[0]} fewer` : `One ${unit[0]} fewer`,
    plus: half ? `Half a ${unit[0]} more` : `One ${unit[0]} more`
  };
}

function calcText(dose) {
  if (!hasAmount(dose)) return "No amount yet, so this dose is not counted.";
  return `= ${ledText(drugOf(dose), dose.dose)}`;
}

function editorHtml(dose) {
  const id = dose.id;
  const drug = drugOf(dose);
  const mgMode = dose.strength === null;
  const isInbrija = drug.id === "inbrija";
  const labels = countLabels(drug, dose.strength);
  const legend = ui.isNew ? "New dose" : `Edit the ${doseTitle(dose)} dose`;
  const notes = ui.notes;
  const chips = DRUG_ORDER.map(drugId => {
    const option = DRUG_BY_ID[drugId];
    return `<label class="chip"><input type="radio" name="drug-${id}" value="${drugId}"${drugId === dose.drug ? " checked" : ""}><span class="check" aria-hidden="true">✓</span>${escapeHtml(option.shortName)}</label>`;
  }).join("");
  const strengthField = isInbrija && !mgMode
    ? `<div class="field"><span class="editor-label">Capsule strength</span><span class="static-strength">42 mg levodopa per capsule</span></div>`
    : `<div class="field"><label class="editor-label" for="strength-${id}">${drug.unit[0] === "tablet" ? "Tablet" : "Capsule"} strength<span class="sr-only"> (carbidopa/levodopa mg)</span></label><select id="strength-${id}" data-field="strength">${strengthOptions(drug, dose)}</select></div>`;
  const amountField = mgMode
    ? `<div class="field"><label class="editor-label" for="mg-${id}">Levodopa (mg)</label><input class="text-field mg-field" id="mg-${id}" data-field="mg" type="text" inputmode="decimal" autocomplete="off" value="${dose.dose ?? ""}" aria-describedby="mgHint-${id} amountError-${id} amountNote-${id}"><p class="hint" id="mgHint-${id}">The second number on the label, e.g. 100 in 25/100.</p></div>`
    : `<div class="field"><label class="editor-label" for="count-${id}">${labels.label}</label><div class="count-controls"><button type="button" class="nudge" data-act="count-down" tabindex="-1" aria-label="${labels.minus}">−</button><input class="text-field count-field" id="count-${id}" data-field="count" type="text" inputmode="decimal" autocomplete="off" value="${escapeHtml(formatCount(dose.count))}" aria-describedby="amountError-${id} amountNote-${id}"><button type="button" class="nudge" data-act="count-up" tabindex="-1" aria-label="${labels.plus}">+</button></div></div>`;
  return `<fieldset class="editor" id="editor-${id}" data-editor="${id}">
    <legend class="sr-only">${escapeHtml(legend)}</legend>
    <div class="editor-block">
      <label class="editor-label" for="time-${id}">Time (24-hour)</label>
      <div class="time-controls">
        <button type="button" class="nudge" data-act="earlier" tabindex="-1" aria-label="30 minutes earlier"><span class="nudge-long">−30 min</span><span class="nudge-short">−30</span></button>
        <input class="text-field time-field" id="time-${id}" data-field="time" type="text" inputmode="decimal" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="done" value="${dose.time}" aria-describedby="timeHint-${id} timeError-${id} timeNote-${id}">
        <button type="button" class="nudge" data-act="later" tabindex="-1" aria-label="30 minutes later"><span class="nudge-long">+30 min</span><span class="nudge-short">+30</span></button>
      </div>
      <output class="echo" id="timeEcho-${id}" for="time-${id}"></output>
      <p class="hint" id="timeHint-${id}">24-hour clock: 18 = 6 pm.<span class="pointer-only"> Up/Down arrows move it 30 min. Tip: type several times at once, like 6 9 12 15 18.</span></p>
      <p class="field-error" id="timeError-${id}"></p>
      <p class="field-note" id="timeNote-${id}">${escapeHtml(notes.time ?? "")}</p>
    </div>
    <fieldset class="editor-block">
      <legend>Medicine</legend>
      <div class="chips">${chips}</div>
      <p class="generic">${escapeHtml(drug.generic)}</p>
      ${isInbrija ? `<p class="field-note">Inbrija is usually an as-needed inhaled dose for OFF episodes: 2 capsules (84 mg) each time.</p>` : ""}
    </fieldset>
    <div class="editor-block">
      <div class="amount-grid">${strengthField}${amountField}</div>
      <p class="field-error" id="amountError-${id}"></p>
      <p class="calc-line"><output id="calc-${id}" aria-live="polite">${escapeHtml(calcText(dose))}</output> ${infoButton("leddContribution")}</p>
      <div class="tip" id="tip-leddContribution" role="status"></div>
      <p class="field-note" id="amountNote-${id}">${escapeHtml(notes.amount ?? "")}</p>
    </div>
    <div class="editor-actions">
      <button type="button" class="button primary done" data-act="done">Done</button>
      <button type="button" class="button" data-act="next">Add next dose</button>
      <button type="button" class="link-button remove" data-act="remove">Remove dose</button>
    </div>
  </fieldset>`;
}

function renderDoseList() {
  closeTip(false);
  const doses = listOrder();
  els.doseList.innerHTML = doses.map(dose => (
    `<li class="dose-item" data-item="${dose.id}">${rowHtml(dose)}${ui.openId === dose.id ? editorHtml(dose) : ""}</li>`
  )).join("");
}

// While an editor is open its row keeps its place; the list re-sorts on close.
let frozenOrder = null;
function listOrder() {
  if (ui.openId && frozenOrder) {
    const known = frozenOrder.map(id => doseById(id)).filter(Boolean);
    const extra = state.doses.filter(dose => !frozenOrder.includes(dose.id));
    return [...known, ...extra];
  }
  return sortedDoses();
}

function updateRow(dose) {
  const item = els.doseList.querySelector(`[data-item="${dose.id}"]`);
  const row = item?.querySelector(".dose-row");
  if (!row) return;
  const template = document.createElement("template");
  template.innerHTML = rowHtml(dose);
  const fresh = template.content.firstElementChild;
  row.className = fresh.className;
  row.innerHTML = fresh.innerHTML;
  const legend = item.querySelector(".editor > legend");
  if (legend && !ui.isNew) legend.textContent = `Edit the ${doseTitle(dose)} dose`;
}

function renderDoseMeta() {
  const count = state.doses.length;
  const empty = count === 0;
  els.emptyDoses.hidden = !empty;
  els.doseList.hidden = empty;
  els.doseCount.textContent = empty ? "" : `${count} ${count === 1 ? "dose" : "doses"}`;
  els.exampleBadge.hidden = !state.example;
  els.addDoseWide.hidden = empty || !wideQuery.matches;
  const full = count >= MAX_DOSES;
  els.addDoseWide.disabled = full;
  els.addDoseWide.textContent = full ? `${MAX_DOSES} doses is the limit` : "+ Add dose";
  els.addDoseBar.disabled = full;
  els.addDoseBar.setAttribute("aria-label", full ? `${MAX_DOSES} doses is the limit` : "Add dose");
  const totals = dailyTotals(state.doses);
  const counted = state.doses.some(hasAmount);
  els.dailyTotal.hidden = !counted;
  els.dailyTotalText.textContent = `${formatNumber(totals.mg)} mg levodopa = ${formatNumber(totals.led)} mg LEDD/day`;
  els.toolsRow.hidden = empty;
  els.makeSheet.hidden = !counted;
  els.answerBar.hidden = !counted;
}

/* ---------- Editor behavior ---------- */

function openEditor(id, { isNew = false } = {}) {
  const dose = doseById(id);
  if (!dose) return;
  ui.openId = id;
  ui.isNew = isNew;
  ui.editSnapshot = { ...dose };
  ui.intendedMg = dose.dose;
  ui.notes = {};
  frozenOrder = listOrder().map(item => item.id);
  renderDoseList();
  highlightCurrent();
}

function closeEditor() {
  ui.openId = null;
  ui.isNew = false;
  ui.editSnapshot = null;
  ui.notes = {};
  frozenOrder = null;
}

function editorField(field, id = ui.openId) {
  return document.getElementById(`${field}-${id}`);
}

function setFieldMessage(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) element.textContent = message ?? "";
}

function setInvalid(input, invalid) {
  if (!input) return;
  if (invalid) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
}

// Applies the typed time. Returns false when the text cannot be read.
function commitTime(dose, { allowMulti = true } = {}) {
  const input = editorField("time", dose.id);
  if (!input) return true;
  const text = input.value.trim();
  const parsed = parseTimes(text);
  if (!text || (!parsed.times.length && !parsed.bad.length)) {
    showTimeError(dose, "Type a time like 0600, 1830 or 6.30. This uses a 24-hour clock.");
    return false;
  }
  if (parsed.bad.length) {
    const several = parsed.times.length + parsed.bad.length > 1;
    showTimeError(dose, several
      ? `Couldn't read "${parsed.bad[0]}". Type times like 0630 or 6.30.`
      : "Type a time like 0600, 1830 or 6.30. This uses a 24-hour clock.");
    return false;
  }
  if (parsed.times.length > 1) {
    if (!allowMulti) return true;
    if (state.doses.length + parsed.times.length - 1 > MAX_DOSES) {
      showTimeError(dose, `That would make more than ${MAX_DOSES} doses.`);
      return false;
    }
    addMultipleTimes(dose, parsed.times);
    return true;
  }
  setInvalid(input, false);
  setFieldMessage(`timeError-${dose.id}`, "");
  applyTime(dose, formatClock(parsed.times[0]));
  return true;
}

function showTimeError(dose, message) {
  const input = editorField("time", dose.id);
  setInvalid(input, true);
  setFieldMessage(`timeError-${dose.id}`, message);
}

function applyTime(dose, time) {
  const input = editorField("time", dose.id);
  const changed = dose.time !== time;
  dose.time = time;
  if (input) input.value = time;
  setFieldMessage(`timeEcho-${dose.id}`, "");
  ui.notes.time = isOvernight(dose) ? "Overnight dose. Is that right?" : null;
  setFieldMessage(`timeNote-${dose.id}`, ui.notes.time);
  if (changed) scheduleChanged();
  updateRow(dose);
}

function addMultipleTimes(dose, times) {
  const snapshot = takeSnapshot();
  applyTime(dose, formatClock(times[0]));
  const copies = times.slice(1).map(minute => ({ ...dose, id: newId(), time: formatClock(minute) }));
  state.doses.push(...copies);
  setUndo(snapshot, `Added ${copies.length + 1} doses.`);
  announce(`Added ${copies.length} more ${drugOf(dose).shortName} doses.`);
  scheduleChanged();
}

function commitAmount(dose) {
  const drug = drugOf(dose);
  if (dose.strength === null) {
    const input = editorField("mg", dose.id);
    if (!input) return true;
    const parsed = parseMg(input.value);
    setInvalid(input, Boolean(parsed.error));
    setFieldMessage(`amountError-${dose.id}`, parsed.error);
    if (parsed.error) return false;
    setDoseAmount(dose, parsed.value);
    ui.notes.amount = parsed.note ?? (parsed.value !== null ? largeDoseNote(drug, parsed.value) : null);
    setFieldMessage(`amountNote-${dose.id}`, ui.notes.amount);
    return true;
  }
  if (drug.id === "inbrija" || editorField("count", dose.id)) {
    const input = editorField("count", dose.id);
    const count = input ? parseCount(input.value) : dose.count;
    const error = count === null
      ? validateCount(drug, dose.strength, Number.NaN)
      : validateCount(drug, dose.strength, count);
    setInvalid(input, Boolean(error));
    setFieldMessage(`amountError-${dose.id}`, error);
    if (error) return false;
    dose.count = count;
    if (input) input.value = formatCount(count);
    setDoseAmount(dose, doseMg(drug, dose.strength, count));
    ui.notes.amount = largeDoseNote(drug, dose.dose);
    setFieldMessage(`amountNote-${dose.id}`, ui.notes.amount);
  }
  return true;
}

function setDoseAmount(dose, mg) {
  const changed = dose.dose !== mg;
  dose.dose = mg;
  ui.intendedMg = mg;
  setFieldMessage(`calc-${dose.id}`, calcText(dose));
  if (changed) scheduleChanged();
  updateRow(dose);
}

function stepCount(dose, direction) {
  const drug = drugOf(dose);
  const step = countStep(drug, dose.strength);
  const input = editorField("count", dose.id);
  const current = parseCount(input?.value ?? "") ?? dose.count ?? minCount(drug, dose.strength);
  const next = Math.min(drug.maxCount, Math.max(minCount(drug, dose.strength), Math.round((current + direction * step) / step) * step));
  if (input) input.value = formatCount(next);
  commitAmount(dose);
}

function changeMedicine(dose, toDrugId) {
  if (toDrugId === dose.drug) return;
  const result = medicineChange({
    fromDrug: drugOf(dose),
    toDrug: DRUG_BY_ID[toDrugId],
    mode: dose.strength === null ? "mg" : "strength",
    intendedMg: ui.intendedMg
  });
  const intended = ui.intendedMg;
  dose.drug = toDrugId;
  dose.strength = result.strength;
  dose.count = result.count;
  dose.dose = result.dose;
  ui.intendedMg = intended;
  ui.notes.amount = result.note ?? null;
  scheduleChanged();
  renderDoseList();
  const radio = els.doseList.querySelector(`input[name="drug-${dose.id}"][value="${toDrugId}"]`);
  radio?.focus();
  highlightCurrent();
}

function changeStrength(dose, value) {
  const drug = drugOf(dose);
  if (value === "other") {
    dose.strength = null;
    dose.count = null;
  } else {
    const strength = strengthOf(drug, value);
    const step = countStep(drug, value);
    const minimum = minCount(drug, value);
    let count;
    if (dose.strength === null) {
      count = dose.dose ? Math.round(dose.dose / strength.levodopa / step) * step : drug.defaultCount;
    } else {
      count = Math.round((dose.count ?? drug.defaultCount) / step) * step;
    }
    count = Math.min(drug.maxCount, Math.max(minimum, count));
    dose.strength = value;
    dose.count = count;
    dose.dose = doseMg(drug, value, count);
    ui.intendedMg = dose.dose;
  }
  ui.notes.amount = hasAmount(dose) ? largeDoseNote(drug, dose.dose) : null;
  scheduleChanged();
  renderDoseList();
  editorField("strength", dose.id)?.focus();
  highlightCurrent();
}

// Validates every field of the open editor, applies pending text, and closes
// it. Returns false (leaving the editor open) when something is invalid.
function commitEditor({ focusAfter = true } = {}) {
  const dose = doseById(ui.openId);
  if (!dose) {
    closeEditor();
    return true;
  }
  const timeInput = editorField("time", dose.id);
  const timeText = timeInput?.value.trim() ?? dose.time;
  const timeOk = timeText === dose.time || commitTime(dose);
  const amountOk = commitAmount(dose);
  if (!timeOk || !amountOk) {
    const firstInvalid = els.doseList.querySelector(`#editor-${dose.id} [aria-invalid="true"]`);
    firstInvalid?.focus();
    return false;
  }
  const wasNew = ui.isNew;
  const before = listOrder().map(item => item.id);
  closeEditor();
  const after = sortedDoses().map(item => item.id);
  const oldIndex = before.indexOf(dose.id);
  const newIndex = after.indexOf(dose.id);
  renderDoseList();
  highlightCurrent();
  if (!wasNew && oldIndex !== newIndex) {
    announce(`Moved the ${dose.time} dose to position ${newIndex + 1} of ${after.length}.`);
  }
  if (focusAfter) {
    if (wasNew) addButton().focus();
    else rowButton(dose.id)?.focus();
  }
  return true;
}

function cancelEditor() {
  const dose = doseById(ui.openId);
  if (!dose) return;
  const wasNew = ui.isNew;
  if (wasNew) {
    state.doses = state.doses.filter(item => item.id !== dose.id);
  } else {
    Object.assign(dose, ui.editSnapshot);
  }
  closeEditor();
  scheduleChanged();
  renderDoseList();
  highlightCurrent();
  if (wasNew || !rowButton(dose.id)) (state.doses.length ? addButton() : els.addFirst).focus();
  else rowButton(dose.id).focus();
}

function rowButton(id) {
  return els.doseList.querySelector(`[data-row="${id}"]`);
}

function addButton() {
  return wideQuery.matches ? els.addDoseWide : els.addDoseBar;
}

function focusTimeField(id) {
  const input = editorField("time", id);
  if (!input) return;
  input.focus();
  input.select();
}

function addDose(sourceId = null) {
  if (ui.openId && !commitEditor({ focusAfter: false })) return;
  if (state.doses.length >= MAX_DOSES) return;
  clearUndo();
  const latest = sortedDoses().at(-1);
  const source = sourceId ?? latest?.id ?? null;
  const defaults = source
    ? nextDoseDefaults(state.doses, source)
    : { time: "08:00", drug: "sinemet", strength: "25/100", count: 1, dose: 100 };
  const dose = { id: newId(), ...defaults };
  state.doses.push(dose);
  state.example = false;
  scheduleChanged();
  openEditor(dose.id, { isNew: true });
  focusTimeField(dose.id);
  rowButton(dose.id)?.scrollIntoView({ block: "nearest" });
}

function removeDose(id) {
  const dose = doseById(id);
  if (!dose) return;
  const snapshot = takeSnapshot();
  const order = sortedDoses().map(item => item.id);
  const position = order.indexOf(id);
  state.doses = state.doses.filter(item => item.id !== id);
  state.example = false;
  closeEditor();
  if (!state.doses.length) ui.pinned = null;
  setUndo(snapshot, `Removed the ${doseTitle(dose)} dose.`);
  scheduleChanged();
  renderDoseList();
  highlightCurrent();
  const remaining = sortedDoses();
  const next = remaining[position] ?? remaining[position - 1];
  (next ? rowButton(next.id) : els.addFirst).focus();
}

/* ---------- Undo ---------- */

function takeSnapshot() {
  return {
    doses: cloneDoses(state.doses),
    lines: { ...state.lines },
    example: state.example,
    pinned: ui.pinned
  };
}

function setUndo(snapshot, message) {
  ui.undo = { snapshot, message };
  renderUndo();
}

function clearUndo() {
  if (!ui.undo) return;
  ui.undo = null;
  renderUndo();
}

function renderUndo() {
  els.undoMessage.textContent = ui.undo?.message ?? "";
  els.undoActions.hidden = !ui.undo;
}

function undo() {
  if (!ui.undo) return;
  const { snapshot } = ui.undo;
  const restoredIds = new Set(snapshot.doses.map(dose => dose.id));
  const currentIds = new Set(state.doses.map(dose => dose.id));
  const restored = snapshot.doses.find(dose => !currentIds.has(dose.id));
  state.doses = cloneDoses(snapshot.doses);
  state.lines = { ...snapshot.lines };
  state.example = snapshot.example;
  ui.pinned = snapshot.pinned;
  closeEditor();
  ui.undo = null;
  renderUndo();
  syncLineInputs();
  scheduleChanged();
  renderDoseList();
  highlightCurrent();
  const target = restored && restoredIds.has(restored.id) ? rowButton(restored.id) : els.doseList.querySelector(".dose-row");
  (target ?? els.addFirst).focus();
}

/* ---------- Example, clear ---------- */

function tryExample() {
  const snapshot = state.doses.length ? takeSnapshot() : null;
  const make = (time, drug, strength) => {
    const count = 1;
    return { id: newId(), time, drug, strength, count, dose: doseMg(DRUG_BY_ID[drug], strength, count) };
  };
  state.doses = [
    make("07:00", "sinemet", "25/100"),
    make("11:00", "sinemet", "25/100"),
    make("15:00", "sinemet", "25/100"),
    make("19:00", "sinemet", "25/100"),
    make("21:00", "sinemetcr", "50/200")
  ];
  state.lines = { target: null, high: null };
  state.example = true;
  ui.pinned = null;
  ui.cursorTouched = false;
  closeEditor();
  if (snapshot) setUndo(snapshot, `Replaced ${snapshot.doses.length} doses with the example.`);
  syncLineInputs();
  scheduleChanged();
  renderDoseList();
  els.resultsTitle.focus();
}

function clearAll() {
  if (!state.doses.length && state.lines.target === null && state.lines.high === null) return;
  const snapshot = takeSnapshot();
  const count = state.doses.length;
  state.doses = [];
  state.lines = { target: null, high: null };
  state.example = false;
  ui.pinned = null;
  ui.cursorTouched = false;
  closeEditor();
  setUndo(snapshot, `Cleared ${count} ${count === 1 ? "dose" : "doses"}.`);
  syncLineInputs();
  scheduleChanged();
  renderDoseList();
  els.addFirst.focus();
}

/* ---------- Lines ---------- */

function parseLine(text) {
  const trimmed = text.trim();
  if (!trimmed) return { value: null, error: null };
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value < 1 || value > 1000) return { value: null, error: "Enter a level from 1 to 1000." };
  return { value, error: null };
}

function applyLine(which) {
  const input = which === "target" ? els.targetInput : els.highInput;
  const error = which === "target" ? els.targetError : els.highError;
  const parsed = parseLine(input.value);
  setInvalid(input, Boolean(parsed.error));
  error.textContent = parsed.error ?? "";
  if (parsed.error) return;
  if (state.lines[which] === parsed.value) return;
  clearUndo();
  state.lines[which] = parsed.value;
  input.value = parsed.value ?? "";
  scheduleChanged();
}

function syncLineInputs() {
  els.targetInput.value = state.lines.target ?? "";
  els.highInput.value = state.lines.high ?? "";
  setInvalid(els.targetInput, false);
  setInvalid(els.highInput, false);
  els.targetError.textContent = "";
  els.highError.textContent = "";
  if (state.lines.target !== null || state.lines.high !== null) els.linesDetails.open = true;
}

function renderLineMeta() {
  const { target, high } = state.lines;
  const parts = [];
  if (target !== null) parts.push(`target ${formatNumber(target)}`);
  if (high !== null) parts.push(`high ${formatNumber(high)}`);
  els.linesSummary.textContent = parts.length ? `Your own lines: ${parts.join(", ")}` : "Your own lines (optional)";
  els.highNote.textContent = target !== null && high !== null && high <= target
    ? "The high line is at or below the target line, so there is no window between them."
    : "";
}

/* ---------- Results ---------- */

function scheduleChanged() {
  renderDoseMeta();
  renderResults();
  queueStatus();
}

function renderResults() {
  renderLineMeta();
  const counted = state.doses.filter(hasAmount);
  const empty = counted.length === 0;
  els.resultsEmpty.hidden = !empty;
  els.resultsBody.hidden = empty;
  els.pinButton.hidden = empty;
  if (empty) {
    analysis = null;
    ui.pinned = null;
    els.pinButton.setAttribute("aria-pressed", "false");
    els.pinButton.textContent = "Pin to compare";
    return;
  }
  analysis = analyzeDay(state.doses, state.lines);
  if (!ui.cursorTouched) {
    ui.cursorMinute = snap5(analysis.stats.lowestBefore?.minute ?? analysis.stats.maxMinute);
  }
  const compare = ui.pinned ? compareModel(analysis, ui.pinned) : null;

  els.headline.innerHTML = headlineSentences(analysis).map(sentence => `<p>${escapeHtml(sentence)}</p>`).join("");
  els.pinButton.setAttribute("aria-pressed", String(Boolean(ui.pinned)));
  els.pinButton.textContent = ui.pinned ? "Unpin" : "Pin to compare";
  els.pinnedNote.hidden = !ui.pinned;
  els.compareSentence.hidden = !compare;
  els.compareSentence.textContent = compare?.sentence ?? "";

  renderTiles(compare);
  renderChart();
  renderKey();
  renderBeforeTable(compare);
  renderRangeLists();
  renderHourTable();
  els.chartDesc.textContent = chartDesc(analysis);
  renderAnswerBar(compare);
  renderCursor();
}

const snap5 = minute => Math.min(1435, Math.max(0, Math.round(minute / 5) * 5));

const TILE_TIPS = { lowest: "lowest", highest: "highest", fluctuation: "fluctuation", below: "target", above: "high", target: "target", high: "high" };

function renderTiles() {
  const tiles = tileModel(analysis, ui.pinned);
  els.tiles.innerHTML = tiles.map(tile => {
    const tipKey = tile.info ?? TILE_TIPS[tile.key] ?? null;
    return `<div class="tile" data-tile="${escapeHtml(tile.key)}">
      <dt>${escapeHtml(tile.label)}${tipKey && TIPS[tipKey] ? ` ${infoButton(tipKey, "tip-tiles")}` : ""}</dt>
      <dd><span class="tile-value">${escapeHtml(tile.value)}</span><span class="tile-note">${escapeHtml(tile.note ?? "")}</span>${tile.was ? `<span class="tile-was">${escapeHtml(tile.was)}</span>` : ""}</dd>
    </div>`;
  }).join("");
}

function renderChart() {
  if (!chart) {
    chart = createChart(els.chart, {
      onCursor: minute => {
        ui.cursorTouched = true;
        ui.cursorMinute = snap5(minute);
        renderCursor();
      },
      onDraw: alignSlider
    });
  }
  chart.draw(analysis, {
    cursorMinute: ui.cursorMinute,
    pinnedTotal: ui.pinned?.total ?? null,
    highlightId: currentHighlight(),
    printing: false
  });
  alignSlider();
}

function alignSlider() {
  if (!chart?.plotBox) return;
  const box = chart.plotBox();
  if (!box || !box.width) return;
  els.slider.style.marginLeft = `${Math.max(0, box.left - 10)}px`;
  els.slider.style.width = `${box.width + 20}px`;
}

function renderCursor() {
  if (!analysis) return;
  const minute = ui.cursorMinute;
  els.readout.textContent = readoutText(analysis, minute);
  els.slider.value = String(minute);
  els.slider.setAttribute("aria-valuetext", sliderValueText(analysis, minute));
  chart?.setCursor(minute);
}

function renderKey() {
  const items = [`<li>${lineSwatch({ color: "#17202a", dash: "" }, 3.5)}Total</li>`];
  const inUse = DRUG_ORDER.filter(drugId => analysis.doses.some(dose => dose.drug === drugId));
  for (const drugId of inUse) items.push(`<li>${lineSwatch(DRUG_BY_ID[drugId].style)}${escapeHtml(DRUG_BY_ID[drugId].shortName)}</li>`);
  items.push(`<li>${lineSwatch({ color: "#6b7580", dash: "1 4" }, 2)}100 = one IR peak</li>`);
  if (state.lines.target !== null) items.push(`<li>${lineSwatch({ color: "#146c43", dash: "7 4" }, 2)}Target line ${formatNumber(state.lines.target)}</li>`);
  if (state.lines.high !== null) items.push(`<li>${lineSwatch({ color: "#9c2f24", dash: "10 3 2 3" }, 2)}High line ${formatNumber(state.lines.high)}</li>`);
  if (ui.pinned) items.push(`<li>${lineSwatch({ color: "#8a96a3", dash: "6 4" }, 2)}Pinned day</li>`);
  items.push(`<li><span class="key-glyph" aria-hidden="true">▲</span>dose</li>`);
  items.push(`<li><span class="key-glyph" aria-hidden="true">①</span>level before a dose</li>`);
  if (state.lines.target !== null) items.push(`<li><svg class="line-swatch" viewBox="0 0 28 10" aria-hidden="true"><rect width="28" height="10" fill="#fbe3c8"/></svg>Shaded: below target line</li>`);
  if (state.lines.high !== null) items.push(`<li><svg class="line-swatch" viewBox="0 0 28 10" aria-hidden="true"><rect width="28" height="10" fill="#f3d6d2"/></svg>Shaded: above high line</li>`);
  els.chartKey.innerHTML = items.join("");
}

function renderBeforeTable(compare) {
  const target = state.lines.target;
  els.beforeBody.innerHTML = analysis.before.map(row => {
    let before = formatNumber(Math.round(row.level), 0);
    if (row.early) before += ` at ${formatClock(row.minute)}`;
    if (target !== null && row.level < target) before += " · below target";
    const was = compare?.beforeWas?.get(row.number);
    if (was) before += ` ${was}`;
    const since = `${formatDuration(row.sinceLast)}${row.overnight ? " · overnight" : ""}`;
    const peak = `${formatNumber(Math.round(row.peakAfter), 0)} at ${formatClock(row.peakAfterMinute)}`;
    return `<tr><td>${circled(row.number)} ${escapeHtml(row.label)}</td><td>${escapeHtml(before)}</td><td>${escapeHtml(since)}</td><td>${escapeHtml(peak)}</td></tr>`;
  }).join("");
  const notes = [];
  if (compare?.unmatched?.length) {
    notes.push(`No longer in the table: ${compare.unmatched.map(item => `${item.label} (${formatNumber(Math.round(item.level), 0)})`).join(", ")}.`);
  }
  if (compare?.wasNote) notes.push("(was …) = the pinned day's value at the closest dose time.");
  els.beforeNotes.innerHTML = notes.map(note => `<p>${escapeHtml(note)}</p>`).join("");
}

function renderRangeLists() {
  const parts = [];
  if (state.lines.target !== null && analysis.below) {
    parts.push(analysis.below.length
      ? `Times below your target line: ${rangeText(analysis.below)} (${formatDuration(analysis.belowMinutes)} in all).`
      : "Times below your target line: none.");
  }
  if (state.lines.high !== null && analysis.above) {
    parts.push(analysis.above.length
      ? `Times at or above your high line: ${rangeText(analysis.above)} (${formatDuration(analysis.aboveMinutes)} in all).`
      : "Times at or above your high line: none.");
  }
  els.rangeLists.innerHTML = parts.map(part => `<p>${escapeHtml(part)}</p>`).join("");
}

function renderHourTable() {
  const rows = hourlyRows(analysis);
  const lines = state.lines.target !== null || state.lines.high !== null;
  els.hourHead.innerHTML = `<tr><th scope="col">Time</th><th scope="col">Level</th><th scope="col">Doses this hour</th>${lines ? `<th scope="col">Compared with your lines</th>` : ""}</tr>`;
  els.hourBody.innerHTML = rows.map(row => (
    `<tr><td>${escapeHtml(row.time)}</td><td>${escapeHtml(String(row.level))}</td><td>${escapeHtml(row.doses ?? "")}</td>${lines ? `<td>${escapeHtml(row.compared ?? "")}</td>` : ""}</tr>`
  )).join("");
}

function renderAnswerBar(compare) {
  const totals = dailyTotals(state.doses);
  els.barLedd.textContent = `LEDD ${formatNumber(totals.led)} mg/day`;
  const low = analysis.stats.lowestBefore;
  let text = low
    ? `Lowest before a dose: ${formatNumber(Math.round(low.level), 0)} at ${formatClock(low.minute)} ↓`
    : `Lowest: ${formatNumber(Math.round(analysis.stats.min), 0)} at ${formatClock(analysis.stats.minMinute)} ↓`;
  if (compare && low && ui.pinned?.lowestBefore && Math.round(ui.pinned.lowestBefore.level) !== Math.round(low.level)) {
    text = text.replace(" ↓", ` (was ${formatNumber(Math.round(ui.pinned.lowestBefore.level), 0)}) ↓`);
  }
  els.barLow.textContent = text;
}

function currentHighlight() {
  return ui.openId ?? ui.hoverId ?? null;
}

function highlightCurrent() {
  chart?.highlight(currentHighlight());
}

/* ---------- Status region ---------- */

function queueStatus() {
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    if (!analysis) return;
    els.statusRegion.textContent = statusMessage(analysis, state.doses.length);
  }, 600);
}

function announce(message) {
  window.clearTimeout(statusTimer);
  els.statusRegion.textContent = message;
}

/* ---------- Toggletips ---------- */

function openTip(button) {
  const key = button.dataset.tip;
  const region = document.getElementById(button.getAttribute("aria-controls"));
  if (!region || !TIPS[key]) return;
  closeTip(false);
  region.textContent = TIPS[key];
  button.setAttribute("aria-expanded", "true");
  ui.openTip = button;
}

function closeTip(returnFocus) {
  const button = ui.openTip;
  if (!button) return;
  const region = document.getElementById(button.getAttribute("aria-controls"));
  if (region) region.textContent = "";
  button.setAttribute("aria-expanded", "false");
  ui.openTip = null;
  if (returnFocus && button.isConnected) button.focus();
}

document.addEventListener("click", event => {
  const button = event.target.closest?.(".info");
  if (button) {
    event.preventDefault();
    if (ui.openTip === button) closeTip(false);
    else openTip(button);
    return;
  }
  if (ui.openTip && !event.target.closest?.(".tip")) closeTip(false);
});

/* ---------- Dose list events ---------- */

els.doseList.addEventListener("click", event => {
  const row = event.target.closest(".dose-row");
  if (row) {
    const id = row.dataset.row;
    if (ui.openId === id) {
      commitEditor();
      return;
    }
    if (ui.openId && !commitEditor({ focusAfter: false })) return;
    openEditor(id);
    const fresh = rowButton(id);
    fresh?.focus();
    fresh?.scrollIntoView({ block: "nearest" });
    return;
  }
  const action = event.target.closest("[data-act]")?.dataset.act;
  const dose = doseById(ui.openId);
  if (!action || !dose) return;
  if (action === "earlier" || action === "later") {
    const input = editorField("time", dose.id);
    setInvalid(input, false);
    setFieldMessage(`timeError-${dose.id}`, "");
    applyTime(dose, formatClock(shiftTime(minuteOf(dose.time), action === "earlier" ? -30 : 30)));
  } else if (action === "count-down" || action === "count-up") {
    stepCount(dose, action === "count-up" ? 1 : -1);
  } else if (action === "done") {
    commitEditor();
  } else if (action === "next") {
    const sourceId = dose.id;
    if (commitEditor({ focusAfter: false })) addDose(sourceId);
  } else if (action === "remove") {
    removeDose(dose.id);
  }
});

els.doseList.addEventListener("input", event => {
  const dose = doseById(ui.openId);
  const field = event.target.dataset.field;
  if (!dose || !field) return;
  if (field === "time") {
    const echo = describeTimeInput(event.target.value);
    setFieldMessage(`timeEcho-${dose.id}`, echo.message);
  } else if (field === "count") {
    const count = parseCount(event.target.value);
    const drug = drugOf(dose);
    if (count !== null && !validateCount(drug, dose.strength, count)) {
      setFieldMessage(`calc-${dose.id}`, `= ${ledText(drug, doseMg(drug, dose.strength, count))}`);
    }
  } else if (field === "mg") {
    const parsed = parseMg(event.target.value);
    if (!parsed.error && parsed.value !== null) setFieldMessage(`calc-${dose.id}`, `= ${ledText(drugOf(dose), parsed.value)}`);
  }
});

els.doseList.addEventListener("change", event => {
  const dose = doseById(ui.openId);
  if (!dose) return;
  const target = event.target;
  if (target.type === "radio") {
    clearUndo();
    changeMedicine(dose, target.value);
    return;
  }
  const field = target.dataset.field;
  if (field === "time") {
    clearUndo();
    commitTime(dose);
  } else if (field === "strength") {
    clearUndo();
    changeStrength(dose, target.value);
  } else if (field === "count" || field === "mg") {
    clearUndo();
    commitAmount(dose);
  }
});

els.doseList.addEventListener("keydown", event => {
  const dose = doseById(ui.openId);
  if (!dose) return;
  const target = event.target;
  const field = target.dataset?.field;
  if (event.key === "Escape") {
    if (ui.openTip) {
      event.preventDefault();
      closeTip(true);
      return;
    }
    if (target.closest(".editor")) {
      event.preventDefault();
      cancelEditor();
    }
    return;
  }
  if (event.key === "Enter" && (target.matches("input.text-field") || target.type === "radio")) {
    event.preventDefault();
    commitEditor();
    return;
  }
  if (field === "time") {
    const steps = { ArrowUp: 30, ArrowDown: -30, PageUp: 60, PageDown: -60 };
    if (!Object.hasOwn(steps, event.key)) return;
    event.preventDefault();
    const current = parseTimes(target.value).times;
    const base = current.length === 1 ? current[0] : minuteOf(dose.time);
    setInvalid(target, false);
    setFieldMessage(`timeError-${dose.id}`, "");
    applyTime(dose, formatClock(shiftTime(base, steps[event.key])));
  } else if (field === "count" && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    event.preventDefault();
    stepCount(dose, event.key === "ArrowUp" ? 1 : -1);
  }
});

els.doseList.addEventListener("focusin", event => {
  if (event.target.dataset?.field === "count") event.target.select();
  const row = event.target.closest(".dose-row");
  if (row && finePointer.matches) {
    ui.hoverId = row.dataset.row;
    highlightCurrent();
  }
});

els.doseList.addEventListener("focusout", event => {
  if (event.target.closest(".dose-row")) {
    ui.hoverId = null;
    highlightCurrent();
  }
});

els.doseList.addEventListener("pointerover", event => {
  if (event.pointerType !== "mouse") return;
  const row = event.target.closest(".dose-row");
  const id = row?.dataset.row ?? null;
  if (id === ui.hoverId) return;
  ui.hoverId = id;
  highlightCurrent();
});

els.doseList.addEventListener("pointerleave", () => {
  if (ui.hoverId === null) return;
  ui.hoverId = null;
  highlightCurrent();
});

/* ---------- Other controls ---------- */

els.addFirst.addEventListener("click", () => addDose());
els.addDoseWide.addEventListener("click", () => addDose());
els.addDoseBar.addEventListener("click", () => addDose());
els.tryExample.addEventListener("click", tryExample);
els.clearAll.addEventListener("click", clearAll);
els.undoButton.addEventListener("click", undo);
els.dismissUndo.addEventListener("click", () => {
  clearUndo();
  (els.doseList.querySelector(".dose-row") ?? els.addFirst).focus();
});

els.answerLink.addEventListener("click", event => {
  event.preventDefault();
  els.resultsTitle.scrollIntoView({ block: "start" });
  els.resultsTitle.focus({ preventScroll: true });
});

els.pinButton.addEventListener("click", () => {
  if (!analysis) return;
  ui.pinned = ui.pinned ? null : pinSnapshot(analysis);
  renderResults();
});

for (const [which, input] of [["target", els.targetInput], ["high", els.highInput]]) {
  input.addEventListener("change", () => applyLine(which));
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLine(which);
    }
  });
}

els.removeLines.addEventListener("click", () => {
  if (state.lines.target === null && state.lines.high === null) return;
  clearUndo();
  state.lines = { target: null, high: null };
  syncLineInputs();
  scheduleChanged();
});

els.slider.addEventListener("input", () => {
  ui.cursorTouched = true;
  ui.cursorMinute = snap5(Number(els.slider.value));
  renderCursor();
});

els.slider.addEventListener("keydown", event => {
  const steps = { PageUp: 60, PageDown: -60 };
  if (!Object.hasOwn(steps, event.key)) return;
  event.preventDefault();
  ui.cursorTouched = true;
  ui.cursorMinute = snap5(ui.cursorMinute + steps[event.key]);
  renderCursor();
});

els.howItWorksLink.addEventListener("click", event => {
  event.preventDefault();
  els.limits.open = true;
  els.limits.scrollIntoView({ block: "start" });
  els.limits.querySelector("summary").focus({ preventScroll: true });
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && ui.openTip) closeTip(true);
});

wideQuery.addEventListener("change", () => renderDoseMeta());

/* ---------- Files ---------- */

function localDateStamp() {
  const now = new Date();
  const pad = value => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function showFileMessages(messages, { error = false, focus = false } = {}) {
  els.fileMessages.innerHTML = messages.map((message, index) => (
    `<p${error && index === 0 ? ` class="error"` : ""}>${escapeHtml(message)}</p>`
  )).join("");
  if (focus) els.fileMessages.focus();
}

function saveFile() {
  const payload = exportRegimen({
    doses: state.doses,
    onThreshold: state.lines.target,
    dyskinesiaThreshold: state.lines.high
  });
  const name = `pdmeds-schedule-${localDateStamp()}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  const missing = state.doses.filter(dose => !hasAmount(dose)).length;
  const messages = [`Saved ${name}.`];
  if (missing) messages.push(`${missing} ${missing === 1 ? "dose" : "doses"} without an amount ${missing === 1 ? "was" : "were"} left out of the file.`);
  showFileMessages(messages);
}

function openText(text, name) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    showFileMessages(["This isn't a schedule file."], { error: true, focus: true });
    return;
  }
  let imported;
  try {
    imported = validateRegimenPayload(parsed);
  } catch (error) {
    const messages = error instanceof ModelValidationError ? error.messages : ["This isn't a schedule file."];
    showFileMessages(messages, { error: true, focus: true });
    return;
  }
  const snapshot = state.doses.length ? takeSnapshot() : null;
  state.doses = imported.doses.map(dose => ({ ...dose, id: newId() }));
  state.lines = { target: imported.onThreshold, high: imported.dyskinesiaThreshold };
  state.example = imported.example;
  ui.pinned = null;
  ui.cursorTouched = false;
  closeEditor();
  const label = name ?? "the pasted text";
  if (snapshot) setUndo(snapshot, `Opened ${label}.`);
  else clearUndo();
  syncLineInputs();
  scheduleChanged();
  renderDoseList();
  const messages = [`Opened ${label}: ${state.doses.length} ${state.doses.length === 1 ? "dose" : "doses"}.`];
  if (parsed.modelVersion && parsed.modelVersion !== MODEL_VERSION) {
    messages.push(`Made with model ${parsed.modelVersion}. The curves now use model ${MODEL_VERSION}, so they may look a little different.`);
  }
  messages.push(...(imported.notes ?? []));
  showFileMessages(messages, { focus: true });
}

els.saveFile.addEventListener("click", saveFile);
els.openFile.addEventListener("click", () => els.fileInput.click());
els.fileInput.addEventListener("change", () => {
  const file = els.fileInput.files?.[0];
  if (!file) return;
  file.text().then(text => openText(text, file.name)).catch(() => {
    showFileMessages(["This isn't a schedule file."], { error: true, focus: true });
  });
  els.fileInput.value = "";
});
els.openPasted.addEventListener("click", () => openText(els.pasteText.value, null));

/* ---------- Dose time sheet handoff ---------- */

function setSheetMessage(message) {
  els.sheetMessage.textContent = message;
}

els.makeSheet.addEventListener("click", () => {
  const { rows, notes } = buildSheetRows(state.doses);
  if (!rows.length) return;
  const opened = window.open("schedule.html", "_blank");
  if (!opened) {
    setSheetMessage("Your browser blocked the new tab. Allow pop-ups for this site, or open the Dose time sheet and fill it in by hand.");
    return;
  }
  const token = {};
  pendingSheet = { window: opened, rows, notes, token };
  window.setTimeout(() => {
    if (pendingSheet?.token !== token) return;
    pendingSheet = null;
    setSheetMessage("The time sheet opened but didn't receive the schedule. Fill it in by hand.");
  }, 10000);
  setSheetMessage("");
});

window.addEventListener("message", event => {
  if (!pendingSheet) return;
  if (event.origin !== window.location.origin) return;
  if (event.source !== pendingSheet.window) return;
  if (event.data?.type !== "pdmeds:sheet-ready") return;
  const { rows, notes } = pendingSheet;
  pendingSheet = null;
  event.source.postMessage({ type: "pdmeds:sheet-rows", rows }, window.location.origin);
  setSheetMessage(["The time sheet opened in a new tab.", ...notes].join(" "));
});

/* ---------- Static content ---------- */

function renderDrugCards() {
  els.drugCards.innerHTML = DRUG_ORDER.map(drugId => {
    const drug = DRUG_BY_ID[drugId];
    const strengths = drug.strengths.map(strength => strength.label).join(", ");
    const factor = drug.led.value;
    const status = drug.ledAssumed ? "assumed; borrowed from Rytary" : "consensus, Jost 2023";
    const source = drug.sourceUrl
      ? `<a href="${escapeHtml(drug.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(drug.source)}</a>`
      : escapeHtml(drug.source);
    return `<div class="drug-card">
      <h4>${lineSwatch(drug.style)}${escapeHtml(drug.shortName)}</h4>
      <p>${escapeHtml(drug.generic)}. Strengths ${escapeHtml(strengths)}.</p>
      <p>${escapeHtml(drug.peaksText)}; ${escapeHtml(drug.halfText)}.</p>
      <p>LEDD factor ×${factor} (${status}).</p>
      <p>Source: ${source}</p>
    </div>`;
  }).join("");
  els.references.innerHTML = REFERENCES.map(reference => `<li>${escapeHtml(reference)}</li>`).join("");
}

/* ---------- Print ---------- */

function fillPrint() {
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  els.printHeader.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = "Levodopa day summary";
  const meta = document.createElement("p");
  meta.textContent = `Printed ${today} · Model ${MODEL_VERSION}`;
  const caution = document.createElement("p");
  caution.textContent = "A teaching model of average patients. Not for dosing decisions.";
  els.printHeader.append(title, meta, caution);

  els.printDoses.replaceChildren();
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const label of ["Time", "Medicine", "Amount", "Levodopa mg", "LEDD (factor)"]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = label;
    head.append(cell);
  }
  const body = table.createTBody();
  for (const dose of sortedDoses()) {
    const drug = drugOf(dose);
    const row = body.insertRow();
    const led = hasAmount(dose) ? `${formatNumber(dose.dose * drug.led.value)} (×${drug.led.value}${drug.ledAssumed ? ", assumed" : ""})` : "not counted";
    const unit = dose.count === 1 ? drug.unit[0] : drug.unit[1];
    const amount = dose.strength ? `${formatCount(dose.count)} × ${strengthOf(drug, dose.strength).label} ${unit}` : (hasAmount(dose) ? `${formatNumber(dose.dose)} mg` : "—");
    for (const text of [dose.time, drug.shortName, amount, hasAmount(dose) ? formatNumber(dose.dose) : "—", led]) {
      row.insertCell().textContent = text;
    }
  }
  const totals = dailyTotals(state.doses);
  const total = document.createElement("p");
  total.textContent = `Daily total: ${formatNumber(totals.mg)} mg levodopa = ${formatNumber(totals.led)} mg LEDD/day`;
  const lines = document.createElement("p");
  const parts = [];
  if (state.lines.target !== null) parts.push(`Target line ${formatNumber(state.lines.target)}`);
  if (state.lines.high !== null) parts.push(`High line ${formatNumber(state.lines.high)}`);
  lines.textContent = parts.length ? parts.join(" · ") : "No lines set";
  els.printDoses.append(table, total, lines);
  if (analysis && chart) {
    chart.draw(analysis, { cursorMinute: ui.cursorMinute, pinnedTotal: ui.pinned?.total ?? null, highlightId: null, printing: true });
  }
}

function afterPrint() {
  if (analysis && chart) renderChart();
}

window.addEventListener("beforeprint", fillPrint);
window.addEventListener("afterprint", afterPrint);
window.matchMedia("print").addEventListener("change", event => {
  if (event.matches) fillPrint();
  else afterPrint();
});

/* ---------- Start ---------- */

els.sliderHint.textContent = finePointer.matches
  ? "Hover the chart, or use the slider (arrow keys: 5 min, Page Up/Down: 1 hour)."
  : "Drag across the chart to read any time.";
els.footerVersion.textContent = `Model ${MODEL_VERSION}`;
renderDrugCards();
renderUndo();
renderDoseList();
scheduleChanged();
