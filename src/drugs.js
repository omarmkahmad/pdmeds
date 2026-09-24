export const MODEL_VERSION = "4.0.0";
export const REGIMEN_SCHEMA_VERSION = 2;
export const MINUTES_PER_DAY = 1440;
export const LN2 = Math.log(2);
export const LD_AUC = 60 / 2 + 81 / LN2;

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
  fdaInbrija: { label: "FDA review, NDA 209184", url: "https://www.accessdata.fda.gov/drugsatfda_docs/nda/2018/209184Orig1s000ClinPharmR.pdf" }
};

const factor = value => ({ kind: "factor", value });
const components = (exposureFactor, values) => ({ kind: "components", exposureFactor, values });

export const DRUGS = [
  {
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
    model: "25% immediate-release granules (peak 60 min, half-life 81 min) and 75% extended-release beads (peak 170 min, half-life 180 min), the label's split. Curve area 0.88 of the same mg of IR (label). Fitted to single doses in advanced PD: about 4.7 h above half its peak, with a peak per mg about 0.37 of IR.",
    sources: [SOURCES.modi2019, SOURCES.crexontLabel, SOURCES.lewitt2023, SOURCES.fdaCrexont, SOURCES.jost2023]
  },
  {
    id: "inbrija", group: "Levodopa preparations", name: "Inbrija — levodopa inhalation powder", defaultDose: 84,
    shortName: "Inbrija", generic: "inhaled levodopa powder", unit: ["capsule", "capsules"],
    style: { color: "#5E3C99", dash: "2 3" }, ledAssumed: false, largeDoseMg: 84,
    strengths: [
      { id: "42", label: "42 mg", levodopa: 42, halves: false }
    ],
    defaultStrength: "42", defaultCount: 2, maxCount: 2,
    peaksText: "Peaks about 30 min after inhaling", halfText: "stays above half its peak for about 2 h",
    isLevodopa: true, led: factor(0.69), exposure: components(0.69, [{ fraction: 1, peakTime: 30, halfLife: 115 }]),
    model: "Rise to a peak at 30 min, then half-life 115 min. Curve area 0.69 of the same mg of oral IR (label, per capsule mg).",
    sources: [SOURCES.inbrijaLabel, SOURCES.fdaInbrija, SOURCES.jost2023]
  }
];

export const DRUG_ORDER = ["sinemet", "sinemetcr", "rytary", "crexont", "inbrija"];

export const DRUG_BY_ID = Object.assign(Object.create(null), Object.fromEntries(DRUGS.map(drug => [drug.id, drug])));
