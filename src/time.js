// Time and number helpers for entry and display. Pure: no DOM, no imports.
// Times are integer minutes 0–1439; the clock is always 24-hour and never
// depends on the device locale.

const MINUTES_PER_DAY = 1440;
const EXACT_CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const SUFFIX = /^(a|am|p|pm)$/;
// "630", "0600", "6p", "630pm"
const DIGITS_ONLY = /^(\d{1,4})(a|am|p|pm)?$/;
// "6:30", "6.30", "6h30", "18h"; minutes must be two digits
const SEPARATED = /^(\d{1,2})(?:[:.](\d{2})|h(\d{2})?)(a|am|p|pm)?$/;

function wrapMinute(minute) {
  return ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function parseOne(piece) {
  if (piece === "noon") return 720;
  if (piece === "midnight") return 0;
  let hours;
  let minutes;
  let suffix;
  const digits = DIGITS_ONLY.exec(piece);
  const separated = digits ? null : SEPARATED.exec(piece);
  if (digits) {
    const text = digits[1];
    suffix = digits[2];
    if (text.length <= 2) {
      hours = Number(text);
      minutes = 0;
    } else {
      hours = Number(text.slice(0, -2));
      minutes = Number(text.slice(-2));
    }
  } else if (separated) {
    hours = Number(separated[1]);
    minutes = Number(separated[2] ?? separated[3] ?? 0);
    suffix = separated[4];
  } else {
    return null;
  }
  if (minutes > 59) return null;
  if (suffix) {
    if (hours < 1 || hours > 12) return null;
    hours = suffix.startsWith("p") ? (hours % 12) + 12 : hours % 12;
  }
  // 24, 2400 and 24:00 are the end of the day, which is the same clock time as 00:00.
  if (hours === 24 && minutes === 0) return 0;
  if (hours > 23) return null;
  return hours * 60 + minutes;
}

export function parseTimes(text) {
  const pieces = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/([ap])\.m\.?/g, "$1m")
    .split(/[\s,;]+/)
    .filter(Boolean);
  const tokens = [];
  for (const piece of pieces) {
    // A bare "pm" belongs to the time before it: "6 pm".
    if (SUFFIX.test(piece) && tokens.length) tokens[tokens.length - 1] += piece;
    else tokens.push(piece);
  }
  const times = [];
  const bad = [];
  for (const token of tokens) {
    const minute = parseOne(token);
    if (minute === null) bad.push(token);
    else times.push(minute);
  }
  return { times, bad };
}

export function formatClock(minute) {
  if (typeof minute !== "number" || !Number.isFinite(minute)) return "";
  const wrapped = wrapMinute(minute);
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// The live echo under the time field. `bad` is extra to the contract: the
// pieces that could not be read, for the commit error message.
export function describeTimeInput(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { kind: "empty", message: "", times: [], bad: [] };
  const { times, bad } = parseTimes(trimmed);
  if (bad.length || !times.length) return { kind: "invalid", message: "Not a time yet", times: [], bad };
  if (times.length > 1) {
    return {
      kind: "multi",
      message: `Will add ${times.length} doses: ${times.map(formatClock).join(", ")}`,
      times,
      bad
    };
  }
  if (EXACT_CLOCK.test(trimmed)) return { kind: "exact", message: "", times, bad };
  const clock = formatClock(times[0]);
  return {
    kind: "single",
    message: times[0] === 0 ? `Reads as ${clock} (midnight)` : `Reads as ${clock}`,
    times,
    bad
  };
}

export function shiftTime(minute, delta) {
  return wrapMinute(minute + delta);
}

const FRACTION_GLYPHS = { "½": 0.5, "¼": 0.25, "¾": 0.75 };

export function parseCount(text) {
  if (typeof text === "number") return Number.isFinite(text) && text >= 0 ? text : null;
  const value = String(text ?? "").trim().replace(/,/g, ".");
  if (!value) return null;
  let match = /^(\d+\.?\d*|\.\d+)$/.exec(value);
  if (match) return Number(match[1]);
  match = /^(\d*)\s*([½¼¾])$/.exec(value);
  if (match) return Number(match[1] || 0) + FRACTION_GLYPHS[match[2]];
  match = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/.exec(value);
  if (match) {
    const denominator = Number(match[3]);
    if (!denominator) return null;
    return Number(match[1] ?? 0) + Number(match[2]) / denominator;
  }
  return null;
}

export function formatCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (n < 0) return `-${formatCount(-n)}`;
  const whole = Math.floor(n);
  const fraction = n - whole;
  if (fraction < 1e-9) return String(whole);
  if (Math.abs(fraction - 0.5) < 1e-9) return whole ? `${whole}½` : "½";
  return formatNumber(n, 2);
}

export function formatNumber(n, maxDecimals = 1) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  const text = n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
  // Small negatives round to "-0", which should read as plain 0.
  return /^-0(\.0*)?$/.test(text) ? "0" : text;
}

export function formatRange(start, end) {
  return `${formatClock(start)}–${formatClock(end)}`;
}
