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

## Model evidence (model 4.0.0)

The chart's unit is anchored to immediate-release levodopa: one 100 mg IR dose peaks at 100. In advanced PD that peak averages about 1,450 ng/mL, with wide variation between people.

Each curve's area follows the label's relative bioavailability against oral IR carbidopa/levodopa: Sinemet CR 0.85 (published values 0.70–1.07), Rytary 0.70, Crexont 0.88, Inbrija 0.69. LEDD keeps the Jost factors separately.

The Rytary and Crexont shapes are fitted to single doses in the same advanced-PD patients (Modi et al., Clin Neuropharmacol 2019, [doi:10.1097/WNF.0000000000000314](https://doi.org/10.1097/WNF.0000000000000314)):

| Preparation | Time above half of peak: model / measured | Peak per mg vs IR: model / measured |
|---|---|---|
| Sinemet IR | 1.9 h / 1.9 h | 1 / 1 |
| Rytary (27% IR-like + 73% slower part) | 3.95 h / 3.9 h | 0.35 / 0.34–0.36 |
| Crexont (25% IR granules + 75% ER beads) | 4.7 h / 4.7 h | 0.37 / 0.36–0.38 |

`test/pk.test.js` checks every preparation against its published ranges, so a parameter change that moves a curve outside the evidence fails the tests. Other sources: the US labels for all five products; the FDA clinical pharmacology reviews for NDA 203312 (Rytary), 217186 (Crexont), and 209184 (Inbrija); Hsu 2015; LeWitt 2023; Mao 2013; Nutt 2008; Contin and Martinelli 2010; and Wach 2026.

## Project layout

- `index.html` — semantic application shell and safety information
- `styles.css` — responsive and accessible presentation
- `app.js` — browser UI: dose editor, results, pin to compare, files, print, and the time sheet handoff
- `src/drugs.js` — medication strengths, curve parameters, and sources
- `src/model.js` — exposure curves, LEDD, and schedule file import/export
- `src/time.js`, `src/amounts.js` — time parsing and tablet/capsule arithmetic
- `src/answers.js` — the level before each dose, headline sentences, tiles, and comparisons
- `src/chart.js` — the SVG chart
- `src/copy.js` — the approved (i) definitions
- `schedule.html`, `schedule.css`, `schedule.js` — printable dose time sheet
- `test/` — unit, pharmacokinetic, copy, deploy, and Content Security Policy tests

## Deployment

Pull requests and pushes are validated by GitHub Actions. A successful push to `main` packages the static assets and deploys them to GitHub Pages.

## Privacy

The app has no analytics, cookies, accounts, or backend. Regimen data remains in the current browser unless the user explicitly copies or downloads it.

## License

MIT. See [LICENSE](LICENSE).
