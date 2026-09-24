// The answers around the chart: the level before each dose, headline
// sentences, tiles, readout, pin to compare, the hour table and the time
// sheet rows. Pure: no DOM. Levels stay raw here and are rounded only in text.
import { DRUG_BY_ID } from "./drugs.js";
import { computeDay, formatDuration } from "./model.js";
import { formatClock, formatCount, formatNumber, formatRange } from "./time.js";
import { dailyTotals, strengthOf } from "./amounts.js";

const DAY = 1440;
const GROUP_GAP = 45;
// The low may sit just after the dose time while the new dose is absorbed.
const LOW_SEARCH_AFTER = 60;
const EARLY_LOW = 10;
const OVERNIGHT_GAP = 360;
const FIRST_DOSE_WINDOW = 60;
const MATCH_WINDOW = 90;
const MIN_SOURCE = 2;
const CHANGE_LEVEL = 5;
const CHANGE_MINUTES = 5;
const SHEET_ROWS = 12;
const SHEET_NAME_MAX = 60;
const MINUS = "\u2212";
const EPSILON = 1e-6;

const PINNED_NOTE = "Comparing with the day you pinned (grey dashed line).";

const wrap = minute => ((minute % DAY) + DAY) % DAY;

function clockMinute(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof time === "string" ? time : "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function hasAmount(dose) {
  return Boolean(dose) && typeof dose.dose === "number" && Number.isFinite(dose.dose) && dose.dose > 0;
}

// Doses the model counts, sorted by time (stable).
function countedDoses(doses) {
  return (Array.isArray(doses) ? doses : [])
    .filter(dose => hasAmount(dose) && DRUG_BY_ID[dose.drug] && clockMinute(dose.time) !== null)
    .map((dose, index) => ({ dose, index, minute: clockMinute(dose.time) }))
    .sort((a, b) => a.minute - b.minute || a.index - b.index)
    .map(item => item.dose);
}

function lineValue(value) {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : null;
}

const levelText = value => formatNumber(Math.round(value), 0);

// "× one IR peak" and the fluctuation index always show 1 decimal (SPEC 3.7).
const oneDecimal = value => value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function valueAt(total, minute) {
  const value = total?.[wrap(minute)];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function circularDistance(a, b) {
  const d = wrap(a - b);
  return Math.min(d, DAY - d);
}

/* ---------- Groups and the level before each dose (SPEC 4.5) ---------- */

// Dose times 45 min or less apart share a group; the day is circular, so a
// group can span midnight. Such a group comes first and has start > end.
export function doseGroups(doses) {
  const list = countedDoses(doses);
  const times = [...new Set(list.map(dose => clockMinute(dose.time)))].sort((a, b) => a - b);
  const spans = [];
  for (const time of times) {
    const last = spans[spans.length - 1];
    if (last && time - last.end <= GROUP_GAP) {
      last.end = time;
      last.times.push(time);
    } else {
      spans.push({ start: time, end: time, times: [time] });
    }
  }
  if (spans.length > 1 && spans[0].start + DAY - spans[spans.length - 1].end <= GROUP_GAP) {
    const last = spans.pop();
    spans[0].start = last.start;
    spans[0].times = [...last.times, ...spans[0].times];
  }
  return spans.map(span => ({
    start: span.start,
    end: span.end,
    times: span.times,
    ids: span.times.flatMap(time => list.filter(dose => clockMinute(dose.time) === time).map(dose => dose.id))
  }));
}

// Ported from design/proto-answer-first/lowpoints-lib.mjs. Rows carry one
// field beyond the contract: previousEnd, the last dose time of the group
// before (for the "3 h after the 06:00 dose" tile note).
export function beforeEachDose(total, groups) {
  if (!Array.isArray(groups) || !groups.length) return [];
  // Unwrap to a line: a group across midnight starts before 0.
  const spans = groups.map(group => ({
    start: group.start > group.end ? group.start - DAY : group.start,
    end: group.end,
    times: Array.isArray(group.times) && group.times.length ? group.times : [group.start]
  }));
  const count = spans.length;
  const rows = spans.map((span, index) => {
    const previous = spans[(index - 1 + count) % count];
    const next = spans[(index + 1) % count];
    let previousEnd = previous.end;
    if (previousEnd >= span.start) previousEnd -= DAY;
    // Start at the peak after the previous dose, so the not-yet-risen level
    // just after that dose is never reported as the low.
    let peak = -Infinity;
    let peakMinute = previousEnd;
    for (let minute = previousEnd; minute <= span.start; minute += 1) {
      const value = valueAt(total, minute);
      if (value > peak) {
        peak = value;
        peakMinute = minute;
      }
    }
    let level = Infinity;
    let lowMinute = peakMinute;
    for (let minute = peakMinute; minute <= span.start + LOW_SEARCH_AFTER; minute += 1) {
      const value = valueAt(total, minute);
      if (value < level) {
        level = value;
        lowMinute = minute;
      }
    }
    let nextStart = next.start;
    if (nextStart <= span.end) nextStart += DAY;
    let peakAfter = -Infinity;
    let peakAfterMinute = span.start;
    for (let minute = span.start; minute <= nextStart; minute += 1) {
      const value = valueAt(total, minute);
      if (value > peakAfter) {
        peakAfter = value;
        peakAfterMinute = minute;
      }
    }
    return {
      number: index + 1,
      label: span.times.map(formatClock).join(" + "),
      groupStart: wrap(span.start),
      level,
      minute: wrap(lowMinute),
      early: span.start - lowMinute > EARLY_LOW,
      sinceLast: span.start - previousEnd,
      overnight: false,
      peakAfter,
      peakAfterMinute: wrap(peakAfterMinute),
      previousEnd: wrap(previousEnd)
    };
  });
  const longest = rows.reduce((best, row) => (row.sinceLast > best.sinceLast ? row : best), rows[0]);
  if (longest.sinceLast >= OVERNIGHT_GAP) longest.overnight = true;
  return rows;
}

/* ---------- Ranges against the lines ---------- */

// Runs of minutes (0–1439) where inside(level) holds; a run across midnight is
// one range. end is exclusive and wrapped; minutes is the run length, so a
// whole day reads { start: 0, end: 0, minutes: 1440 }.
function circularRuns(total, inside) {
  const flags = [];
  for (let minute = 0; minute < DAY; minute += 1) flags.push(inside(valueAt(total, minute)));
  const firstOut = flags.indexOf(false);
  if (firstOut === -1) return [{ start: 0, end: 0, minutes: DAY }];
  const runs = [];
  let current = null;
  for (let step = 1; step <= DAY; step += 1) {
    const minute = (firstOut + step) % DAY;
    if (flags[minute]) {
      if (!current) current = { start: minute, minutes: 0 };
      current.minutes += 1;
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  return runs
    .map(run => ({ start: run.start, end: (run.start + run.minutes) % DAY, minutes: run.minutes }))
    .sort((a, b) => a.start - b.start);
}

export function rangesBelow(total, threshold) {
  const line = lineValue(threshold);
  return line === null ? [] : circularRuns(total, value => value < line);
}

export function rangesAbove(total, threshold) {
  const line = lineValue(threshold);
  return line === null ? [] : circularRuns(total, value => value >= line);
}

function minutesOf(ranges) {
  return ranges.reduce((sum, range) => sum + range.minutes, 0);
}

function countMinutes(total, inside) {
  let minutes = 0;
  for (let minute = 0; minute < DAY; minute += 1) if (inside(valueAt(total, minute))) minutes += 1;
  return minutes;
}

function longestRange(ranges) {
  return ranges.reduce((best, range) => (!best || range.minutes > best.minutes ? range : best), null);
}

// "22:44–06:32"; a whole day reads "00:00–24:00".
export function rangeLabel(range) {
  if (range.minutes >= DAY) return "00:00–24:00";
  return formatRange(range.start, range.end);
}

// "08:04–09:18, 11:17–12:16" for the range lists under the table.
export function rangeText(ranges) {
  return (ranges ?? []).map(rangeLabel).join(", ");
}

/* ---------- The central analysis ---------- */

export function analyzeDay(doses, lines = { target: null, high: null }) {
  const list = countedDoses(doses);
  // Only what the model needs, so no stale field (such as hidden) changes the total.
  const computed = computeDay({ doses: list.map(dose => ({ time: dose.time, drug: dose.drug, dose: dose.dose })) });
  const total = computed.total;
  const groups = doseGroups(list);
  const before = beforeEachDose(total, groups);
  const target = lineValue(lines?.target);
  const high = lineValue(lines?.high);

  let sum = 0;
  for (let minute = 0; minute < DAY; minute += 1) sum += valueAt(total, minute);
  const mean = sum / DAY;
  const lowestBefore = before.length >= 2
    ? before.filter(row => !row.overnight).reduce((low, row) => (!low || row.level < low.level ? row : low), null)
    : null;

  const below = target === null ? null : rangesBelow(total, target);
  const above = high === null ? null : rangesAbove(total, high);
  const belowMinutes = below ? minutesOf(below) : null;
  const aboveMinutes = above ? minutesOf(above) : null;

  return {
    doses: list,
    computed,
    groups,
    before,
    stats: {
      min: computed.minimum,
      minMinute: computed.minimumMinute,
      max: computed.maximum,
      maxMinute: computed.maximumMinute,
      mean,
      fluctuation: mean > 0 ? (computed.maximum - computed.minimum) / mean : null,
      lowestBefore
    },
    lines: { target, high },
    below,
    above,
    belowMinutes,
    aboveMinutes,
    targetFraction: belowMinutes === null ? null : (DAY - belowMinutes) / DAY,
    totals: dailyTotals(list)
  };
}

/* ---------- Headline (SPEC 4.2) ---------- */

// The dose that starts the day: the one after the overnight gap, else the earliest.
function firstDoseRow(analysis) {
  const rows = analysis.before ?? [];
  return rows.find(row => row.overnight) ?? rows[0] ?? null;
}

// The minute is in the 60 min before the first dose group, or at it.
function beforeFirstDose(analysis, minute) {
  const first = firstDoseRow(analysis);
  return Boolean(first) && wrap(first.groupStart - minute) <= FIRST_DOSE_WINDOW;
}

function spanText(values) {
  const rounded = values.map(value => Math.round(value));
  const low = Math.min(...rounded);
  const high = Math.max(...rounded);
  return low === high ? levelText(low) : `${levelText(low)}–${levelText(high)}`;
}

function belowSentence(analysis) {
  if ((analysis.lines?.target ?? null) === null || !analysis.below) return null;
  const minutes = analysis.belowMinutes ?? minutesOf(analysis.below);
  if (minutes <= 0) return "Never below your target line.";
  if (minutes >= DAY) return "Below your target line all day.";
  return `Below your target line for ${formatDuration(minutes)} a day; the longest stretch is ${rangeLabel(longestRange(analysis.below))}.`;
}

export function headlineSentences(analysis) {
  if (!analysis?.doses?.length || !analysis.before?.length) return [];
  const { stats, before } = analysis;
  const sentences = [];
  if (before.length === 1) {
    sentences.push(`One dose time a day: highest ${levelText(stats.max)} at ${formatClock(stats.maxMinute)}, `
      + `lowest ${levelText(stats.min)} at ${formatClock(stats.minMinute)}.`);
  } else {
    const first = beforeFirstDose(analysis, stats.minMinute) ? ", before the first dose" : "";
    sentences.push(`Lowest of the day: ${levelText(stats.min)} at ${formatClock(stats.minMinute)}${first}.`);
    const daytime = before.filter(row => !row.overnight);
    if (daytime.length === 1) {
      sentences.push(`During the day it drops to ${levelText(daytime[0].level)} before the ${formatClock(daytime[0].groupStart)} dose.`);
    } else if (daytime.length > 1) {
      sentences.push(`During the day it drops to ${spanText(daytime.map(row => row.level))} before each dose `
        + `and rises to ${spanText(daytime.map(row => row.peakAfter))} after.`);
    }
  }
  const below = belowSentence(analysis);
  if (below) sentences.push(below);
  return sentences;
}

/* ---------- Tiles (SPEC 4.2, 4.8) ---------- */

function signedText(delta, text) {
  return `${delta > 0 ? "+" : MINUS}${text}`;
}

// The third tile line while pinned: "was 192 · +27" or "same as pinned".
function levelWas(current, pinned) {
  if (typeof pinned !== "number" || !Number.isFinite(pinned)) return undefined;
  const was = Math.round(pinned);
  if (typeof current !== "number" || !Number.isFinite(current)) return `was ${levelText(was)}`;
  const delta = Math.round(current) - was;
  return delta === 0 ? "same as pinned" : `was ${levelText(was)} · ${signedText(delta, levelText(Math.abs(delta)))}`;
}

function decimalWas(current, pinned) {
  if (typeof pinned !== "number" || !Number.isFinite(pinned)) return undefined;
  const was = Math.round(pinned * 10);
  if (typeof current !== "number" || !Number.isFinite(current)) return `was ${oneDecimal(was / 10)}`;
  const delta = Math.round(current * 10) - was;
  return delta === 0 ? "same as pinned" : `was ${oneDecimal(was / 10)} · ${signedText(delta, oneDecimal(Math.abs(delta) / 10))}`;
}

function durationWas(current, pinned) {
  if (typeof pinned !== "number" || typeof current !== "number") return undefined;
  const delta = current - pinned;
  return delta === 0 ? "same as pinned" : `was ${formatDuration(pinned)} · ${signedText(delta, formatDuration(Math.abs(delta)))}`;
}

function pinnedBelow(snapshot, target) {
  return snapshot?.total && target !== null ? countMinutes(snapshot.total, value => value < target) : null;
}

function pinnedAbove(snapshot, high) {
  return snapshot?.total && high !== null ? countMinutes(snapshot.total, value => value >= high) : null;
}

const hasOvernightGap = analysis => Boolean(analysis?.before?.some(row => row.overnight));

// With an overnight gap, the lowest before a dose leaves out the first dose
// of the day, so the name says so. Otherwise "Lowest before a dose" read as
// a contradiction next to a lower "Lowest" before that first dose.
export function lowestBeforeLabel(analysis) {
  return hasOvernightGap(analysis) ? "Daytime low" : "Lowest before a dose";
}

function lowestBeforeNote(row) {
  if (!row) return "Needs 2 or more dose times.";
  if (row.early) return `at ${formatClock(row.minute)}, before the ${formatClock(row.groupStart)} dose`;
  return `at ${formatClock(row.minute)}, ${formatDuration(wrap(row.minute - row.previousEnd))} after the ${formatClock(row.previousEnd)} dose`;
}

export function tileModel(analysis, pinned = null) {
  const { stats, lines } = analysis;
  const low = stats.lowestBefore;
  const tiles = [
    {
      key: "lowestBefore",
      label: lowestBeforeLabel(analysis),
      value: low ? levelText(low.level) : "—",
      note: lowestBeforeNote(low),
      info: null
    },
    {
      key: "lowest",
      label: "Lowest",
      value: levelText(stats.min),
      note: `at ${formatClock(stats.minMinute)}${beforeFirstDose(analysis, stats.minMinute) ? ", before the first dose" : ""}`,
      info: "lowest"
    },
    {
      key: "highest",
      label: "Highest",
      value: levelText(stats.max),
      note: `at ${formatClock(stats.maxMinute)} · ${oneDecimal(stats.max / 100)} × one IR peak`,
      info: "highest"
    },
    {
      key: "fluctuation",
      label: "Fluctuation index",
      value: stats.fluctuation === null ? "—" : oneDecimal(stats.fluctuation),
      note: "bigger number = bigger swings",
      info: "fluctuation"
    }
  ];
  if (lines.target !== null) {
    const minutes = analysis.belowMinutes ?? 0;
    const percent = `at or above target ${Math.round(((DAY - minutes) / DAY) * 100)}% of the day`;
    const longest = longestRange(analysis.below ?? []);
    tiles.push({
      key: "below",
      label: "Below target line",
      value: formatDuration(minutes),
      note: longest ? `longest ${rangeLabel(longest)} · ${percent}` : percent,
      info: "target"
    });
  }
  if (lines.high !== null) {
    const longest = longestRange(analysis.above ?? []);
    tiles.push({
      key: "above",
      label: "At or above high line",
      value: formatDuration(analysis.aboveMinutes ?? 0),
      note: longest ? `longest ${rangeLabel(longest)}` : "none",
      info: "high"
    });
  }
  if (pinned) {
    const was = {
      lowestBefore: pinned.lowestBefore ? levelWas(low?.level, pinned.lowestBefore.level) : undefined,
      lowest: levelWas(stats.min, pinned.stats?.min),
      highest: levelWas(stats.max, pinned.stats?.max),
      fluctuation: decimalWas(stats.fluctuation, pinned.stats?.fluctuation),
      below: durationWas(analysis.belowMinutes, pinnedBelow(pinned, lines.target)),
      above: durationWas(analysis.aboveMinutes, pinnedAbove(pinned, lines.high))
    };
    for (const tile of tiles) if (was[tile.key]) tile.was = was[tile.key];
  }
  return tiles;
}

/* ---------- Readout and slider (SPEC 4.3, 4.4) ---------- */

function cursorMinute(minute) {
  const number = Number(minute);
  return Number.isFinite(number) ? wrap(Math.round(number)) : 0;
}

function lineStatus(value, lines) {
  const target = lines?.target ?? null;
  const high = lines?.high ?? null;
  if (high !== null && value >= high) return "at or above high line";
  if (target !== null) return value < target ? "below target line" : "at or above target";
  return null;
}

// Top two sources of at least 2 units. Doses at the same time of the same
// medicine are one source.
function sourcesText(analysis, minute) {
  const sources = new Map();
  (analysis.doses ?? []).forEach((dose, index) => {
    const key = `${dose.time}|${dose.drug}`;
    const source = sources.get(key) ?? { dose, value: 0, order: index };
    source.value += valueAt(analysis.computed?.series?.[index], minute);
    sources.set(key, source);
  });
  const top = [...sources.values()]
    .filter(source => source.value >= MIN_SOURCE)
    .sort((a, b) => b.value - a.value || a.order - b.order)
    .slice(0, 2);
  if (!top.length) return "almost nothing left from any dose";
  const name = source => {
    const when = clockMinute(source.dose.time) > minute ? "last night's" : "the";
    return `${when} ${source.dose.time} ${DRUG_BY_ID[source.dose.drug].shortName} (${levelText(source.value)})`;
  };
  return `mostly ${top.map(name).join(" and ")}`;
}

export function readoutText(analysis, minute) {
  const at = cursorMinute(minute);
  const value = valueAt(analysis.computed?.total, at);
  const parts = [formatClock(at), `level ${levelText(value)}`];
  const status = lineStatus(value, analysis.lines);
  if (status) parts.push(status);
  parts.push(sourcesText(analysis, at));
  return parts.join(" · ");
}

export function sliderValueText(analysis, minute) {
  const at = cursorMinute(minute);
  const value = valueAt(analysis.computed?.total, at);
  const status = lineStatus(value, analysis.lines);
  return `${formatClock(at)}, level ${levelText(value)}${status ? `, ${status}` : ""}`;
}

/* ---------- Pin to compare (SPEC 4.8) ---------- */

export function pinSnapshot(analysis) {
  const { stats } = analysis;
  return {
    total: new Float64Array(analysis.computed.total),
    stats: {
      min: stats.min,
      minMinute: stats.minMinute,
      max: stats.max,
      maxMinute: stats.maxMinute,
      mean: stats.mean,
      fluctuation: stats.fluctuation
    },
    lowestBefore: stats.lowestBefore ? { ...stats.lowestBefore } : null,
    before: analysis.before.map(row => ({ ...row })),
    totals: { mg: analysis.totals.mg, led: analysis.totals.led },
    doseCount: analysis.doses.length
  };
}

// Current and pinned groups within 90 min, one-to-one, closest pairs first.
function matchGroups(rows, pinnedRows) {
  const pairs = [];
  for (const row of rows) {
    for (const old of pinnedRows) {
      const distance = circularDistance(row.groupStart, old.groupStart);
      if (distance <= MATCH_WINDOW) pairs.push({ row, old, distance });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || a.row.number - b.row.number || a.old.number - b.old.number);
  const used = new Set();
  const matched = new Map();
  for (const pair of pairs) {
    if (matched.has(pair.row.number) || used.has(pair.old.number)) continue;
    matched.set(pair.row.number, pair.old);
    used.add(pair.old.number);
  }
  return { matched, used };
}

function totalsClause(current, pinned) {
  const mgNow = formatNumber(current.mg);
  const mgWas = formatNumber(pinned.mg);
  const ledNow = formatNumber(current.led);
  const ledWas = formatNumber(pinned.led);
  if (mgNow !== mgWas) return `Daily levodopa goes from ${mgWas} to ${mgNow} mg (LEDD ${ledWas} → ${ledNow}).`;
  if (ledNow !== ledWas) return `Daily levodopa is the same (${mgNow} mg; LEDD ${ledWas} → ${ledNow}).`;
  return `Daily levodopa is the same (${mgNow} mg).`;
}

export function compareModel(analysis, snapshot) {
  if (!snapshot) return null;
  const rows = analysis.before ?? [];
  const pinnedRows = snapshot.before ?? [];
  const { matched, used } = matchGroups(rows, pinnedRows);

  const beforeWas = new Map();
  for (const row of rows) {
    const old = matched.get(row.number);
    beforeWas.set(row.number, old ? `(was ${levelText(old.level)})` : "(new)");
  }
  const unmatched = pinnedRows
    .filter(old => !used.has(old.number))
    .map(old => ({ number: old.number, label: old.label, level: old.level, groupStart: old.groupStart, minute: old.minute }));

  const clauses = [];
  let fall = null;
  for (const row of rows) {
    const old = matched.get(row.number);
    if (!old) continue;
    const drop = Math.round(old.level) - Math.round(row.level);
    if (drop >= CHANGE_LEVEL && (!fall || drop > fall.drop)) fall = { row, old, drop };
  }
  if (fall) {
    clauses.push(`the level before the ${formatClock(fall.row.groupStart)} dose falls from ${levelText(fall.old.level)} to ${levelText(fall.row.level)}`);
  }
  const highNow = Math.round(analysis.stats.max);
  const highWas = Math.round(snapshot.stats.max);
  if (Math.abs(highNow - highWas) >= CHANGE_LEVEL) {
    clauses.push(`the highest level ${highNow > highWas ? "rises" : "falls"} from ${levelText(highWas)} to ${levelText(highNow)} `
      + `(now at ${formatClock(analysis.stats.maxMinute)})`);
  }
  // The lines belong to the patient, so the pinned day is measured against today's target.
  const belowWas = pinnedBelow(snapshot, analysis.lines?.target ?? null);
  const belowNow = analysis.belowMinutes;
  if (belowWas !== null && typeof belowNow === "number" && Math.abs(belowNow - belowWas) >= CHANGE_MINUTES) {
    clauses.push(`time below your target line goes from ${formatDuration(belowWas)} to ${formatDuration(belowNow)}`);
  }
  const totals = totalsClause(analysis.totals, snapshot.totals);
  const sentence = clauses.length
    ? `Compared with the pinned day: ${clauses.join("; ")}. ${totals}`
    : `The curve is almost the same as the pinned day. ${totals}`;

  return { note: PINNED_NOTE, sentence, beforeWas, unmatched, wasNote: matched.size > 0 };
}

/* ---------- Hour-by-hour table (SPEC 4.7) ---------- */

function hourStatus(value, lines) {
  const status = lineStatus(value, lines);
  if (status === "at or above high line") return "at or above high";
  if (status === "below target line") return "below target";
  return status ?? "";
}

export function hourlyRows(analysis) {
  const rows = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const minute = hour * 60;
    const value = valueAt(analysis.computed?.total, minute);
    const doses = (analysis.doses ?? [])
      .filter(dose => Math.floor(clockMinute(dose.time) / 60) === hour)
      .map(dose => `${dose.time} ${DRUG_BY_ID[dose.drug].shortName} ${formatNumber(dose.dose)} mg`)
      .join(", ");
    rows.push({ time: formatClock(minute), level: levelText(value), doses, compared: hourStatus(value, analysis.lines) });
  }
  return rows;
}

/* ---------- Text alternatives and status (SPEC 8, 4.9) ---------- */

export function chartDesc(analysis) {
  const parts = [...headlineSentences(analysis)];
  const rows = analysis?.before ?? [];
  if (rows.length) parts.push(`Levels before each dose: ${rows.map(row => `${row.label} ${levelText(row.level)}`).join(", ")}.`);
  return parts.join(" ");
}

export function statusMessage(analysis, count) {
  const doses = Number.isInteger(count) ? count : (analysis?.doses?.length ?? 0);
  const countText = plural(doses, "dose", "doses");
  if (!analysis?.doses?.length) return `Updated. ${countText}.`;
  const { stats, totals } = analysis;
  const low = stats.lowestBefore
    ? `${lowestBeforeLabel(analysis)} ${levelText(stats.lowestBefore.level)} at ${formatClock(stats.lowestBefore.minute)}.`
    : `Lowest ${levelText(stats.min)} at ${formatClock(stats.minMinute)}.`;
  return `Updated. ${countText}, ${formatNumber(totals.mg)} mg levodopa = ${formatNumber(totals.led)} mg LEDD a day. `
    + `${low} Highest ${levelText(stats.max)} at ${formatClock(stats.maxMinute)}.`;
}

// The second line of the phone answer bar. It has about 155 px on a 360 px
// screen, so the "was" form drops the time; the tiles still show it.
export function answerBarLow(analysis, pinned = null) {
  const { stats } = analysis;
  const low = stats.lowestBefore;
  if (!low) return `Lowest: ${levelText(stats.min)} at ${formatClock(stats.minMinute)} ↓`;
  if (pinned?.lowestBefore && Math.round(pinned.lowestBefore.level) !== Math.round(low.level)) {
    return `Dips to ${levelText(low.level)} (was ${levelText(pinned.lowestBefore.level)}) ↓`;
  }
  return `Dips to ${levelText(low.level)} at ${formatClock(low.minute)} ↓`;
}

/* ---------- Dose time sheet rows (SPEC 7.3) ---------- */

// Strength × count when they are set and match the mg; otherwise mg mode.
function sheetKey(dose, drug) {
  const strength = strengthOf(drug, dose.strength);
  const count = dose.count;
  if (strength && typeof count === "number" && count > 0 && Math.abs(strength.levodopa * count - dose.dose) < EPSILON) {
    const unit = count > 1 ? drug.unit[1] : drug.unit[0];
    return { key: `${drug.id}|${strength.id}|${count}`, name: `${drug.shortName} ${strength.label} · ${formatCount(count)} ${unit}` };
  }
  return { key: `${drug.id}|mg|${dose.dose}`, name: `${drug.shortName} · ${formatNumber(dose.dose)} mg levodopa` };
}

export function buildSheetRows(doses) {
  const list = Array.isArray(doses) ? doses : [];
  const groups = new Map();
  let missing = 0;
  for (const dose of list) {
    if (!dose) continue;
    if (!hasAmount(dose)) {
      missing += 1;
      continue;
    }
    const drug = DRUG_BY_ID[dose.drug];
    const minute = clockMinute(dose.time);
    if (!drug || minute === null) continue;
    const { key, name } = sheetKey(dose, drug);
    const inhaled = drug.id === "inbrija" ? " (inhaled)" : "";
    const group = groups.get(key) ?? { name: `${name}${inhaled}`, minutes: [] };
    group.minutes.push(minute);
    groups.set(key, group);
  }
  const all = [...groups.values()]
    .map(group => ({ ...group, first: Math.min(...group.minutes) }))
    .sort((a, b) => a.first - b.first)
    .map(group => {
      const minutes = [...new Set(group.minutes)].sort((a, b) => a - b);
      const offHour = minutes.filter(minute => minute % 60 !== 0);
      let name = group.name;
      if (offHour.length) {
        const listed = `${name} (at ${offHour.map(formatClock).join(", ")})`;
        const general = `${name} (times not on the hour)`;
        if (listed.length <= SHEET_NAME_MAX) name = listed;
        else if (general.length <= SHEET_NAME_MAX) name = general;
      }
      return { name, hours: [...new Set(minutes.map(minute => Math.floor(minute / 60)))] };
    });
  const notes = [];
  if (all.length > SHEET_ROWS) notes.push(`The time sheet holds ${SHEET_ROWS} medicines. The first ${SHEET_ROWS} were sent.`);
  if (missing) notes.push(`${plural(missing, "dose", "doses")} without an amount ${missing === 1 ? "was" : "were"} left off.`);
  return { rows: all.slice(0, SHEET_ROWS), notes };
}
