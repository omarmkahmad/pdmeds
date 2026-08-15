export const MODEL_VERSION = "3.0.0";
export const REGIMEN_SCHEMA_VERSION = 1;
export const MINUTES_PER_DAY = 1440;
export const LN2 = Math.log(2);
export const LD_AUC = 60 / 2 + 81 / LN2;

const JOST_2023 = "https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mds.29410";

const factor = value => ({ kind: "factor", value });
const components = (exposureFactor, values) => ({ kind: "components", exposureFactor, values });

export const DRUGS = [
  {
    id: "sinemet", group: "Levodopa preparations", name: "Sinemet — levodopa/carbidopa IR", defaultDose: 100,
    isLevodopa: true, led: factor(1), exposure: components(1, [{ fraction: 1, weight: 1, peakTime: 60, halfLife: 81 }]),
    model: "Tmax 60 min · T½ 81 min", evidence: "Referenced", source: "Kuoppamäki 2009; Turner"
  },
  {
    id: "sinemetcr", group: "Levodopa preparations", name: "Sinemet CR — levodopa/carbidopa CR", defaultDose: 100,
    isLevodopa: true, led: factor(0.75), exposure: components(0.75, [{ fraction: 1, weight: 1, peakTime: 120, halfLife: 137 }]),
    model: "Tmax 120 min · T½ 137 min · area normalized to LED ×0.75", evidence: "Consensus conversion",
    source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "rytary", group: "Levodopa preparations", name: "Rytary — carbidopa/levodopa ER capsules", defaultDose: 245,
    isLevodopa: true, led: factor(0.5), exposure: components(0.5, [
      { fraction: 0.25, weight: 0.5, peakTime: 60, halfLife: 81 },
      { fraction: 0.75, weight: 0.209, peakTime: 270, halfLife: 150 }
    ]),
    model: "IR 25% + ER 75% · area normalized to LED ×0.5", evidence: "Estimated shape; consensus conversion",
    source: "Rytary PI; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "crexont", group: "Levodopa preparations", name: "Crexont — carbidopa/levodopa ER (IPX-203)", defaultDose: 140,
    isLevodopa: true, led: factor(0.5), exposure: components(0.5, [
      { fraction: 0.3, weight: 0.6, peakTime: 60, halfLife: 81 },
      { fraction: 0.7, weight: 0.164, peakTime: 300, halfLife: 180 }
    ]),
    model: "IR 30% + ER 70% · area normalized to assumed LED ×0.5", evidence: "Estimated",
    source: "Crexont PI / RISE-PD; Rytary conversion used as an explicit assumption"
  },
  {
    id: "inbrija", group: "Levodopa preparations", name: "Inbrija — levodopa inhalation powder", defaultDose: 84,
    isLevodopa: true, led: factor(0.69), exposure: components(0.69, [{ fraction: 1, weight: 1, peakTime: 30, halfLife: 138 }]),
    model: "Tmax 30 min · T½ 138 min · area normalized to LED ×0.69", evidence: "Estimated shape; consensus conversion",
    source: "Inbrija PI; Jost 2023", sourceUrl: JOST_2023
  }
];

export const DRUG_BY_ID = Object.assign(Object.create(null), Object.fromEntries(DRUGS.map(drug => [drug.id, drug])));

export const PALETTE = [
  "#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00",
  "#56B4E9", "#8C510A", "#5E3C99", "#117733", "#882255"
];
