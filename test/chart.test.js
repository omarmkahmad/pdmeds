import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeDay } from "../src/model.js";
import {
  buildChartScene,
  CHART_CLASSES,
  chartGeometry,
  CURSOR_MAX,
  curveStyle,
  cursorPoint,
  doseCurveLook,
  hourLabels,
  markerCenterY,
  parseClock,
  PRINT_WIDTH,
  snapMinute,
  spreadLabels,
  stackRows,
  yScale
} from "../src/chart.js";

const TEST_REGIMEN = [
  { id: "d1", time: "06:00", drug: "sinemet", strength: "25/100", count: 1.5, dose: 150 },
  { id: "d2", time: "09:00", drug: "sinemet", strength: "25/100", count: 1.5, dose: 150 },
  { id: "d3", time: "12:00", drug: "sinemet", strength: "25/100", count: 1.5, dose: 150 },
  { id: "d4", time: "15:00", drug: "sinemet", strength: "25/100", count: 1.5, dose: 150 },
  { id: "d5", time: "18:00", drug: "sinemet", strength: "25/100", count: 1.5, dose: 150 },
  { id: "d6", time: "21:00", drug: "rytary", strength: "61.25/245", count: 2, dose: 490 }
];

const minuteOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

// Minimal stand-in for answers.analyzeDay: only the fields the chart reads.
function fakeAnalysis(doses, lines = { target: null, high: null }) {
  const sorted = doses.filter(dose => dose.dose > 0).sort((a, b) => minuteOf(a.time) - minuteOf(b.time));
  const computed = computeDay({ doses: sorted });
  const times = [...new Set(sorted.map(dose => minuteOf(dose.time)))].sort((a, b) => a - b);
  const groups = [];
  for (const time of times) {
    if (groups.length && time - groups.at(-1).end <= 45) groups.at(-1).end = time;
    else groups.push({ start: time, end: time });
  }
  const at = minute => computed.total[((minute % 1440) + 1440) % 1440];
  const before = groups.map((group, index) => {
    const previous = groups[(index - 1 + groups.length) % groups.length];
    let from = previous.end;
    if (from >= group.start) from -= 1440;
    let peak = -Infinity;
    let peakMinute = from;
    for (let m = from; m <= group.start; m += 1) if (at(m) > peak) { peak = at(m); peakMinute = m; }
    let level = Infinity;
    let minute = 0;
    for (let m = peakMinute; m <= group.start + 60; m += 1) if (at(m) < level) { level = at(m); minute = m; }
    return { number: index + 1, groupStart: group.start, level, minute: ((minute % 1440) + 1440) % 1440 };
  });
  return { doses: sorted, computed, groups, before, lines };
}

function walk(tree, visit) {
  visit(tree);
  for (const child of tree.children) walk(child, visit);
}

function findAll(tree, predicate) {
  const found = [];
  walk(tree, item => { if (predicate(item)) found.push(item); });
  return found;
}

const hasClass = name => item => String(item.attrs.class ?? "").split(" ").includes(name);
const byClass = (tree, name) => findAll(tree, hasClass(name));

const regimen = fakeAnalysis(TEST_REGIMEN);

test("curve styles follow the preparation (SPEC 4.3 table)", () => {
  assert.deepEqual(curveStyle("sinemet"), { color: "#0072B2", dash: "" });
  assert.deepEqual(curveStyle("sinemetcr"), { color: "#B35900", dash: "9 4" });
  assert.deepEqual(curveStyle("rytary"), { color: "#117733", dash: "4 3" });
  assert.deepEqual(curveStyle("crexont"), { color: "#882255", dash: "12 3 3 3" });
  assert.deepEqual(curveStyle("inbrija"), { color: "#5E3C99", dash: "2 3" });
  assert.equal(curveStyle("unknown").dash, "");
  assert.match(curveStyle("unknown").color, /^#[0-9a-f]{6}$/i);
});

test("geometry switches to wide at a 560 px box", () => {
  const compact = chartGeometry(559);
  assert.equal(compact.compact, true);
  assert.equal(compact.height, 260);
  assert.deepEqual(compact.margin, { left: 36, right: 8, top: 10, bottom: 46 });
  assert.equal(compact.hourStep, 6);
  assert.equal(compact.gridStep, 3);
  assert.equal(compact.labelsInMargin, false);

  const wide = chartGeometry(560);
  assert.equal(wide.compact, false);
  assert.deepEqual(wide.margin, { left: 42, right: 84, top: 12, bottom: 48 });
  assert.equal(wide.hourStep, 3);
  assert.equal(wide.labelsInMargin, true);
  assert.equal(wide.plotWidth, 560 - 42 - 84);
});

test("wide height is clamp(300, 0.45 × W, 380)", () => {
  assert.equal(chartGeometry(560).height, 300);
  assert.equal(chartGeometry(800).height, 360);
  assert.equal(chartGeometry(844).height, 380);
  assert.equal(chartGeometry(1200).height, 380);
});

test("hour labels every 2 h once the plot is 900 px wide", () => {
  assert.equal(chartGeometry(1025).hourStep, 3);
  const wide = chartGeometry(1026);
  assert.equal(wide.plotWidth, 900);
  assert.equal(wide.hourStep, 2);
  assert.equal(wide.gridStep, 2);
  assert.equal(chartGeometry(150).hourStep, 12);
});

test("print geometry is 720 px wide whatever the box", () => {
  const print = chartGeometry(300, { printing: true });
  assert.equal(print.width, PRINT_WIDTH);
  assert.equal(print.compact, false);
  // Short, so the whole printed summary fits one Letter page.
  assert.equal(print.height, 260);
});

test("hour labels: 00:00 anchored at the start and 24:00 at the end of the plot", () => {
  for (const width of [288, 334, 424, 804, 1100]) {
    const g = chartGeometry(width);
    const labels = hourLabels(g);
    assert.equal(labels[0].text, "00:00");
    assert.equal(labels[0].anchor, "start");
    assert.equal(labels[0].x, g.plotLeft);
    assert.equal(labels.at(-1).text, "24:00");
    assert.equal(labels.at(-1).anchor, "end");
    assert.equal(labels.at(-1).x, g.plotRight);
    assert.ok(labels.slice(1, -1).every(label => label.anchor === "middle"));
    assert.equal(labels.length, 24 / g.hourStep + 1);
  }
  assert.deepEqual(hourLabels(chartGeometry(334)).map(label => label.text), ["00:00", "06:00", "12:00", "18:00", "24:00"]);
});

test("y axis: 0 to a round-up of 1.08 × max, always including 100", () => {
  assert.deepEqual(yScale([192]), { top: 250, step: 50, ticks: [0, 50, 100, 150, 200, 250] });
  assert.equal(yScale([43]).top, 150);
  assert.equal(yScale([100]).top, 150);
  assert.equal(yScale([]).top, 150);
  assert.equal(yScale([NaN, null, undefined, -5]).top, 150);
  assert.equal(yScale([300 / 1.08]).top, 300);
  const over = yScale([300]);
  assert.equal(over.step, 100);
  assert.equal(over.top, 400);
  assert.deepEqual(over.ticks, [0, 100, 200, 300, 400]);
  assert.equal(yScale([120, 180]).top, 200);
  assert.equal(yScale([900]).top, 1000);
  const huge = yScale([1000]);
  assert.ok(huge.top >= 1080);
  assert.ok(huge.ticks.length <= 9);
  for (const peak of [10, 99, 150, 250, 280, 500, 925]) {
    const scale = yScale([peak]);
    assert.ok(scale.top >= peak * 1.08 - 1e-9, `top covers ${peak}`);
    assert.ok(scale.ticks.includes(100), `100 is a tick for ${peak}`);
  }
});

test("right-margin labels are sorted and pushed at least 14 px apart", () => {
  assert.deepEqual(spreadLabels([100, 50, 200]), [100, 50, 200]);
  const pushed = spreadLabels([100, 104, 110]);
  assert.deepEqual(pushed, [100, 114, 128]);
  const clamped = spreadLabels([300, 295], 14, 0, 300);
  assert.deepEqual([...clamped].sort((a, b) => a - b), [286, 300]);
  assert.equal(clamped[0] - clamped[1], 14);
  const top = spreadLabels([2, 1], 14, 10, 300);
  assert.deepEqual(top, [24, 10]);
  const many = spreadLabels([80, 81, 82, 83], 14, 0, 400);
  const sorted = [...many].sort((a, b) => a - b);
  for (let k = 1; k < sorted.length; k += 1) assert.ok(sorted[k] - sorted[k - 1] >= 14 - 1e-9);
  assert.deepEqual(spreadLabels([]), []);
});

test("dose triangles within 45 min stack; others share row 0", () => {
  assert.deepEqual(stackRows([360, 540, 720, 900, 1080, 1260]), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(stackRows([420, 435]), [0, 1]);
  assert.deepEqual(stackRows([480, 480, 480]), [0, 1, 2]);
  assert.deepEqual(stackRows([420, 450, 480]), [0, 1, 0]);
  assert.deepEqual(stackRows([435, 420]), [1, 0]);
  assert.deepEqual(stackRows([420, 465]), [0, 1]);
  assert.deepEqual(stackRows([420, 466]), [0, 0]);
  assert.deepEqual(stackRows([]), []);
});

test("markers sit 14 px below the curve, or above it near the axis", () => {
  const g = chartGeometry(334);
  assert.equal(markerCenterY(100, g), 114);
  assert.equal(markerCenterY(g.plotBottom - 5, g), g.plotBottom - 19);
  assert.equal(markerCenterY(g.plotTop - 30, g), g.plotTop + 9);
});

test("cursor snaps to 5 min inside 00:00–23:55", () => {
  assert.equal(snapMinute(541), 540);
  assert.equal(snapMinute(543), 545);
  assert.equal(snapMinute(-40), 0);
  assert.equal(snapMinute(1439), CURSOR_MAX);
  assert.equal(CURSOR_MAX, 1435);
  assert.equal(snapMinute(NaN), 0);
});

test("parseClock reads HH:MM", () => {
  assert.equal(parseClock("06:00"), 360);
  assert.equal(parseClock("23:59"), 1439);
  assert.ok(Number.isNaN(parseClock("24:00")));
  assert.ok(Number.isNaN(parseClock("6pm")));
  assert.ok(Number.isNaN(parseClock(null)));
});

test("dose curve looks: normal, pinned, highlighted, faded", () => {
  assert.deepEqual(doseCurveLook("normal"), { width: 1.5, opacity: 0.75 });
  assert.deepEqual(doseCurveLook("normal", true), { width: 1.5, opacity: 0.25 });
  assert.deepEqual(doseCurveLook("on", true), { width: 2.5, opacity: 1 });
  assert.deepEqual(doseCurveLook("faded"), { width: 1.5, opacity: 0.25 });
});

test("scene: layers back to front, as SPEC 4.3", () => {
  const { root } = buildChartScene(regimen, { cursorMinute: 540 }, 334);
  const order = root.children.filter(item => item.tag !== "desc" && item.tag !== "title")
    .map(item => item.attrs.class);
  assert.deepEqual(order, [
    "chart-grid", "chart-shading", "chart-lines", "chart-doses", "chart-total",
    "chart-dose-marks", "chart-cursor-rule", "chart-markers", "chart-ticks", "chart-line-labels", "chart-cursor"
  ]);
  assert.equal(root.attrs.role, "img");
  assert.equal(root.attrs.viewBox, "0 0 334 260");
  assert.equal(root.attrs.width, 334);
  assert.match(root.attrs.class, /chart-svg/);
  assert.match(root.attrs.class, /chart-compact/);
});

test("scene: one curve and one triangle per dose, coloured by preparation", () => {
  const { root } = buildChartScene(regimen, {}, 804);
  const curves = byClass(root, "chart-dose");
  assert.equal(curves.length, 6);
  assert.deepEqual(curves.map(curve => curve.attrs["data-dose-id"]), ["d1", "d2", "d3", "d4", "d5", "d6"]);
  for (const curve of curves.slice(0, 5)) {
    assert.equal(curve.attrs.stroke, "#0072B2");
    assert.equal(curve.attrs["stroke-dasharray"], undefined);
  }
  assert.equal(curves[5].attrs.stroke, "#117733");
  assert.equal(curves[5].attrs["stroke-dasharray"], "4 3");
  assert.ok(curves.every(curve => curve.attrs["stroke-width"] === 1.5 && curve.attrs["stroke-opacity"] === 0.75));
  const triangles = byClass(root, "chart-dose-mark");
  assert.equal(triangles.length, 6);
  assert.equal(triangles[5].attrs.fill, "#117733");
  const total = byClass(root, "chart-total")[0];
  assert.equal(total.attrs.stroke, "#17202a");
  assert.equal(total.attrs["stroke-width"], 3);
});

test("scene: deleting a dose does not recolour the others", () => {
  const fewer = fakeAnalysis(TEST_REGIMEN.filter(dose => dose.id !== "d2"));
  const colours = scene => Object.fromEntries(byClass(scene.root, "chart-dose").map(curve => [curve.attrs["data-dose-id"], curve.attrs.stroke]));
  const before = colours(buildChartScene(regimen, {}, 400));
  const after = colours(buildChartScene(fewer, {}, 400));
  for (const [id, colour] of Object.entries(after)) assert.equal(colour, before[id]);
});

test("scene: 6 numbered markers match the before-each-dose rows", () => {
  const { root, info } = buildChartScene(regimen, {}, 334);
  const markers = byClass(root, "chart-marker");
  assert.equal(markers.length, 6);
  assert.deepEqual(markers.map(marker => marker.attrs["data-number"]), ["1", "2", "3", "4", "5", "6"]);
  const g = info.geometry;
  for (const [index, marker] of info.markers.entries()) {
    const expectedX = g.plotLeft + regimen.before[index].minute / 1440 * g.plotWidth;
    assert.ok(Math.abs(marker.cx - expectedX) < 0.2 || marker.cx <= g.width - 10);
    const offset = Math.round(marker.cy - marker.curveY);
    assert.ok(offset === 14 || offset === -14, `marker ${marker.number} offset ${offset}`);
    assert.ok(marker.cy + 9 <= g.plotBottom, "marker stays above the axis");
    assert.ok(marker.cx - 9 >= 0 && marker.cx + 9 <= g.width, "marker inside the SVG");
  }
  const circle = markers[0].children[0];
  assert.equal(circle.attrs.r, 9);
  assert.equal(circle.attrs.fill, "#ffffff");
  assert.equal(circle.attrs["stroke-width"], 1.5);
  assert.equal(markers[0].children[1].attrs.class, "chart-marker-num");
});

test("scene: reference line at 100 always; no lines or shading without user lines", () => {
  for (const width of [334, 804]) {
    const { root, info } = buildChartScene(regimen, {}, width);
    const ref = byClass(root, "chart-ref")[0];
    assert.equal(ref.attrs.stroke, "#6b7580");
    assert.equal(ref.attrs["stroke-width"], 1.5);
    assert.equal(ref.attrs["stroke-dasharray"], "1 4");
    assert.equal(ref.attrs["stroke-linecap"], "round");
    const g = info.geometry;
    assert.ok(Math.abs(ref.attrs.y1 - (g.plotBottom - 100 / info.scale.top * g.plotHeight)) < 0.1);
    assert.equal(byClass(root, "chart-target").length, 0);
    assert.equal(byClass(root, "chart-high").length, 0);
    assert.equal(byClass(root, "chart-shading")[0].children.length, 0);
  }
});

test("scene: a single Rytary 245 mg dose still shows 100 on the axis", () => {
  const single = fakeAnalysis([{ id: "r1", time: "08:00", drug: "rytary", dose: 245 }]);
  assert.ok(single.computed.maximum < 100);
  const { root, info } = buildChartScene(single, {}, 334);
  assert.equal(info.scale.top, 150);
  const labels = byClass(root, "chart-tick-y").map(item => item.text);
  assert.ok(labels.includes("100"));
  assert.equal(byClass(root, "chart-ref").length, 1);
});

test("scene: target and high lines, shading and right-margin labels", () => {
  const lined = fakeAnalysis(TEST_REGIMEN, { target: 100, high: 180 });
  const { root, info } = buildChartScene(lined, {}, 804);
  const target = byClass(root, "chart-target")[0];
  assert.equal(target.attrs.stroke, "#146c43");
  assert.equal(target.attrs["stroke-width"], 2);
  assert.equal(target.attrs["stroke-dasharray"], "7 4");
  const high = byClass(root, "chart-high")[0];
  assert.equal(high.attrs.stroke, "#9c2f24");
  assert.equal(high.attrs["stroke-dasharray"], "10 3 2 3");
  assert.equal(byClass(root, "chart-shade-below")[0].attrs.fill, "#fbe3c8");
  assert.equal(byClass(root, "chart-shade-above")[0].attrs.fill, "#f3d6d2");
  const labels = byClass(root, "chart-label").map(item => item.text);
  assert.deepEqual(labels, ["100 ref.", "Target 100", "High 180"]);
  assert.equal(byClass(root, "chart-ref-label")[0].text, "100 ref.");
  const ys = info.labels.map(label => label.y).sort((a, b) => a - b);
  for (let k = 1; k < ys.length; k += 1) assert.ok(ys[k] - ys[k - 1] >= 14 - 0.1);
  const x = byClass(root, "chart-label")[0].attrs.x;
  assert.ok(x > info.geometry.plotRight && x < info.geometry.width);
});

test("scene: line labels stay out of compact charts (key only)", () => {
  const lined = fakeAnalysis(TEST_REGIMEN, { target: 100, high: 180 });
  const { root } = buildChartScene(lined, {}, 424);
  assert.equal(byClass(root, "chart-label").length, 0);
  assert.equal(byClass(root, "chart-target").length, 1);
});

test("scene: shading never covers the empty band above the high line", () => {
  const lined = fakeAnalysis(TEST_REGIMEN, { target: 50, high: 300 });
  const { root, info } = buildChartScene(lined, {}, 804);
  assert.ok(info.scale.top >= 300 * 1.08);
  assert.equal(byClass(root, "chart-shade-above").length, 0);
  assert.equal(byClass(root, "chart-shade-below").length, 1);
});

test("scene: equal target and high lines both draw (a note, not an error)", () => {
  const lined = fakeAnalysis(TEST_REGIMEN, { target: 150, high: 150 });
  const { root } = buildChartScene(lined, {}, 804);
  assert.equal(byClass(root, "chart-target").length, 1);
  assert.equal(byClass(root, "chart-high").length, 1);
  const labels = byClass(root, "chart-label");
  const ys = labels.map(label => label.attrs.y).sort((a, b) => a - b);
  for (let k = 1; k < ys.length; k += 1) assert.ok(ys[k] - ys[k - 1] >= 13.9);
});

test("scene: a high line without a target is allowed", () => {
  const lined = fakeAnalysis(TEST_REGIMEN, { target: null, high: 180 });
  const { root } = buildChartScene(lined, {}, 804);
  assert.equal(byClass(root, "chart-target").length, 0);
  assert.equal(byClass(root, "chart-high").length, 1);
  assert.equal(byClass(root, "chart-shade-below").length, 0);
});

test("scene: pinned total draws grey dashed and fades the dose curves", () => {
  const moved = fakeAnalysis(TEST_REGIMEN.map(dose => (dose.id === "d5" ? { ...dose, time: "17:00" } : dose)));
  const { root, info } = buildChartScene(moved, { pinnedTotal: regimen.computed.total }, 804);
  const pinned = byClass(root, "chart-pinned")[0];
  assert.equal(pinned.attrs.stroke, "#8a96a3");
  assert.equal(pinned.attrs["stroke-width"], 2);
  assert.equal(pinned.attrs["stroke-dasharray"], "6 4");
  assert.ok(byClass(root, "chart-dose").every(curve => curve.attrs["stroke-opacity"] === 0.25));
  assert.ok(byClass(root, "chart-label").some(label => label.text === "Pinned"));
  assert.equal(info.pinned, true);
  assert.match(root.attrs.class, /chart-is-pinned/);
});

test("scene: y axis grows to fit a taller pinned day", () => {
  const small = fakeAnalysis([{ id: "a", time: "08:00", drug: "sinemet", dose: 100 }]);
  const tall = new Float64Array(1441).fill(260);
  const { info } = buildChartScene(small, { pinnedTotal: tall }, 334);
  assert.equal(info.scale.top, 300);
});

test("scene: highlight thickens one curve, fades the rest, and draws it last", () => {
  const { root } = buildChartScene(regimen, { highlightId: "d3" }, 334);
  const curves = byClass(root, "chart-dose");
  const lifted = curves.at(-1);
  assert.equal(lifted.attrs["data-dose-id"], "d3");
  assert.equal(lifted.attrs["stroke-width"], 2.5);
  assert.equal(lifted.attrs["stroke-opacity"], 1);
  assert.match(lifted.attrs.class, /is-highlighted/);
  assert.ok(curves.slice(0, -1).every(curve => curve.attrs["stroke-opacity"] === 0.25 && /is-faded/.test(curve.attrs.class)));
  assert.match(root.attrs.class, /chart-has-highlight/);
  const none = buildChartScene(regimen, { highlightId: "missing" }, 334).root;
  assert.ok(byClass(none, "chart-dose").every(curve => curve.attrs["stroke-opacity"] === 0.75));
});

test("scene: the total and statistics are unaffected by highlight", () => {
  const plain = byClass(buildChartScene(regimen, {}, 334).root, "chart-total")[0].attrs.d;
  const lit = byClass(buildChartScene(regimen, { highlightId: "d6" }, 334).root, "chart-total")[0].attrs.d;
  assert.equal(plain, lit);
});

test("scene: printing draws 720 px wide, without cursor or highlight", () => {
  const { root, info } = buildChartScene(regimen, { printing: true, cursorMinute: 540, highlightId: "d1" }, 334);
  assert.equal(root.attrs.width, 720);
  assert.equal(root.attrs.viewBox, "0 0 720 260");
  assert.match(root.attrs.class, /\bprinting\b/);
  assert.equal(byClass(root, "chart-cursor").length, 0);
  assert.equal(byClass(root, "chart-cursor-rule").length, 0);
  assert.ok(byClass(root, "chart-dose").every(curve => curve.attrs["stroke-width"] === 1.5));
  assert.equal(info.geometry.compact, false);
});

test("scene: cursor line and dot sit at the cursor minute on the total", () => {
  const { root, info } = buildChartScene(regimen, { cursorMinute: 540 }, 334);
  const line = byClass(root, "chart-cursor-line")[0];
  const dot = byClass(root, "chart-cursor-dot")[0];
  const point = cursorPoint(info, 540);
  assert.equal(line.attrs.x1, point.x);
  assert.equal(dot.attrs.cx, point.x);
  assert.equal(dot.attrs.cy, point.y);
  assert.equal(dot.attrs.r, 5);
  assert.equal(line.attrs.stroke, "#3d4852");
  assert.equal(line.attrs["stroke-width"], 1);
  assert.ok(line.attrs["stroke-dasharray"]);
  const g = info.geometry;
  assert.ok(Math.abs(point.x - (g.plotLeft + 540 / 1440 * g.plotWidth)) < 0.1);
  assert.ok(Math.abs(point.y - (g.plotBottom - regimen.computed.total[540] / info.scale.top * g.plotHeight)) < 0.1);
  const plain = buildChartScene(regimen, {}, 334).root;
  assert.equal(byClass(plain, "chart-cursor")[0].attrs.visibility, "hidden");
  assert.equal(byClass(plain, "chart-cursor-rule")[0].attrs.visibility, "hidden");
});

test("scene: text uses size classes only, and nothing carries a style attribute", () => {
  for (const [width, options] of [[334, {}], [804, { pinnedTotal: regimen.computed.total }], [334, { printing: true }]]) {
    const lined = fakeAnalysis(TEST_REGIMEN, { target: 100, high: 180 });
    const { root } = buildChartScene(lined, options, width);
    walk(root, item => {
      assert.ok(!("style" in item.attrs), `${item.tag} has no style attribute`);
      assert.ok(!("font-size" in item.attrs), `${item.tag} has no font-size attribute`);
    });
    const texts = findAll(root, item => item.tag === "text");
    assert.ok(texts.length > 0);
    for (const text of texts) {
      assert.match(String(text.attrs.class), /\bchart-(tick|label|marker-num)\b/);
    }
  }
});

test("scene: 13 px axis numbers come from the chart-wide class", () => {
  assert.match(buildChartScene(regimen, {}, 804).root.attrs.class, /chart-wide/);
  assert.match(buildChartScene(regimen, {}, 334).root.attrs.class, /chart-compact/);
});

test("scene: grouped 07:00 + 07:15 triangles stack", () => {
  const grouped = fakeAnalysis([
    { id: "a", time: "07:00", drug: "sinemet", dose: 100 },
    { id: "b", time: "07:15", drug: "rytary", dose: 245 },
    { id: "c", time: "13:00", drug: "sinemet", dose: 100 }
  ]);
  const { root, info } = buildChartScene(grouped, {}, 334);
  const triangles = byClass(root, "chart-dose-mark");
  const tipY = triangle => Number(triangle.attrs.d.split("L")[1].split(" ")[1]);
  assert.equal(tipY(triangles[0]), info.geometry.plotBottom + 3);
  assert.equal(tipY(triangles[1]), info.geometry.plotBottom + 12);
  assert.equal(tipY(triangles[2]), info.geometry.plotBottom + 3);
  assert.equal(info.rows, 2);
});

test("scene: markers at the day's edges stay inside the SVG", () => {
  const edge = {
    ...regimen,
    before: [{ number: 1, minute: 0, level: 20 }, { number: 2, minute: 1440, level: 20 }]
  };
  const { info } = buildChartScene(edge, {}, 334);
  for (const marker of info.markers) {
    assert.ok(marker.cx - 9 >= 0);
    assert.ok(marker.cx + 9 <= info.geometry.width);
  }
});

test("scene: tolerates an empty or partial analysis", () => {
  assert.doesNotThrow(() => buildChartScene(null, {}, 334));
  assert.doesNotThrow(() => buildChartScene({ doses: [], computed: {}, before: [] }, {}, 804));
  const empty = buildChartScene({ doses: [], computed: computeDay({ doses: [] }), before: [], lines: {} }, { cursorMinute: 0 }, 334);
  assert.equal(empty.info.scale.top, 150);
  assert.equal(byClass(empty.root, "chart-dose").length, 0);
});

test("scene: accessible name from the app's ids, or a title of its own", () => {
  const withIds = buildChartScene(regimen, {}, 334, { labelledby: "chartTitle", describedby: "chartDesc" }).root;
  assert.equal(withIds.attrs["aria-labelledby"], "chartTitle");
  assert.equal(withIds.attrs["aria-describedby"], "chartDesc");
  assert.equal(withIds.children.filter(item => item.tag === "title").length, 0);
  assert.equal(withIds.children.filter(item => item.tag === "desc").length, 0);
  const own = buildChartScene(regimen, {}, 334, { labelledby: "chart-title-1", titleId: "chart-title-1" }).root;
  const title = own.children.find(item => item.tag === "title");
  assert.equal(title.attrs.id, "chart-title-1");
  assert.equal(title.text, "Levodopa level over a typical day");
  assert.equal(own.attrs["aria-labelledby"], "chart-title-1");
});

test("scene: <desc> carries the description text the DOM layer passes in", () => {
  const text = "Lowest of the day: 24 at 06:00, before the first dose. Levels before each dose: 06:00 24, 09:00 64.";
  const root = buildChartScene(regimen, {}, 334, { labelledby: "chartTitle", describedby: "chartDesc", desc: text }).root;
  const desc = root.children.filter(item => item.tag === "desc");
  assert.equal(desc.length, 1);
  assert.equal(desc[0].text, text);
  assert.equal(root.children[0].tag, "desc");
});

test("chart.js is importable without a DOM and imports only drugs.js", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/chart.js", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import .* from "(.+)";$/gm)].map(match => match[1]);
  assert.deepEqual(imports, ["./drugs.js"]);
  assert.doesNotMatch(source, /\sstyle=["'`$\\]/);
  assert.doesNotMatch(source, /setAttribute\(\s*["'`]style["'`]/);
});

// ---- The class contract with styles.css ----
// Review finding: styles.css targeted classes the chart never emits
// (.chart-tick.wide, .dose-curve, .total-curve), had no .printing rule, and set
// `fill` over the line-label colours. These tests pin both sides.

const HOOKS = new Set(Object.values(CHART_CLASSES));

function sceneClasses(root) {
  const found = new Set();
  walk(root, item => {
    for (const name of String(item.attrs.class ?? "").split(" ")) if (name) found.add(name);
  });
  return found;
}

// Splits on `sep` outside parentheses, so ":is(.a, .b)" stays whole.
function splitTop(text, sep) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && sep.test(char)) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map(part => part.trim()).filter(Boolean);
}

// Flat list of style rules: { media: [conditions], selectors, decls }.
function cssRules(text, media = []) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf("{", index);
    if (open === -1) break;
    let depth = 1;
    let close = open + 1;
    for (; close < source.length && depth; close += 1) {
      if (source[close] === "{") depth += 1;
      else if (source[close] === "}") depth -= 1;
    }
    const raw = source.slice(index, open);
    const head = raw.slice(raw.lastIndexOf(";") + 1).trim();
    const body = source.slice(open + 1, close - 1);
    if (/^@(media|supports)\b/.test(head)) rules.push(...cssRules(body, [...media, head]));
    else if (!head.startsWith("@")) {
      const decls = {};
      for (const part of body.split(";")) {
        const colon = part.indexOf(":");
        if (colon > 0) decls[part.slice(0, colon).trim().toLowerCase()] = part.slice(colon + 1).replace(/!important/i, "").trim();
      }
      rules.push({ media, selectors: splitTop(head, /,/), decls });
    }
    index = close;
  }
  return rules;
}

const TEXT_HOOKS = ["chart-tick", "chart-label", "chart-marker-num"];
const PAINT = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "opacity"];

// What a stylesheet gets wrong about the chart's hooks ([] = nothing).
function styleContractProblems(css) {
  const problems = [];
  const forced = rule => rule.media.some(condition => /forced-colors\s*:\s*active/i.test(condition));
  const entries = [];
  for (const rule of cssRules(css)) {
    for (const selector of rule.selectors) {
      const classes = splitTop(selector, /[\s>+~]/).map(compound => (compound.match(/\.[\w-]+/g) || []).map(name => name.slice(1)));
      entries.push({ rule, selector, classes, last: classes.at(-1) || [], all: classes.flat() });
    }
  }
  const size = entry => (entry.rule.decls["font-size"] || "").replace(/\s+/g, "");
  const sized = predicate => entries.filter(entry => !forced(entry.rule) && size(entry) && predicate(entry)).map(size);
  for (const name of TEXT_HOOKS) {
    const base = sized(entry => entry.last.includes(name) && !entry.all.includes("chart-wide") && !entry.all.includes("printing"));
    if (!base.includes("12px")) problems.push(`.${name}: no 12px size`);
    if (!sized(entry => entry.last.includes(name) && entry.all.includes("printing")).includes("10pt")) {
      problems.push(`.chart-svg.printing .${name}: no 10pt size`);
    }
  }
  if (!sized(entry => entry.last.includes("chart-tick") && entry.all.includes("chart-wide")).includes("13px")) {
    problems.push(".chart-wide .chart-tick: no 13px size");
  }
  const total = entries.some(entry => forced(entry.rule) && entry.last.includes("chart-total") && /^canvastext$/i.test(entry.rule.decls.stroke || ""));
  if (!total) problems.push("forced colors: no .chart-total { stroke: CanvasText }");
  for (const entry of entries) {
    for (const compound of entry.classes) {
      const stray = compound.filter(name => !HOOKS.has(name));
      if (compound.some(name => HOOKS.has(name)) && stray.length) {
        problems.push(`${entry.selector}: .${stray.join(", .")} is never on a chart element`);
      }
    }
    const inside = entry.classes.findIndex(compound => compound.includes("chart") || compound.includes("chart-svg"));
    if (inside >= 0) {
      for (const name of entry.classes.slice(inside + 1).flat()) {
        if (!HOOKS.has(name)) problems.push(`${entry.selector}: .${name} is not a chart class`);
      }
    }
    if (!forced(entry.rule) && entry.last.some(name => HOOKS.has(name))) {
      for (const prop of PAINT) {
        if (prop in entry.rule.decls) problems.push(`${entry.selector}: sets ${prop}, overriding the chart's own`);
      }
    }
  }
  return [...new Set(problems)];
}

test("scene: emits only the classes in CHART_CLASSES, and each one in some state", () => {
  const lined = fakeAnalysis(TEST_REGIMEN, { target: 100, high: 180 });
  const scenes = [
    buildChartScene(regimen, { cursorMinute: 540 }, 334),
    buildChartScene(lined, { cursorMinute: 540, pinnedTotal: regimen.computed.total, highlightId: "d6" }, 804),
    buildChartScene(lined, { printing: true }, 334)
  ];
  const seen = new Set();
  for (const { root } of scenes) {
    for (const name of sceneClasses(root)) {
      assert.ok(HOOKS.has(name), `.${name} is listed in CHART_CLASSES`);
      seen.add(name);
    }
  }
  assert.deepEqual([...HOOKS].filter(name => !seen.has(name)), []);
  assert.ok(Object.isFrozen(CHART_CLASSES));
});

test("scene: size hooks sit where the stylesheet rules expect them", () => {
  const classes = root => root.attrs.class.split(" ");
  const wide = buildChartScene(regimen, {}, 804).root;
  const compact = buildChartScene(regimen, {}, 334).root;
  const printed = buildChartScene(regimen, { printing: true }, 334).root;
  // .chart-wide .chart-tick and .chart-svg.printing .chart-* key off the <svg>.
  assert.deepEqual(classes(wide).slice(0, 2), ["chart-svg", "chart-wide"]);
  assert.deepEqual(classes(compact).slice(0, 2), ["chart-svg", "chart-compact"]);
  assert.deepEqual(classes(printed).slice(0, 3), ["chart-svg", "chart-wide", "printing"]);
  assert.ok(!classes(wide).includes("printing"));
  for (const root of [wide, compact, printed]) {
    const texts = findAll(root, item => item.tag === "text");
    const tagged = name => texts.filter(hasClass(name)).length;
    assert.equal(tagged("chart-tick") + tagged("chart-label") + tagged("chart-marker-num"), texts.length);
    assert.ok(tagged("chart-tick") > 0 && tagged("chart-marker-num") === 6);
  }
  assert.equal(byClass(wide, "chart-tick-x").length + byClass(wide, "chart-tick-y").length, byClass(wide, "chart-tick").length);
  // The total is the only path a forced-colors rule restyles.
  assert.equal(byClass(wide, "chart-total").length, 1);
  assert.equal(byClass(wide, "chart-total")[0].tag, "path");
});

test("scene: line labels carry their line's colour as a fill attribute", () => {
  const lined = fakeAnalysis(TEST_REGIMEN, { target: 100, high: 180 });
  const { root } = buildChartScene(lined, { pinnedTotal: regimen.computed.total }, 762);
  const fills = Object.fromEntries(byClass(root, "chart-label").map(label => [label.attrs["data-line"], label.attrs.fill]));
  assert.deepEqual(fills, { ref: "#56616d", target: "#146c43", high: "#9c2f24", pinned: "#56616d" });
});

test("style contract checker: passes the agreed rules, flags the drifted ones", () => {
  const agreed = `
    .chart { position: relative; min-height: 260px; }
    .chart svg { display: block; width: 100%; height: auto; }
    .chart-svg { -webkit-user-select: none; user-select: none; }
    .chart-tick, .chart-label, .chart-marker-num { font-size: 12px; }
    .chart-marker-num { font-weight: 700; }
    .chart-wide .chart-tick { font-size: 13px; }
    .chart-svg.printing .chart-tick,
    .chart-svg.printing .chart-label,
    .chart-svg.printing .chart-marker-num { font-size: 10pt; }
    .chart-key li { display: inline-flex; }
    @media (forced-colors: active) {
      .chart-svg text { fill: CanvasText; }
      .chart-total, .chart-cursor-line { stroke: CanvasText; }
    }
    @media print { @page { size: letter; } .chart { break-inside: avoid; } }`;
  assert.deepEqual(styleContractProblems(agreed), []);
  const drifted = `
    .chart svg { display: block; }
    .chart-tick, .chart-label, .chart-ref-label { font-size: 12px; fill: var(--ink); }
    .chart-tick.wide { font-size: 13px; }
    .chart-marker-num { font-size: 12px; font-weight: 700; fill: var(--ink); }
    .chart .dose-curve.faded { opacity: 0.25; }
    @media (forced-colors: active) { .chart .total-curve { stroke: CanvasText; } }`;
  const problems = styleContractProblems(drifted);
  for (const expected of [
    ".chart-svg.printing .chart-tick: no 10pt size",
    ".chart-svg.printing .chart-label: no 10pt size",
    ".chart-svg.printing .chart-marker-num: no 10pt size",
    ".chart-wide .chart-tick: no 13px size",
    "forced colors: no .chart-total { stroke: CanvasText }",
    ".chart-tick.wide: .wide is never on a chart element",
    ".chart .dose-curve.faded: .dose-curve is not a chart class",
    ".chart .total-curve: .total-curve is not a chart class",
    ".chart-label: sets fill, overriding the chart's own",
    ".chart-marker-num: sets fill, overriding the chart's own"
  ]) {
    assert.ok(problems.includes(expected), `flags "${expected}"`);
  }
});

test("styles.css styles the chart only through its class hooks", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.deepEqual(styleContractProblems(css), []);
});
