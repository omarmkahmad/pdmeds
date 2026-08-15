import {
  DRUGS,
  DRUG_BY_ID,
  MINUTES_PER_DAY,
  MODEL_VERSION,
  PALETTE
} from "./src/drugs.js";
import {
  MAX_DOSES,
  MAX_DOSE_MG,
  ModelValidationError,
  calculateLedSummary,
  calculateStatistics,
  classifyLevel,
  computeDay,
  exportRegimen,
  formatClock,
  formatDuration,
  toMinute,
  validateRegimenPayload,
  validateThresholds
} from "./src/model.js";

const $ = id => document.getElementById(id);
const escapeHtml = value => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
const round1 = value => Math.round(value * 10) / 10;

const elements = {
  modelVersion: $("modelVersion"),
  exampleBadge: $("exampleBadge"),
  regimenBody: $("regimenBody"),
  addDose: $("addDose"),
  loadExample: $("loadExample"),
  clearRegimen: $("clearRegimen"),
  onThreshold: $("onThreshold"),
  dyskinesiaThreshold: $("dyskinesiaThreshold"),
  days: $("days"),
  formMessage: $("formMessage"),
  readoutTime: $("readoutTime"),
  readoutValue: $("readoutValue"),
  readoutZone: $("readoutZone"),
  readoutContributions: $("readoutContributions"),
  chartBox: $("chartBox"),
  timeSlider: $("timeSlider"),
  sliderTime: $("sliderTime"),
  legend: $("legend"),
  statistics: $("statistics"),
  regimenJson: $("regimenJson"),
  exportJson: $("exportJson"),
  copyJson: $("copyJson"),
  downloadJson: $("downloadJson"),
  importJson: $("importJson"),
  jsonMessage: $("jsonMessage"),
  parameterBody: $("parameterBody")
};

let state = validateRegimenPayload({ doses: [], days: 2 });
let computed = null;
let cursorMinute = 0;

const compactChartQuery = window.matchMedia("(max-width: 640px)");

function chartGeometry() {
  if (compactChartQuery.matches) {
    return {
      compact: true,
      width: 480,
      height: 414,
      left: 48,
      right: 470,
      top: 16,
      bottom: 318,
      stripY: 334,
      stripHeight: 16,
      labelY: 388,
      hourStep: 6,
      yTop: 10
    };
  }
  return {
    compact: false,
    width: 980,
    height: 470,
    left: 64,
    right: 960,
    top: 18,
    bottom: 338,
    stripY: 360,
    stripHeight: 18,
    labelY: 410,
    hourStep: 2,
    yTop: 10
  };
}

let CHART = chartGeometry();

const DASH_PATTERNS = ["", "8 4", "2 3", "10 3 2 3", "5 3", "12 4", "3 2 1 2"];

function setMessage(element, message = "", success = false) {
  element.textContent = message;
  element.classList.toggle("success", success);
}

function markPersonalized() {
  state.example = false;
  elements.exampleBadge.hidden = true;
}

function synchronizeSettings() {
  elements.onThreshold.value = state.onThreshold ?? "";
  elements.dyskinesiaThreshold.value = state.dyskinesiaThreshold ?? "";
  elements.days.value = state.days;
  elements.exampleBadge.hidden = !state.example;
}

function ledFormula(drug) {
  return `dose × ${drug.led.value}`;
}

function drugOptions(selected) {
  const grouped = new Map();
  DRUGS.forEach(drug => {
    if (!grouped.has(drug.group)) grouped.set(drug.group, []);
    grouped.get(drug.group).push(drug);
  });
  return Array.from(grouped.entries()).map(([group, drugs]) => (
    `<optgroup label="${escapeHtml(group)}">${drugs.map(drug => (
      `<option value="${drug.id}"${drug.id === selected ? " selected" : ""}>${escapeHtml(drug.name)}</option>`
    )).join("")}</optgroup>`
  )).join("");
}

function renderParameterTable() {
  elements.parameterBody.innerHTML = DRUGS.map(drug => {
    const source = drug.sourceUrl
      ? `<a href="${escapeHtml(drug.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(drug.source)}</a>`
      : escapeHtml(drug.source);
    return `<tr>
      <td>${escapeHtml(drug.name)}</td>
      <td>${escapeHtml(ledFormula(drug))}</td>
      <td>${escapeHtml(drug.model)}</td>
      <td><strong>${escapeHtml(drug.evidence)}</strong><br>${source}</td>
    </tr>`;
  }).join("");
}

function renderRows() {
  const led = calculateLedSummary(state.doses);
  if (!state.doses.length) {
    elements.regimenBody.innerHTML = `<tr><td class="empty-row" colspan="6">No medication rows yet. Add a dose or load the clearly labeled example.</td></tr>`;
    return;
  }

  elements.regimenBody.innerHTML = state.doses.map((dose, index) => {
    const drug = DRUG_BY_ID[dose.drug];
    const label = `${drug.name}, ${dose.dose} milligrams at ${dose.time}`;
    return `<tr>
      <td><input type="time" value="${dose.time}" data-index="${index}" data-field="time" aria-label="Dose time for row ${index + 1}"></td>
      <td><select data-index="${index}" data-field="drug" aria-label="Medication for row ${index + 1}">${drugOptions(drug.id)}</select></td>
      <td><input type="number" min="0" max="${MAX_DOSE_MG}" step="any" inputmode="decimal" value="${dose.dose}" data-index="${index}" data-field="dose" aria-label="Dose in milligrams for row ${index + 1}"></td>
      <td><span id="row-led-${index}" title="Research levodopa-equivalent daily dose contribution">${round1(led.rows[index].totalLed)} mg</span></td>
      <td><span class="curve-chip" style="background:${PALETTE[index % PALETTE.length]}" aria-label="Curve color for row ${index + 1}"></span></td>
      <td><button class="button remove-button" type="button" data-remove="${index}" aria-label="Remove ${escapeHtml(label)}">×</button></td>
    </tr>`;
  }).join("");

  elements.regimenBody.querySelectorAll("input[data-field], select[data-field]").forEach(control => {
    control.addEventListener("change", handleRowChange);
  });
  elements.regimenBody.querySelectorAll("button[data-remove]").forEach(button => {
    button.addEventListener("click", () => {
      state.doses.splice(Number(button.dataset.remove), 1);
      markPersonalized();
      renderRows();
      recompute();
    });
  });
}

function handleRowChange(event) {
  const control = event.currentTarget;
  const index = Number(control.dataset.index);
  const field = control.dataset.field;
  const dose = state.doses[index];
  control.removeAttribute("aria-invalid");
  setMessage(elements.formMessage);

  if (field === "time") {
    if (Number.isNaN(toMinute(control.value))) {
      control.setAttribute("aria-invalid", "true");
      setMessage(elements.formMessage, "Enter a valid 24-hour time.");
      control.value = dose.time;
      return;
    }
    dose.time = control.value;
  } else if (field === "drug") {
    const drug = DRUG_BY_ID[control.value];
    dose.drug = drug.id;
    dose.dose = drug.defaultDose;
  } else {
    const value = Number(control.value);
    if (!Number.isFinite(value) || value < 0 || value > MAX_DOSE_MG) {
      control.setAttribute("aria-invalid", "true");
      setMessage(elements.formMessage, `Dose must be between 0 and ${MAX_DOSE_MG}.`);
      control.value = dose[field];
      return;
    }
    dose[field] = value;
  }
  markPersonalized();
  renderRows();
  recompute();
}

function xPosition(minute) {
  return CHART.left + (minute / MINUTES_PER_DAY) * (CHART.right - CHART.left);
}

function niceStep(range) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / 6;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function zoneLabel(classification) {
  return {
    high: "High exposure",
    target: "At or above target",
    low: "Below target",
    unclassified: "Unclassified"
  }[classification];
}

function drawChart() {
  const previousYTop = CHART.yTop;
  CHART = chartGeometry();
  CHART.yTop = previousYTop;
  const axisFont = CHART.compact ? 14 : 12;
  const smallFont = CHART.compact ? 12.5 : 11;
  const curveWidth = CHART.compact ? 2.1 : 1.8;
  const requestedTop = Math.max(
    computed.maximum,
    state.dyskinesiaThreshold ?? 0,
    state.onThreshold ?? 0,
    10
  ) * 1.08;
  const step = niceStep(requestedTop);
  const yTop = Math.ceil(requestedTop / step) * step;
  CHART.yTop = yTop;
  const yPosition = value => CHART.bottom - (value / yTop) * (CHART.bottom - CHART.top);
  const svg = [];
  svg.push(`<svg viewBox="0 0 ${CHART.width} ${CHART.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="chartSvgTitle chartSvgDescription" id="exposureSvg">`);
  svg.push(`<title id="chartSvgTitle">Modeled relative medication exposure over 24 hours</title>`);
  svg.push(`<desc id="chartSvgDescription">A total exposure curve and individual medication curves. Use the time slider after the graph for exact values.</desc>`);
  svg.push(`<rect width="${CHART.width}" height="${CHART.height}" fill="#ffffff"/>`);

  if (state.onThreshold !== null) {
    svg.push(`<rect x="${CHART.left}" y="${yPosition(state.onThreshold)}" width="${CHART.right - CHART.left}" height="${CHART.bottom - yPosition(state.onThreshold)}" fill="#e7f3ec"/>`);
  }
  if (state.dyskinesiaThreshold !== null) {
    svg.push(`<rect x="${CHART.left}" y="${CHART.top}" width="${CHART.right - CHART.left}" height="${Math.max(0, yPosition(state.dyskinesiaThreshold) - CHART.top)}" fill="#4b5560" opacity="0.14"/>`);
  }

  for (let value = 0; value <= yTop + step / 100; value += step) {
    const y = yPosition(value);
    svg.push(`<line x1="${CHART.left}" y1="${y}" x2="${CHART.right}" y2="${y}" stroke="#d7dde2"/>`);
    svg.push(`<text x="${CHART.left - 9}" y="${y + 4}" text-anchor="end" font-size="${axisFont}" fill="#17202a">${round1(value)}</text>`);
  }
  for (let hour = 0; hour <= 24; hour += CHART.hourStep) {
    const x = xPosition(hour * 60);
    svg.push(`<line x1="${x}" y1="${CHART.top}" x2="${x}" y2="${CHART.bottom}" stroke="#edf0f2"/>`);
    svg.push(`<text x="${x}" y="${CHART.labelY}" text-anchor="middle" font-size="${axisFont}" fill="#17202a">${String(hour).padStart(2, "0")}:00</text>`);
  }
  svg.push(`<line x1="${CHART.left}" y1="${CHART.top}" x2="${CHART.left}" y2="${CHART.bottom}" stroke="#17202a" stroke-width="1.5"/>`);
  svg.push(`<line x1="${CHART.left}" y1="${CHART.bottom}" x2="${CHART.right}" y2="${CHART.bottom}" stroke="#17202a" stroke-width="1.5"/>`);
  svg.push(`<text transform="translate(${CHART.compact ? 15 : 17} ${(CHART.top + CHART.bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="${CHART.compact ? 12.5 : 12}" font-weight="700" fill="#17202a">Relative exposure units</text>`);

  if (state.onThreshold !== null) {
    svg.push(`<line x1="${CHART.left}" y1="${yPosition(state.onThreshold)}" x2="${CHART.right}" y2="${yPosition(state.onThreshold)}" stroke="#146c43" stroke-width="1.5" stroke-dasharray="7 4"/>`);
    svg.push(`<text x="${CHART.right - 4}" y="${yPosition(state.onThreshold) - 6}" text-anchor="end" font-size="${smallFont}" font-weight="700" fill="#146c43">User target</text>`);
  }
  if (state.dyskinesiaThreshold !== null) {
    svg.push(`<line x1="${CHART.left}" y1="${yPosition(state.dyskinesiaThreshold)}" x2="${CHART.right}" y2="${yPosition(state.dyskinesiaThreshold)}" stroke="#9c2f24" stroke-width="1.5" stroke-dasharray="2 3"/>`);
    svg.push(`<text x="${CHART.right - 4}" y="${yPosition(state.dyskinesiaThreshold) - 6}" text-anchor="end" font-size="${smallFont}" font-weight="700" fill="#9c2f24">${CHART.compact ? "High threshold" : "User high-exposure threshold"}</text>`);
  }

  state.doses.forEach((dose, index) => {
    if (dose.hidden) return;
    const path = [];
    for (let minute = 0; minute <= MINUTES_PER_DAY; minute += 2) {
      path.push(`${minute === 0 ? "M" : "L"}${xPosition(minute).toFixed(1)} ${yPosition(computed.series[index][minute]).toFixed(1)}`);
    }
    const dash = DASH_PATTERNS[index % DASH_PATTERNS.length];
    svg.push(`<path d="${path.join(" ")}" fill="none" stroke="${PALETTE[index % PALETTE.length]}" stroke-width="${curveWidth}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`);
  });

  const totalPath = [];
  for (let minute = 0; minute <= MINUTES_PER_DAY; minute += 2) {
    totalPath.push(`${minute === 0 ? "M" : "L"}${xPosition(minute).toFixed(1)} ${yPosition(computed.total[minute]).toFixed(1)}`);
  }
  svg.push(`<path d="${totalPath.join(" ")}" fill="none" stroke="#17202a" stroke-width="3"/>`);

  if (state.onThreshold !== null) {
    let runStart = 0;
    let current = classifyLevel(computed.total[0], state.onThreshold, state.dyskinesiaThreshold);
    const fills = { low: "#d8dde2", target: "#e7f3ec", high: "#4b5560" };
    for (let minute = 1; minute <= MINUTES_PER_DAY; minute += 1) {
      const next = minute === MINUTES_PER_DAY
        ? null
        : classifyLevel(computed.total[minute], state.onThreshold, state.dyskinesiaThreshold);
      if (next !== current) {
        svg.push(`<rect x="${xPosition(runStart)}" y="${CHART.stripY}" width="${xPosition(minute) - xPosition(runStart)}" height="${CHART.stripHeight}" fill="${fills[current]}"/>`);
        runStart = minute;
        current = next;
      }
    }
    svg.push(`<rect x="${CHART.left}" y="${CHART.stripY}" width="${CHART.right - CHART.left}" height="${CHART.stripHeight}" fill="none" stroke="#17202a"/>`);
    svg.push(`<text x="${CHART.left - 9}" y="${CHART.stripY + 13}" text-anchor="end" font-size="${CHART.compact ? 11 : 10}" font-weight="700" fill="#17202a">Zones</text>`);
  }

  const cursorX = xPosition(cursorMinute);
  svg.push(`<line id="crosshairLine" x1="${cursorX}" y1="${CHART.top}" x2="${cursorX}" y2="${CHART.bottom}" stroke="#17202a" stroke-width="1" stroke-dasharray="3 3"/>`);
  svg.push(`<circle id="crosshairDot" cx="${cursorX}" cy="${yPosition(computed.total[cursorMinute])}" r="5" fill="#17202a"/>`);
  svg.push("</svg>");
  elements.chartBox.innerHTML = svg.join("");
}

function updateReadout(minute) {
  cursorMinute = Math.max(0, Math.min(1439, Math.round(minute)));
  const value = computed.total[cursorMinute];
  const classification = classifyLevel(value, state.onThreshold, state.dyskinesiaThreshold);
  const time = formatClock(cursorMinute);
  elements.readoutTime.textContent = time;
  elements.readoutValue.textContent = String(round1(value));
  elements.readoutZone.textContent = zoneLabel(classification);
  elements.timeSlider.value = String(cursorMinute);
  elements.sliderTime.value = time;
  elements.sliderTime.textContent = time;

  const contributions = state.doses.map((dose, index) => ({
    dose,
    index,
    value: computed.series[index][cursorMinute]
  })).filter(item => item.value > 0.5 && !item.dose.hidden)
    .sort((left, right) => right.value - left.value)
    .slice(0, 5)
    .map(item => {
      const name = DRUG_BY_ID[item.dose.drug].name.split(" — ")[0].split(" (")[0];
      return `${name} ${item.dose.time}: ${round1(item.value)}`;
    });
  elements.readoutContributions.textContent = contributions.length
    ? `Largest contributions — ${contributions.join(" · ")}`
    : "No visible contribution at this time.";

  const line = $("crosshairLine");
  const dot = $("crosshairDot");
  if (line && dot) {
    const x = xPosition(cursorMinute);
    const y = CHART.bottom - (value / CHART.yTop) * (CHART.bottom - CHART.top);
    line.setAttribute("x1", String(x));
    line.setAttribute("x2", String(x));
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
  }
}

function renderLegend() {
  const total = `<span class="legend-button" aria-label="Total exposure curve"><span class="legend-swatch" style="background:#17202a"></span><strong>Total</strong></span>`;
  const rows = state.doses.map((dose, index) => {
    const drug = DRUG_BY_ID[dose.drug];
    const name = drug.name.split(" — ")[0];
    const time = ` ${dose.time}`;
    return `<button type="button" class="legend-button" data-legend-index="${index}" aria-pressed="${!dose.hidden}" aria-label="${dose.hidden ? "Show" : "Hide"} ${escapeHtml(name)} curve">
      <span class="legend-swatch" style="background:${PALETTE[index % PALETTE.length]}"></span>
      ${escapeHtml(name)}${time} · ${dose.dose} mg
    </button>`;
  }).join("");
  elements.legend.innerHTML = total + rows;
  elements.legend.querySelectorAll("button[data-legend-index]").forEach(button => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.legendIndex);
      state.doses[index].hidden = !state.doses[index].hidden;
      markPersonalized();
      recompute();
    });
  });
}

function statCard(value, label, note = "") {
  return `<div class="stat"><span class="stat-value">${escapeHtml(value)}</span><span class="stat-label">${escapeHtml(label)}</span>${note ? `<span class="stat-note">${escapeHtml(note)}</span>` : ""}</div>`;
}

function renderStatistics() {
  if (!state.doses.length) {
    elements.statistics.innerHTML = statCard("—", "Add doses to begin");
    return;
  }
  const stats = calculateStatistics(computed, state);
  const cards = [
    statCard(`${round1(stats.ledd)} mg/day`, "Total LEDD", "Research dose-comparison measure"),
    statCard(round1(stats.peak), "Model peak", `at ${formatClock(stats.peakMinute)}`),
    statCard(round1(stats.trough), "Model trough", `at ${formatClock(stats.troughMinute)}`),
    statCard(stats.fluctuationIndex === null ? "—" : round1(stats.fluctuationIndex), "Fluctuation index", "(peak − trough) / mean")
  ];
  if (stats.targetMinutes !== undefined) {
    cards.push(statCard(formatDuration(stats.targetMinutes), "At/above target", `${Math.round(stats.targetMinutes / 14.4)}% of day`));
    cards.push(statCard(formatDuration(stats.lowMinutes), "Below target", `Longest circular interval ${formatDuration(stats.longestLowMinutes)}`));
  }
  if (stats.highMinutes !== undefined) cards.push(statCard(formatDuration(stats.highMinutes), "Above high threshold", `${Math.round(stats.highMinutes / 14.4)}% of day`));
  elements.statistics.innerHTML = cards.join("");
}

function recompute() {
  try {
    computed = computeDay(state);
    if (cursorMinute === null || !Number.isFinite(cursorMinute)) cursorMinute = computed.maximumMinute;
    drawChart();
    renderLegend();
    renderStatistics();
    updateReadout(cursorMinute);
    const led = computed.led;
    state.doses.forEach((dose, index) => {
      const cell = $(`row-led-${index}`);
      if (cell) cell.textContent = `${round1(led.rows[index].totalLed)} mg`;
    });
  } catch (error) {
    const message = error instanceof ModelValidationError ? error.messages.join(" ") : "The model could not calculate this regimen.";
    setMessage(elements.formMessage, message);
  }
}

function applyThresholdSettings() {
  const validation = validateThresholds(elements.onThreshold.value, elements.dyskinesiaThreshold.value);
  elements.onThreshold.setAttribute("aria-invalid", String(validation.errors.some(message => message.includes("Target"))));
  elements.dyskinesiaThreshold.setAttribute("aria-invalid", String(validation.errors.length > 0));
  if (validation.errors.length) {
    setMessage(elements.formMessage, validation.errors.join(" "));
    return;
  }
  elements.onThreshold.removeAttribute("aria-invalid");
  elements.dyskinesiaThreshold.removeAttribute("aria-invalid");
  state.onThreshold = validation.onThreshold;
  state.dyskinesiaThreshold = validation.dyskinesiaThreshold;
  markPersonalized();
  setMessage(elements.formMessage);
  recompute();
}

function prepareJson() {
  const text = JSON.stringify(exportRegimen(state), null, 2);
  elements.regimenJson.value = text;
  setMessage(elements.jsonMessage, `Prepared regimen for model ${MODEL_VERSION}.`, true);
  return text;
}

async function copyJson() {
  const text = elements.regimenJson.value.trim() || prepareJson();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    elements.regimenJson.focus();
    elements.regimenJson.select();
    document.execCommand("copy");
  }
  setMessage(elements.jsonMessage, "Regimen JSON copied.", true);
}

function downloadJson() {
  const text = elements.regimenJson.value.trim() || prepareJson();
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pdmeds-regimen-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setMessage(elements.jsonMessage, "Regimen JSON downloaded.", true);
}

function loadJson() {
  try {
    const parsed = JSON.parse(elements.regimenJson.value);
    const imported = validateRegimenPayload(parsed);
    const versionNote = parsed.modelVersion && parsed.modelVersion !== MODEL_VERSION
      ? ` It was created with model ${parsed.modelVersion}; results have been recalculated with ${MODEL_VERSION}.`
      : "";
    state = imported;
    cursorMinute = 0;
    synchronizeSettings();
    renderRows();
    recompute();
    setMessage(elements.jsonMessage, `Regimen loaded.${versionNote}`, true);
  } catch (error) {
    const message = error instanceof ModelValidationError
      ? error.messages.join(" ")
      : "The text is not valid regimen JSON.";
    setMessage(elements.jsonMessage, message);
  }
}

elements.addDose.addEventListener("click", () => {
  if (state.doses.length >= MAX_DOSES) {
    setMessage(elements.formMessage, `A regimen can contain at most ${MAX_DOSES} rows.`);
    return;
  }
  state.doses.push({ time: "08:00", drug: "sinemet", dose: 100, hidden: false });
  markPersonalized();
  renderRows();
  recompute();
});

elements.loadExample.addEventListener("click", () => {
  state = validateRegimenPayload({
    doses: [
      { time: "07:00", drug: "sinemet", dose: 100 },
      { time: "11:00", drug: "sinemet", dose: 100 },
      { time: "15:00", drug: "sinemet", dose: 100 },
      { time: "19:00", drug: "sinemet", dose: 100 },
      { time: "21:00", drug: "sinemetcr", dose: 200 }
    ],
    onThreshold: 50,
    dyskinesiaThreshold: 120,
    days: 2,
    example: true
  });
  cursorMinute = 0;
  synchronizeSettings();
  setMessage(elements.formMessage);
  renderRows();
  recompute();
});

elements.clearRegimen.addEventListener("click", () => {
  if (state.doses.length && !window.confirm("Clear every medication row?")) return;
  state.doses = [];
  state.example = false;
  cursorMinute = 0;
  elements.exampleBadge.hidden = true;
  renderRows();
  recompute();
});

elements.onThreshold.addEventListener("change", applyThresholdSettings);
elements.dyskinesiaThreshold.addEventListener("change", applyThresholdSettings);
elements.days.addEventListener("change", () => {
  const value = Number(elements.days.value);
  if (!Number.isInteger(value) || value < 1 || value > 7) {
    elements.days.setAttribute("aria-invalid", "true");
    elements.days.value = state.days;
    setMessage(elements.formMessage, "Days represented must be a whole number from 1 to 7.");
    return;
  }
  elements.days.removeAttribute("aria-invalid");
  state.days = value;
  markPersonalized();
  setMessage(elements.formMessage);
  recompute();
});

elements.timeSlider.addEventListener("input", () => updateReadout(Number(elements.timeSlider.value)));
elements.timeSlider.addEventListener("keydown", event => {
  const steps = {
    ArrowRight: 1,
    ArrowUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
    PageUp: 60,
    PageDown: -60,
    Home: -cursorMinute,
    End: 1439 - cursorMinute
  };
  if (!Object.hasOwn(steps, event.key)) return;
  event.preventDefault();
  updateReadout(cursorMinute + steps[event.key]);
});
elements.chartBox.addEventListener("pointermove", event => {
  const svg = elements.chartBox.querySelector("svg");
  if (!svg) return;
  const bounds = svg.getBoundingClientRect();
  const scale = bounds.width / CHART.width;
  const minute = ((event.clientX - bounds.left) / scale - CHART.left) / (CHART.right - CHART.left) * MINUTES_PER_DAY;
  if (minute >= 0 && minute < MINUTES_PER_DAY) updateReadout(minute);
});
elements.chartBox.addEventListener("pointerdown", event => {
  if (event.pointerType === "touch") {
    const svg = elements.chartBox.querySelector("svg");
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const scale = bounds.width / CHART.width;
    updateReadout(((event.clientX - bounds.left) / scale - CHART.left) / (CHART.right - CHART.left) * MINUTES_PER_DAY);
  }
});

compactChartQuery.addEventListener("change", () => {
  if (!computed) return;
  drawChart();
  updateReadout(cursorMinute);
});

elements.exportJson.addEventListener("click", prepareJson);
elements.copyJson.addEventListener("click", copyJson);
elements.downloadJson.addEventListener("click", downloadJson);
elements.importJson.addEventListener("click", loadJson);

elements.modelVersion.textContent = `Model ${MODEL_VERSION}`;
synchronizeSettings();
renderParameterTable();
renderRows();
recompute();
