// The one sentence added to the owner's "About the level" text, from the
// verified research (advanced-PD dose-normalized IR Cmax: Modi 2019 and the
// FDA clinical pharmacology reviews for NDA 203312 and 217186).
export const LEVEL_ANCHOR_SENTENCE = "In advanced PD, one 100 mg IR dose peaks at about 1,450 ng/mL on average, but people vary widely (about two in three fall between 800 and 2,100 ng/mL), so 1 unit is roughly 14.5 ng/mL (Modi 2019; FDA reviews of Rytary and Crexont).";

// Owner-approved toggletip wording. test/copy.test.js checks these strings
// against the approved text, so change them only with the owner's sign-off.
export const TIPS = {
  leddContribution: "How much this dose counts toward the day's levodopa-equivalent dose. It equals levodopa mg × the product's factor: IR ×1, Sinemet CR ×0.75, Rytary ×0.5, Crexont ×0.5 (assumed), Inbrija ×0.69 (Jost 2023). Use it to compare total dopaminergic load. It is not a dose-conversion tool.",
  totalLedd: "The cumulative sum of all rows LEDD. A research measure for comparing medication burden across patients and studies. It does not establish the right dose for a patient.",
  level: `Modeled plasma levodopa on a relative scale. 100 = the peak after one 100 mg IR dose taken on its own (for example, one Sinemet 25/100). Real levels vary a lot with meals, gastric emptying, age, and body weight. Disease stage changes the response to a level more than the level itself. ${LEVEL_ANCHOR_SENTENCE}`,
  target: "An optional line you set. Time at or above it counts as \"at or above target\". Tip: set it to the modeled level at the time this patient usually wears off. It is not a validated \"on\" threshold.",
  high: "An optional line above the target. Time at or above it counts as high exposure. Tip: set it to the modeled level at the time peak-dose dyskinesia usually starts. It is not a validated dyskinesia cutoff.",
  highest: "The highest modeled level of the day, and when it happens. Peak-dose effects such as dyskinesia are most likely around peaks.",
  lowest: "The lowest modeled level of the day, and when it happens. Wearing-off is most likely around troughs, often early morning before the first dose.",
  fluctuation: "(Peak − trough) ÷ the day's average level. It's a standard pharmacokinetic measure of how much levels swing. 0 would be perfectly steady, like a continuous infusion. Higher means bigger swings."
};

export const TIP_LABELS = {
  leddContribution: "About LEDD contribution",
  totalLedd: "About total LEDD",
  level: "About the level",
  target: "About the target line",
  high: "About the high line",
  highest: "About highest",
  lowest: "About lowest",
  fluctuation: "About the fluctuation index"
};
