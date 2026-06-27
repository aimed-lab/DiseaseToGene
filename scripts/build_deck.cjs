const pptxgen = require("pptxgenjs");
const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.33, height: 7.5 });
p.layout = "W";
p.author = "Nikhil Kurmachalam";
p.title = "Disease2Target — Three New Evidence Axes";

const W = 13.33, H = 7.5, M = 0.7;
const INK = "0F172A", INK2 = "1E293B", WHITE = "FFFFFF", TINT = "F1F5F9", CARD = "F8FAFC";
const TX = "1E293B", MUT = "64748B", LT = "E2E8F0", LINEC = "E2E8F0";
const TEAL = "0D9488", TEALT = "CCFBF1";
const VIOLET = "7C3AED", VIOLETT = "EDE9FE";
const AMBER = "B45309", AMBERT = "FEF3C7";
const BRAND = "2563EB";
const HEAD = "Cambria", BODY = "Calibri";

const shadow = () => ({ type: "outer", color: "000000", blur: 7, offset: 3, angle: 90, opacity: 0.12 });

function footer(s, n) {
  s.addText("DISEASE2TARGET", { x: M, y: H - 0.45, w: 4, h: 0.3, fontFace: BODY, fontSize: 9, color: MUT, charSpacing: 2, bold: true });
  s.addText(String(n), { x: W - 1.1, y: H - 0.45, w: 0.4, h: 0.3, fontFace: BODY, fontSize: 10, color: MUT, align: "right" });
}
function chip(s, label, x, y, fill, tcolor, w) {
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: w || 2.3, h: 0.5, fill: { color: fill }, rectRadius: 0.25, line: { type: "none" } });
  s.addText(label, { x, y, w: w || 2.3, h: 0.5, fontFace: BODY, fontSize: 13, bold: true, color: tcolor, align: "center", valign: "middle", margin: 0 });
}
function dot(s, letter, x, y, d, color) {
  s.addShape(p.shapes.OVAL, { x, y, w: d, h: d, fill: { color }, line: { type: "none" } });
  s.addText(letter, { x, y, w: d, h: d, fontFace: HEAD, fontSize: d * 22, bold: true, color: WHITE, align: "center", valign: "middle", margin: 0 });
}
function title(s, t, color) {
  s.addText(t, { x: M, y: 0.55, w: W - 2 * M, h: 0.8, fontFace: HEAD, fontSize: 30, bold: true, color: color || TX, margin: 0 });
}

// ─────────────────────────────────────────────────────────── 1 · TITLE
(() => {
  const s = p.addSlide(); s.background = { color: INK };
  s.addShape(p.shapes.OVAL, { x: 9.7, y: -2.2, w: 6, h: 6, fill: { color: INK2 }, line: { type: "none" } });
  s.addText("DISEASE2TARGET  ·  AI-POWERED TARGET PRIORITIZATION", { x: M, y: 1.5, w: 11, h: 0.4, fontFace: BODY, fontSize: 13, color: "7DD3FC", charSpacing: 3, bold: true });
  s.addText("Three New Evidence Axes", { x: M, y: 2.0, w: 11.5, h: 1.2, fontFace: HEAD, fontSize: 52, bold: true, color: WHITE, margin: 0 });
  s.addText("Adding independent biological evidence to find targets that single-source scoring misses", { x: M, y: 3.25, w: 10.5, h: 0.7, fontFace: BODY, fontSize: 18, color: LT });
  chip(s, "Dysregulation", M, 4.35, TEAL, WHITE, 2.5);
  chip(s, "Dependency", M + 2.75, 4.35, VIOLET, WHITE, 2.4);
  chip(s, "Safety", M + 5.4, 4.35, AMBER, WHITE, 1.9);
  s.addText("Nikhil Kurmachalam   ·   Demonstration disease: Pancreatic adenocarcinoma", { x: M, y: 6.3, w: 11, h: 0.4, fontFace: BODY, fontSize: 13, color: MUT });
})();

// ─────────────────────────────────────────────────────────── 2 · WHY
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Why add these three axes?");
  s.addText([
    { text: "One source is not enough.", options: { bold: true, color: TX, breakLine: true, fontSize: 17 } },
    { text: "Ranking targets by a single aggregated score (e.g. Open Targets alone) quietly buries genes that are real targets but score low on that one measure.", options: { color: MUT, breakLine: true, fontSize: 15, paraSpaceAfter: 10 } },
    { text: "Each new axis is an independent line of evidence", options: { bold: true, color: TX, breakLine: true, fontSize: 17 } },
    { text: "— answering a different biological question. Used together, they recover targets that any one source would drop.", options: { color: MUT, fontSize: 15 } },
  ], { x: M, y: 1.7, w: 6.6, h: 3.2, valign: "top" });

  // SRC callout card
  const cx = 7.9, cw = 4.7;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: 1.7, w: cw, h: 4.4, fill: { color: INK }, rectRadius: 0.12, line: { type: "none" }, shadow: shadow() });
  s.addText("THE SRC PROBLEM", { x: cx + 0.4, y: 2.0, w: cw - 0.8, h: 0.4, fontFace: BODY, fontSize: 12, bold: true, color: "7DD3FC", charSpacing: 2 });
  s.addText([
    { text: "Open Targets score: ", options: { color: LT, fontSize: 15 } },
    { text: "0.39", options: { color: "F87171", bold: true, fontSize: 15, breakLine: true } },
    { text: "Buried at rank ~5,000 — invisible to anyone looking at the top of the list.", options: { color: MUT, fontSize: 13, breakLine: true, paraSpaceAfter: 12 } },
    { text: "Add the new axes:", options: { color: WHITE, bold: true, fontSize: 14, breakLine: true, paraSpaceAfter: 6 } },
    { text: "▲ over-expressed in tumor (+1.46)", options: { color: TEALT, fontSize: 14, breakLine: true } },
    { text: "● a real pancreatic dependency", options: { color: VIOLETT, fontSize: 14, breakLine: true } },
    { text: "◆ druggable, constraint understood", options: { color: AMBERT, fontSize: 14, breakLine: true, paraSpaceAfter: 10 } },
    { text: "→ SRC rises into view.", options: { color: WHITE, bold: true, italic: true, fontSize: 15 } },
  ], { x: cx + 0.4, y: 2.45, w: cw - 0.8, h: 3.5, valign: "top" });
  footer(s, 2);
})();

// ─────────────────────────────────────────────────────────── 3 · OVERVIEW (3 cards)
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "The three new axes at a glance");
  const cards = [
    { L: "D", c: TEAL, t: TEALT, name: "Dysregulation", q: "Is the gene abnormally expressed in the tumor?", src: "TCGA tumor + GTEx normal\n(via UCSC Xena Toil)" },
    { L: "P", c: VIOLET, t: VIOLETT, name: "Dependency", q: "Does the tumor need this gene to survive?", src: "DepMap CRISPR\nknockout screens" },
    { L: "S", c: AMBER, t: AMBERT, name: "Safety", q: "Is it safe to drug — or essential to healthy cells?", src: "gnomAD population\nconstraint" },
  ];
  const cw = 3.78, gap = 0.45, y = 1.75, ch = 4.5;
  let x = M;
  cards.forEach(cd => {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, rectRadius: 0.1, line: { color: LINEC, width: 1 }, shadow: shadow() });
    dot(s, cd.L, x + 0.4, y + 0.4, 0.95, cd.c);
    s.addText(cd.name, { x: x + 1.5, y: y + 0.45, w: cw - 1.7, h: 0.9, fontFace: HEAD, fontSize: 21, bold: true, color: cd.c, valign: "middle", margin: 0 });
    s.addText(cd.q, { x: x + 0.4, y: y + 1.7, w: cw - 0.8, h: 1.5, fontFace: BODY, fontSize: 16, color: TX, valign: "top" });
    s.addText("SOURCE", { x: x + 0.4, y: y + 3.25, w: cw - 0.8, h: 0.3, fontFace: BODY, fontSize: 10, bold: true, color: MUT, charSpacing: 2 });
    s.addText(cd.src, { x: x + 0.4, y: y + 3.55, w: cw - 0.8, h: 0.8, fontFace: BODY, fontSize: 13, color: MUT, valign: "top" });
    x += cw + gap;
  });
  footer(s, 3);
})();

// ─────────────────────────────────────────────────────────── 4 · HOW IT WORKS
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "How it works in the app");
  const steps = [
    { n: "1", h: "Click a gene", d: "Open any gene under a disease — e.g. SRC under pancreatic cancer." },
    { n: "2", h: "Three panels appear", d: "Each axis fetches and shows its own drill-down panel, beside the existing mutation / druggability / clinical evidence." },
    { n: "3", h: "Real, traceable numbers", d: "Every value comes from a named public source with its provenance — no invented numbers." },
  ];
  const y = 1.8, cw = 3.78, gap = 0.45; let x = M;
  steps.forEach(st => {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: 2.5, fill: { color: CARD }, rectRadius: 0.1, line: { color: LINEC, width: 1 }, shadow: shadow() });
    dot(s, st.n, x + 0.4, y + 0.4, 0.8, BRAND);
    s.addText(st.h, { x: x + 1.35, y: y + 0.45, w: cw - 1.6, h: 0.7, fontFace: HEAD, fontSize: 18, bold: true, color: TX, valign: "middle", margin: 0 });
    s.addText(st.d, { x: x + 0.4, y: y + 1.35, w: cw - 0.8, h: 1.0, fontFace: BODY, fontSize: 13.5, color: MUT, valign: "top" });
    x += cw + gap;
  });
  // delivery note
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 4.7, w: W - 2 * M, h: 1.5, fill: { color: TINT }, rectRadius: 0.1, line: { type: "none" } });
  s.addText("Two delivery modes", { x: M + 0.4, y: 4.85, w: 11, h: 0.4, fontFace: BODY, fontSize: 14, bold: true, color: TX });
  s.addText([
    { text: "Live  ", options: { bold: true, color: AMBER, fontSize: 14 } },
    { text: "gnomAD (Safety) — queried in real time, stable API.        ", options: { color: MUT, fontSize: 14 } },
    { text: "Preloaded  ", options: { bold: true, color: TEAL, fontSize: 14 } },
    { text: "Expression & Dependency are large reference datasets, built once into a fast local table.", options: { color: MUT, fontSize: 14 } },
  ], { x: M + 0.4, y: 5.25, w: W - 2 * M - 0.8, h: 0.85, valign: "top" });
  s.addText("Fully additive — no existing scoring or logic was changed.", { x: M + 0.4, y: 5.78, w: 11, h: 0.4, fontFace: BODY, fontSize: 12, italic: true, color: MUT });
  footer(s, 4);
})();

// ─── divider helper ───
function divider(num, name, sub, color, letter, tint) {
  const s = p.addSlide(); s.background = { color: INK };
  s.addShape(p.shapes.OVAL, { x: 10.3, y: 2.0, w: 3.6, h: 3.6, fill: { color: INK2 }, line: { type: "none" } });
  dot(s, letter, 10.9, 2.6, 2.4, color);
  s.addText(num, { x: M, y: 2.1, w: 3, h: 1.4, fontFace: HEAD, fontSize: 80, bold: true, color: color, margin: 0 });
  s.addText(name, { x: M, y: 3.55, w: 9, h: 1.0, fontFace: HEAD, fontSize: 44, bold: true, color: WHITE, margin: 0 });
  s.addText(sub, { x: M, y: 4.6, w: 9, h: 0.6, fontFace: BODY, fontSize: 18, color: tint });
  return s;
}

// ─────────────────────────────────────────────────────────── 5 · DIVIDER Dysregulation
divider("01", "Dysregulation", "Tumor vs Normal expression", TEAL, "D", TEALT);

// ─────────────────────────────────────────────────────────── 6 · Dysregulation what+source
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Dysregulation — what it is", TEAL);
  s.addText([
    { text: "Compares how strongly a gene is expressed in tumor tissue versus healthy tissue. ", options: { color: TX, fontSize: 16, breakLine: true, paraSpaceAfter: 8 } },
    { text: "A gene that is strongly over-expressed in the tumor is a candidate driver and a potential drug target.", options: { color: MUT, fontSize: 16 } },
  ], { x: M, y: 1.7, w: 6.7, h: 1.8, valign: "top" });

  s.addText("WHAT IT ADDS", { x: M, y: 3.5, w: 6.7, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: TEAL, charSpacing: 2 });
  s.addText([
    { text: "“Associated with a disease” is not the same as “actually dysregulated in the tumor.” ", options: { color: TX, fontSize: 15, breakLine: true, paraSpaceAfter: 6 } },
    { text: "This axis tests the latter — and it is exactly the signal that lifts genes like SRC, whose raw genetic score is low.", options: { color: MUT, fontSize: 15 } },
  ], { x: M, y: 3.85, w: 6.7, h: 1.8, valign: "top" });

  // source card
  const cx = 8.0, cw = 4.6;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: 1.7, w: cw, h: 4.5, fill: { color: TEALT }, rectRadius: 0.1, line: { type: "none" }, shadow: shadow() });
  s.addText("DATA SOURCE", { x: cx + 0.4, y: 2.0, w: cw - 0.8, h: 0.35, fontFace: BODY, fontSize: 12, bold: true, color: TEAL, charSpacing: 2 });
  s.addText([
    { text: "TCGA", options: { bold: true, color: "115E59", fontSize: 16 } },
    { text: "  tumor samples (178)", options: { color: INK2, fontSize: 15, breakLine: true, paraSpaceAfter: 8 } },
    { text: "GTEx", options: { bold: true, color: "115E59", fontSize: 16 } },
    { text: "  healthy pancreas (167)", options: { color: INK2, fontSize: 15, breakLine: true, paraSpaceAfter: 12 } },
    { text: "Both reprocessed through the UCSC Xena “Toil” pipeline, so tumor and normal are measured in the same units and are directly comparable.", options: { color: "115E59", fontSize: 14, breakLine: true, paraSpaceAfter: 10 } },
    { text: "Why that matters: ", options: { bold: true, color: INK2, fontSize: 13 } },
    { text: "mixing two differently-normalized datasets would make any fold-change meaningless.", options: { color: "115E59", fontSize: 13 } },
  ], { x: cx + 0.4, y: 2.4, w: cw - 0.8, h: 3.6, valign: "top" });
  footer(s, 6);
})();

// ─────────────────────────────────────────────────────────── 7 · Dysregulation terms
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Reading the panel — every term", TEAL);
  const defs = [
    ["log2 fold-change (log2FC)", "Tumor vs normal on a log2 scale. +1 = 2× higher in tumor, +2 = 4×, 0 = same, negative = lower in tumor."],
    ["▲ Up in tumor / ▼ Down", "Direction of a significant change (at least ~1.5×)."],
    ["p-value (p)", "Chance the difference is random. Small (p < 0.05) = real; p ≈ 0 = extremely significant."],
    ["Tumor / Normal median", "The middle expression value across all samples, in log2(TPM)."],
    ["TPM", "Transcripts Per Million — a standard normalized unit of gene expression."],
    ["Dysregulation bar", "The magnitude of the change (size of |log2FC|) — how strongly dysregulated."],
  ];
  layoutDefs(s, defs, TEAL);
  // high/low strip
  hilo(s, "HIGH (large +log2FC) = strongly over-expressed in tumor → strong candidate", "NEAR 0 = expressed the same as normal tissue → not dysregulated", TEAL, TEALT);
  footer(s, 7);
})();

// ─────────────────────────────────────────────────────────── 8 · DIVIDER Dependency
divider("02", "Dependency", "Does the tumor need this gene?", VIOLET, "P", VIOLETT);

// ─────────────────────────────────────────────────────────── 9 · Dependency what+source
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Dependency — what it is", VIOLET);
  s.addText([
    { text: "Uses genome-wide ", options: { color: TX, fontSize: 16 } },
    { text: "CRISPR", options: { bold: true, color: VIOLET, fontSize: 16 } },
    { text: " knockout screens to ask a direct question: if you delete this gene, do the cancer cells die?", options: { color: TX, fontSize: 16, breakLine: true, paraSpaceAfter: 8 } },
    { text: "If yes, the tumor depends on the gene to survive.", options: { color: MUT, fontSize: 16 } },
  ], { x: M, y: 1.7, w: 6.7, h: 1.9, valign: "top" });
  s.addText("WHAT IT ADDS", { x: M, y: 3.6, w: 6.7, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: VIOLET, charSpacing: 2 });
  s.addText("Separates true drivers from passengers. A frequently-mutated gene the tumor doesn’t actually need scores near zero; a real dependency scores strongly. It is the strongest causal evidence short of a clinical trial.", { x: M, y: 3.95, w: 6.7, h: 1.8, fontFace: BODY, fontSize: 15, color: MUT, valign: "top" });

  const cx = 8.0, cw = 4.6;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: 1.7, w: cw, h: 4.5, fill: { color: VIOLETT }, rectRadius: 0.1, line: { type: "none" }, shadow: shadow() });
  s.addText("DATA SOURCE", { x: cx + 0.4, y: 2.0, w: cw - 0.8, h: 0.35, fontFace: BODY, fontSize: 12, bold: true, color: VIOLET, charSpacing: 2 });
  s.addText([
    { text: "DepMap", options: { bold: true, color: "5B21B6", fontSize: 16 } },
    { text: "  (Broad Institute) — the Cancer Dependency Map.", options: { color: INK2, fontSize: 15, breakLine: true, paraSpaceAfter: 10 } },
    { text: "The ", options: { color: "4C1D95", fontSize: 14 } },
    { text: "Chronos", options: { bold: true, color: "5B21B6", fontSize: 14 } },
    { text: " algorithm scores the effect of knocking out each gene across ~1,100 cancer cell lines.", options: { color: "4C1D95", fontSize: 14, breakLine: true, paraSpaceAfter: 10 } },
    { text: "We average the ", options: { color: "4C1D95", fontSize: 14 } },
    { text: "48 pancreatic", options: { bold: true, color: "5B21B6", fontSize: 14 } },
    { text: " cell lines for this disease.", options: { color: "4C1D95", fontSize: 14 } },
  ], { x: cx + 0.4, y: 2.4, w: cw - 0.8, h: 3.6, valign: "top" });
  footer(s, 9);
})();

// ─────────────────────────────────────────────────────────── 10 · Dependency terms
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Reading the panel — every term", VIOLET);
  const defs = [
    ["Mean gene-effect (Chronos)", "Average effect of knocking the gene out. 0 = no effect, −1 = median common-essential (strong), positive = knockout helps growth."],
    ["Class", "Strong dependency (< −1) · Dependency (< −0.5) · Weak (< −0.1) · Not dependent."],
    ["48 pancreatic lines", "Number of pancreatic cancer cell lines screened and averaged."],
    ["Dependency strength bar", "The scaled magnitude of the dependency (0 to 100%)."],
    ["% of lines dependent", "Fraction of the cell lines where gene-effect is below −0.5."],
    ["Strongest line", "The single most dependent cell line (most negative value)."],
  ];
  layoutDefs(s, defs, VIOLET);
  hilo(s, "MORE NEGATIVE = stronger dependency → tumor needs it → better target", "POSITIVE / near 0 = the tumor does not need it (e.g. tumor suppressors)", VIOLET, VIOLETT);
  footer(s, 10);
})();

// ─────────────────────────────────────────────────────────── 11 · DIVIDER Safety
divider("03", "Safety", "Is it safe to drug?", AMBER, "S", AMBERT);

// ─────────────────────────────────────────────────────────── 12 · Safety what+source+terms
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Safety — what it is, and every term", AMBER);
  s.addText([
    { text: "Measures how strongly the human population tolerates ", options: { color: TX, fontSize: 15.5 } },
    { text: "losing", options: { italic: true, color: TX, fontSize: 15.5 } },
    { text: " this gene. A gene humans cannot afford to break is essential — drugging it by knockdown risks toxicity. ", options: { color: TX, fontSize: 15.5, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Source: ", options: { bold: true, color: AMBER, fontSize: 14 } },
    { text: "gnomAD (Genome Aggregation Database) — constraint metrics from ~800,000 human genomes.", options: { color: MUT, fontSize: 14 } },
  ], { x: M, y: 1.65, w: 6.6, h: 2.4, valign: "top" });

  const defs = [
    ["pLI", "Probability of Loss-of-function Intolerance (0–1). ≥ 0.9 = the gene cannot tolerate being knocked out."],
    ["LOEUF", "LoF Observed/Expected Upper bound Fraction. Lower = more constrained; < 0.6 = constrained (gnomAD v4)."],
    ["LoF", "Loss of Function — variants that break the gene."],
    ["Knockdown safety concern", "0–100%, derived from LOEUF/pLI: higher = more on-target toxicity risk."],
  ];
  // right column defs
  let y = 1.65; const cx = 7.5, cw = W - M - cx;
  defs.forEach(([t, d]) => {
    s.addText([
      { text: t + "  ", options: { bold: true, color: AMBER, fontSize: 14.5 } },
      { text: d, options: { color: TX, fontSize: 13 } },
    ], { x: cx, y, w: cw, h: 1.0, valign: "top" });
    y += 1.06;
  });
  hilo(s, "HIGH pLI / LOW LOEUF = constrained, essential in healthy cells → caution flag",
    "NOT a disqualifier: KRAS and SRC are highly constrained yet remain prime targets", AMBER, AMBERT);
  footer(s, 12);
})();

// ─────────────────────────────────────────────────────────── 13 · REAL COHORTS
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Built on real cohort data — not estimates");
  s.addText("Every value traces back to a named public cohort of real samples — no invented or simulated numbers.", { x: M, y: 1.32, w: W - 2 * M, h: 0.4, fontFace: BODY, fontSize: 15, color: MUT });
  const stats = [
    { n: "178", c: TEAL, l: "pancreatic tumor patients", sub: "TCGA — sequenced tumors" },
    { n: "167", c: TEAL, l: "healthy pancreas samples", sub: "GTEx — normal tissue" },
    { n: "48", c: VIOLET, l: "pancreatic cancer cell lines", sub: "DepMap — CRISPR screens" },
    { n: "~800k", c: AMBER, l: "human genomes", sub: "gnomAD — population constraint" },
  ];
  const cw = 2.83, gap = 0.37, y = 2.05, ch = 3.3; let x = M;
  stats.forEach(st => {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, rectRadius: 0.1, line: { color: LINEC, width: 1 }, shadow: shadow() });
    s.addText(st.n, { x: x + 0.2, y: y + 0.45, w: cw - 0.4, h: 1.1, fontFace: HEAD, fontSize: 46, bold: true, color: st.c, align: "center", valign: "middle", margin: 0 });
    s.addText(st.l, { x: x + 0.25, y: y + 1.65, w: cw - 0.5, h: 0.9, fontFace: BODY, fontSize: 15, bold: true, color: TX, align: "center", valign: "top" });
    s.addText(st.sub, { x: x + 0.25, y: y + 2.55, w: cw - 0.5, h: 0.6, fontFace: BODY, fontSize: 12, color: MUT, align: "center", valign: "top" });
    x += cw + gap;
  });
  s.addText("A “cohort” is a defined group of real samples — patients, tissues, cell lines, or people — that the measurements are taken from.", { x: M, y: 5.75, w: W - 2 * M, h: 0.5, fontFace: BODY, fontSize: 12.5, italic: true, color: MUT });
  footer(s, 13);
})();

// ─────────────────────────────────────────────────────────── 14 · HOW COMPUTED
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "How each number is computed");
  const cards = [
    { c: TEAL, L: "D", name: "Dysregulation", steps: "Take each gene's expression across the 178 tumors and the 167 healthy samples, compare the median of each group, and report the difference as a log2 fold-change.\n\nBoth groups run through the same UCSC Xena “Toil” pipeline, so tumor and normal are measured the same way and can be compared fairly." },
    { c: VIOLET, L: "P", name: "Dependency", steps: "DepMap used CRISPR to knock out (disable) each gene, one at a time, in cancer cell lines, and measured whether the cells still survived.\n\nWe keep the 48 pancreatic lines and average each gene's effect. Around −1 = strong dependency — the cells need that gene." },
    { c: AMBER, L: "S", name: "Safety", steps: "gnomAD checked ~800,000 healthy people for naturally-broken copies of each gene.\n\nAlmost no broken copies = the gene is essential = a caution flag (pLI / LOEUF). Many broken copies = losing it is tolerated, so it is safer." },
  ];
  const cw = 3.78, gap = 0.45, y = 1.55, ch = 4.05; let x = M;
  cards.forEach(cd => {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, rectRadius: 0.1, line: { color: LINEC, width: 1 }, shadow: shadow() });
    dot(s, cd.L, x + 0.35, y + 0.35, 0.7, cd.c);
    s.addText(cd.name, { x: x + 1.2, y: y + 0.37, w: cw - 1.4, h: 0.7, fontFace: HEAD, fontSize: 17, bold: true, color: cd.c, valign: "middle", margin: 0 });
    s.addText(cd.steps, { x: x + 0.35, y: y + 1.25, w: cw - 0.7, h: 2.65, fontFace: BODY, fontSize: 12.5, color: TX, valign: "top" });
    x += cw + gap;
  });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 5.82, w: W - 2 * M, h: 0.95, fill: { color: TINT }, rectRadius: 0.08, line: { type: "none" } });
  s.addText([
    { text: "In plain terms:   ", options: { bold: true, color: TX, fontSize: 12.5 } },
    { text: "“Knock out” = break a gene so it makes no working product.    “Toil pipeline” = one uniform processing so TCGA tumor and GTEx normal can be compared fairly.", options: { color: MUT, fontSize: 12.5 } },
  ], { x: M + 0.35, y: 5.95, w: W - 2 * M - 0.7, h: 0.7, valign: "middle" });
  footer(s, 14);
})();

// ─────────────────────────────────────────────────────────── 15 · PANCREATIC NUMBERS
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Pancreatic cancer — real numbers");
  const rows = [
    [{ text: "Gene", options: { bold: true, color: WHITE, fill: { color: INK }, align: "left" } },
     { text: "Dysregulation (log2FC)", options: { bold: true, color: WHITE, fill: { color: TEAL }, align: "center" } },
     { text: "Dependency (Chronos)", options: { bold: true, color: WHITE, fill: { color: VIOLET }, align: "center" } },
     { text: "Safety (pLI / LOEUF)", options: { bold: true, color: WHITE, fill: { color: AMBER }, align: "center" } },
     { text: "Read", options: { bold: true, color: WHITE, fill: { color: INK }, align: "left" } }],
  ];
  const data = [
    ["KRAS", "+1.94  ▲", "−2.14  (96%)", "1.00 / 0.23", "Driver: up, essential, constrained"],
    ["SRC", "+1.46  ▲", "−0.22", "1.00 / 0.33", "Recovered by expression + druggability"],
    ["TP53", "+1.90  ▲", "+0.24", "1.00 / 0.42", "Tumor suppressor — not a dependency"],
    ["CEACAM5", "+10.9  ▲", "—", "—", "Classic pancreatic tumor marker"],
    ["RPL3", "—", "−2.52 (100%)", "—", "Common-essential (ribosome) control"],
  ];
  data.forEach((r, i) => {
    const bg = i % 2 ? "FFFFFF" : "F8FAFC";
    rows.push(r.map((c, j) => ({ text: c, options: { color: j === 0 ? TX : (j === 4 ? MUT : INK2), bold: j === 0, fill: { color: bg }, align: j === 0 || j === 4 ? "left" : "center", fontSize: 13 } })));
  });
  s.addTable(rows, { x: M, y: 1.7, w: W - 2 * M, colW: [1.5, 2.7, 2.7, 2.2, 2.83], rowH: 0.62, border: { type: "solid", pt: 0.5, color: LINEC }, fontFace: BODY, fontSize: 13, valign: "middle", align: "left", margin: [4, 6, 4, 6] });
  s.addText("Every value comes from a named public dataset — gnomAD live, TCGA/GTEx and DepMap from the preloaded tables. “—” = not applicable for that gene.", { x: M, y: 5.95, w: W - 2 * M, h: 0.6, fontFace: BODY, fontSize: 12.5, italic: true, color: MUT });
  footer(s, 15);
})();

// ─────────────────────────────────────────────────────────── 14 · OTHER DISEASES
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Beyond pancreatic — other diseases");
  const cards = [
    { c: TEAL, t: TEALT, L: "D", name: "Dysregulation", body: "Works for any cancer with TCGA tumor + GTEx normal tissue (breast, glioblastoma, lung…). Rebuild the table per disease. Non-cancer needs that disease’s tissue vs normal.", tag: "Disease-specific" },
    { c: VIOLET, t: VIOLETT, L: "P", name: "Dependency", body: "DepMap covers ~30 cancer lineages — just slice the relevant one. Most powerful for cancers; limited for non-cancer disease (it is cancer-cell-line based).", tag: "Lineage-specific" },
    { c: AMBER, t: AMBERT, L: "S", name: "Safety", body: "Constraint is a property of the gene, not the disease. The same pLI / LOEUF applies to every disease — works everywhere as-is, no rebuild.", tag: "Universal" },
  ];
  const cw = 3.78, gap = 0.45, y = 1.75, ch = 4.4; let x = M;
  cards.forEach(cd => {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, rectRadius: 0.1, line: { color: LINEC, width: 1 }, shadow: shadow() });
    dot(s, cd.L, x + 0.4, y + 0.4, 0.8, cd.c);
    s.addText(cd.name, { x: x + 1.3, y: y + 0.42, w: cw - 1.5, h: 0.8, fontFace: HEAD, fontSize: 18, bold: true, color: cd.c, valign: "middle", margin: 0 });
    s.addText(cd.body, { x: x + 0.4, y: y + 1.5, w: cw - 0.8, h: 2.1, fontFace: BODY, fontSize: 13.5, color: TX, valign: "top" });
    chip(s, cd.tag, x + 0.4, y + ch - 0.75, cd.t, cd.c, cw - 0.8);
    x += cw + gap;
  });
  footer(s, 16);
})();

// ─────────────────────────────────────────────────────────── 15 · GLOSSARY
(() => {
  const s = p.addSlide(); s.background = { color: WHITE };
  title(s, "Glossary — abbreviations on screen");
  const head = ["Term", "Stands for", "Meaning"].map(h => ({ text: h, options: { bold: true, color: WHITE, fill: { color: INK }, fontSize: 13 } }));
  const g = [
    ["TCGA", "The Cancer Genome Atlas", "Reference database of tumor genomics / expression."],
    ["GTEx", "Genotype-Tissue Expression", "Reference expression from healthy human tissues."],
    ["TPM", "Transcripts Per Million", "Normalized unit of gene expression."],
    ["log2FC", "log2 fold-change", "Tumor vs normal expression ratio, on a log2 scale."],
    ["DepMap", "Cancer Dependency Map", "CRISPR knockout screens across cancer cell lines."],
    ["CRISPR", "(gene-knockout technology)", "Used to delete each gene and measure the effect."],
    ["Chronos", "DepMap gene-effect model", "0 = no effect, −1 = strong (common-essential)."],
    ["gnomAD", "Genome Aggregation Database", "Constraint metrics from ~800k human genomes."],
    ["pLI", "prob. of LoF Intolerance", "≥ 0.9 = gene cannot tolerate being knocked out."],
    ["LOEUF", "LoF Obs/Exp Upper Fraction", "Lower = more constrained; < 0.6 = constrained."],
    ["LoF", "Loss of Function", "Variants that break the gene."],
  ];
  const body = g.map((r, i) => r.map((c, j) => ({ text: c, options: { bold: j === 0, color: j === 0 ? BRAND : (j === 1 ? TX : MUT), fill: { color: i % 2 ? "FFFFFF" : "F8FAFC" }, fontSize: 11.5 } })));
  s.addTable([head, ...body], { x: M, y: 1.65, w: W - 2 * M, colW: [1.7, 3.4, 6.83], rowH: 0.42, border: { type: "solid", pt: 0.5, color: LINEC }, fontFace: BODY, fontSize: 11.5, valign: "middle", margin: [3, 6, 3, 6] });
  footer(s, 17);
})();

// ─────────────────────────────────────────────────────────── 16 · SUMMARY
(() => {
  const s = p.addSlide(); s.background = { color: INK };
  s.addShape(p.shapes.OVAL, { x: -2, y: 4.0, w: 6, h: 6, fill: { color: INK2 }, line: { type: "none" } });
  s.addText("TAKEAWAY", { x: M, y: 1.0, w: 8, h: 0.4, fontFace: BODY, fontSize: 13, bold: true, color: "7DD3FC", charSpacing: 3 });
  s.addText("Three independent axes, one clearer picture", { x: M, y: 1.5, w: 11.5, h: 1.2, fontFace: HEAD, fontSize: 36, bold: true, color: WHITE, margin: 0 });
  const items = [
    { c: TEAL, L: "D", h: "Dysregulation", d: "Is it abnormally expressed in the tumor?" },
    { c: VIOLET, L: "P", h: "Dependency", d: "Does the tumor need it to survive?" },
    { c: AMBER, L: "S", h: "Safety", d: "Is it safe to drug, or essential to healthy cells?" },
  ];
  let y = 3.0;
  items.forEach(it => {
    dot(s, it.L, M, y, 0.7, it.c);
    s.addText([
      { text: it.h + "   ", options: { bold: true, color: WHITE, fontSize: 18 } },
      { text: it.d, options: { color: LT, fontSize: 16 } },
    ], { x: M + 1.0, y: y, w: 10, h: 0.7, valign: "middle", margin: 0 });
    y += 0.95;
  });
  s.addText("Together they recover targets — like SRC — that single-source scoring buries.", { x: M, y: 6.1, w: 11.5, h: 0.6, fontFace: BODY, fontSize: 16, italic: true, color: "7DD3FC" });
})();

// shared: two-column definition layout (6 items)
function layoutDefs(s, defs, color) {
  const colW = 5.7, x2 = M + colW + 0.45, rowH = 1.18; let yTop = 1.65;
  defs.forEach((d, i) => {
    const col = i < 3 ? M : x2;
    const row = i % 3;
    const y = yTop + row * rowH;
    s.addText([
      { text: d[0], options: { bold: true, color: color, fontSize: 14.5, breakLine: true } },
      { text: d[1], options: { color: TX, fontSize: 12.5 } },
    ], { x: col, y, w: colW, h: rowH - 0.1, valign: "top" });
  });
}
// shared: high/low strip near bottom
function hilo(s, hi, lo, color, tint) {
  const y = 5.55, w = (W - 2 * M - 0.4) / 2;
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y, w, h: 1.15, fill: { color: tint }, rectRadius: 0.08, line: { type: "none" } });
  s.addText(hi, { x: M + 0.3, y: y + 0.15, w: w - 0.6, h: 0.85, fontFace: BODY, fontSize: 12.5, color: INK2, valign: "middle" });
  s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M + w + 0.4, y, w, h: 1.15, fill: { color: TINT }, rectRadius: 0.08, line: { type: "none" } });
  s.addText(lo, { x: M + w + 0.7, y: y + 0.15, w: w - 0.6, h: 0.85, fontFace: BODY, fontSize: 12.5, color: MUT, valign: "middle" });
}

const OUT = process.env.DECK_OUT || "documentation/Disease2Target_Evidence_Axes_Demo.pptx";
p.writeFile({ fileName: OUT }).then(() => console.log("WROTE " + OUT));
