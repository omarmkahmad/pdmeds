import test from "node:test";
import assert from "node:assert/strict";

import {
  describeTimeInput,
  formatClock,
  formatCount,
  formatNumber,
  formatRange,
  parseCount,
  parseTimes,
  shiftTime
} from "../src/time.js";

const clock = text => parseTimes(text).times.map(formatClock);

test("parseTimes reads every accepted form from the spec (SPEC 3.3, 11 Entry)", () => {
  const cases = [
    ["1200", "12:00"],
    ["2100", "21:00"],
    ["6", "06:00"],
    ["06", "06:00"],
    ["630", "06:30"],
    ["0600", "06:00"],
    ["6.30", "06:30"],
    ["6:30", "06:30"],
    ["6h30", "06:30"],
    ["18h", "18:00"],
    ["18:30", "18:30"],
    ["6p", "18:00"],
    ["6pm", "18:00"],
    ["6 pm", "18:00"],
    ["6 p.m.", "18:00"],
    ["6:30pm", "18:30"],
    ["6.30 pm", "18:30"],
    ["630p", "18:30"],
    ["6a", "06:00"],
    ["6 am", "06:00"],
    ["12a", "00:00"],
    ["12am", "00:00"],
    ["12p", "12:00"],
    ["12:30a", "00:30"],
    ["noon", "12:00"],
    ["midnight", "00:00"],
    ["Noon", "12:00"],
    ["0", "00:00"],
    ["00:00", "00:00"],
    ["23:59", "23:59"],
    ["24", "00:00"],
    ["2400", "00:00"],
    ["24:00", "00:00"],
    ["  7  ", "07:00"]
  ];
  for (const [text, expected] of cases) {
    const result = parseTimes(text);
    assert.deepEqual(result.bad, [], text);
    assert.deepEqual(result.times.map(formatClock), [expected], text);
  }
});

test("parseTimes rejects out-of-range and malformed pieces (SPEC 3.3, 11 Entry)", () => {
  for (const text of ["25", "6:75", "6.3", "13p", "0p", "0am", "24:30", "2401", "1260", "7:5", "6:", "12345",
    "abc", "30", "24p", "6.300", "-6", "am"]) {
    const result = parseTimes(text);
    assert.deepEqual(result.times, [], text);
    assert.equal(result.bad.length, 1, text);
  }
  assert.deepEqual(parseTimes("25").bad, ["25"]);
  assert.deepEqual(parseTimes("13P").bad, ["13p"]);
});

test("parseTimes splits several times on spaces, commas and semicolons", () => {
  assert.deepEqual(clock("6 9 12 15 18"), ["06:00", "09:00", "12:00", "15:00", "18:00"]);
  assert.deepEqual(clock("0600, 0900; 1200"), ["06:00", "09:00", "12:00"]);
  assert.deepEqual(clock("6,9,12"), ["06:00", "09:00", "12:00"]);
  assert.deepEqual(clock("6 am 6 pm"), ["06:00", "18:00"]);
  assert.deepEqual(clock("7p, 11p"), ["19:00", "23:00"]);
  const mixed = parseTimes("6 30 9");
  assert.deepEqual(mixed.times.map(formatClock), ["06:00", "09:00"]);
  assert.deepEqual(mixed.bad, ["30"]);
});

test("parseTimes handles empty and non-string input", () => {
  assert.deepEqual(parseTimes(""), { times: [], bad: [] });
  assert.deepEqual(parseTimes("   "), { times: [], bad: [] });
  assert.deepEqual(parseTimes(" , ; "), { times: [], bad: [] });
  assert.deepEqual(parseTimes(null), { times: [], bad: [] });
  assert.deepEqual(parseTimes(undefined), { times: [], bad: [] });
  assert.deepEqual(parseTimes(6).times, [360]);
});

test("describeTimeInput gives the live echo messages (SPEC 3.3, 5.3)", () => {
  assert.deepEqual(describeTimeInput("18"), { kind: "single", message: "Reads as 18:00", times: [1080], bad: [] });
  assert.equal(describeTimeInput("6.30").message, "Reads as 06:30");
  assert.equal(describeTimeInput("6p").message, "Reads as 18:00");
  assert.equal(describeTimeInput("noon").message, "Reads as 12:00");
  for (const text of ["24", "2400", "24:00"]) {
    const echo = describeTimeInput(text);
    assert.equal(echo.kind, "single", text);
    assert.equal(echo.message, "Reads as 00:00 (midnight)", text);
    assert.deepEqual(echo.times, [0], text);
  }
  assert.equal(describeTimeInput("12a").message, "Reads as 00:00 (midnight)");
  assert.equal(describeTimeInput("midnight").message, "Reads as 00:00 (midnight)");

  assert.deepEqual(describeTimeInput("18:00"), { kind: "exact", message: "", times: [1080], bad: [] });
  assert.equal(describeTimeInput(" 06:00 ").kind, "exact");
  assert.equal(describeTimeInput("00:00").kind, "exact");
  assert.equal(describeTimeInput("6:00").kind, "single");

  const multi = describeTimeInput("6 9 12 15 18");
  assert.equal(multi.kind, "multi");
  assert.equal(multi.message, "Will add 5 doses: 06:00, 09:00, 12:00, 15:00, 18:00");
  assert.deepEqual(multi.times, [360, 540, 720, 900, 1080]);

  for (const text of ["25", "6:75", "6.3", "13p", "6 30", "abc", ",,"]) {
    const echo = describeTimeInput(text);
    assert.equal(echo.kind, "invalid", text);
    assert.equal(echo.message, "Not a time yet", text);
    assert.deepEqual(echo.times, [], text);
  }
  assert.deepEqual(describeTimeInput("6 30").bad, ["30"]);

  assert.deepEqual(describeTimeInput(""), { kind: "empty", message: "", times: [], bad: [] });
  assert.equal(describeTimeInput("   ").kind, "empty");
  assert.equal(describeTimeInput(null).kind, "empty");
});

test("formatClock pads, wraps past midnight and rounds", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(390), "06:30");
  assert.equal(formatClock(1439), "23:59");
  assert.equal(formatClock(1440), "00:00");
  assert.equal(formatClock(1500), "01:00");
  assert.equal(formatClock(-30), "23:30");
  assert.equal(formatClock(-1440), "00:00");
  assert.equal(formatClock(59.6), "01:00");
  assert.equal(formatClock(Number.NaN), "");
  assert.equal(formatClock(null), "");
});

test("shiftTime wraps past midnight both ways", () => {
  assert.equal(shiftTime(360, 30), 390);
  assert.equal(shiftTime(1425, 30), 15);
  assert.equal(shiftTime(15, -30), 1425);
  assert.equal(shiftTime(0, -60), 1380);
  assert.equal(shiftTime(1380, 60), 0);
  assert.equal(shiftTime(720, 1440), 720);
  assert.equal(shiftTime(720, -2880), 720);
});

test("formatRange uses an en dash and may cross midnight", () => {
  assert.equal(formatRange(1360, 70), "22:40–01:10");
  assert.equal(formatRange(360, 540), "06:00–09:00");
  assert.equal(formatRange(1440, 1500), "00:00–01:00");
});

test("parseCount accepts every listed form (SPEC 3.3 count)", () => {
  const cases = [
    ["1", 1], ["2", 2], ["1.5", 1.5], ["1,5", 1.5], ["1½", 1.5], ["½", 0.5], [".5", 0.5], [",5", 0.5],
    ["1 1/2", 1.5], ["3/2", 1.5], ["1/2", 0.5], ["1 ½", 1.5], ["2½", 2.5], [" 3 ", 3], ["0", 0], ["1.", 1],
    ["8", 8], ["¼", 0.25], ["1¾", 1.75], ["10", 10], ["2 / 1", 2]
  ];
  for (const [text, expected] of cases) assert.equal(parseCount(text), expected, text);
  assert.equal(parseCount(1.5), 1.5);
  assert.equal(parseCount(0), 0);
});

test("parseCount returns null for text it can't read", () => {
  for (const text of ["", "  ", "abc", "1.5.5", "1/0", "-1", "one", "1 2", "½½", "1//2", "1 1/2 3"]) {
    assert.equal(parseCount(text), null, text);
  }
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
  assert.equal(parseCount(Number.NaN), null);
  assert.equal(parseCount(-1), null);
  assert.equal(parseCount(Infinity), null);
});

test("formatCount shows halves as fractions", () => {
  assert.equal(formatCount(1.5), "1½");
  assert.equal(formatCount(0.5), "½");
  assert.equal(formatCount(2), "2");
  assert.equal(formatCount(1), "1");
  assert.equal(formatCount(8), "8");
  assert.equal(formatCount(7.5), "7½");
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(0.25), "0.25");
  assert.equal(formatCount(null), "");
  assert.equal(formatCount(Number.NaN), "");
  for (const n of [0.5, 1, 1.5, 2, 2.5, 7.5, 8]) assert.equal(parseCount(formatCount(n)), n);
});

test("formatNumber uses en-US grouping, rounds and drops a trailing .0 (SPEC 3.7)", () => {
  assert.equal(formatNumber(1240), "1,240");
  assert.equal(formatNumber(995), "995");
  assert.equal(formatNumber(57.96), "58");
  assert.equal(formatNumber(84 * 0.69), "58");
  assert.equal(formatNumber(157.5), "157.5");
  assert.equal(formatNumber(122.5), "122.5");
  assert.equal(formatNumber(150.04), "150");
  assert.equal(formatNumber(12345.67), "12,345.7");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber(-0.04), "0");
  assert.equal(formatNumber(-22), "-22");
  assert.equal(formatNumber(64.4, 0), "64");
  assert.equal(formatNumber(64.5, 0), "65");
  assert.equal(formatNumber(1.234, 2), "1.23");
  assert.equal(formatNumber(0.69, 2), "0.69");
  assert.equal(formatNumber(1_000_000, 0), "1,000,000");
  assert.equal(formatNumber(Number.NaN), "");
  assert.equal(formatNumber(null), "");
});
