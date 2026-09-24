// The day chart: an SVG drawn at the container's real pixel width.
// buildChartScene() is pure (a plain node tree, tested in node); createChart()
// turns it into DOM and adds resizing, the cursor, highlighting and pointer input.
import { DRUG_BY_ID, MINUTES_PER_DAY } from "./drugs.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DAY = MINUTES_PER_DAY;

export const COMPACT_BELOW = 560;
export const PRINT_WIDTH = 720;
export const SNAP_MINUTES = 5;
export const CURSOR_MAX = DAY - SNAP_MINUTES;
export const CHART_TITLE = "Levodopa level over a typical day";

// Every class the chart emits: the whole contract with styles.css. The
// stylesheet sets text sizes only through these (SPEC 4.3, 9):
//   .chart-tick, .chart-label, .chart-marker-num { font-size: 12px }
//   .chart-wide .chart-tick { font-size: 13px }
//   .chart-svg.printing .chart-tick, .chart-svg.printing .chart-label,
//   .chart-svg.printing .chart-marker-num { font-size: 10pt }
//   @media (forced-colors: active) { .chart-total { stroke: CanvasText } }
// Colours, widths and opacities are presentation attributes, which any CSS
// rule overrides, so it must not set fill, stroke or opacity on these parts
// outside forced-colors.
export const CHART_CLASSES = Object.freeze({
  svg: "chart-svg", compact: "chart-compact", wide: "chart-wide", printing: "printing",
  pinned: "chart-is-pinned", hasHighlight: "chart-has-highlight",
  grid: "chart-grid", axis: "chart-axis", ticks: "chart-ticks",
  tick: "chart-tick", tickX: "chart-tick-x", tickY: "chart-tick-y",
  shading: "chart-shading", shadeBelow: "chart-shade-below", shadeAbove: "chart-shade-above",
  lines: "chart-lines", refLine: "chart-ref", targetLine: "chart-target", highLine: "chart-high",
  pinnedLine: "chart-pinned",
  doses: "chart-doses", dose: "chart-dose", highlighted: "is-highlighted", faded: "is-faded",
  total: "chart-total", doseMarks: "chart-dose-marks", doseMark: "chart-dose-mark",
  markers: "chart-markers", marker: "chart-marker", markerNum: "chart-marker-num",
  lineLabels: "chart-line-labels", label: "chart-label", refLabel: "chart-ref-label",
  cursorRule: "chart-cursor-rule", cursorLine: "chart-cursor-line", cursor: "chart-cursor",
  cursorDot: "chart-cursor-dot"
});

const STACK_MINUTES = 45;
const LABEL_GAP = 14;
const MARKER_RADIUS = 9;
const MARKER_OFFSET = 14;
const TRIANGLE_WIDTH = 10;
const TRIANGLE_HEIGHT = 8;
const INK = "#17202a";
const MUTED = "#56616d";

export const LINE_STYLES = Object.freeze({
  grid: { color: "#e3e7eb", width: 1, dash: "" },
  axis: { color: MUTED, width: 1, dash: "" },
  ref: { color: "#6b7580", width: 1.5, dash: "1 4" },
  target: { color: "#146c43", width: 2, dash: "7 4" },
  high: { color: "#9c2f24", width: 2, dash: "10 3 2 3" },
  pinned: { color: "#8a96a3", width: 2, dash: "6 4" },
  total: { color: INK, width: 3, dash: "" },
  cursor: { color: "#3d4852", width: 1, dash: "4 3" }
});

export const SHADE_COLORS = Object.freeze({ below: "#fbe3c8", above: "#f3d6d2" });

// Used only while drugs.js has no `style` for a preparation (SPEC 4.3 table).
const FALLBACK_STYLES = {
  sinemet: { color: "#0072B2", dash: "" },
  sinemetcr: { color: "#B35900", dash: "9 4" },
  rytary: { color: "#117733", dash: "4 3" },
  crexont: { color: "#882255", dash: "12 3 3 3" },
  inbrija: { color: "#5E3C99", dash: "2 3" }
};

export function curveStyle(drugId) {
  const style = DRUG_BY_ID[drugId]?.style;
  if (style && typeof style.color === "string") return { color: style.color, dash: style.dash || "" };
  return FALLBACK_STYLES[drugId] || { color: MUTED, dash: "" };
}

// Width and look of one per-dose curve: "normal", "on" (highlighted) or "faded".
export function doseCurveLook(state, pinned = false) {
  if (state === "on") return { width: 2.5, opacity: 1 };
  if (state === "faded" || pinned) return { width: 1.5, opacity: 0.25 };
  return { width: 1.5, opacity: 0.75 };
}

export function chartGeometry(width, { printing = false } = {}) {
  const box = Math.floor(printing ? PRINT_WIDTH : Number(width) || 0);
  const w = Math.max(120, box);
  const compact = w < COMPACT_BELOW;
  // Print keeps the chart short so the whole summary fits one Letter page.
  const height = compact || printing ? 260 : Math.round(Math.min(380, Math.max(300, 0.45 * w)));
  const margin = compact
    ? { left: 36, right: 8, top: 10, bottom: 46 }
    : { left: 42, right: 84, top: 12, bottom: 48 };
  const plotLeft = margin.left;
  const plotRight = w - margin.right;
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;
  const plotWidth = plotRight - plotLeft;
  let hourStep = compact ? 6 : plotWidth >= 900 ? 2 : 3;
  // Below about 160 px five "HH:00" labels would touch.
  if (compact && plotWidth < 160) hourStep = 12;
  return {
    width: w, height, compact, printing: Boolean(printing), margin,
    plotLeft, plotRight, plotTop, plotBottom, plotWidth, plotHeight: plotBottom - plotTop,
    hourStep,
    // Gridlines every 3 h, except when labels are every 2 h, so no label floats between lines.
    gridStep: hourStep === 2 ? 2 : 3,
    labelsInMargin: !compact
  };
}

function niceStep(raw) {
  for (let power = 100; ; power *= 10) {
    for (const factor of [2, 2.5, 5, 10]) {
      if (Math.ceil(raw / (factor * power) - 1e-9) <= 8) return factor * power;
    }
  }
}

// 0 to a round-up of 1.08 × the largest value, never below 100.
export function yScale(values) {
  let peak = 100;
  for (const value of values) if (Number.isFinite(value) && value > peak) peak = value;
  const raw = peak * 1.08;
  const roundUp = step => Math.ceil(raw / step - 1e-9) * step;
  let step = roundUp(50) > 300 ? 100 : 50;
  // Not in SPEC: very large days would need more than 10 ticks at 100.
  if (roundUp(step) > 1000) step = niceStep(raw);
  const top = roundUp(step);
  const ticks = [];
  for (let value = 0; value <= top + 1e-9; value += step) ticks.push(value);
  return { top, step, ticks };
}

export function seriesMax(values) {
  let max = 0;
  if (!values) return max;
  for (let index = 0; index < values.length; index += 1) {
    if (Number.isFinite(values[index]) && values[index] > max) max = values[index];
  }
  return max;
}

function isSeries(values) {
  return values != null && typeof values !== "string" && typeof values.length === "number" && values.length >= DAY;
}

function valueAt(values, minute) {
  const value = minute < values.length ? values[minute] : values[minute % DAY];
  return Number.isFinite(value) ? value : 0;
}

export function snapMinute(raw) {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(CURSOR_MAX, Math.max(0, Math.round(raw / SNAP_MINUTES) * SNAP_MINUTES));
}

function normalizeMinute(minute) {
  if (minute === null || minute === undefined || minute === "") return null;
  const value = Number(minute);
  if (!Number.isFinite(value)) return null;
  return Math.min(DAY, Math.max(0, Math.round(value)));
}

export function parseClock(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!match) return NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return NaN;
  return hours * 60 + minutes;
}

// Stacking rows for dose triangles: a triangle takes the first row whose last
// triangle is more than 45 min earlier, so doses close together never overlap.
export function stackRows(minutes, window = STACK_MINUTES) {
  const order = minutes.map((minute, index) => ({ minute, index }))
    .sort((a, b) => a.minute - b.minute || a.index - b.index);
  const lastInRow = [];
  const rows = new Array(minutes.length).fill(0);
  for (const { minute, index } of order) {
    let row = lastInRow.findIndex(last => minute - last > window);
    if (row === -1) row = lastInRow.length;
    lastInRow[row] = minute;
    rows[index] = row;
  }
  return rows;
}

// Positions sorted and pushed at least `gap` apart inside [min, max];
// returned in the input order.
export function spreadLabels(positions, gap = LABEL_GAP, min = -Infinity, max = Infinity) {
  const order = positions.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y || a.index - b.index);
  const ys = order.map(item => Math.min(max, Math.max(min, item.y)));
  for (let k = 1; k < ys.length; k += 1) ys[k] = Math.max(ys[k], ys[k - 1] + gap);
  if (ys.length && ys[ys.length - 1] > max) {
    ys[ys.length - 1] = max;
    for (let k = ys.length - 2; k >= 0; k -= 1) ys[k] = Math.min(ys[k], ys[k + 1] - gap);
  }
  if (ys.length && ys[0] < min) {
    ys[0] = min;
    for (let k = 1; k < ys.length; k += 1) ys[k] = Math.max(ys[k], ys[k - 1] + gap);
  }
  const result = new Array(positions.length);
  order.forEach((item, k) => { result[item.index] = ys[k]; });
  return result;
}

// Marker centre: 14 px below the curve, or 14 px above when it would hit the axis.
export function markerCenterY(curveY, geometry) {
  let cy = curveY + MARKER_OFFSET;
  if (cy + MARKER_RADIUS > geometry.plotBottom - 2) cy = curveY - MARKER_OFFSET;
  return Math.max(geometry.plotTop + MARKER_RADIUS, cy);
}

export function hourLabels(geometry) {
  const labels = [];
  for (let hour = 0; hour <= 24; hour += geometry.hourStep) {
    labels.push({
      hour,
      text: `${String(hour).padStart(2, "0")}:00`,
      x: geometry.plotLeft + (hour / 24) * geometry.plotWidth,
      anchor: hour === 0 ? "start" : hour === 24 ? "end" : "middle"
    });
  }
  return labels;
}

function formatLevel(value) {
  return (Math.round(value * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function lineValue(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

const fx = value => Math.round(value * 10) / 10;
const crisp = value => Math.round(value) + 0.5;

function node(tag, attrs = {}, children = [], text = null) {
  return { tag, attrs, children, text };
}

function strokeAttrs(style) {
  return {
    fill: "none",
    stroke: style.color,
    "stroke-width": style.width,
    ...(style.dash ? { "stroke-dasharray": style.dash } : {})
  };
}

// Builds the chart as a plain tree: { root, info }. `a11y` comes from the DOM
// layer: { labelledby, describedby, titleId, desc }.
export function buildChartScene(analysis, options = {}, width = 0, a11y = {}) {
  const printing = Boolean(options.printing);
  const g = chartGeometry(width, { printing });
  const computed = analysis?.computed || {};
  const total = isSeries(computed.total) ? computed.total : new Float64Array(DAY + 1);
  const series = Array.isArray(computed.series) ? computed.series : [];
  const doses = Array.isArray(analysis?.doses) ? analysis.doses : [];
  const before = Array.isArray(analysis?.before) ? analysis.before : [];
  const target = lineValue(analysis?.lines?.target);
  const high = lineValue(analysis?.lines?.high);
  const pinned = isSeries(options.pinnedTotal) ? options.pinnedTotal : null;
  const highlightId = printing || options.highlightId == null ? null : String(options.highlightId);
  const cursorMinute = normalizeMinute(options.cursorMinute);
  const scale = yScale([seriesMax(total), target, high, pinned ? seriesMax(pinned) : 0]);
  const x = minute => g.plotLeft + (minute / DAY) * g.plotWidth;
  const y = value => g.plotBottom - (value / scale.top) * g.plotHeight;

  const linePath = (values, step) => {
    let d = "";
    for (let minute = 0; minute <= DAY; minute += step) {
      d += `${minute ? "L" : "M"}${fx(x(minute))} ${fx(y(valueAt(values, minute)))}`;
    }
    if (DAY % step) d += `L${fx(x(DAY))} ${fx(y(valueAt(values, DAY)))}`;
    return d;
  };

  // Area between a line and the total, only where the total is beyond it.
  const bandPath = (level, below) => {
    const base = fx(y(level));
    const beyond = [];
    for (let minute = 0; minute <= DAY; minute += 1) {
      const value = valueAt(total, minute);
      beyond.push(below ? value < level : value > level);
    }
    if (!beyond.includes(true)) return null;
    let d = `M${fx(x(0))} ${base}`;
    for (let minute = 0; minute <= DAY; minute += 1) {
      const here = beyond[minute];
      // Points on the line itself are only needed where the band starts or ends.
      if (here || minute === 0 || minute === DAY || beyond[minute - 1] || beyond[minute + 1]) {
        d += `L${fx(x(minute))} ${here ? fx(y(valueAt(total, minute))) : base}`;
      }
    }
    return `${d}L${fx(x(DAY))} ${base}Z`;
  };

  const hLine = (value, style, className, extra = {}) => node("line", {
    class: className,
    x1: g.plotLeft, x2: g.plotRight, y1: fx(y(value)), y2: fx(y(value)),
    ...strokeAttrs(style), ...extra
  });

  // 1. Gridlines, axis and tick labels (the labels sit in the margins).
  const grid = [];
  for (const value of scale.ticks) {
    if (value > 0) {
      grid.push(node("line", {
        x1: g.plotLeft, x2: g.plotRight, y1: crisp(y(value)), y2: crisp(y(value)),
        stroke: LINE_STYLES.grid.color, "stroke-width": 1
      }));
    }
  }
  for (let hour = 0; hour <= 24; hour += g.gridStep) {
    const lineX = hour === 24 ? Math.round(x(DAY)) - 0.5 : crisp(x(hour * 60));
    grid.push(node("line", {
      x1: lineX, x2: lineX, y1: g.plotTop, y2: g.plotBottom,
      stroke: LINE_STYLES.grid.color, "stroke-width": 1
    }));
  }
  grid.push(node("line", {
    class: "chart-axis",
    x1: g.plotLeft, x2: g.plotRight, y1: Math.round(g.plotBottom) - 0.5, y2: Math.round(g.plotBottom) - 0.5,
    stroke: LINE_STYLES.axis.color, "stroke-width": 1
  }));
  const ticks = [];
  for (const value of scale.ticks) {
    ticks.push(node("text", {
      class: "chart-tick chart-tick-y", x: g.plotLeft - (g.compact ? 4 : 6), y: fx(y(value) + 4),
      "text-anchor": "end", fill: MUTED
    }, [], String(value)));  // no comma: "1,200" would not fit the 36 px margin
  }
  const hours = hourLabels(g);
  // Low enough to clear three rows of stacked triangles.
  const hourY = g.plotBottom + (g.compact ? 40 : 41);
  for (const label of hours) {
    ticks.push(node("text", {
      class: "chart-tick chart-tick-x", x: fx(label.x), y: hourY, "text-anchor": label.anchor, fill: INK
    }, [], label.text));
  }

  // 2. Gap shading, only when lines are set.
  const shade = [];
  if (target !== null) {
    const d = bandPath(target, true);
    if (d) shade.push(node("path", { class: "chart-shade-below", d, fill: SHADE_COLORS.below, stroke: "none" }));
  }
  if (high !== null) {
    const d = bandPath(high, false);
    if (d) shade.push(node("path", { class: "chart-shade-above", d, fill: SHADE_COLORS.above, stroke: "none" }));
  }

  // 3–6. Reference, target, high and pinned lines.
  const lines = [hLine(100, LINE_STYLES.ref, "chart-ref", { "stroke-linecap": "round" })];
  if (target !== null) lines.push(hLine(target, LINE_STYLES.target, "chart-target"));
  if (high !== null) lines.push(hLine(high, LINE_STYLES.high, "chart-high"));
  if (pinned) {
    lines.push(node("path", {
      class: "chart-pinned", d: linePath(pinned, 1), ...strokeAttrs(LINE_STYLES.pinned), "stroke-linejoin": "round"
    }));
  }

  // 7. Per-dose curves.
  const doseIds = doses.map(dose => String(dose.id ?? ""));
  const anyHighlight = highlightId !== null && doseIds.includes(highlightId);
  const curves = [];
  doses.forEach((dose, index) => {
    const values = series[index];
    if (!isSeries(values)) return;
    const style = curveStyle(dose.drug);
    const on = anyHighlight && doseIds[index] === highlightId;
    const look = doseCurveLook(on ? "on" : anyHighlight ? "faded" : "normal", Boolean(pinned));
    const classes = ["chart-dose"];
    if (on) classes.push("is-highlighted");
    else if (anyHighlight) classes.push("is-faded");
    curves.push(node("path", {
      class: classes.join(" "), "data-dose-id": doseIds[index], "data-drug": dose.drug,
      d: linePath(values, 2), ...strokeAttrs({ ...style, width: look.width }),
      "stroke-opacity": look.opacity, "stroke-linejoin": "round"
    }));
  });
  if (anyHighlight) {
    const lifted = curves.findIndex(curve => curve.attrs["data-dose-id"] === highlightId);
    if (lifted >= 0) curves.push(...curves.splice(lifted, 1));
  }

  // 8. Total.
  const totalPath = node("path", {
    class: "chart-total", d: linePath(total, 1), ...strokeAttrs(LINE_STYLES.total),
    "stroke-linejoin": "round", "stroke-linecap": "round"
  });

  // 9. Dose triangles below the axis, stacked when within 45 min.
  const doseMinutes = doses.map(dose => parseClock(dose.time));
  const placed = doses.map((dose, index) => ({ dose, index, minute: doseMinutes[index] }))
    .filter(item => Number.isFinite(item.minute));
  const rows = stackRows(placed.map(item => item.minute));
  const rowCount = rows.length ? Math.max(...rows) + 1 : 0;
  const rowStep = rowCount <= 3 ? 9 : 18 / (rowCount - 1);
  const triangles = placed.map((item, k) => {
    const cx = fx(x(item.minute));
    const tip = fx(g.plotBottom + 3 + rows[k] * rowStep);
    const base = fx(tip + TRIANGLE_HEIGHT);
    const half = TRIANGLE_WIDTH / 2;
    return node("path", {
      class: "chart-dose-mark", "data-dose-id": doseIds[item.index],
      d: `M${fx(cx - half)} ${base}L${cx} ${tip}L${fx(cx + half)} ${base}Z`,
      fill: curveStyle(item.dose.drug).color
    });
  });

  // 10. Numbered low-point markers, matching the "Level before each dose" rows.
  const markers = [];
  const markerInfo = [];
  before.forEach((row, index) => {
    if (!row || !Number.isFinite(row.minute) || !Number.isFinite(row.level)) return;
    const minute = Math.min(DAY, Math.max(0, row.minute));
    const cx = fx(Math.min(g.width - MARKER_RADIUS - 1, Math.max(MARKER_RADIUS + 1, x(minute))));
    const cy = fx(markerCenterY(y(row.level), g));
    const number = String(row.number ?? index + 1);
    markerInfo.push({ number, minute, cx, cy, curveY: fx(y(row.level)) });
    markers.push(node("g", { class: "chart-marker", "data-number": number }, [
      node("circle", { cx, cy, r: MARKER_RADIUS, fill: "#ffffff", stroke: INK, "stroke-width": 1.5 }),
      node("text", {
        class: "chart-marker-num", x: cx, y: fx(cy + 4.2), "text-anchor": "middle", "font-weight": 700, fill: INK
      }, [], number)
    ]));
  });

  // Right-margin labels on wide charts.
  const labelItems = [];
  if (g.labelsInMargin) {
    labelItems.push({ key: "ref", text: "100 ref.", value: 100, fill: MUTED });
    if (target !== null) labelItems.push({ key: "target", text: `Target ${formatLevel(target)}`, value: target, fill: LINE_STYLES.target.color });
    if (high !== null) labelItems.push({ key: "high", text: `High ${formatLevel(high)}`, value: high, fill: LINE_STYLES.high.color });
    if (pinned) labelItems.push({ key: "pinned", text: "Pinned", value: valueAt(pinned, DAY), fill: MUTED });
  }
  const spread = spreadLabels(labelItems.map(item => y(item.value)), LABEL_GAP, g.plotTop + 4, g.plotBottom - 2);
  const labelInfo = labelItems.map((item, index) => ({ ...item, lineY: fx(y(item.value)), y: fx(spread[index]) }));
  const labels = labelInfo.map(item => node("text", {
    class: item.key === "ref" ? "chart-label chart-ref-label" : "chart-label",
    "data-line": item.key, x: g.plotRight + 6, y: fx(item.y + 4), "text-anchor": "start",
    "font-weight": 600, fill: item.fill, stroke: "#ffffff", "stroke-width": 3,
    "stroke-linejoin": "round", "paint-order": "stroke"
  }, [], item.text));

  // 11. Cursor (not printed). The cursor starts on a marker, so its rule is
  // drawn just under the markers to keep their numbers clear; the dot is on top.
  const cursorRule = [];
  const cursor = [];
  if (!printing) {
    const minute = cursorMinute ?? 0;
    const cx = fx(x(minute));
    const hidden = cursorMinute === null ? { visibility: "hidden" } : {};
    cursorRule.push(node("g", { class: "chart-cursor-rule", ...hidden }, [
      node("line", {
        class: "chart-cursor-line", x1: cx, x2: cx, y1: g.plotTop, y2: g.plotBottom, ...strokeAttrs(LINE_STYLES.cursor)
      })
    ]));
    cursor.push(node("g", { class: "chart-cursor", ...hidden }, [
      node("circle", {
        class: "chart-cursor-dot", cx, cy: fx(y(valueAt(total, minute))), r: 5,
        fill: LINE_STYLES.cursor.color, stroke: "#ffffff", "stroke-width": 1.5
      })
    ]));
  }

  const svgClasses = ["chart-svg", g.compact ? "chart-compact" : "chart-wide"];
  if (printing) svgClasses.push("printing");
  if (pinned) svgClasses.push("chart-is-pinned");
  if (anyHighlight) svgClasses.push("chart-has-highlight");
  const head = [];
  if (a11y.titleId) head.push(node("title", { id: a11y.titleId }, [], CHART_TITLE));
  if (typeof a11y.desc === "string") head.push(node("desc", {}, [], a11y.desc));

  const root = node("svg", {
    class: svgClasses.join(" "),
    viewBox: `0 0 ${g.width} ${g.height}`, width: g.width, height: g.height,
    role: "img",
    ...(a11y.labelledby ? { "aria-labelledby": a11y.labelledby } : { "aria-label": CHART_TITLE }),
    ...(a11y.describedby ? { "aria-describedby": a11y.describedby } : {})
  }, [
    ...head,
    node("g", { class: "chart-grid" }, grid),
    node("g", { class: "chart-shading" }, shade),
    node("g", { class: "chart-lines" }, lines),
    node("g", { class: "chart-doses" }, curves),
    totalPath,
    node("g", { class: "chart-dose-marks" }, triangles),
    ...cursorRule,
    node("g", { class: "chart-markers" }, markers),
    node("g", { class: "chart-ticks" }, ticks),
    node("g", { class: "chart-line-labels" }, labels),
    ...cursor
  ]);

  return {
    root,
    info: {
      geometry: g, scale, total, pinned: Boolean(pinned), cursorMinute,
      hours, markers: markerInfo, labels: labelInfo, rows: rowCount
    }
  };
}

export function cursorPoint(info, minute) {
  const g = info.geometry;
  const m = Math.min(DAY, Math.max(0, minute));
  return {
    x: fx(g.plotLeft + (m / DAY) * g.plotWidth),
    y: fx(g.plotBottom - (valueAt(info.total, m) / info.scale.top) * g.plotHeight)
  };
}

function toElement(tree) {
  const element = document.createElementNS(SVG_NS, tree.tag);
  for (const [name, value] of Object.entries(tree.attrs)) {
    if (value === null || value === undefined || value === false || name === "style") continue;
    element.setAttribute(name, String(value));
  }
  if (tree.text !== null) element.textContent = tree.text;
  for (const child of tree.children) element.append(toElement(child));
  return element;
}

// Text the margins cannot hold ("Target 1,000" at print size, or a 5-digit
// axis number from an imported file) is slid back inside the SVG.
function fitMarginLabels(svg, geometry) {
  for (const tick of svg.querySelectorAll(".chart-tick-y")) {
    if (Number(tick.getAttribute("x")) - tick.getComputedTextLength() < 1) {
      tick.setAttribute("text-anchor", "start");
      tick.setAttribute("x", "1");
    }
  }
  for (const label of svg.querySelectorAll(".chart-label")) {
    const length = label.getComputedTextLength();
    const x = Number(label.getAttribute("x"));
    if (x + length > geometry.width - 2) {
      label.setAttribute("x", String(fx(Math.max(geometry.plotLeft, geometry.width - 2 - length))));
    }
  }
}

function applyHighlight(svg, id, pinned) {
  const paths = [...svg.querySelectorAll(".chart-dose")];
  const key = id == null ? null : String(id);
  const match = key !== null && paths.some(path => path.getAttribute("data-dose-id") === key);
  svg.classList.toggle("chart-has-highlight", match);
  for (const path of paths) {
    const on = match && path.getAttribute("data-dose-id") === key;
    const look = doseCurveLook(on ? "on" : match ? "faded" : "normal", pinned);
    path.classList.toggle("is-highlighted", on);
    path.classList.toggle("is-faded", match && !on);
    path.setAttribute("stroke-width", String(look.width));
    path.setAttribute("stroke-opacity", String(look.opacity));
    if (on) path.parentNode.append(path);
  }
}

let chartCount = 0;

// onDraw (optional, beyond API.md) runs after every draw, including resize
// redraws, with plotBox(), so the app can keep the slider aligned.
export function createChart(container, { onCursor, onDraw } = {}) {
  chartCount += 1;
  const titleId = `chart-title-${chartCount}`;
  const options = { cursorMinute: null, pinnedTotal: null, highlightId: null, printing: false };
  let analysis = null;
  let svg = null;
  let info = null;
  let drawnWidth = -1;
  let frame = 0;
  let touch = null;
  let descSource = null;
  let descObserver = null;

  function boxWidth() {
    const style = getComputedStyle(container);
    const inner = container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    return Math.max(0, Math.floor(inner));
  }

  // Name: the app's ids from data-labelledby, else a <title> of our own.
  // Description: data-describedby, else the app's #chartDesc paragraph, whose
  // text the SVG <desc> mirrors.
  function a11y() {
    const labelledby = container.dataset.labelledby?.trim() || null;
    let describedby = container.dataset.describedby?.trim() || null;
    const source = document.getElementById(describedby ? describedby.split(/\s+/)[0] : "chartDesc");
    if (!labelledby && !describedby && source) describedby = source.id;
    watchDesc(source);
    return {
      labelledby: labelledby || titleId,
      describedby,
      titleId: labelledby ? null : titleId,
      desc: source ? source.textContent.trim() : ""
    };
  }

  function watchDesc(source) {
    if (source === descSource) return;
    descObserver?.disconnect();
    descObserver = null;
    descSource = source;
    if (source && typeof MutationObserver === "function") {
      descObserver = new MutationObserver(() => {
        const desc = svg?.querySelector("desc");
        if (desc) desc.textContent = descSource.textContent.trim();
      });
      descObserver.observe(source, { childList: true, characterData: true, subtree: true });
    }
  }

  function clear() {
    svg?.remove();
    svg = null;
    info = null;
  }

  function render() {
    if (!analysis) {
      clear();
      drawnWidth = -1;
      return;
    }
    const width = options.printing ? PRINT_WIDTH : boxWidth();
    drawnWidth = width;
    // A hidden container has no width; the ResizeObserver draws once it shows.
    if (!width) return;
    const scene = buildChartScene(analysis, options, width, a11y());
    const next = toElement(scene.root);
    // CSSOM (CSP-safe): horizontal drags reach us, vertical swipes still scroll,
    // and dragging the cursor never selects the axis text.
    next.style.touchAction = "pan-y";
    next.style.webkitUserSelect = "none";
    next.style.userSelect = "none";
    if (svg && svg.parentNode === container) container.replaceChild(next, svg);
    else {
      svg?.remove();
      container.append(next);
    }
    svg = next;
    info = scene.info;
    fitMarginLabels(svg, info.geometry);
    if (typeof onDraw === "function") onDraw(plotBox());
  }

  function draw(nextAnalysis, nextOptions = {}) {
    analysis = nextAnalysis || null;
    for (const key of Object.keys(options)) {
      if (nextOptions[key] !== undefined) options[key] = nextOptions[key];
    }
    options.cursorMinute = normalizeMinute(options.cursorMinute);
    options.printing = Boolean(options.printing);
    render();
  }

  function setCursor(minute) {
    options.cursorMinute = normalizeMinute(minute);
    const groups = svg ? [...svg.querySelectorAll(".chart-cursor-rule, .chart-cursor")] : [];
    if (!groups.length || !info) return;
    if (options.cursorMinute === null) {
      for (const group of groups) group.setAttribute("visibility", "hidden");
      return;
    }
    const point = cursorPoint(info, options.cursorMinute);
    const line = svg.querySelector(".chart-cursor-line");
    const dot = svg.querySelector(".chart-cursor-dot");
    line.setAttribute("x1", String(point.x));
    line.setAttribute("x2", String(point.x));
    dot.setAttribute("cx", String(point.x));
    dot.setAttribute("cy", String(point.y));
    for (const group of groups) group.removeAttribute("visibility");
  }

  function highlight(id) {
    options.highlightId = id ?? null;
    if (svg && info && !options.printing) applyHighlight(svg, options.highlightId, info.pinned);
  }

  function plotBox() {
    if (!svg || !info) return { left: 0, width: 0, right: 0 };
    const outer = container.getBoundingClientRect();
    const rect = svg.getBoundingClientRect();
    const g = info.geometry;
    const scale = rect.width / g.width || 1;
    const left = rect.left - outer.left + g.plotLeft * scale;
    const width = g.plotWidth * scale;
    return { left: fx(left), width: fx(width), right: fx(outer.width - left - width) };
  }

  function moveCursor(event) {
    if (!svg || !info || options.printing) return;
    const rect = svg.getBoundingClientRect();
    const g = info.geometry;
    const scale = rect.width / g.width || 1;
    const minute = snapMinute((((event.clientX - rect.left) / scale) - g.plotLeft) / g.plotWidth * DAY);
    if (minute === options.cursorMinute) return;
    setCursor(minute);
    if (typeof onCursor === "function") onCursor(minute);
  }

  // Mouse and pen move the cursor on hover. Touch moves it on a tap or a
  // horizontal drag only, so a vertical swipe still scrolls the page.
  function onPointerDown(event) {
    if (event.pointerType === "touch") {
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
      return;
    }
    if (event.button === 0) moveCursor(event);
  }

  function onPointerMove(event) {
    if (event.pointerType !== "touch") {
      moveCursor(event);
      return;
    }
    if (!touch || touch.id !== event.pointerId) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    if (!touch.dragging && Math.abs(dx) >= 6 && Math.abs(dx) > Math.abs(dy)) touch.dragging = true;
    if (touch.dragging) moveCursor(event);
  }

  function onPointerUp(event) {
    if (!touch || touch.id !== event.pointerId) return;
    moveCursor(event);
    touch = null;
  }

  function onPointerCancel(event) {
    if (touch && touch.id === event.pointerId) touch = null;
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (analysis && !options.printing && boxWidth() !== drawnWidth) render();
    });
  }) : null;
  observer?.observe(container);

  function destroy() {
    observer?.disconnect();
    watchDesc(null);
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerCancel);
    analysis = null;
    clear();
  }

  return { draw, setCursor, highlight, plotBox, destroy };
}
