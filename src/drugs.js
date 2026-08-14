export const MODEL_VERSION = "2.0.0";
export const REGIMEN_SCHEMA_VERSION = 1;
export const MINUTES_PER_DAY = 1440;
export const LN2 = Math.log(2);
export const LD_AUC = 60 / 2 + 81 / LN2;
export const CONSTANT_LEVEL_PER_LED = LD_AUC / MINUTES_PER_DAY;

const JOST_2023 = "https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mds.29410";
const COMTAN_LABEL = "https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/020796s15lbl.pdf";
const ONGENTYS_LABEL = "https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/212489s007lbl.pdf";
const TASMAR_LABEL = "https://www.accessdata.fda.gov/drugsatfda_docs/label/2009/020697s013s015lbl.pdf";

export const COMT_OPTIONS = {
  none: {
    id: "none",
    name: "None",
    ledFactor: 0,
    exposureMultiplier: 1,
    description: "No COMT adjustment."
  },
  ent: {
    id: "ent",
    name: "Entacapone with each levodopa dose",
    ledFactor: 0.33,
    exposureMultiplier: 1.35,
    description: "Adds 33% of eligible levodopa LED; exposure model uses the label's approximate 35% AUC increase.",
    source: "Jost 2023; Comtan prescribing information",
    sourceUrl: COMTAN_LABEL
  },
  opi: {
    id: "opi",
    name: "Opicapone once daily",
    ledFactor: 0.5,
    exposureMultiplier: 1.78,
    description: "Adds 50% of eligible levodopa LED; exposure model uses the midpoint of the label's 62–94% AUC increase.",
    source: "Jost 2023; Ongentys prescribing information",
    sourceUrl: ONGENTYS_LABEL
  },
  tol: {
    id: "tol",
    name: "Tolcapone three times daily",
    ledFactor: 0.5,
    exposureMultiplier: 2,
    description: "Adds 50% of eligible levodopa LED; exposure model uses the label's approximate twofold AUC increase.",
    source: "Jost 2023; Tasmar prescribing information",
    sourceUrl: TASMAR_LABEL
  }
};

const factor = value => ({ kind: "factor", value });
const fixed = value => ({ kind: "fixed", value });
const levodopaSubtotal = value => ({ kind: "levodopa-subtotal", value });
const components = (exposureFactor, values) => ({ kind: "components", exposureFactor, values });
const infusion = (exposureFactor, halfLife) => ({ kind: "infusion", exposureFactor, halfLife });
const steady = () => ({ kind: "steady" });

export const DRUGS = [
  {
    id: "sinemet", group: "Levodopa preparations", name: "Sinemet — levodopa/carbidopa IR", defaultDose: 100,
    isLevodopa: true, led: factor(1), exposure: components(1, [{ fraction: 1, weight: 1, peakTime: 60, halfLife: 81 }]),
    model: "Tmax 60 min · T½ 81 min", evidence: "Referenced", source: "Kuoppamäki 2009; Turner"
  },
  {
    id: "madopar", group: "Levodopa preparations", name: "Madopar — levodopa/benserazide IR", defaultDose: 100,
    isLevodopa: true, led: factor(1), exposure: components(1, [{ fraction: 1, weight: 1, peakTime: 60, halfLife: 81 }]),
    model: "Tmax 60 min · T½ 81 min", evidence: "Referenced", source: "Korten 1975; Turner"
  },
  {
    id: "sinemetcr", group: "Levodopa preparations", name: "Sinemet CR — levodopa/carbidopa CR", defaultDose: 100,
    isLevodopa: true, led: factor(0.75), exposure: components(0.75, [{ fraction: 1, weight: 1, peakTime: 120, halfLife: 137 }]),
    model: "Tmax 120 min · T½ 137 min · area normalized to LED ×0.75", evidence: "Consensus conversion",
    source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "madoparcr", group: "Levodopa preparations", name: "Madopar HBS / CR", defaultDose: 100,
    isLevodopa: true, led: factor(0.75), exposure: components(0.75, [{ fraction: 1, weight: 1, peakTime: 120, halfLife: 137 }]),
    model: "As controlled-release levodopa", evidence: "Consensus conversion", source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "stalevo", group: "Levodopa preparations", name: "Stalevo — levodopa/carbidopa/entacapone", defaultDose: 100,
    isLevodopa: true, comtIncluded: true, led: factor(1.33),
    exposure: components(1.35, [{ fraction: 1, weight: 1, peakTime: 90, halfLife: 117 }]),
    model: "Entacapone included · area normalized to 1.35× IR exposure", evidence: "Referenced",
    source: "Jost 2023; Stalevo/Comtan labeling", sourceUrl: COMTAN_LABEL
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
  },
  {
    id: "duopa", group: "Levodopa infusions", name: "Duopa / Duodopa — LCIG intestinal infusion", defaultDose: 1000,
    defaultDuration: 960, isLevodopa: true, led: factor(1.11), exposure: infusion(1.11, 81),
    model: "Continuous infusion · T½ 81 min · LED ×1.11", evidence: "Consensus conversion",
    source: "Duopa PI; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "vyalev", group: "Levodopa infusions", name: "Vyalev — foslevodopa/foscarbidopa SC infusion", defaultDose: 1000,
    defaultDuration: 1440, isLevodopa: true, led: factor(0.75), exposure: infusion(0.75, 81),
    model: "Continuous infusion · T½ 81 min · LED ×0.75", evidence: "Consensus conversion",
    source: "Vyalev PI; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "onapgo", group: "Levodopa infusions", name: "Onapgo — apomorphine SC infusion", defaultDose: 60,
    defaultDuration: 960, led: factor(10), exposure: infusion(10, 27),
    model: "Continuous infusion · T½ 27 min", evidence: "Estimated shape; established apomorphine conversion",
    source: "Onapgo PI; Sam 1995; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "aposc", group: "Dopamine agonists", name: "Apomorphine SC injection (Apokyn)", defaultDose: 4,
    led: factor(10), exposure: components(10, [{ fraction: 1, weight: 1, peakTime: 18, halfLife: 27 }]),
    model: "Tmax 18 min · T½ 27 min", evidence: "Referenced", source: "Sam 1995; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "apoin", group: "Dopamine agonists", name: "Apomorphine intranasal — investigational/legacy", defaultDose: 4,
    led: factor(7.5), exposure: components(7.5, [{ fraction: 1, weight: 1, peakTime: 23, halfLife: 31 }]),
    model: "Tmax 23 min · T½ 31 min", evidence: "Legacy estimate; not a current US product", source: "Sam 1995; Turner"
  },
  {
    id: "prami", group: "Dopamine agonists", name: "Pramipexole IR (Mirapex / Mirapexin)", defaultDose: 0.5,
    led: factor(100), exposure: components(100, [{ fraction: 1, weight: 1, peakTime: 120, halfLife: 600 }]),
    model: "Tmax 120 min · T½ 600 min · area normalized to LED", evidence: "Referenced conversion",
    source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "pramier", group: "Dopamine agonists", name: "Pramipexole ER (Mirapex ER)", defaultDose: 1.5,
    led: factor(100), exposure: components(100, [{ fraction: 1, weight: 1, peakTime: 360, halfLife: 600 }]),
    model: "Tmax 360 min · T½ 600 min · area normalized to LED", evidence: "Estimated shape; referenced conversion",
    source: "Mirapex ER PI; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "ropin", group: "Dopamine agonists", name: "Ropinirole IR (Requip)", defaultDose: 2,
    led: factor(20), exposure: components(20, [{ fraction: 1, weight: 1, peakTime: 90, halfLife: 360 }]),
    model: "Tmax 90 min · T½ 360 min · area normalized to LED", evidence: "Referenced conversion", source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "ropinxl", group: "Dopamine agonists", name: "Ropinirole XL / CR (Requip XL)", defaultDose: 8,
    led: factor(20), exposure: components(20, [{ fraction: 1, weight: 1, peakTime: 480, halfLife: 360 }]),
    model: "Tmax 480 min · T½ 360 min · area normalized to LED", evidence: "Referenced conversion", source: "Requip XL PI; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "rotig", group: "Dopamine agonists", name: "Rotigotine patch (Neupro)", defaultDose: 6,
    led: factor(30.3), exposure: steady(), model: "Constant modeled exposure at steady state", evidence: "Referenced conversion",
    source: "Cawello 2014; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "bromo", group: "Dopamine agonists", name: "Bromocriptine (Parlodel)", defaultDose: 2.5,
    led: factor(10), exposure: components(10, [{ fraction: 1, weight: 1, peakTime: 90, halfLife: 360 }]),
    model: "Tmax 90 min · T½ 360 min · area normalized to LED", evidence: "Estimated shape; referenced conversion",
    source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "rasag", group: "MAO-B inhibitors", name: "Rasagiline (Azilect)", defaultDose: 1,
    led: factor(100), exposure: steady(), model: "Constant pseudo-exposure at steady state", evidence: "Referenced conversion",
    source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "seleg", group: "MAO-B inhibitors", name: "Selegiline oral (Eldepryl)", defaultDose: 10,
    led: factor(10), exposure: steady(), model: "Constant pseudo-exposure at steady state", evidence: "Referenced conversion",
    source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "zelapar", group: "MAO-B inhibitors", name: "Selegiline ODT (Zelapar)", defaultDose: 1.25,
    led: factor(80), exposure: steady(), model: "Constant pseudo-exposure at steady state", evidence: "Referenced conversion",
    source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "safin", group: "MAO-B inhibitors", name: "Safinamide (Xadago)", defaultDose: 100,
    led: fixed(150), exposure: steady(), model: "Fixed 150 mg LED proposal for an effective daily dose", evidence: "Consensus proposal",
    source: "Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "amant", group: "Other adjuncts", name: "Amantadine IR", defaultDose: 100,
    led: factor(1), exposure: components(1, [{ fraction: 1, weight: 1, peakTime: 126, halfLife: 847 }]),
    model: "Tmax 126 min · T½ 847 min · area normalized to LED", evidence: "Referenced conversion",
    source: "Morrison 2007; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "gocovri", group: "Other adjuncts", name: "Amantadine ER (Gocovri)", defaultDose: 274,
    led: factor(1.25), exposure: components(1.25, [{ fraction: 1, weight: 1, peakTime: 720, halfLife: 847 }]),
    model: "Tmax 720 min · T½ 847 min · area normalized to LED ×1.25", evidence: "Estimated shape; consensus conversion",
    source: "Gocovri PI; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "osmolex", group: "Other adjuncts", name: "Amantadine IR/ER (Osmolex ER)", defaultDose: 129,
    led: factor(1), exposure: components(1, [{ fraction: 1, weight: 1, peakTime: 720, halfLife: 847 }]),
    model: "Estimated ER shape · area normalized to LED ×1", evidence: "Estimated shape; consensus conversion",
    source: "Osmolex ER PI; Jost 2023", sourceUrl: JOST_2023
  },
  {
    id: "istrad", group: "Other adjuncts", name: "Istradefylline (Nourianz)", defaultDose: 40,
    led: levodopaSubtotal(0.2), exposure: steady(),
    model: "Fixed regimen-level proposal: 20% of levodopa + COMT subtotal", evidence: "Consensus proposal with limited evidence",
    source: "Jost 2023", sourceUrl: JOST_2023
  }
];

export const DRUG_BY_ID = Object.fromEntries(DRUGS.map(drug => [drug.id, drug]));

export const PALETTE = [
  "#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00",
  "#56B4E9", "#8C510A", "#5E3C99", "#117733", "#882255"
];
