import test from "node:test";
import assert from "node:assert/strict";

import { LEVEL_ANCHOR_SENTENCE, TIPS, TIP_LABELS } from "../src/copy.js";

// The owner approved this wording word for word. If a tip needs to change,
// update it here only with the owner's sign-off.
const APPROVED = {
  leddContribution: "How much this dose counts toward the day's levodopa-equivalent dose. It equals levodopa mg × the product's factor: IR ×1, Sinemet CR ×0.75, Rytary ×0.5, Crexont ×0.5 (assumed), Inbrija ×0.69 (Jost 2023). Use it to compare total dopaminergic load. It is not a dose-conversion tool.",
  totalLedd: "The cumulative sum of all rows LEDD. A research measure for comparing medication burden across patients and studies. It does not establish the right dose for a patient.",
  level: "Modeled plasma levodopa on a relative scale. 100 = the peak after one 100 mg IR dose taken on its own (for example, one Sinemet 25/100). Real levels vary a lot with meals, gastric emptying, and disease stage.",
  target: "An optional line you set. Time at or above it counts as \"at or above target\". Tip: set it to the modeled level at the time this patient usually wears off. It is not a validated \"on\" threshold.",
  high: "An optional line above the target. Time at or above it counts as high exposure. Tip: set it to the modeled level at the time peak-dose dyskinesia usually starts. It is not a validated dyskinesia cutoff.",
  highest: "The highest modeled level of the day, and when it happens. Peak-dose effects such as dyskinesia are most likely around peaks.",
  lowest: "The lowest modeled level of the day, and when it happens. Wearing-off is most likely around troughs, often early morning before the first dose.",
  fluctuation: "(Peak − trough) ÷ the day's average level. It's a standard pharmacokinetic measure of how much levels swing. 0 would be perfectly steady, like a continuous infusion. Higher means bigger swings."
};

test("toggletips use the owner-approved wording", () => {
  assert.deepEqual(Object.keys(TIPS).sort(), Object.keys(APPROVED).sort());
  for (const [key, text] of Object.entries(APPROVED)) {
    const expected = key === "level" ? `${text} ${LEVEL_ANCHOR_SENTENCE}` : text;
    assert.equal(TIPS[key], expected, key);
  }
});

test("every toggletip has an accessible button name", () => {
  for (const key of Object.keys(TIPS)) assert.match(TIP_LABELS[key], /^About /, key);
});
