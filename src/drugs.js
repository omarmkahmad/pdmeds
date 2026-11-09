export const MODEL_VERSION = "4.1.0";
export const REGIMEN_SCHEMA_VERSION = 2;
export const MINUTES_PER_DAY = 1440;
export const LN2 = Math.log(2);
export const LD_AUC = 60 / 2 + 81 / LN2;

// Amantadine is drawn on its own chart in typical ng/mL, not on the levodopa
// scale. This is the steady-state area under the curve per mg of amantadine
// hydrochloride, in ng·min/mL: 57.66 ng·h/mL per mg in healthy adults (FDA
// review of NDA 208944, study PK-111, 100 mg twice daily), times 1.6 for the
// lower clearance of the PD patients in the Gocovri trials (Hauser 2019).
export const AMANTADINE_AUC = 57.66 * 1.6 * 60;
// Gocovri capsules are labeled in mg of amantadine. One 137 mg capsule holds
// 170 mg of amantadine hydrochloride, the salt that immediate-release
// products and the LEDD factor are counted in.
export const GOCOVRI_HCL_PER_MG = 170 / 137;

// Sources for the curve fits and conversion factors. The single-dose
// targets behind each fit are summarized in README.md ("Model evidence").
const SOURCES = {
  jost2023: { label: "Jost 2023 (LEDD factors)", url: "https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mds.29410" },
  modi2019: { label: "Modi 2019", url: "https://doi.org/10.1097/WNF.0000000000000314" },
  hsu2015: { label: "Hsu 2015", url: "https://doi.org/10.1002/jcph.514" },
  kuoppamaki2009: { label: "Kuoppamäki 2009", url: "https://doi.org/10.1007/s00228-009-0622-y" },
  lewitt2023: { label: "LeWitt 2023", url: "https://doi.org/10.1016/j.prdoa.2023.100197" },
  sinemetLabel: { label: "Sinemet label", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/017555s076lbl.pdf" },
  sinemetCrLabel: { label: "Sinemet CR label", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/019856s029lbl.pdf" },
  rytaryLabel: { label: "Rytary label", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/203312s026lbl.pdf" },
  crexontLabel: { label: "Crexont label", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/217186s008lbl.pdf" },
  inbrijaLabel: { label: "Inbrija label", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/209184s013.pdf" },
  fdaRytary: { label: "FDA review, NDA 203312", url: "https://www.accessdata.fda.gov/drugsatfda_docs/nda/2015/203312Orig1s000ClinPharmR.pdf" },
  fdaCrexont: { label: "FDA review, NDA 217186", url: "https://www.accessdata.fda.gov/drugsatfda_docs/nda/2025/217186Orig1s000ClinPharmR.pdf" },
  fdaInbrija: { label: "FDA review, NDA 209184", url: "https://www.accessdata.fda.gov/drugsatfda_docs/nda/2018/209184Orig1s000ClinPharmR.pdf" },
  hauser2019: { label: "Hauser 2019", url: "https://doi.org/10.1007/s40262-018-0663-4" },
  amantadineLabel: { label: "Amantadine (Symmetrel) label", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2008/016023s040,018101s015lbl.pdf" },
  gocovriLabel: { label: "Gocovri label", url: "https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/208944s009lbl.pdf" },
  fdaGocovri: { label: "FDA review, NDA 208944", url: "https://www.accessdata.fda.gov/drugsatfda_docs/nda/2017/208944Orig1s000SumR.pdf" }
};

const factor = value => ({ kind: "factor", value });
const components = (exposureFactor, values) => ({ kind: "components", exposureFactor, values });

// Fields shared by every levodopa preparation. `analyte` picks the chart a
// dose is drawn on. `doseBasis` says what the mg count: an amount carries
// over to another medicine only when both count the same thing.
const LEVODOPA = { analyte: "levodopa", doseBasis: "levodopa", mgName: "levodopa", mgMode: true };

// The five levodopa preparations. Amantadine is listed separately below.
export const DRUGS = [
  {
    ...LEVODOPA,
    id: "sinemet", group: "Levodopa preparations", name: "Sinemet — levodopa/carbidopa IR", defaultDose: 100,
    shortName: "Sinemet IR", generic: "carbidopa/levodopa, immediate release", unit: ["tablet", "tablets"],
    style: { color: "#0072B2", dash: "" }, ledAssumed: false, largeDoseMg: 400,
    strengths: [
      { id: "10/100", label: "10/100", levodopa: 100, halves: true },
      { id: "25/100", label: "25/100", levodopa: 100, halves: true },
      { id: "25/250", label: "25/250", levodopa: 250, halves: true }
    ],
    defaultStrength: "25/100", defaultCount: 1, maxCount: 8,
    peaksText: "Peaks about 1 h after a dose", halfText: "stays above half its peak for about 2 h",
    isLevodopa: true, led: factor(1), exposure: components(1, [{ fraction: 1, peakTime: 60, halfLife: 81 }]),
    model: "Rise to a peak at 60 min, then half-life 81 min. The reference curve: 100 mg peaks at 100.",
    sources: [SOURCES.kuoppamaki2009, SOURCES.modi2019, SOURCES.sinemetLabel, SOURCES.jost2023]
  },
  {
    ...LEVODOPA,
    id: "sinemetcr", group: "Levodopa preparations", name: "Sinemet CR — levodopa/carbidopa CR", defaultDose: 100,
    shortName: "Sinemet CR", generic: "carbidopa/levodopa, controlled release", unit: ["tablet", "tablets"],
    style: { color: "#B35900", dash: "9 4" }, ledAssumed: false, largeDoseMg: 600,
    strengths: [
      { id: "25/100", label: "25/100", levodopa: 100, halves: false },
      { id: "50/200", label: "50/200", levodopa: 200, halves: true }
    ],
    defaultStrength: "50/200", defaultCount: 1, maxCount: 8,
    peaksText: "Peaks about 2 h after a dose", halfText: "stays above half its peak for about 3¼ h",
    isLevodopa: true, led: factor(0.75), exposure: components(0.85, [{ fraction: 1, peakTime: 120, halfLife: 137 }]),
    model: "Rise to a peak at 120 min, then apparent half-life 137 min. Curve area 0.85 of the same mg of IR (published values range from 0.70 to 1.07).",
    sources: [SOURCES.sinemetCrLabel, SOURCES.hsu2015, SOURCES.fdaCrexont, SOURCES.jost2023]
  },
  {
    ...LEVODOPA,
    id: "rytary", group: "Levodopa preparations", name: "Rytary — carbidopa/levodopa ER capsules", defaultDose: 245,
    shortName: "Rytary", generic: "carbidopa/levodopa, extended-release capsules", unit: ["capsule", "capsules"],
    style: { color: "#117733", dash: "4 3" }, ledAssumed: false, largeDoseMg: 980,
    strengths: [
      { id: "23.75/95", label: "23.75/95", levodopa: 95, halves: false },
      { id: "36.25/145", label: "36.25/145", levodopa: 145, halves: false },
      { id: "48.75/195", label: "48.75/195", levodopa: 195, halves: false },
      { id: "61.25/245", label: "61.25/245", levodopa: 245, halves: false }
    ],
    defaultStrength: "61.25/245", defaultCount: 1, maxCount: 8,
    peaksText: "Rises within 1 h and peaks about 2½ h after a dose", halfText: "stays above half its peak for about 4 h",
    isLevodopa: true, led: factor(0.5), exposure: components(0.7, [
      { fraction: 0.27, peakTime: 60, halfLife: 81 },
      { fraction: 0.73, peakTime: 140, halfLife: 160 }
    ]),
    model: "27% arrives like IR (peak 60 min, half-life 81 min) and 73% more slowly (peak 140 min, half-life 160 min). Curve area 0.70 of the same mg of IR (label). Fitted to single doses in advanced PD: about 3.9 h above half its peak, with a peak per mg about 0.35 of IR.",
    sources: [SOURCES.modi2019, SOURCES.rytaryLabel, SOURCES.fdaRytary, SOURCES.jost2023]
  },
  {
    ...LEVODOPA,
    id: "crexont", group: "Levodopa preparations", name: "Crexont — carbidopa/levodopa ER (IPX-203)", defaultDose: 140,
    shortName: "Crexont", generic: "carbidopa/levodopa, extended-release capsules (IPX203)", unit: ["capsule", "capsules"],
    style: { color: "#882255", dash: "12 3 3 3" }, ledAssumed: true, largeDoseMg: 700,
    strengths: [
      { id: "35/140", label: "35/140", levodopa: 140, halves: false },
      { id: "52.5/210", label: "52.5/210", levodopa: 210, halves: false },
      { id: "70/280", label: "70/280", levodopa: 280, halves: false },
      { id: "87.5/350", label: "87.5/350", levodopa: 350, halves: false }
    ],
    defaultStrength: "35/140", defaultCount: 1, maxCount: 8,
    peaksText: "Rises within 1 h and peaks about 3 h after a dose", halfText: "stays above half its peak for about 4¾ h",
    isLevodopa: true, led: factor(0.5), exposure: components(0.88, [
      { fraction: 0.25, peakTime: 60, halfLife: 81 },
      { fraction: 0.75, peakTime: 170, halfLife: 180 }
    ]),
    model: "25% immediate-release granules (peak 60 min, half-life 81 min) and 75% extended-release beads (peak 170 min, half-life 180 min), the split reported by LeWitt 2023. Curve area 0.88 of the same mg of IR (the low end of the label's 88–99%). Fitted to single doses in advanced PD: about 4.7 h above half its peak, with a peak per mg about 0.37 of IR.",
    sources: [SOURCES.modi2019, SOURCES.crexontLabel, SOURCES.lewitt2023, SOURCES.fdaCrexont, SOURCES.jost2023]
  },
  {
    ...LEVODOPA,
    // One strength and at most 2 capsules, so no "Other amount (mg)".
    mgMode: false,
    editorNote: "Inbrija is only for OFF episodes, taken as needed on top of carbidopa/levodopa. Each dose is 2 capsules (84 mg), up to 5 times a day.",
    id: "inbrija", group: "Levodopa preparations", name: "Inbrija — levodopa inhalation powder", defaultDose: 84,
    shortName: "Inbrija", generic: "inhaled levodopa powder", unit: ["capsule", "capsules"],
    style: { color: "#5E3C99", dash: "2 3" }, ledAssumed: false, largeDoseMg: 84,
    strengths: [
      { id: "42", label: "42 mg", levodopa: 42, halves: false }
    ],
    defaultStrength: "42", defaultCount: 2, maxCount: 2,
    peaksText: "Peaks about 30 min after inhaling", halfText: "stays above half its peak for about 2 h",
    isLevodopa: true, led: factor(0.69), exposure: components(0.69, [{ fraction: 1, peakTime: 30, halfLife: 115 }]),
    model: "Rise to a peak at 30 min, then half-life 115 min. Curve area 0.69 of the same mg of oral IR (label and FDA review; healthy volunteers, per capsule mg).",
    sources: [SOURCES.inbrijaLabel, SOURCES.fdaInbrija, SOURCES.jost2023]
  }
];

export const DRUG_ORDER = ["sinemet", "sinemetcr", "rytary", "crexont", "inbrija"];

// Amantadine products. They are not levodopa: their doses never add to the
// levodopa level. They get their own chart, in typical ng/mL, on the same
// clock, and they count toward LEDD with the Jost 2023 factors.
export const AMANTADINE_DRUGS = [
  {
    analyte: "amantadine", doseBasis: "amantadine-hcl", mgName: "amantadine HCl", mgMode: true,
    editorNote: "The label's usual dose for Parkinson's is 100 mg twice a day. Its mg are amantadine hydrochloride (HCl). For syrup (50 mg per 5 mL), choose Other amount (mg).",
    mgHint: "The mg of amantadine hydrochloride, e.g. 50 for 5 mL of syrup.",
    id: "amantadine", group: "Amantadine", name: "Amantadine — immediate release", defaultDose: 100,
    shortName: "Amantadine IR", generic: "amantadine hydrochloride, immediate release (capsules, tablets or syrup)",
    unit: ["capsule or tablet", "capsules or tablets"],
    style: { color: "#3D3DDB", dash: "6 2" }, ledAssumed: false, largeDoseMg: 200,
    strengths: [
      { id: "100", label: "100 mg", amantadine: 100, halves: false }
    ],
    defaultStrength: "100", defaultCount: 1, maxCount: 4,
    peaksText: "Peaks about 3 h after a dose", halfText: "stays above half its peak for about 17½ h",
    isLevodopa: false, led: factor(1),
    exposure: { ...components(1, [{ fraction: 1, peakTime: 180, halfLife: 960 }]), unitAuc: AMANTADINE_AUC },
    model: "Rise to a peak at 3 h, then half-life 16 h (label: peak at 2–4 h, half-life 16–17 h). Levels are typical ng/mL for a PD patient: the steady-state curve area in healthy adults (57.7 ng·h/mL per mg, FDA review) times 1.6 for the lower kidney clearance of PD patients (Hauser 2019). Check: 100 mg at 08:00 and 16:00 peaks at about 990 ng/mL and averages about 740 from 06:00 to 18:00 (published simulation: 967 and 751).",
    sources: [SOURCES.amantadineLabel, SOURCES.hauser2019, SOURCES.fdaGocovri, SOURCES.jost2023]
  },
  {
    analyte: "amantadine", doseBasis: "amantadine", mgName: "amantadine", mgMode: true,
    editorNote: "Gocovri is taken once a day at bedtime: 137 mg for the first week, then 274 mg (two 137 mg capsules). Its mg are amantadine: 137 mg is 170 mg of amantadine hydrochloride (HCl). It cannot be swapped mg-for-mg with other amantadine products.",
    mgHint: "The mg on the capsule label, e.g. 68.5 or 137.",
    id: "gocovri", group: "Amantadine", name: "Gocovri — amantadine ER capsules (ADS-5102)", defaultDose: 274,
    shortName: "Gocovri", generic: "amantadine, extended-release capsules (ADS-5102)", unit: ["capsule", "capsules"],
    style: { color: "#D12C6A", dash: "10 3" }, ledAssumed: false, largeDoseMg: 274,
    strengths: [
      { id: "68.5", label: "68.5 mg", amantadine: 68.5, halves: false },
      { id: "137", label: "137 mg", amantadine: 137, halves: false }
    ],
    defaultStrength: "137", defaultCount: 2, maxCount: 4,
    peaksText: "Starts to rise about 3 h after a dose and peaks about 13 h after it", halfText: "stays above half its peak for about 23 h",
    isLevodopa: false, led: { ...factor(1.25), basis: GOCOVRI_HCL_PER_MG, basisName: "HCl" },
    exposure: {
      ...components(GOCOVRI_HCL_PER_MG, [
        { fraction: 0.55, lag: 180, peakTime: 480, halfLife: 960 },
        { fraction: 0.45, lag: 180, peakTime: 780, halfLife: 960 }
      ]),
      unitAuc: AMANTADINE_AUC
    },
    model: "No rise for the first 3 h, then two overlapping parts that peak 8 h (55%) and 13 h (45%) after the dose, each with half-life 16 h (label). Fitted to the steady-state shape: lowest in the first 3 h after a dose, highest about 8 h after it (Hauser 2019). Same curve area per mg of amantadine hydrochloride as immediate release (FDA review: 58.5 vs 57.7 ng·h/mL per mg at steady state). Check: 274 mg at 22:00 peaks at about 1,640 ng/mL and averages about 1,490 from 06:00 to 18:00 (published simulation: 1,690 and 1,536; measured in PD patients: about 1,500).",
    sources: [SOURCES.hauser2019, SOURCES.gocovriLabel, SOURCES.fdaGocovri, SOURCES.jost2023]
  }
];

export const AMANTADINE_ORDER = ["amantadine", "gocovri"];

// Every medicine a dose can name, in the order the editor lists them.
export const MEDICINES = [...DRUGS, ...AMANTADINE_DRUGS];
export const MEDICINE_ORDER = [...DRUG_ORDER, ...AMANTADINE_ORDER];

export const DRUG_BY_ID = Object.assign(Object.create(null), Object.fromEntries(MEDICINES.map(drug => [drug.id, drug])));

export function analyteOf(drug) {
  return drug?.analyte ?? "levodopa";
}

// LEDD mg per labeled mg. Gocovri's factor applies to the hydrochloride mg
// (Jost 2023: 340 mg of amantadine hydrochloride a day counts as 425 mg), and
// its capsules are labeled in mg of amantadine, so the two multiply.
export function ledPerMg(drug) {
  return drug.led.value * (drug.led.basis ?? 1);
}
