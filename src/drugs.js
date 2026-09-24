export const MODEL_VERSION = "3.0.0";
export const REGIMEN_SCHEMA_VERSION = 2;
export const MINUTES_PER_DAY = 1440;
export const LN2 = Math.log(2);
export const LD_AUC = 60 / 2 + 81 / LN2;

const JOST_2023 = "https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mds.29410";

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
    peaksText: "Peaks about 1 h after a dose", halfText: "half gone about 1½ h later",
    isLevodopa: true, led: factor(1), exposure: components(1, [{ fraction: 1, weight: 1, peakTime: 60, halfLife: 81 }]),
    model: "Tmax 60 min · T½ 81 min", evidence: "Referenced", source: "Kuoppamäki 2009; Turner"
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
    peaksText: "Peaks about 2 h after a dose", halfText: "half gone about 2½ h later",
    isLevodopa: true, led: factor(0.75), exposure: components(0.75, [{ fraction: 1, weight: 1, peakTime: 120, halfLife: 137 }]),
    model: "Tmax 120 min · T½ 137 min · area normalized to LED ×0.75", evidence: "Consensus conversion",
    source: "Jost 2023", sourceUrl: JOST_2023
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
    peaksText: "Rises within about 1 h and peaks about 4½ h after a dose", halfText: "half gone about 2½ h later",
    isLevodopa: true, led: factor(0.5), exposure: components(0.5, [
      { fraction: 0.25, weight: 0.5, peakTime: 60, halfLife: 81 },
      { fraction: 0.75, weight: 0.209, peakTime: 270, halfLife: 150 }
    ]),
    model: "IR 25% + ER 75% · area normalized to LED ×0.5", evidence: "Estimated shape; consensus conversion",
    source: "Rytary PI; Jost 2023", sourceUrl: JOST_2023
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
    peaksText: "Peaks about 1 h after a dose", halfText: "half gone about 5 h later",
    isLevodopa: true, led: factor(0.5), exposure: components(0.5, [
      { fraction: 0.3, weight: 0.6, peakTime: 60, halfLife: 81 },
      { fraction: 0.7, weight: 0.164, peakTime: 300, halfLife: 180 }
    ]),
    model: "IR 30% + ER 70% · area normalized to assumed LED ×0.5", evidence: "Estimated",
    source: "Crexont PI / RISE-PD; Rytary conversion used as an explicit assumption"
  },
  {
    id: "inbrija", group: "Levodopa preparations", name: "Inbrija — levodopa inhalation powder", defaultDose: 84,
    shortName: "Inbrija", generic: "inhaled levodopa powder", unit: ["capsule", "capsules"],
    style: { color: "#5E3C99", dash: "2 3" }, ledAssumed: false, largeDoseMg: 84,
    strengths: [
      { id: "42", label: "42 mg", levodopa: 42, halves: false }
    ],
    defaultStrength: "42", defaultCount: 2, maxCount: 2,
    peaksText: "Peaks about 30 min after inhaling", halfText: "half gone about 2½ h later",
    isLevodopa: true, led: factor(0.69), exposure: components(0.69, [{ fraction: 1, weight: 1, peakTime: 30, halfLife: 138 }]),
    model: "Tmax 30 min · T½ 138 min · area normalized to LED ×0.69", evidence: "Estimated shape; consensus conversion",
    source: "Inbrija PI; Jost 2023", sourceUrl: JOST_2023
  }
];

export const DRUG_ORDER = ["sinemet", "sinemetcr", "rytary", "crexont", "inbrija"];

export const DRUG_BY_ID = Object.assign(Object.create(null), Object.fromEntries(DRUGS.map(drug => [drug.id, drug])));

export const PALETTE = [
  "#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00",
  "#56B4E9", "#8C510A", "#5E3C99", "#117733", "#882255"
];
