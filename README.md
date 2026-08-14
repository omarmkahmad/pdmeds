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

- Builds a timed regimen from oral, inhaled, infused, and steady-exposure Parkinson medications.
- Reports research LEDD separately from the normalized exposure visualization.
- Models entacapone, opicapone, and tolcapone with distinct LEDD and exposure assumptions.
- Lets users define their own target and high-exposure thresholds without labeling them as clinical “on,” “off,” or dyskinesia states.
- Imports and exports versioned JSON regimens; all calculations stay in the browser.
- Includes keyboard-accessible chart exploration, toggleable medication curves, responsive tables, and textual source data.

## Model scope and safety

This is a deterministic educational estimate, not a pharmacokinetic simulator, clinical decision-support system, dose converter, or dosing recommendation. Curves are normalized relative-exposure shapes. They do not predict an individual's plasma concentration, motor response, adverse effects, or safe treatment window.

LEDD calculations primarily follow Jost et al. (2023). Product-specific exposure adjustments are documented in the in-app parameter table and linked to official labeling. The main references are:

- [Jost et al., Levodopa Dose Equivalency in Parkinson’s Disease](https://movementdisorders.onlinelibrary.wiley.com/doi/10.1002/mds.29410)
- [Entacapone FDA label](https://www.accessdata.fda.gov/drugsatfda_docs/label/2010/020796s15lbl.pdf)
- [Opicapone FDA label](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/212489s007lbl.pdf)
- [Tolcapone FDA label](https://www.accessdata.fda.gov/drugsatfda_docs/label/2009/020697s013s015lbl.pdf)

## Project layout

- `index.html` — semantic application shell and safety information
- `styles.css` — responsive and accessible presentation
- `app.js` — browser UI, chart rendering, and import/export flows
- `src/drugs.js` — versioned medication parameters and references
- `src/model.js` — validation, LEDD, exposure, and summary calculations
- `test/model.test.js` — model and regression tests

## Deployment

Pull requests and pushes are validated by GitHub Actions. A successful push to `main` packages the static assets and deploys them to GitHub Pages.

## Privacy

The app has no analytics, cookies, accounts, or backend. Regimen data remains in the current browser unless the user explicitly copies or downloads it.

## License

MIT. See [LICENSE](LICENSE).
