import test from "node:test";
import assert from "node:assert/strict";

import { DRUGS, DRUG_BY_ID, DRUG_ORDER, REGIMEN_SCHEMA_VERSION } from "../src/drugs.js";
import {
  amountLabel,
  countStep,
  dailyTotals,
  doseMg,
  inferStrength,
  largeDoseNote,
  ledParts,
  ledText,
  medicineChange,
  minCount,
  nextDoseDefaults,
  parseMg,
  strengthOf,
  validateCount
} from "../src/amounts.js";
import { parseCount } from "../src/time.js";

const dose = (id, time, drug, strength, count, mg) => ({ id, time, drug, strength, count, dose: mg });

// The test regimen from the top of SPEC.md.
const testRegimen = [
  dose("d1", "06:00", "sinemet", "25/100", 1.5, 150),
  dose("d2", "09:00", "sinemet", "25/100", 1.5, 150),
  dose("d3", "12:00", "sinemet", "25/100", 1.5, 150),
  dose("d4", "15:00", "sinemet", "25/100", 1.5, 150),
  dose("d5", "18:00", "sinemet", "25/100", 1.5, 150),
  dose("d6", "21:00", "rytary", "61.25/245", 2, 490)
];

test("drugs.js carries the redesign fields for every preparation (SPEC 3.4, 4.3)", () => {
  assert.equal(REGIMEN_SCHEMA_VERSION, 2);
  assert.deepEqual(DRUG_ORDER, ["sinemet", "sinemetcr", "rytary", "crexont", "inbrija"]);
  assert.deepEqual([...DRUG_ORDER].sort(), DRUGS.map(drug => drug.id).sort());
  const expected = {
    sinemet: ["Sinemet IR", "carbidopa/levodopa, immediate release", "tablet", "#0072B2", "", 400,
      ["10/100", "25/100", "25/250"], "25/100", 1, 8],
    sinemetcr: ["Sinemet CR", "carbidopa/levodopa, controlled release", "tablet", "#B35900", "9 4", 600,
      ["25/100", "50/200"], "50/200", 1, 8],
    rytary: ["Rytary", "carbidopa/levodopa, extended-release capsules", "capsule", "#117733", "4 3", 980,
      ["23.75/95", "36.25/145", "48.75/195", "61.25/245"], "61.25/245", 1, 8],
    crexont: ["Crexont", "carbidopa/levodopa, extended-release capsules (IPX203)", "capsule", "#882255", "12 3 3 3", 700,
      ["35/140", "52.5/210", "70/280", "87.5/350"], "35/140", 1, 8],
    inbrija: ["Inbrija", "inhaled levodopa powder", "capsule", "#5E3C99", "2 3", 84, ["42 mg"], "42", 2, 2]
  };
  for (const drug of DRUGS) {
    const [shortName, generic, unit, color, dash, large, labels, defaultStrength, defaultCount, maxCount] = expected[drug.id];
    assert.equal(drug.shortName, shortName);
    assert.equal(drug.generic, generic);
    assert.deepEqual(drug.unit, [unit, `${unit}s`]);
    assert.deepEqual(drug.style, { color, dash });
    assert.equal(drug.largeDoseMg, large);
    assert.deepEqual(drug.strengths.map(strength => strength.label), labels);
    assert.equal(drug.defaultStrength, defaultStrength);
    assert.ok(strengthOf(drug, drug.defaultStrength), drug.id);
    assert.equal(drug.defaultCount, defaultCount);
    assert.equal(drug.maxCount, maxCount);
    assert.equal(drug.ledAssumed, drug.id === "crexont");
    assert.equal(typeof drug.peaksText, "string");
    assert.equal(typeof drug.halfText, "string");
    // Existing fields stay.
    assert.equal(typeof drug.led.value, "number");
    assert.equal(drug.exposure.kind, "components");
    for (const strength of drug.strengths) {
      assert.equal(typeof strength.id, "string");
      assert.ok(strength.levodopa > 0);
      // The levodopa number is the second number of the label.
      if (strength.label.includes("/")) assert.equal(Number(strength.label.split("/")[1]), strength.levodopa);
    }
  }
  assert.deepEqual(DRUG_BY_ID.inbrija.strengths, [{ id: "42", label: "42 mg", levodopa: 42, halves: false }]);
});

test("halves: IR all, CR 50/200 only, capsules never", () => {
  for (const id of ["10/100", "25/100", "25/250"]) {
    assert.equal(minCount("sinemet", id), 0.5);
    assert.equal(countStep("sinemet", id), 0.5);
  }
  assert.equal(minCount("sinemetcr", "25/100"), 1);
  assert.equal(countStep("sinemetcr", "25/100"), 1);
  assert.equal(minCount("sinemetcr", "50/200"), 0.5);
  assert.equal(countStep("sinemetcr", "50/200"), 0.5);
  for (const id of ["rytary", "crexont", "inbrija"]) {
    for (const strength of DRUG_BY_ID[id].strengths) {
      assert.equal(minCount(id, strength.id), 1);
      assert.equal(countStep(DRUG_BY_ID[id], strength.id), 1);
    }
  }
});

test("strengthOf accepts a drug object or id, and a strength id or label", () => {
  assert.equal(strengthOf("sinemet", "25/100").levodopa, 100);
  assert.equal(strengthOf(DRUG_BY_ID.rytary, "61.25/245").levodopa, 245);
  assert.equal(strengthOf("inbrija", "42").label, "42 mg");
  assert.equal(strengthOf("inbrija", "42 mg").id, "42");
  assert.equal(strengthOf("sinemet", "61.25/245"), null);
  assert.equal(strengthOf("sinemet", null), null);
  assert.equal(strengthOf("nope", "25/100"), null);
  assert.equal(strengthOf(null, "25/100"), null);
});

test("doseMg is levodopa per unit × count", () => {
  assert.equal(doseMg("sinemet", "25/100", 1.5), 150);
  assert.equal(doseMg("sinemet", "25/250", 1), 250);
  assert.equal(doseMg("rytary", "61.25/245", 2), 490);
  assert.equal(doseMg("crexont", "52.5/210", 2), 420);
  assert.equal(doseMg("inbrija", "42", 2), 84);
  assert.equal(doseMg("sinemet", null, 1), null);
  assert.equal(doseMg("sinemet", "25/100", null), null);
  assert.equal(doseMg("sinemet", "25/100", Number.NaN), null);
});

test("inferStrength gives the required results (SPEC 3.4)", () => {
  const cases = [
    ["sinemet", 150, { strength: "25/100", count: 1.5 }],
    ["sinemet", 200, { strength: "25/100", count: 2 }],
    ["sinemet", 250, { strength: "25/250", count: 1 }],
    ["sinemetcr", 100, { strength: "25/100", count: 1 }],
    ["sinemetcr", 200, { strength: "50/200", count: 1 }],
    ["rytary", 490, { strength: "61.25/245", count: 2 }],
    ["crexont", 420, { strength: "52.5/210", count: 2 }],
    ["inbrija", 84, { strength: "42", count: 2 }],
    ["rytary", 150, null]
  ];
  for (const [drug, mg, expected] of cases) assert.deepEqual(inferStrength(drug, mg), expected, `${drug} ${mg}`);
});

test("inferStrength rules: whole before half, fewest units, default, then smaller", () => {
  // Whole counts beat a half count even with more units: 25/100 × 1 over 50/200 × ½.
  assert.deepEqual(inferStrength("sinemetcr", 100), { strength: "25/100", count: 1 });
  // CR 150: 25/100 is whole-only and 50/200 × ¾ is not a half step, so no match.
  assert.equal(inferStrength("sinemetcr", 150), null);
  assert.deepEqual(inferStrength("sinemetcr", 300), { strength: "25/100", count: 3 });
  assert.deepEqual(inferStrength("sinemetcr", 400), { strength: "50/200", count: 2 });
  // IR 100: 10/100 and 25/100 tie at 1 unit; the default wins.
  assert.deepEqual(inferStrength("sinemet", 100), { strength: "25/100", count: 1 });
  assert.deepEqual(inferStrength("sinemet", 50), { strength: "25/100", count: 0.5 });
  assert.deepEqual(inferStrength("sinemet", 500), { strength: "25/250", count: 2 });
  assert.deepEqual(inferStrength("sinemet", 125), { strength: "25/250", count: 0.5 });
  assert.deepEqual(inferStrength("sinemet", 2000), { strength: "25/250", count: 8 });
  assert.equal(inferStrength("sinemet", 2500), null);
  assert.equal(inferStrength("sinemet", 175), null);
  // Crexont 280: 70/280 × 1 beats 35/140 × 2.
  assert.deepEqual(inferStrength("crexont", 280), { strength: "70/280", count: 1 });
  assert.deepEqual(inferStrength("crexont", 140), { strength: "35/140", count: 1 });
  assert.deepEqual(inferStrength("crexont", 700), { strength: "87.5/350", count: 2 });
  assert.deepEqual(inferStrength("rytary", 95), { strength: "23.75/95", count: 1 });
  assert.deepEqual(inferStrength("rytary", 390), { strength: "48.75/195", count: 2 });
  assert.equal(inferStrength("rytary", 122.5), null);
  assert.deepEqual(inferStrength("inbrija", 42), { strength: "42", count: 1 });
  assert.equal(inferStrength("inbrija", 126), null);
  // Exact matches only, within 1e-6.
  assert.deepEqual(inferStrength("sinemet", 150 + 1e-7), { strength: "25/100", count: 1.5 });
  assert.equal(inferStrength("sinemet", 150.01), null);
  for (const mg of [0, -100, null, undefined, Number.NaN, "150"]) assert.equal(inferStrength("sinemet", mg), null);
  assert.equal(inferStrength("nope", 100), null);
  // Every result round-trips and is a valid count.
  for (const drug of DRUGS) {
    for (const strength of drug.strengths) {
      for (let count = 0.5; count <= drug.maxCount; count += 0.5) {
        const mg = strength.levodopa * count;
        const found = inferStrength(drug, mg);
        if (!found) continue;
        assert.equal(doseMg(drug, found.strength, found.count), mg);
        assert.equal(validateCount(drug, found.strength, found.count), null);
      }
    }
  }
});

test("validateCount gives the exact hard errors (SPEC 3.3)", () => {
  const halves = "Choose ½ to 8 tablets, in halves.";
  const wholeTablets = "This strength is taken as whole tablets. Choose 1 to 8.";
  const capsules = "Choose 1 to 8 capsules.";
  const inbrija = "Choose 1 or 2 capsules.";
  for (const count of [0.5, 1, 1.5, 4, 7.5, 8]) assert.equal(validateCount("sinemet", "25/100", count), null, count);
  for (const count of [0, 0.25, 1.25, 8.5, 9, -1, null, Number.NaN, undefined]) {
    assert.equal(validateCount("sinemet", "25/100", count), halves, String(count));
  }
  assert.equal(validateCount("sinemetcr", "50/200", 0.5), null);
  assert.equal(validateCount("sinemetcr", "50/200", 9), halves);
  assert.equal(validateCount("sinemetcr", "25/100", 1), null);
  assert.equal(validateCount("sinemetcr", "25/100", 0.5), wholeTablets);
  assert.equal(validateCount("sinemetcr", "25/100", 1.5), wholeTablets);
  assert.equal(validateCount("sinemetcr", "25/100", 9), wholeTablets);
  for (const count of [1, 2, 8]) assert.equal(validateCount("rytary", "61.25/245", count), null);
  for (const count of [0, 0.5, 1.5, 9]) assert.equal(validateCount("rytary", "61.25/245", count), capsules);
  assert.equal(validateCount("crexont", "35/140", 2.5), capsules);
  assert.equal(validateCount("inbrija", "42", 1), null);
  assert.equal(validateCount("inbrija", "42", 2), null);
  for (const count of [0, 0.5, 1.5, 3]) assert.equal(validateCount("inbrija", "42", count), inbrija);
  // Typed text is read with parseCount.
  assert.equal(validateCount("sinemet", "25/100", "1½"), null);
  assert.equal(validateCount("sinemet", "25/100", "abc"), halves);
  assert.equal(validateCount("sinemet", "25/100", parseCount("1 1/2")), null);
  // mg mode has no count to check.
  assert.equal(validateCount("sinemet", null, null), null);
});

test("parseMg reads the levodopa field (SPEC 3.3 4b)", () => {
  const blank = { value: null, error: null, note: "Enter the levodopa mg. Until then this dose is not counted." };
  assert.deepEqual(parseMg(""), blank);
  assert.deepEqual(parseMg("   "), blank);
  assert.deepEqual(parseMg(null), blank);
  for (const text of ["150", "150mg", "150 mg", "150 MG", " 150 "]) {
    assert.deepEqual(parseMg(text), { value: 150, error: null, note: null }, text);
  }
  assert.equal(parseMg(150).value, 150);
  assert.equal(parseMg("122.5").value, 122.5);
  assert.equal(parseMg("122,5").value, 122.5);
  assert.equal(parseMg("1,500").value, 1500);
  assert.equal(parseMg("2000").value, 2000);
  assert.equal(parseMg("25").note, null);

  const slash = "Type only the levodopa amount (the second number, e.g. 100), or pick a strength.";
  for (const text of ["25/100", "25 / 100", "61.25/245", "1/2"]) {
    assert.deepEqual(parseMg(text), { value: null, error: slash, note: null }, text);
  }
  const range = "Enter 1 to 2000 mg.";
  for (const text of ["0", "0.5", "2001", "2,500", "20000", "-5", "abc", "mg", "1.5.5"]) {
    assert.deepEqual(parseMg(text), { value: null, error: range, note: null }, text);
  }

  assert.deepEqual(parseMg("1.5"), {
    value: 1.5,
    error: null,
    note: "Only 1.5 mg? That looks like a tablet count. Pick a strength and use Tablets instead."
  });
  assert.equal(parseMg("2").note, "Only 2 mg? That looks like a tablet count. Pick a strength and use Tablets instead.");
  assert.equal(parseMg("24.5").note, "Only 24.5 mg? That looks like a tablet count. Pick a strength and use Tablets instead.");
  assert.equal(parseMg("1.25").note, "Only 1.25 mg? That looks like a tablet count. Pick a strength and use Tablets instead.");
});

test("parseMg has only the SPEC 5.3 tablet-count note (regression: no capsule variant)", () => {
  // A second argument used to switch to an unapproved "capsule count" note.
  const note = "Only 2 mg? That looks like a tablet count. Pick a strength and use Tablets instead.";
  for (const drug of [...DRUG_ORDER, DRUG_BY_ID.rytary, null]) assert.equal(parseMg("2", drug).note, note, String(drug?.id ?? drug));
  assert.equal(parseMg.length, 1);
});

test("ledParts and ledText show both numbers and the factor (owner request 1)", () => {
  assert.deepEqual(ledParts("sinemet", 150), { mg: 150, led: 150, factor: 1, assumed: false });
  assert.deepEqual(ledParts("crexont", 420), { mg: 420, led: 210, factor: 0.5, assumed: true });
  assert.deepEqual(ledParts("sinemet", null), { mg: null, led: null, factor: 1, assumed: false });
  assert.equal(ledText("sinemet", 150), "150 mg levodopa · counts as 150 mg LEDD (×1)");
  assert.equal(ledText("rytary", 490), "490 mg levodopa · counts as 245 mg LEDD (×0.5)");
  assert.equal(ledText(DRUG_BY_ID.crexont, 420), "420 mg levodopa · counts as 210 mg LEDD (×0.5, assumed)");
  assert.equal(ledText("sinemetcr", 200), "200 mg levodopa · counts as 150 mg LEDD (×0.75)");
  assert.equal(ledText("sinemetcr", 210), "210 mg levodopa · counts as 157.5 mg LEDD (×0.75)");
  assert.equal(ledText("inbrija", 84), "84 mg levodopa · counts as 58 mg LEDD (×0.69)");
  assert.equal(ledText("sinemet", 1250), "1,250 mg levodopa · counts as 1,250 mg LEDD (×1)");
  assert.equal(ledText("sinemet", null), "No amount yet · not counted");
  assert.equal(ledText("sinemet", 0), "No amount yet · not counted");
});

test("amountLabel formats strength × count, mg mode and Inbrija", () => {
  assert.equal(amountLabel(dose("a", "06:00", "sinemet", "25/100", 1.5, 150)), "1½ × 25/100");
  assert.equal(amountLabel(dose("a", "06:00", "sinemet", "25/100", 0.5, 50)), "½ × 25/100");
  assert.equal(amountLabel(dose("a", "06:00", "sinemet", null, null, 150)), "150 mg");
  assert.equal(amountLabel(dose("a", "06:00", "sinemet", null, null, 122.5)), "122.5 mg");
  assert.equal(amountLabel(dose("a", "06:00", "inbrija", "42", 2, 84)), "2 × 42 mg");
  assert.equal(amountLabel(dose("a", "06:00", "rytary", "61.25/245", 2, 490)), "2 × 61.25/245");
  assert.equal(amountLabel(dose("a", "06:00", "sinemet", null, null, null)), "");
  assert.equal(amountLabel(null), "");
});

test("largeDoseNote uses the SPEC 1.5 marks", () => {
  assert.equal(largeDoseNote("sinemet", 450), "That is a large single dose for Sinemet IR (over 400 mg). Check it.");
  assert.equal(largeDoseNote("sinemet", 400), null);
  assert.equal(largeDoseNote("sinemetcr", 800), "That is a large single dose for Sinemet CR (over 600 mg). Check it.");
  assert.equal(largeDoseNote("sinemetcr", 600), null);
  assert.equal(largeDoseNote("rytary", 980), null);
  assert.equal(largeDoseNote("rytary", 1225), "That is a large single dose for Rytary (over 980 mg). Check it.");
  assert.equal(largeDoseNote("crexont", 700), null);
  assert.equal(largeDoseNote("crexont", 840), "That is a large single dose for Crexont (over 700 mg). Check it.");
  assert.equal(largeDoseNote("inbrija", 84), null);
  assert.equal(largeDoseNote("inbrija", 100), "That is a large single dose for Inbrija (over 84 mg). Check it.");
  assert.equal(largeDoseNote("sinemet", 5000), "That is a large single dose for Sinemet IR (over 400 mg). Check it.");
  assert.equal(largeDoseNote("sinemet", null), null);
  assert.equal(largeDoseNote("sinemet", 0), null);
  assert.equal(largeDoseNote("nope", 5000), null);
  // A count over 4 with the mg over the mark gets the mg message.
  assert.equal(largeDoseNote("sinemet", doseMg("sinemet", "25/100", 4.5)), "That is a large single dose for Sinemet IR (over 400 mg). Check it.");
});

test("largeDoseNote has only the SPEC 5.3 wording, and it is always true (regression: no count variant)", () => {
  // A third count argument used to give an unapproved "(over 4 capsules)" note.
  assert.equal(largeDoseNote("rytary", 475, 5), null);
  assert.equal(largeDoseNote("sinemetcr", 500, 5), null);
  assert.equal(largeDoseNote("crexont", 700, 5), null);
  assert.equal(largeDoseNote("sinemet", 500, 5), "That is a large single dose for Sinemet IR (over 400 mg). Check it.");
  assert.equal(largeDoseNote.length, 2);
  // Every note any strength × count can produce names the mark, and the mg is over it.
  const template = /^That is a large single dose for (Sinemet IR|Sinemet CR|Rytary|Crexont|Inbrija) \(over ([\d,]+) mg\)\. Check it\.$/;
  for (const drug of DRUGS) {
    for (const strength of drug.strengths) {
      for (let count = 0.5; count <= drug.maxCount; count += 0.5) {
        const mg = strength.levodopa * count;
        const note = largeDoseNote(drug, mg, count);
        if (mg <= drug.largeDoseMg) {
          assert.equal(note, null, `${drug.id} ${strength.id} × ${count}`);
          continue;
        }
        const match = template.exec(note);
        assert.ok(match, note);
        assert.equal(match[1], drug.shortName);
        assert.equal(Number(match[2].replace(/,/g, "")), drug.largeDoseMg);
      }
    }
  }
});

test("medicineChange follows SPEC 3.5 with the exact notes", () => {
  // mg mode keeps the mg.
  assert.deepEqual(medicineChange({ fromDrug: "sinemet", toDrug: "rytary", mode: "mg", intendedMg: 490 }), {
    strength: null, count: null, dose: 490, mode: "mg", note: null
  });
  assert.deepEqual(medicineChange({ fromDrug: "sinemet", toDrug: "rytary", mode: "mg", intendedMg: null }), {
    strength: null, count: null, dose: null, mode: "mg", note: null
  });
  // Exact match with a factor change.
  assert.deepEqual(medicineChange({ fromDrug: "sinemet", toDrug: "sinemetcr", mode: "strength", intendedMg: 200 }), {
    strength: "50/200",
    count: 1,
    dose: 200,
    mode: "strength",
    note: "Same 200 mg levodopa, now 1 × 50/200 tablet. Sinemet CR counts ×0.75, so LEDD goes from 200 to 150 mg. Products are not mg-for-mg equivalent."
  });
  // No match: the default amount.
  assert.deepEqual(medicineChange({ fromDrug: "sinemet", toDrug: "rytary", mode: "strength", intendedMg: 100 }), {
    strength: "61.25/245",
    count: 1,
    dose: 245,
    mode: "strength",
    note: "Amount set to 1 × 61.25/245 capsule (245 mg), the usual starting amount for Rytary. Check it."
  });
  assert.equal(
    medicineChange({ fromDrug: "sinemet", toDrug: "inbrija", mode: "strength", intendedMg: 100 }).note,
    "Amount set to 2 × 42 mg capsules (84 mg), the usual starting amount for Inbrija. Check it."
  );
  // Crexont says "assumed" where its factor is shown.
  assert.equal(
    medicineChange({ fromDrug: "sinemet", toDrug: "crexont", mode: "strength", intendedMg: 420 }).note,
    "Same 420 mg levodopa, now 2 × 52.5/210 capsules. Crexont counts ×0.5 (assumed), so LEDD goes from 420 to 210 mg. Products are not mg-for-mg equivalent."
  );
  // Halves in the note.
  assert.equal(
    medicineChange({ fromDrug: "rytary", toDrug: "sinemet", mode: "strength", intendedMg: 150 }).note,
    "Same 150 mg levodopa, now 1½ × 25/100 tablets. Sinemet IR counts ×1, so LEDD goes from 75 to 150 mg. Products are not mg-for-mg equivalent."
  );
  // Same factor (Rytary and Crexont are both ×0.5): no note.
  const sameFactor = medicineChange({ fromDrug: "crexont", toDrug: "rytary", mode: "strength", intendedMg: 490 });
  assert.deepEqual(sameFactor, { strength: "61.25/245", count: 2, dose: 490, mode: "strength", note: null });
  // Same drug: no note.
  assert.equal(medicineChange({ fromDrug: "sinemet", toDrug: "sinemet", mode: "strength", intendedMg: 150 }).note, null);
  // No previous drug (a fresh row): no note on a match.
  assert.equal(medicineChange({ toDrug: "sinemetcr", mode: "strength", intendedMg: 200 }).note, null);
  // Accepts drug objects too.
  assert.equal(medicineChange({ fromDrug: DRUG_BY_ID.sinemet, toDrug: DRUG_BY_ID.sinemetcr, intendedMg: 200 }).count, 1);
  assert.throws(() => medicineChange({ fromDrug: "sinemet", toDrug: "nope", mode: "strength", intendedMg: 100 }), TypeError);
});

test("arrowing IR → CR → Rytary → IR returns to the original amount (SPEC 11)", () => {
  const intendedMg = 100;
  let current = { drug: "sinemet", strength: "25/100", count: 1, dose: 100 };
  const steps = [];
  for (const toDrug of ["sinemetcr", "rytary", "sinemet"]) {
    const next = medicineChange({ fromDrug: current.drug, toDrug, mode: "strength", intendedMg, currentMg: current.dose });
    steps.push(next);
    current = { drug: toDrug, ...next };
  }
  assert.deepEqual(steps.map(step => [step.strength, step.count, step.dose]), [
    ["25/100", 1, 100], ["61.25/245", 1, 245], ["25/100", 1, 100]
  ]);
  assert.equal(steps[0].note, "Same 100 mg levodopa, now 1 × 25/100 tablet. Sinemet CR counts ×0.75, so LEDD goes from 100 to 75 mg. Products are not mg-for-mg equivalent.");
  assert.equal(steps[1].note, "Amount set to 1 × 61.25/245 capsule (245 mg), the usual starting amount for Rytary. Check it.");
  // The SPEC 3.5 note, worked from the intended amount (regression: the
  // unapproved "Back to …" variant, which an extra currentMg used to trigger, is gone).
  assert.equal(steps[2].note, "Same 100 mg levodopa, now 1 × 25/100 tablet. Sinemet IR counts ×1, so LEDD goes from 50 to 100 mg. Products are not mg-for-mg equivalent.");
  const plain = medicineChange({ fromDrug: "rytary", toDrug: "sinemet", mode: "strength", intendedMg });
  assert.deepEqual(plain, { strength: "25/100", count: 1, dose: 100, mode: "strength", note: steps[2].note });
});

test("Inbrija never goes into mg mode and stays within 2 capsules (regression; SPEC 3.3, owner request 5)", () => {
  const sameNote = "Same 84 mg levodopa, now 2 × 42 mg capsules. Inbrija counts ×0.69, so LEDD goes from 84 to 58 mg. Products are not mg-for-mg equivalent.";
  const setNote = "Amount set to 2 × 42 mg capsules (84 mg), the usual starting amount for Inbrija. Check it.";
  // mg mode with an exact capsule amount switches to capsules.
  assert.deepEqual(medicineChange({ fromDrug: "sinemet", toDrug: "inbrija", mode: "mg", intendedMg: 84 }), {
    strength: "42", count: 2, dose: 84, mode: "strength", note: sameNote
  });
  assert.deepEqual(medicineChange({ fromDrug: "rytary", toDrug: "inbrija", mode: "mg", intendedMg: 42 }), {
    strength: "42",
    count: 1,
    dose: 42,
    mode: "strength",
    note: "Same 42 mg levodopa, now 1 × 42 mg capsule. Inbrija counts ×0.69, so LEDD goes from 21 to 29 mg. Products are not mg-for-mg equivalent."
  });
  // Anything else gets the default 2 × 42 with the "Amount set to…" note.
  for (const intendedMg of [490, 126, 100, 1.5, null]) {
    assert.deepEqual(medicineChange({ fromDrug: "sinemet", toDrug: "inbrija", mode: "mg", intendedMg }), {
      strength: "42", count: 2, dose: 84, mode: "strength", note: setNote
    }, String(intendedMg));
  }
  // Every way into Inbrija ends as a valid capsule count.
  for (const fromDrug of DRUG_ORDER) {
    for (const mode of ["strength", "mg"]) {
      for (const intendedMg of [null, 42, 84, 100, 126, 490, 2000]) {
        const result = medicineChange({ fromDrug, toDrug: "inbrija", mode, intendedMg });
        assert.equal(result.mode, "strength");
        assert.equal(validateCount("inbrija", result.strength, result.count), null);
        assert.equal(result.dose, doseMg("inbrija", result.strength, result.count));
      }
    }
  }
  // Other medicines still keep the mg in mg mode (SPEC 3.5 rule 1).
  assert.equal(medicineChange({ fromDrug: "inbrija", toDrug: "rytary", mode: "mg", intendedMg: 126 }).dose, 126);
  assert.equal(medicineChange({ fromDrug: "inbrija", toDrug: "rytary", mode: "mg", intendedMg: 126 }).mode, "mg");
});

test("a round trip through Inbrija keeps the intended amount (SPEC 3.5)", () => {
  const trip = (drug, mode, intendedMg, via = "inbrija") => {
    const out = medicineChange({ fromDrug: drug, toDrug: via, mode, intendedMg });
    const back = medicineChange({ fromDrug: via, toDrug: drug, mode: out.mode, intendedMg });
    return { out, back };
  };
  // mg mode with an amount no product matches comes back to mg mode, same mg, no note.
  assert.deepEqual(trip("sinemet", "mg", 122).back, { strength: null, count: null, dose: 122, mode: "mg", note: null });
  assert.deepEqual(trip("crexont", "mg", 300).back, { strength: null, count: null, dose: 300, mode: "mg", note: null });
  // A blank mg comes back blank rather than as a default amount.
  assert.deepEqual(trip("sinemet", "mg", null).back, { strength: null, count: null, dose: null, mode: "mg", note: null });
  // An amount a strength matches comes back as that strength × count.
  const matched = trip("sinemet", "mg", 150).back;
  assert.deepEqual([matched.strength, matched.count, matched.dose, matched.mode], ["25/100", 1.5, 150, "strength"]);
  const rytary = trip("rytary", "strength", 490).back;
  assert.deepEqual([rytary.strength, rytary.count, rytary.dose, rytary.mode], ["61.25/245", 2, 490, "strength"]);
  // A real Inbrija amount leaving Inbrija follows rules 2 and 3 unchanged.
  assert.deepEqual(medicineChange({ fromDrug: "inbrija", toDrug: "rytary", mode: "strength", intendedMg: 84 }), {
    strength: "61.25/245",
    count: 1,
    dose: 245,
    mode: "strength",
    note: "Amount set to 1 × 61.25/245 capsule (245 mg), the usual starting amount for Rytary. Check it."
  });
  // Leaving Inbrija for a medicine with no exact match keeps the intended mg
  // in mg mode rather than setting that medicine's default.
  assert.deepEqual(medicineChange({ fromDrug: "inbrija", toDrug: "sinemet", mode: "strength", intendedMg: 420 }), {
    strength: null, count: null, dose: 420, mode: "mg", note: null
  });
  // Arrowing through every medicine in radio order (Inbrija included) and back
  // to the start gives back the starting amount.
  const cycles = [
    ["sinemet", "mg", 122, "mg"],
    ["sinemet", "strength", 100, "strength"],
    ["rytary", "strength", 490, "mg"],
    ["crexont", "strength", 420, "mg"]
  ];
  for (const [start, mode, intendedMg, endMode] of cycles) {
    let current = { drug: start, mode };
    const order = [...DRUG_ORDER.slice(DRUG_ORDER.indexOf(start) + 1), ...DRUG_ORDER.slice(0, DRUG_ORDER.indexOf(start) + 1)];
    for (const toDrug of order) {
      const next = medicineChange({ fromDrug: current.drug, toDrug, mode: current.mode, intendedMg });
      current = { drug: toDrug, mode: next.mode, dose: next.dose };
    }
    assert.deepEqual([current.drug, current.dose, current.mode], [start, intendedMg, endMode], `${start} ${mode} ${intendedMg}`);
  }
});

test("every medicine-change note matches a SPEC 5.3 template (regression: no unapproved copy)", () => {
  const names = "(Sinemet IR|Sinemet CR|Rytary|Crexont|Inbrija)";
  const amount = "(½|\\d+½?) × (\\S+(?: mg)?) (tablet|tablets|capsule|capsules)";
  const same = new RegExp(`^Same ([\\d,.]+) mg levodopa, now ${amount}\\. ${names} counts ×[\\d.]+( \\(assumed\\))?, `
    + "so LEDD goes from [\\d,.]+ to [\\d,.]+ mg\\. Products are not mg-for-mg equivalent\\.$");
  const set = new RegExp(`^Amount set to ${amount} \\(([\\d,.]+) mg\\), the usual starting amount for ${names}\\. Check it\\.$`);
  let notes = 0;
  for (const fromDrug of [null, ...DRUG_ORDER]) {
    for (const toDrug of DRUG_ORDER) {
      for (const mode of ["strength", "mg"]) {
        for (const intendedMg of [null, 42, 50, 84, 95, 100, 122.5, 140, 150, 200, 245, 250, 420, 490, 700, 2000]) {
          // An old extra argument must not change the wording.
          const result = medicineChange({ fromDrug, toDrug, mode, intendedMg, currentMg: 245 });
          if (result.note === null) continue;
          notes += 1;
          const match = same.exec(result.note) ?? set.exec(result.note);
          assert.ok(match, result.note);
          assert.ok(!result.note.includes("Back to"), result.note);
          if (result.note.startsWith("Same")) {
            assert.equal(match[1], String(intendedMg).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
            assert.equal(match[6] !== undefined, toDrug === "crexont");
          }
        }
      }
    }
  }
  assert.ok(notes > 100);
  assert.equal(medicineChange.length, 1);
});

test("nextDoseDefaults copies the source and repeats the gap (SPEC 3.6)", () => {
  // Empty: the first-dose defaults.
  assert.deepEqual(nextDoseDefaults([]), { time: "08:00", drug: "sinemet", strength: "25/100", count: 1, dose: 100 });
  assert.deepEqual(nextDoseDefaults(undefined).time, "08:00");
  // A single dose: no previous gap, so + 3 h.
  assert.deepEqual(nextDoseDefaults([dose("a", "08:00", "sinemet", "25/100", 1, 100)]),
    { time: "11:00", drug: "sinemet", strength: "25/100", count: 1, dose: 100 });
  // Add dose after five IR doses: latest 18:00 + the 3 h gap = 21:00.
  const five = testRegimen.slice(0, 5);
  assert.deepEqual(nextDoseDefaults(five), { time: "21:00", drug: "sinemet", strength: "25/100", count: 1.5, dose: 150 });
  // Add next dose from a given row uses that row's own gap.
  const uneven = [
    dose("a", "07:00", "sinemet", "25/100", 1, 100),
    dose("b", "11:00", "sinemetcr", "50/200", 1, 200),
    dose("c", "13:30", "sinemet", "25/100", 2, 200)
  ];
  assert.deepEqual(nextDoseDefaults(uneven, "b"), { time: "15:00", drug: "sinemetcr", strength: "50/200", count: 1, dose: 200 });
  assert.equal(nextDoseDefaults(uneven, "c").time, "16:00");
  assert.equal(nextDoseDefaults(uneven).time, "16:00");
  // The first dose of the day: the gap back to last night is over 6 h, so + 3 h.
  assert.equal(nextDoseDefaults(uneven, "a").time, "10:00");
  // Gaps under 60 or over 360 min fall back to 3 h.
  assert.equal(nextDoseDefaults([dose("a", "07:00", "sinemet", "25/100", 1, 100), dose("b", "07:30", "sinemet", "25/100", 1, 100)]).time, "10:30");
  assert.equal(nextDoseDefaults([dose("a", "07:00", "sinemet", "25/100", 1, 100), dose("b", "14:00", "sinemet", "25/100", 1, 100)]).time, "17:00");
  // Boundaries 60 and 360 are kept.
  assert.equal(nextDoseDefaults([dose("a", "07:00", "sinemet", "25/100", 1, 100), dose("b", "08:00", "sinemet", "25/100", 1, 100)]).time, "09:00");
  assert.equal(nextDoseDefaults([dose("a", "07:00", "sinemet", "25/100", 1, 100), dose("b", "13:00", "sinemet", "25/100", 1, 100)]).time, "19:00");
  // Wraps past midnight.
  assert.equal(nextDoseDefaults([dose("a", "19:00", "sinemet", "25/100", 1, 100), dose("b", "22:00", "sinemet", "25/100", 1, 100)]).time, "01:00");
  // The gap is measured to the previous dose time, across midnight too.
  assert.equal(nextDoseDefaults([dose("a", "22:00", "sinemet", "25/100", 1, 100), dose("b", "00:30", "sinemet", "25/100", 1, 100)], "b").time, "03:00");
  // Doses at the same time as the source don't count as the previous one.
  const together = [
    dose("a", "07:00", "sinemet", "25/100", 1, 100),
    dose("b", "10:00", "sinemet", "25/100", 1, 100),
    dose("c", "10:00", "sinemetcr", "50/200", 1, 200)
  ];
  assert.deepEqual(nextDoseDefaults(together), { time: "13:00", drug: "sinemetcr", strength: "50/200", count: 1, dose: 200 });
  // Order in the array doesn't matter for "latest by time".
  assert.equal(nextDoseDefaults([...five].reverse()).time, "21:00");
  // An mg-mode or missing-amount source is copied as is.
  assert.deepEqual(nextDoseDefaults([dose("a", "08:00", "rytary", null, null, null)]),
    { time: "11:00", drug: "rytary", strength: null, count: null, dose: null });
  // An unknown source id falls back to the latest dose.
  assert.equal(nextDoseDefaults(uneven, "zzz").time, "16:00");
});

test("dailyTotals counts only doses with an amount", () => {
  assert.deepEqual(dailyTotals(testRegimen), { mg: 1240, led: 995 });
  assert.deepEqual(dailyTotals([]), { mg: 0, led: 0 });
  assert.deepEqual(dailyTotals([
    dose("a", "08:00", "crexont", "52.5/210", 2, 420),
    dose("b", "12:00", "crexont", "52.5/210", 1, 210),
    dose("c", "16:00", "sinemet", null, null, null),
    dose("d", "18:00", "sinemet", null, null, 0),
    dose("e", "20:00", "nope", null, null, 100)
  ]), { mg: 630, led: 315 });
  const inbrija = dailyTotals([dose("a", "08:00", "inbrija", "42", 2, 84)]);
  assert.equal(inbrija.mg, 84);
  assert.ok(Math.abs(inbrija.led - 57.96) < 1e-9);
});
