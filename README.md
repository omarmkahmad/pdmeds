# PD Medication Exposure Explorer

An educational, browser-based tool for comparing a daily Parkinson medication schedule with normalized exposure curves and research levodopa-equivalent daily dose (LEDD) proposals.

Live site: <https://omarmkahmad.github.io/pdmeds/>

## Run it locally

The app has no runtime dependencies. From the repository directory, start any static file server:

```sh
python3 -m http.server 4173
```

Then open <http://127.0.0.1:4173/>. Loading `index.html` directly from disk is not recommended because browsers restrict JavaScript modules on `file://` URLs.

To run the automated validation suite:

```sh
npm run validate
```

Node.js 20 or newer is recommended.

## What it does

- Builds a daily schedule from five levodopa preparations (Sinemet, Sinemet CR, Rytary, Crexont, and Inbrija), entered as tablet or capsule strength × count.
- Draws the modeled levodopa level over a repeating day, lists the level before each dose, and shows each dose's levodopa mg next to its LEDD contribution.
- Adds immediate-release amantadine and Gocovri (amantadine ER) on a second chart under the levodopa chart. It uses the same clock and one shared cursor, and marks each levodopa dose time on the amantadine curve, so you can see how high amantadine is when each levodopa dose is taken. Amantadine is in typical ng/mL on its own axis and never adds to the levodopa level.
- Pin to compare: move or change a dose and see the difference from the pinned day.
- Lets users draw their own target and high lines without labeling them as clinical “on,” “off,” or dyskinesia states.
- Saves and opens versioned schedule files; all calculations stay in the browser. Older files still open; retired fields are ignored.
- Works by keyboard and screen reader, with text tables that mirror the chart.
- Includes a separate printable dose time sheet (`schedule.html`) for marking dose hours, with a copy format for Epic notes. Names and marks live only in the open page and clear on reload; only the 12-/24-hour clock choice is saved in the browser.

## Model scope and safety

This is a deterministic educational estimate, not a pharmacokinetic simulator, clinical decision-support system, dose converter, or dosing recommendation. Curves are typical-patient shapes. They do not predict an individual's plasma concentration, motor response, adverse effects, or safe treatment window.

LEDD conversion factors follow Jost et al. (2023):

- [Jost et al., Levodopa Dose Equivalency in Parkinson’s Disease](https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mds.29410)

Crexont was approved after that review, so its LEDD factor (×0.5, the Rytary factor) is an assumption; its label switches from Rytary at about 1:1 by levodopa mg.

Amantadine counts toward LEDD by its hydrochloride mg: immediate release ×1 and Gocovri ×1.25 (both from Jost 2023). Gocovri capsules are labeled in mg of amantadine, and 137 mg is 170 mg of the hydrochloride, so 274 mg counts as 340 × 1.25 = 425 mg.

## Model evidence (model 4.1.0)

The chart's unit is anchored to immediate-release levodopa: one 100 mg IR dose peaks at 100. In advanced PD that peak averages about 1,450 ng/mL, with wide variation between people.

Each curve's area follows published bioavailability relative to oral IR carbidopa/levodopa: Rytary 0.70 (label), Crexont 0.88 (the low end of the label's 0.88–0.99), and Inbrija 0.69 (label and FDA review, healthy volunteers). Sinemet CR 0.85 is a middle value: its label gives 0.70–0.75, and other studies go up to 1.07. LEDD keeps the Jost factors separately.

The Rytary and Crexont shapes are fitted to single doses in the same advanced-PD patients (Modi et al., Clin Neuropharmacol 2019, [doi:10.1097/WNF.0000000000000314](https://doi.org/10.1097/WNF.0000000000000314)):

| Preparation | Time above half of peak: model / measured | Peak per mg vs IR: model / measured |
|---|---|---|
| Sinemet IR | 1.9 h / 1.9 h | 1 / 1 |
| Rytary (27% IR-like + 73% slower part) | 3.95 h / 3.9 h | 0.35 / 0.34–0.36 |
| Crexont (25% IR granules + 75% ER beads, per LeWitt 2023) | 4.7 h / 4.7 h | 0.37 / 0.36–0.38 |

`test/pk.test.js` checks every preparation against its published ranges, so a parameter change that moves a curve outside the evidence fails the tests. Other sources: the US labels for all five products; the FDA clinical pharmacology reviews for NDA 203312 (Rytary), 217186 (Crexont), and 209184 (Inbrija); Hsu 2015; LeWitt 2023; Mao 2013; Nutt 2008; Contin and Martinelli 2010; and Wach 2026.

### Amantadine (added in model 4.1.0)

Amantadine curves are in ng/mL for a typical PD patient at steady state. The levodopa curves did not change.

- **Size.** Steady-state curve area in healthy adults is 57.7 ng·h/mL per mg of amantadine hydrochloride (FDA review of NDA 208944, study PK-111). It is raised 1.6 times for the lower kidney clearance of the PD patients in the Gocovri trials (median creatinine clearance 74 vs 121 mL/min/1.73 m²; Hauser et al., Clin Pharmacokinet 2019, [doi:10.1007/s40262-018-0663-4](https://doi.org/10.1007/s40262-018-0663-4)). Gocovri has the same area per mg of hydrochloride as immediate release at steady state (58.5 vs 57.7).
- **Immediate release.** Rise to a peak at 3 h, then half-life 16 h (label: peak at 2–4 h, half-life 16–17 h).
- **Gocovri.** No rise for 3 h, then two overlapping parts that peak 8 h (55%) and 13 h (45%) after the dose, each with half-life 16 h. This gives the published steady-state shape: lowest in the first 3 h after a bedtime dose and highest about 8 h after it.

| Schedule (steady state, PD patients) | Model | Published (Hauser 2019) |
|---|---|---|
| Gocovri 274 mg at 22:00: peak | 1,640 ng/mL | 1,690 (simulated) |
| Gocovri 274 mg at 22:00: 06:00–18:00 average | 1,490 | 1,536 (simulated); about 1,500 measured 9–17 h after the dose |
| IR 100 mg at 08:00 and 16:00: peak / 06:00–18:00 average | 990 / 740 | 967 / 751 |
| IR 100 mg at 08:00, 12:00 and 16:00: peak / 06:00–18:00 average | 1,480 / 1,110 | 1,500 / 1,125 |

`test/amantadine.test.js` holds these ranges (about ±7%), plus the healthy-volunteer and single-dose values. Not modeled: kidney function. Amantadine is cleared by the kidneys, so with lower clearance real levels are higher and the half-life is longer (29 h in older adults, per the label). Osmolex ER is not included.

## Project layout

- `index.html` — semantic application shell and safety information
- `styles.css` — responsive and accessible presentation
- `app.js` — browser UI: dose editor, results, pin to compare, files, print, and the time sheet handoff
- `src/drugs.js` — medication strengths, curve parameters, and sources (levodopa preparations and amantadine products)
- `src/model.js` — exposure curves, LEDD, and schedule file import/export
- `src/time.js`, `src/amounts.js` — time parsing and tablet/capsule arithmetic
- `src/answers.js` — the level before each dose, headline sentences, tiles, comparisons, and the amantadine analysis
- `src/chart.js` — the SVG chart (levodopa, and the shorter amantadine panel)
- `src/copy.js` — the approved (i) definitions
- `schedule.html`, `schedule.css`, `schedule.js` — printable dose time sheet
- `test/` — unit, pharmacokinetic, copy, deploy, and Content Security Policy tests

## Deployment

Pull requests and pushes are validated by GitHub Actions. A successful push to `main` packages the static assets and deploys them to GitHub Pages.

## Privacy

The app has no analytics, cookies, accounts, or backend. Regimen data remains in the current browser unless the user explicitly copies or downloads it.

## License

MIT. See [LICENSE](LICENSE).
