"""Render the validation figures from docs/validation/data.json.

Usage: python3 scripts/validation_plots.py
Writes PNG figures into docs/validation/.
"""

import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "validation"
data = json.loads((OUT / "data.json").read_text())

TOOL_COLOR = "#0072B2"       # tool model
REF_COLOR = "#D55E00"        # published reference model
INK = "#17202a"
MUTED = "#56616d"
GRID = dict(color="#d7dde2", linewidth=0.7)

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "axes.edgecolor": INK,
    "axes.labelcolor": INK,
    "text.color": INK,
    "xtick.color": INK,
    "ytick.color": INK,
    "figure.facecolor": "white",
    "axes.facecolor": "white",
})

STEP = 5  # curves were downsampled to every 5 minutes

# Published landmarks. Sources are cited in docs/validation.md.
MEASURED = {
    "sinemet": {
        "label": "Sinemet IR 100 mg",
        "tmax": (60, 30, 120),          # median, range (Hsu 2015)
        "notes": ["T>50%Cmax: 90±42 min (Hsu)", "post-peak t½: 96±12 min (Hsu)"],
    },
    "sinemetcr": {
        "label": "Sinemet CR 100 mg",
        "tmax": (90, 60, 120),          # Hsu 2015; label (elderly) ~120 min
        "notes": ["Cmax/IR: 0.78 (Hsu), 0.35 (label, elderly)", "T>50%Cmax: 126±60 min (Hsu)", "rel. F vs IR: 0.70–0.75 (label)"],
    },
    "rytary": {
        "label": "Rytary 390 mg",
        "tmax": (270, 30, 480),         # Hsu 2015
        "notes": ["Cmax/IR: 0.31 (Hsu; label ≈30%)", "T>50%Cmax: 294±144 min (Hsu)", "rel. F vs IR: ≈0.70 (label)"],
    },
    "crexont": {
        "label": "Crexont 140 mg",
        "tmax": (150, None, None),      # label: overall Tmax ~2.5 h; initial peak ~1 h
        "notes": ["initial peak ≈1 h; sustained 6–7 h (label)", "rel. F vs IR: 0.88–0.99 (label)"],
    },
    "inbrija": {
        "label": "Inbrija 84 mg",
        "tmax": (30, 10, 120),          # label median 0.5 h, range 0.17-2 h
        "notes": ["Cmax/IR: ≈0.5 (label)", "t½: 2.3 h = 138 min (label)", "rel. F vs oral IR: ≈0.70 (label)"],
    },
}

MODEL_SUMMARY = {
    k: data["tool"][k] for k in MEASURED
}

# ---------------- Figure 1: face validity, five panels ----------------
fig, axes = plt.subplots(2, 3, figsize=(13, 7.2))
axes = axes.ravel()
order = ["sinemet", "sinemetcr", "rytary", "crexont", "inbrija"]
for idx, drug_id in enumerate(order):
    ax = axes[idx]
    tool = data["tool"][drug_id]
    curve = tool["curve"]
    peak = max(curve)
    hours = [i * STEP / 60 for i in range(len(curve))]
    values = [v / peak for v in curve]
    ax.plot(hours, values, color=TOOL_COLOR, linewidth=2, label="pdmeds model", zorder=3)

    med, lo, hi = MEASURED[drug_id]["tmax"]
    if lo is not None:
        ax.plot([lo / 60, hi / 60], [1.36, 1.36], color=INK, linewidth=1.2, zorder=4)
    ax.plot(med / 60, 1.36, marker="o", color=INK, markersize=5, zorder=5,
            label="measured Tmax (median, range)")

    m = MODEL_SUMMARY[drug_id]
    lines = [f"model Tmax {m['tmaxMin']} min", *MEASURED[drug_id]["notes"]]
    ax.text(0.98, 0.88, "\n".join(lines), transform=ax.transAxes, ha="right", va="top",
            fontsize=7.4, color=MUTED, linespacing=1.35)

    ax.set_title(MEASURED[drug_id]["label"], fontsize=10.5, fontweight="bold", loc="left")
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 1.45)
    ax.grid(**GRID)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    if idx >= 2:
        ax.set_xlabel("hours after dose")
    if idx % 3 == 0:
        ax.set_ylabel("fraction of model Cmax")

handles, labels = axes[0].get_legend_handles_labels()
axes[5].axis("off")
axes[5].legend(handles, labels, loc="upper left", bbox_to_anchor=(0.0, 0.92), frameon=False, fontsize=9)
axes[5].text(0.0, 0.42,
             "Model curves from src/model.js as deployed.\nMeasured landmarks: Hsu 2015 (J Clin\nPharmacol) and FDA prescribing information.\nDetails and sources: docs/validation.md",
             fontsize=8, color=MUTED, linespacing=1.4, va="top")
fig.suptitle("Face validity: pdmeds single-dose curves vs published landmarks", fontsize=13,
             fontweight="bold", x=0.02, ha="left")
fig.tight_layout(rect=(0, 0, 1, 0.95))
fig.savefig(OUT / "fig1-face-validity.png", dpi=160)
plt.close(fig)

# ---------------- Figure 2: single-dose model comparison ----------------
cmp_single = data["comparison"]["singleDose"]
hours8 = [i * STEP / 60 for i in range(len(cmp_single["refCurveNormalized"]))]
fig, ax = plt.subplots(figsize=(8.4, 4.6))
ax.plot(hours8, cmp_single["refCurveNormalized"], color=REF_COLOR, linewidth=2.2,
        label="population PK model (Othman & Dutta 2014)")
ax.plot(hours8, cmp_single["toolCurveNormalized"], color=TOOL_COLOR, linewidth=2.2,
        label="pdmeds model")
ax.set_xlabel("hours after a 100 mg levodopa/carbidopa IR dose")
ax.set_ylabel("concentration (AUC-normalized)")
ax.set_xlim(0, 8)
ax.set_ylim(bottom=0)
ax.grid(**GRID)
ax.set_axisbelow(True)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, loc="upper right", fontsize=9)
ax.text(0.985, 0.62,
        f"shape divergence (NRMSE): {cmp_single['nrmsePctOfRefPeak']:.1f}% of reference peak\n"
        f"Tmax: reference {cmp_single['refTmaxMin']} min · pdmeds {cmp_single['candTmaxMin']} min",
        transform=ax.transAxes, ha="right", va="top", fontsize=8.4, color=MUTED, linespacing=1.5)
ax.set_title("Model comparison: single IR dose", fontsize=12, fontweight="bold", loc="left")
fig.tight_layout()
fig.savefig(OUT / "fig2-single-dose.png", dpi=160)
plt.close(fig)

# ---------------- Figure 3: full-day regimen comparison ----------------
cmp_day = data["comparison"]["day"]
hours24 = [i * STEP / 60 for i in range(len(cmp_day["refCurveNormalized"]))]
fig, ax = plt.subplots(figsize=(9.6, 4.8))
ax.plot(hours24, cmp_day["refCurveNormalized"], color=REF_COLOR, linewidth=2.2,
        label="population PK model (Othman & Dutta 2014)")
ax.plot(hours24, cmp_day["toolCurveNormalized"], color=TOOL_COLOR, linewidth=2.2,
        label="pdmeds model")
for hour in (7, 11, 15, 19):
    ax.axvline(hour, color="#b8c0c8", linewidth=0.9, linestyle=(0, (3, 3)), zorder=0)
    ax.text(hour, ax.get_ylim()[1] * 0.02, f" {hour:02d}:00", fontsize=7.5, color=MUTED,
            rotation=90, va="bottom")
ax.set_xlabel("time of day (h); 100 mg IR levodopa at 07:00, 11:00, 15:00, 19:00")
ax.set_ylabel("concentration (AUC-normalized)")
ax.set_xlim(5, 24)
ax.set_ylim(bottom=0)
ax.grid(**GRID)
ax.set_axisbelow(True)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, loc="upper right", fontsize=9)
rpt = cmp_day["refPeakTrough"]; tpt = cmp_day["toolPeakTrough"]
ax.text(0.015, 0.97,
        f"shape divergence (NRMSE): {cmp_day['nrmsePctOfRefPeak']:.1f}% of reference peak\n"
        f"daytime peak:trough — reference {rpt['ratio']:.1f} · pdmeds {tpt['ratio']:.1f}",
        transform=ax.transAxes, ha="left", va="top", fontsize=8.4, color=MUTED, linespacing=1.5)
ax.set_title("Model comparison: example daily regimen", fontsize=12, fontweight="bold", loc="left")
fig.tight_layout()
fig.savefig(OUT / "fig3-day-regimen.png", dpi=160)
plt.close(fig)

print("wrote", *[p.name for p in sorted(OUT.glob("fig*.png"))])
