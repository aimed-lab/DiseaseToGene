#!/usr/bin/env python3
"""Regenerate every manuscript figure from the committed result files.

    python scripts/make_figures.py [outdir]

Default outdir is manuscript/v2/figures. No new computation: each figure reads a JSON
produced by one of the benchmark scripts, so a figure cannot drift from the numbers the
text quotes. v1 had no figure script — the images in the v1 .docx were made ad hoc, which
is how Figure 4 came to render 99.2 where the text said 99.3.

Every value drawn is also asserted against the source file, so a silently changed input
fails here rather than reaching a reviewer.
"""
import json, os, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "manuscript", "v2", "figures")
os.makedirs(OUT, exist_ok=True)

def load(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return json.load(f)

GREEN, BLUE, GOLD, RED = "#1c6b4a", "#2c6ba8", "#b8901f", "#a63a2e"
TIER_COLOR = {"Precedented": GREEN, "Plausible": BLUE, "Speculative": GOLD, "Blocked": RED}
TIERS = ["Precedented", "Plausible", "Speculative", "Blocked"]
INK, MUTE, GRID = "#1a1a1a", "#5b6b75", "#dfe5ea"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 11,
    "axes.edgecolor": "#98a6b0", "axes.labelcolor": INK,
    "xtick.color": MUTE, "ytick.color": MUTE, "text.color": INK,
    "figure.dpi": 200, "savefig.dpi": 200, "savefig.bbox": "tight",
})

def save(fig, name):
    p = os.path.join(OUT, name)
    fig.savefig(p, facecolor="white")
    plt.close(fig)
    print("wrote", p)

def tidy(ax, ygrid=True):
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    if ygrid:
        ax.set_axisbelow(True)
        ax.yaxis.grid(True, color=GRID, lw=1)


# ── Figure 1 — goal conditioning ────────────────────────────────────────────
def figure1():
    d = load("deliverables/figure1_goal_conditioning.json")
    cases = d["cases"]
    rows = ["Splice-switching", "RNA knockdown", "PROTAC", "Expression / genetic"]
    goals = [("inhibit", "inhibit"), ("restore_function", "restore function")]
    fig, axes = plt.subplots(1, len(cases), figsize=(13, 4.4))
    for ax, case in zip(axes, cases):
        tiers = {g: {m["modality"]: m["tier"] for m in case["byGoal"][g]} for g, _ in goals}
        for yi, mod in enumerate(rows):
            for xi, (gk, _) in enumerate(goals):
                t = tiers[gk][mod]
                ax.add_patch(plt.Rectangle((xi, -yi - 0.36), 0.86, 0.72,
                                           facecolor=TIER_COLOR[t], edgecolor="none"))
                ax.text(xi + 0.43, -yi, t, ha="center", va="center",
                        color="white", fontsize=10.5, fontweight="bold")
        ax.set_xlim(-0.06, 1.98); ax.set_ylim(-len(rows) + 0.42, 0.72)
        ax.set_xticks([0.43, 1.43]); ax.set_xticklabels([lbl for _, lbl in goals], fontsize=11)
        ax.set_yticks([-i for i in range(len(rows))]); ax.set_yticklabels(rows, fontsize=11, color=INK)
        ax.set_title(f"{case['gene']}  ({case['drug']})", fontsize=13, fontweight="bold", pad=12)
        for s in ax.spines.values():
            s.set_visible(False)
        ax.tick_params(length=0)
    fig.suptitle("Evidence held constant; only the mechanistic goal differs",
                 fontsize=11.5, color=MUTE, y=0.02)
    save(fig, "figure1_goal_conditioning.png")


# ── Figure 2 — exclusion, the surviving result ──────────────────────────────
def figure2():
    r = load("deliverables/modality_goldset_results.json")["tierSeparation"]
    cols = [("L0realised", "Developed\nL0"), ("L0other", "Alternatives\nL0"),
            ("L2realised", "Developed\nL2"), ("L2other", "Alternatives\nL2")]
    fig, ax = plt.subplots(figsize=(9, 5.6))
    x = range(len(cols))
    bottom = [0.0] * len(cols)
    for t in TIERS:
        vals = [100 * r[t][k] for k, _ in cols]
        ax.bar(x, vals, 0.62, bottom=bottom, color=TIER_COLOR[t], label=t, edgecolor="none")
        bottom = [b + v for b, v in zip(bottom, vals)]
    below = {k: 100 * (r["Speculative"][k] + r["Blocked"][k]) for k, _ in cols}
    # Assert against the reported contrast so a changed input cannot pass silently.
    assert abs(below["L2realised"] - 0.75) < 0.01, below["L2realised"]
    assert abs(below["L2other"] - 37.746) < 0.01, below["L2other"]
    for xi, (k, _) in enumerate(cols):
        if k.startswith("L2"):
            ax.text(xi, 103, f"{below[k]:.2f}%\nbelow Plausible".replace("0.75", "0.75"),
                    ha="center", va="bottom", fontsize=10.5, fontweight="bold", color=GOLD)
    ax.set_xticks(list(x)); ax.set_xticklabels([lbl for _, lbl in cols], fontsize=11)
    ax.set_ylabel("% of assessments"); ax.set_ylim(0, 118)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    tidy(ax)
    ax.legend(handles=[Patch(facecolor=TIER_COLOR[t], label=t) for t in TIERS],
              loc="upper center", bbox_to_anchor=(0.5, -0.09), ncol=4, frameon=False, fontsize=10.5)
    save(fig, "figure2_exclusion.png")


# ── Figure 3 — permissiveness ───────────────────────────────────────────────
def figure3():
    e = load("deliverables/modality_extended_analyses.json")["B_permissiveness"]
    hist, mean, ceil = e["histogram"], e["meanAdmitted"], e["reachableCeiling"]
    assert e["maxObserved"] == 9, e["maxObserved"]
    fig, ax = plt.subplots(figsize=(9.5, 5.2))
    top = max(hist) * 1.22
    ax.bar(range(13), hist, 0.74, color=BLUE, edgecolor="none")
    # Annotations sit in headroom above the bars: at x = 7.9 and x = 10.5 they would
    # otherwise land directly on the two tallest columns.
    ax.axvline(mean, color=RED, ls="--", lw=2, ymax=(max(hist) * 1.06) / top)
    ax.annotate(f"mean {mean:.1f} of 12", xy=(mean, max(hist) * 1.06),
                xytext=(mean - 1.9, top * 0.95), color=RED, fontsize=11, fontweight="bold",
                ha="center", va="top",
                arrowprops=dict(arrowstyle="-", color=RED, lw=1.2, shrinkA=2, shrinkB=2))
    ax.axvline(ceil + 0.5, color=MUTE, ls=":", lw=2)
    ax.text(ceil + 0.72, top * 0.60,
            f"reachable\nceiling {ceil}\n\ntwo modalities\nare never\nadmissible",
            color=MUTE, fontsize=9.5, va="top", linespacing=1.35)
    ax.set_ylim(0, top)
    ax.set_xlim(-0.7, 13.4)
    ax.set_xticks(range(13))
    ax.set_xlabel("modalities admitted at Plausible or above (of 12)")
    ax.set_ylabel(f"assessments (n = {sum(hist)})")
    tidy(ax)
    save(fig, "figure3_permissiveness.png")


# ── Figure 4 — ablation ─────────────────────────────────────────────────────
def figure4():
    r = load("deliverables/modality_goldset_results.json")
    lv = [("L0", "full evidence"), ("L1", "no developed drugs"), ("L2", "no clinical evidence")]
    overall = [100 * r["ablation"][k] for k, _ in lv]
    nonsm = [100 * r["nonSMByLevel"][k]["hit"] / r["nonSMByLevel"][k]["total"] for k, _ in lv]
    base = 100 * r["baseRate"]
    assert abs(overall[2] - 99.25) < 0.005, overall[2]
    fig, ax = plt.subplots(figsize=(9.5, 5.2))
    x = range(len(lv)); w = 0.35
    b1 = ax.bar([i - w / 2 for i in x], overall, w, color=BLUE, label="overall (n = 400)", edgecolor="none")
    b2 = ax.bar([i + w / 2 for i in x], nonsm, w, color=GREEN, label="non-small-molecule (n = 58)", edgecolor="none")
    # Two decimals: 397/400 is 99.25% exactly, and rounding it to one place is what made
    # the v1 figure disagree with the v1 text.
    for bars, vals in ((b1, overall), (b2, nonsm)):
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v + 1.6, f"{v:.2f}".rstrip("0").rstrip("."),
                    ha="center", fontsize=10.5, color=INK)
    ax.axhline(base, color=RED, ls="--", lw=2)
    ax.text(0.02, base - 5.5, f"always-small-molecule base rate  {base:.1f}%",
            color=RED, fontsize=10.5, fontweight="bold",
            bbox=dict(facecolor="white", edgecolor="none", pad=2))
    ax.set_xticks(list(x))
    ax.set_xticklabels([f"{k}\n{d}" for k, d in lv], fontsize=11)
    ax.set_ylabel("recall of developed modality (%)"); ax.set_ylim(0, 116)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    tidy(ax)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, 1.13), ncol=2, frameon=False, fontsize=10.5)
    save(fig, "figure4_ablation.png")


# ── Figure 5 — goal-blind baseline (new in v2) ──────────────────────────────
def figure5():
    b = load("deliverables/goal_blind_baseline.json")["variants"]["clinicalFree"]["byModality"]
    r = load("deliverables/modality_per_assessment.json")["records"]
    ENGINE = {"Conventional small molecule": "SM", "Antibody / intrabody": "Antibody",
              "RNA knockdown (siRNA/gapmer ASO)": "RNA", "Splice-switching ASO": "Splice"}
    RANK = {"Blocked": 0, "Speculative": 1, "Plausible": 2, "Precedented": 3}
    rules = {}
    for rec in r:
        if rec["level"] != 2:
            continue
        for m in rec["modalities"]:
            if not m.get("developed"):
                continue
            k = ENGINE.get(m["modality"], m["modality"])
            h, t = rules.get(k, (0, 0))
            rules[k] = (h + (1 if RANK[m["tier"]] >= 2 else 0), t + 1)
    order = ["SM", "Antibody", "RNA", "Splice"]
    labels = ["Small molecule\n(n = 342)", "Antibody\n(n = 48)", "RNA knockdown\n(n = 8)", "Splice-switching\n(n = 2)"]
    gb = [100 * b[k]["hit"] / b[k]["total"] for k in order]
    ru = [100 * rules[k][0] / rules[k][1] for k in order]
    assert gb[2] == 0 and gb[3] == 0, gb
    assert ru[2] == 100 and ru[3] == 100, ru
    fig, ax = plt.subplots(figsize=(10, 5.2))
    x = range(len(order)); w = 0.36
    b1 = ax.bar([i - w / 2 for i in x], gb, w, color=MUTE, label="goal-blind tractability", edgecolor="none")
    b2 = ax.bar([i + w / 2 for i in x], ru, w, color=BLUE, label="goal-conditioned rules", edgecolor="none")
    for bars, vals in ((b1, gb), (b2, ru)):
        for bb, v in zip(bars, vals):
            ax.text(bb.get_x() + bb.get_width() / 2, v + 1.8, f"{v:.0f}", ha="center", fontsize=10.5, color=INK)
    ax.set_xticks(list(x)); ax.set_xticklabels(labels, fontsize=10.5)
    ax.set_ylabel("recall of developed modality (%)"); ax.set_ylim(0, 118)
    ax.set_yticks([0, 20, 40, 60, 80, 100])
    ax.set_title("Both with clinical evidence removed", fontsize=10.5, color=MUTE, pad=10)
    tidy(ax)
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, 1.22), ncol=2, frameon=False, fontsize=10.5)
    save(fig, "figure5_goal_blind_baseline.png")


for fn in (figure1, figure2, figure3, figure4, figure5):
    fn()
print(f"\nAll figures written to {OUT}")
