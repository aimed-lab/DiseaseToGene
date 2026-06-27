const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
pres.author = "Nikhil Kurmachalam";
pres.title = "Disease2Target — Demo, Progress & Roadmap";

const W = 13.33, H = 7.5;
const NAVY = "0B2545", NAVY2 = "13315C", TEAL = "0F766E", TEAL2 = "14B8A6",
      MINT = "5EEAD4", AMBER = "F59E0B", RED = "DC2626", GREEN = "16A34A",
      YELLOW = "CA8A04", LIGHT = "F6F8FB", CARD = "FFFFFF", INK = "0F172A",
      MUTED = "64748B", LINE = "E2E8F0", MONO = "Consolas";
const HF = "Georgia", BF = "Calibri";
const sh = () => ({ type: "outer", color: "0B2545", blur: 9, offset: 3, angle: 135, opacity: 0.16 });

function footer(slide, n, dark) {
  slide.addText("Disease2Target · Content-Centric Target Discovery", { x: 0.6, y: H - 0.42, w: 9, h: 0.3, fontFace: BF, fontSize: 9, color: dark ? "8FA6C4" : MUTED, align: "left", margin: 0 });
  slide.addText(String(n), { x: W - 1.1, y: H - 0.42, w: 0.5, h: 0.3, fontFace: BF, fontSize: 9, color: dark ? "8FA6C4" : MUTED, align: "right", margin: 0 });
}
function title(slide, text, kicker) {
  if (kicker) slide.addText(kicker.toUpperCase(), { x: 0.6, y: 0.42, w: 12, h: 0.3, fontFace: BF, fontSize: 12, bold: true, color: TEAL, charSpacing: 3, margin: 0 });
  slide.addText(text, { x: 0.6, y: kicker ? 0.72 : 0.5, w: 12.1, h: 0.85, fontFace: HF, fontSize: 28, bold: true, color: INK, margin: 0 });
}
function dot(slide, x, y, color) { slide.addShape(pres.shapes.OVAL, { x, y, w: 0.16, h: 0.16, fill: { color } }); }

// helper for the Added / Why / Got demo slides
function demoSlide(kicker, ttl, rows) {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, ttl, kicker);
  let y = 1.95; const h = 1.42, gap = 0.22;
  rows.forEach((r) => {
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y, w: 12.1, h, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y, w: 2.1, h, fill: { color: r[1] } });
    s.addText(r[0], { x: 0.6, y, w: 2.1, h, fontFace: BF, fontSize: 15, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    s.addText(r[2], { x: 2.95, y: y + 0.1, w: 9.5, h: h - 0.2, fontFace: BF, fontSize: 14.5, color: INK, valign: "middle", margin: 0 });
    y += h + gap;
  });
  return s;
}

// ── 1. Title ────────────────────────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addShape(pres.shapes.OVAL, { x: 10.6, y: -1.2, w: 4.2, h: 4.2, fill: { color: NAVY2 } });
  s.addShape(pres.shapes.OVAL, { x: 11.9, y: 4.6, w: 3.2, h: 3.2, fill: { color: TEAL } });
  s.addShape(pres.shapes.OVAL, { x: 9.9, y: 5.3, w: 1.4, h: 1.4, fill: { color: AMBER } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 2.05, w: 0.12, h: 2.7, fill: { color: TEAL2 } });
  s.addText("DISEASE2TARGET", { x: 0.95, y: 1.55, w: 10, h: 0.4, fontFace: BF, fontSize: 14, bold: true, color: MINT, charSpacing: 5, margin: 0 });
  s.addText("What we built, why it matters,\nand where the data goes next", { x: 0.9, y: 2.0, w: 9.4, h: 1.7, fontFace: HF, fontSize: 33, bold: true, color: "FFFFFF", lineSpacingMultiple: 1.05, margin: 0 });
  s.addText("A content-centric, traceable target-discovery engine  ·  Pancreatic cancer first", { x: 0.95, y: 3.95, w: 11, h: 0.4, fontFace: BF, fontSize: 16, color: MINT, margin: 0 });
  s.addText([{ text: "Nikhil Kurmachalam", options: { bold: true } }, { text: "    June 2026", options: { color: "8FA6C4" } }], { x: 0.95, y: 5.7, w: 11, h: 0.35, fontFace: BF, fontSize: 13, color: "FFFFFF", margin: 0 });
  s.addText("github.com/aimed-lab/DiseaseToGene   ·   disease-to-gene.vercel.app", { x: 0.95, y: 6.05, w: 11, h: 0.35, fontFace: BF, fontSize: 12, color: "8FA6C4", margin: 0 });
})();

// ── 2. The reframe ───────────────────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "The reframe: from running a process to building content", "Why this work");
  const colW = 5.75, y = 2.0, h = 3.4;
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y, w: colW, h, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y, w: 0.1, h, fill: { color: RED } });
  s.addText("BEFORE — process-centric", { x: 0.95, y: y + 0.25, w: colW - 0.6, h: 0.4, fontFace: BF, fontSize: 14, bold: true, color: RED, margin: 0 });
  s.addText([
    { text: "Select disease", options: { bullet: true, breakLine: true } },
    { text: "Call the APIs on the spot", options: { bullet: true, breakLine: true } },
    { text: "Show the result on screen", options: { bullet: true, breakLine: true } },
    { text: "Lost on refresh — nothing stored", options: { bullet: true } },
  ], { x: 0.95, y: y + 0.85, w: colW - 0.7, h: h - 1.1, fontFace: BF, fontSize: 15, color: INK, paraSpaceAfter: 8, margin: 0 });
  const x2 = 7.0;
  s.addShape(pres.shapes.RECTANGLE, { x: x2, y, w: colW, h, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
  s.addShape(pres.shapes.RECTANGLE, { x: x2, y, w: 0.1, h, fill: { color: TEAL } });
  s.addText("NOW — content-centric", { x: x2 + 0.35, y: y + 0.25, w: colW - 0.6, h: 0.4, fontFace: BF, fontSize: 14, bold: true, color: TEAL, margin: 0 });
  s.addText([
    { text: "Collect evidence from named sources", options: { bullet: true, breakLine: true } },
    { text: "Process with reproducible code", options: { bullet: true, breakLine: true } },
    { text: "Store permanent disease–target content", options: { bullet: true, breakLine: true } },
    { text: "Version it · audit it · reuse it", options: { bullet: true } },
  ], { x: x2 + 0.35, y: y + 0.85, w: colW - 0.7, h: h - 1.1, fontFace: BF, fontSize: 15, color: INK, paraSpaceAfter: 8, margin: 0 });
  s.addText("Guiding test:  does the feature produce stored, sourced, reusable content — not just a transient on-screen answer?", { x: 0.6, y: 5.75, w: 12.1, h: 0.7, fontFace: BF, fontSize: 14, italic: true, color: MUTED, align: "center", margin: 0 });
  footer(s, 2);
})();

// ── 3. What we added (demo map) ──────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "What we added this cycle — we'll demo each", "The demo");
  const cards = [
    ["1", "Mutation axis", "cBioPortal", "Cancer genes now resolve to the mutation level — KRAS → G12D.", AMBER],
    ["2", "Paper → evidence", "PDF + AI", "Upload a paper; genes, drugs and outcomes extracted with source quotes.", TEAL2],
    ["3", "Store + reuse", "Supabase", "Full evidence per gene stored with provenance, highlighted, and reused in the ranking.", TEAL],
  ];
  const cw = 3.95, ch = 3.9, gap = 0.3, y = 2.0;
  let x = 0.6;
  cards.forEach((c) => {
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.12, fill: { color: c[4] } });
    s.addShape(pres.shapes.OVAL, { x: x + cw / 2 - 0.45, y: y + 0.45, w: 0.9, h: 0.9, fill: { color: c[4] } });
    s.addText(c[0], { x: x + cw / 2 - 0.45, y: y + 0.45, w: 0.9, h: 0.9, fontFace: HF, fontSize: 30, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    s.addText(c[1], { x: x + 0.2, y: y + 1.6, w: cw - 0.4, h: 0.5, fontFace: BF, fontSize: 19, bold: true, color: INK, align: "center", margin: 0 });
    s.addText(c[2], { x: x + 0.2, y: y + 2.1, w: cw - 0.4, h: 0.35, fontFace: MONO, fontSize: 12, color: c[4], align: "center", margin: 0 });
    s.addText(c[3], { x: x + 0.3, y: y + 2.55, w: cw - 0.6, h: 1.1, fontFace: BF, fontSize: 13, color: MUTED, align: "center", margin: 0 });
    x += cw + gap;
  });
  footer(s, 3);
})();

// ── 4. Demo: Mutation axis ───────────────────────────────────────────────────
(() => {
  const s = demoSlide("Demo 1 · cBioPortal", "Mutation axis: gene → mutation → frequency", [
    ["WHAT WE ADDED", AMBER, "For cancer genes we now pull per-patient mutation data from cBioPortal (public, no key) and show frequency + hotspot variants on the gene card."],
    ["WHY", NAVY2, "“KRAS is associated” isn't enough for cancer — drugs target specific mutations, so we need gene → mutation depth, not protein level only."],
    ["WHAT WE GOT", GREEN, "KRAS in pancreatic cancer: mutated in 66% of tumors, dominant variant G12D (41%) — sourced to TCGA PanCancer Atlas, with retrieval date."],
  ]);
  footer(s, 4);
})();

// ── 5. Demo: Paper → evidence ────────────────────────────────────────────────
(() => {
  const s = demoSlide("Demo 2 · Papers", "Paper → structured, sourced evidence", [
    ["WHAT WE ADDED", TEAL2, "Upload a PDF → Gemini extracts genes, drugs, mutations and outcomes — each fact keeps the exact source sentence — stored as evidence cards."],
    ["WHY", NAVY2, "Papers are high-value content, and no single API gives the mutation→drug link — so we extract it and keep it as stored, sourced, reusable content, not a transient answer."],
    ["WHAT WE GOT", GREEN, "The SRC paper → 6 evidence cards (Dasatinib/Bosutinib → SRC, Sotorasib → KRAS G12C) with verbatim quotes, tagged AI-extracted."],
  ]);
  footer(s, 5);
})();

// ── 6. Demo: Store + harvest + reuse ─────────────────────────────────────────
(() => {
  const s = demoSlide("Demo 3 · Content store", "Store the evidence — then reuse it", [
    ["WHAT WE ADDED", TEAL, "A gene_content store + a “Harvest” button that loops loaded genes and saves the full profile: scores, clinical, literature, ChEMBL, mutations."],
    ["WHY", NAVY2, "So results are stored, reusable and refreshable — not re-fetched on every click. This is the foundation for daily updates and benchmarking."],
    ["WHAT WE GOT", GREEN, "Genes already in the ranking with stored evidence (e.g. KRAS) show an EVIDENCE badge; click → the Stored Evidence panel shows the sourced cards. Next: surface stored genes Open Targets misses, like SRC."],
  ]);
  footer(s, 6);
})();

// ── 7. Mutation chart ────────────────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "The result, concretely — KRAS variants in PDAC", "cBioPortal data");
  s.addChart(pres.charts.BAR, [{ name: "Share of mutated samples (%)", labels: ["G12D", "G12V", "G12R", "Q61H", "G12C", "Other"], values: [41, 28, 21, 5, 1, 4] }], {
    x: 0.6, y: 1.85, w: 7.6, h: 4.7, barDir: "col",
    chartColors: [AMBER, AMBER, AMBER, TEAL, GREEN, MUTED], chartArea: { fill: { color: LIGHT } },
    catAxisLabelColor: MUTED, valAxisLabelColor: MUTED, catAxisLabelFontFace: BF, valAxisLabelFontFace: BF,
    valGridLine: { color: LINE, size: 0.5 }, catGridLine: { style: "none" },
    showValue: true, dataLabelPosition: "outEnd", dataLabelColor: INK, dataLabelFontBold: true, dataLabelFontFace: BF,
    showLegend: false, valAxisMaxVal: 50, valAxisMinVal: 0,
  });
  const x = 8.55, w = 4.2;
  s.addShape(pres.shapes.RECTANGLE, { x, y: 1.95, w, h: 4.45, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
  s.addText("Why it matters", { x: x + 0.3, y: 2.2, w: w - 0.6, h: 0.4, fontFace: BF, fontSize: 16, bold: true, color: TEAL, margin: 0 });
  s.addText([
    { text: "119 of 179 sequenced PDAC tumors are KRAS-mutated.", options: { bullet: true, breakLine: true } },
    { text: "G12D / G12V / G12R ≈ 90% — the common variants.", options: { bullet: true, breakLine: true } },
    { text: "G12C (1%) → sotorasib, adagrasib (approved).", options: { bullet: true, breakLine: true } },
    { text: "G12D/V/R → daraxonrasib (Phase 3, 2026) — the new option.", options: { bullet: true } },
  ], { x: x + 0.3, y: 2.65, w: w - 0.6, h: 2.8, fontFace: BF, fontSize: 13, color: INK, paraSpaceAfter: 10, margin: 0 });
  s.addText("Source: TCGA PanCancer Atlas (paad_tcga_pan_can_atlas_2018) · retrieved 2026-06-13", { x: x + 0.3, y: 5.95, w: w - 0.6, h: 0.4, fontFace: BF, fontSize: 9.5, italic: true, color: MUTED, margin: 0 });
  footer(s, 7);
})();

// ── 8. Where the data lives & why ────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "Where the data lives — and where it goes next", "Storage model");
  // left: tables today
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.95, w: 6.1, h: 4.45, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
  s.addText("Stored today — Supabase (Postgres)", { x: 0.9, y: 2.2, w: 5.5, h: 0.4, fontFace: BF, fontSize: 16, bold: true, color: TEAL, margin: 0 });
  const tables = [
    ["papers", "one row per ingested paper"],
    ["evidence_cards", "one fact per gene/drug/mutation + source quote"],
    ["gene_content", "full evidence profile per (disease, gene)"],
    ["target_ranking_snapshots", "versioned ranking history"],
  ];
  let yy = 2.75;
  tables.forEach((t) => {
    s.addText(t[0], { x: 0.95, y: yy, w: 3.0, h: 0.35, fontFace: MONO, fontSize: 12.5, bold: true, color: NAVY2, margin: 0 });
    s.addText(t[1], { x: 0.95, y: yy + 0.32, w: 5.4, h: 0.4, fontFace: BF, fontSize: 12, color: MUTED, margin: 0 });
    yy += 0.88;
  });
  // right: why + next
  s.addShape(pres.shapes.RECTANGLE, { x: 7.0, y: 1.95, w: 5.7, h: 4.45, fill: { color: NAVY }, line: { color: NAVY, width: 1 }, shadow: sh() });
  s.addText("Why here, and where next", { x: 7.3, y: 2.2, w: 5.1, h: 0.4, fontFace: BF, fontSize: 16, bold: true, color: MINT, margin: 0 });
  s.addText([
    { text: "Supabase now — Postgres, row-level security, fast, free interim store. Already wired into the app.", options: { bullet: true, breakLine: true } },
    { text: "Oracle next — migrate the structured, high-value content (genes, evidence, scores, audit) to the lab's Oracle DB.", options: { bullet: true, breakLine: true } },
    { text: "Wiki / LLM — long-form: paper summaries, notes, manuscript drafts.", options: { bullet: true } },
  ], { x: 7.3, y: 2.7, w: 5.1, h: 3.5, fontFace: BF, fontSize: 13.5, color: "E6EEF8", paraSpaceAfter: 12, margin: 0 });
  footer(s, 8);
})();

// ── 9. Trust layer (honest: in place vs proposed) ────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "Trackable & trustworthy — where we are", "Trust layer");
  // in place
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.95, w: 5.95, h: 4.4, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.95, w: 5.95, h: 0.55, fill: { color: GREEN } });
  s.addText("IN PLACE TODAY", { x: 0.6, y: 1.95, w: 5.95, h: 0.55, fontFace: BF, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle", charSpacing: 2, margin: 0 });
  s.addText([
    { text: "Source + retrieval date on harvested content", options: { bullet: true, breakLine: true } },
    { text: "Exact source sentence on every evidence card", options: { bullet: true, breakLine: true } },
    { text: "audit_status field (default: AI-extracted)", options: { bullet: true, breakLine: true } },
    { text: "Scores by code, not AI (reproducible)", options: { bullet: true } },
  ], { x: 0.95, y: 2.75, w: 5.3, h: 3.4, fontFace: BF, fontSize: 14, color: INK, paraSpaceAfter: 12, margin: 0 });
  // proposed
  s.addShape(pres.shapes.RECTANGLE, { x: 6.75, y: 1.95, w: 5.95, h: 4.4, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
  s.addShape(pres.shapes.RECTANGLE, { x: 6.75, y: 1.95, w: 5.95, h: 0.55, fill: { color: AMBER } });
  s.addText("PROPOSED (NEXT)", { x: 6.75, y: 1.95, w: 5.95, h: 0.55, fontFace: BF, fontSize: 14, bold: true, color: "FFFFFF", align: "center", valign: "middle", charSpacing: 2, margin: 0 });
  s.addText([
    { text: "Audit lifecycle: Extracted → Pending → Verified / Rejected", options: { bullet: true, breakLine: true } },
    { text: "Audit agent re-checks each fact against its source", options: { bullet: true, breakLine: true } },
    { text: "Generated-by + agent version + content version", options: { bullet: true, breakLine: true } },
    { text: "“Verify” button: promote to human-verified", options: { bullet: true } },
  ], { x: 7.1, y: 2.75, w: 5.3, h: 3.4, fontFace: BF, fontSize: 14, color: INK, paraSpaceAfter: 12, margin: 0 });
  footer(s, 9);
})();

// ── 10. Status scorecard ─────────────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "Where we stand today", "Status");
  const cols = [
    ["DONE", GREEN, ["Content-centric storage", "Mutation-level evidence", "Paper-derived genes + sources", "Code-for-scores, AI-for-reading", "KRAS benchmark (mostly)"]],
    ["IN PROGRESS", YELLOW, ["Pancreatic proof of concept", "SRC case-study package", "Uniform traceability stamp", "Network methods (RWR/WINNER)", "Label OT as one source"]],
    ["NEXT", RED, ["Gene × Source matrix", "Audit + ingestion agents", "Benchmark recovery view", "Push content to Oracle", "GeneTerrain export · Alzheimer's"]],
  ];
  const cw = 3.95, ch = 4.45, y = 1.95, gap = 0.3;
  let x = 0.6;
  cols.forEach((c) => {
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: 0.55, fill: { color: c[1] } });
    s.addText(c[0], { x, y, w: cw, h: 0.55, fontFace: BF, fontSize: 15, bold: true, color: "FFFFFF", align: "center", valign: "middle", charSpacing: 2, margin: 0 });
    let yy = y + 0.8;
    c[2].forEach((item) => {
      dot(s, x + 0.32, yy + 0.07, c[1]);
      s.addText(item, { x: x + 0.62, y: yy - 0.05, w: cw - 0.85, h: 0.55, fontFace: BF, fontSize: 13, color: INK, valign: "top", margin: 0 });
      yy += 0.72;
    });
    x += cw + gap;
  });
  footer(s, 10);
})();

// ── 11. Source separation matrix ─────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "Next priority: separate GET by source", "Next priority");
  const hdr = (t) => ({ text: t, options: { fill: { color: NAVY }, color: "FFFFFF", bold: true, fontFace: BF, fontSize: 12, align: "center", valign: "middle" } });
  const cell = (t, color) => ({ text: t, options: { color: color || INK, bold: !!color, fontFace: BF, fontSize: 12.5, align: "center", valign: "middle" } });
  const rows = [
    [hdr("Gene"), hdr("Open Targets"), hdr("Paper"), hdr("Expression"), hdr("Clinical"), hdr("ChEMBL"), hdr("Mutation"), hdr("Foundation model")],
    [cell("KRAS", NAVY2), cell("Yes", GREEN), cell("Yes", GREEN), cell("Yes", GREEN), cell("Yes", GREEN), cell("Yes", GREEN), cell("Yes", GREEN), cell("No", MUTED)],
    [cell("SRC", NAVY2), cell("Yes", GREEN), cell("Yes", GREEN), cell("Yes", GREEN), cell("Possible", YELLOW), cell("Yes", GREEN), cell("Pending", YELLOW), cell("Pending", YELLOW)],
    [cell("MYC", NAVY2), cell("Yes", GREEN), cell("Yes", GREEN), cell("Possible", YELLOW), cell("Possible", YELLOW), cell("Yes", GREEN), cell("Pending", YELLOW), cell("No", MUTED)],
  ];
  s.addTable(rows, { x: 0.6, y: 2.1, w: 12.1, colW: [1.4, 1.75, 1.35, 1.6, 1.4, 1.4, 1.4, 1.8], rowH: [0.7, 0.7, 0.7, 0.7], border: { pt: 1, color: LINE }, fill: { color: CARD }, valign: "middle" });
  s.addText("A clear next step: show every gene's evidence broken out by source. Every value above is buildable from data we already store.", { x: 0.6, y: 5.4, w: 12.1, h: 0.7, fontFace: BF, fontSize: 14, italic: true, color: MUTED, align: "center", margin: 0 });
  footer(s, 11);
})();

// ── 12. Version history & documentation ──────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "Version history & documentation", "Case-study discipline");
  // left: working directory
  s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 1.95, w: 6.1, h: 4.45, fill: { color: NAVY }, line: { color: NAVY, width: 1 }, shadow: sh() });
  s.addText("Working directory (per disease)", { x: 0.9, y: 2.2, w: 5.5, h: 0.4, fontFace: BF, fontSize: 15, bold: true, color: MINT, margin: 0 });
  s.addText([
    { text: "pancreatic_get_v0.2/", options: { breakLine: true, color: "FFFFFF", bold: true } },
    { text: "  app/         data/        source_records/", options: { breakLine: true } },
    { text: "  analysis/     manuscript/  supplemental/", options: { breakLine: true } },
    { text: "  figures/      target_cards/", options: { breakLine: true } },
    { text: "  audit_reports/  logs/", options: {} },
  ], { x: 0.95, y: 2.7, w: 5.5, h: 3.5, fontFace: MONO, fontSize: 13, color: "CFE0F5", lineSpacingMultiple: 1.3, margin: 0 });
  // right: version timeline
  s.addShape(pres.shapes.RECTANGLE, { x: 7.0, y: 1.95, w: 5.7, h: 4.45, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
  s.addText("Versioned iterations (Box-style history)", { x: 7.3, y: 2.2, w: 5.1, h: 0.4, fontFace: BF, fontSize: 15, bold: true, color: TEAL, margin: 0 });
  const vers = [["v0.1", "first PDAC bundle: OT + KRAS mutation"], ["v0.2", "+ SRC paper evidence + harvest store"], ["v0.3", "+ source matrix + audit agent"]];
  let yy = 2.75;
  vers.forEach((v, i) => {
    s.addShape(pres.shapes.OVAL, { x: 7.35, y: yy + 0.02, w: 0.4, h: 0.4, fill: { color: i === 2 ? AMBER : TEAL } });
    s.addText(v[0], { x: 7.35, y: yy + 0.02, w: 0.4, h: 0.4, fontFace: BF, fontSize: 10, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    s.addText(v[1], { x: 7.95, y: yy, w: 4.5, h: 0.5, fontFace: BF, fontSize: 13, color: INK, valign: "middle", margin: 0 });
    if (i < vers.length - 1) s.addShape(pres.shapes.LINE, { x: 7.55, y: yy + 0.42, w: 0, h: 0.55, line: { color: LINE, width: 2 } });
    yy += 0.97;
  });
  s.addText("Each version = data + ranking + app + manuscript + audit, together.", { x: 7.3, y: 5.7, w: 5.1, h: 0.6, fontFace: BF, fontSize: 11.5, italic: true, color: MUTED, margin: 0 });
  s.addText("Already in place: ranking content is versioned in Supabase (snapshots). This adds project-level version history — the manuscript, data and app evolve together, every iteration.", { x: 0.6, y: 6.55, w: 12.1, h: 0.5, fontFace: BF, fontSize: 12, italic: true, color: MUTED, align: "center", margin: 0 });
})();

// ── 13. Now & Next ───────────────────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "Now & next — diseases and storage", "Direction");
  // disease timeline
  s.addText("Disease focus", { x: 0.6, y: 1.85, w: 5, h: 0.4, fontFace: BF, fontSize: 15, bold: true, color: NAVY2, margin: 0 });
  const dz = [["Pancreatic", "in progress", AMBER], ["GBM", "next", TEAL2], ["Alzheimer's", "then", MUTED]];
  let dx = 0.7;
  dz.forEach((d, i) => {
    s.addShape(pres.shapes.RECTANGLE, { x: dx, y: 2.35, w: 3.55, h: 1.25, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x: dx, y: 2.35, w: 0.1, h: 1.25, fill: { color: d[2] } });
    s.addText(d[0], { x: dx + 0.3, y: 2.55, w: 3.1, h: 0.45, fontFace: BF, fontSize: 18, bold: true, color: INK, margin: 0 });
    s.addText(d[1].toUpperCase(), { x: dx + 0.3, y: 3.0, w: 3.1, h: 0.35, fontFace: BF, fontSize: 11, bold: true, color: d[2], charSpacing: 2, margin: 0 });
    if (i < dz.length - 1) s.addText("→", { x: dx + 3.55, y: 2.7, w: 0.55, h: 0.6, fontFace: BF, fontSize: 24, bold: true, color: TEAL, align: "center", margin: 0 });
    dx += 4.1;
  });
  // storage path
  s.addText("Storage path", { x: 0.6, y: 4.0, w: 5, h: 0.4, fontFace: BF, fontSize: 15, bold: true, color: NAVY2, margin: 0 });
  const st = [["Supabase", "now — interim structured store", TEAL], ["Oracle", "next — lab's structured DB", AMBER], ["Wiki / LLM", "long-form & manuscripts", NAVY2]];
  let sx = 0.7;
  st.forEach((d, i) => {
    s.addShape(pres.shapes.RECTANGLE, { x: sx, y: 4.5, w: 3.55, h: 1.25, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
    s.addShape(pres.shapes.RECTANGLE, { x: sx, y: 4.5, w: 0.1, h: 1.25, fill: { color: d[2] } });
    s.addText(d[0], { x: sx + 0.3, y: 4.7, w: 3.1, h: 0.45, fontFace: BF, fontSize: 18, bold: true, color: INK, margin: 0 });
    s.addText(d[1], { x: sx + 0.3, y: 5.18, w: 3.1, h: 0.5, fontFace: BF, fontSize: 11.5, color: MUTED, margin: 0 });
    if (i < st.length - 1) s.addText("→", { x: sx + 3.55, y: 4.85, w: 0.55, h: 0.6, fontFace: BF, fontSize: 24, bold: true, color: AMBER, align: "center", margin: 0 });
    sx += 4.1;
  });
  footer(s, 13);
})();

// ── 14. Feature roadmap ──────────────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: LIGHT };
  title(s, "Feature roadmap — pancreatic-first", "What's next");
  const items = [
    ["1", "Source-separation matrix", "Gene × source view in app + DB — the #1 repeated ask."],
    ["2", "Ingestion + audit agents", "Tag genes G/E/T + confidence; audit each fact against its source."],
    ["3", "Benchmark recovery view", "Does GET rank KRAS / SRC / known targets high?"],
    ["4", "Push content to Oracle", "Migrate structured content from Supabase to the lab Oracle DB."],
    ["5", "Network expansion", "GET seeds → PAGER pathways → Spinner centrality → re-rank."],
    ["6", "GeneTerrain export + GBM/AD", "All-attribute export (pending schema); then GBM, then Alzheimer's."],
  ];
  const cw = 5.85, ch = 1.25, gx = 0.6, gy = 1.85, sx = 0.65, sy = 0.25;
  items.forEach((it, i) => {
    const x = gx + (i % 2) * (cw + sx), y = gy + Math.floor(i / 2) * (ch + sy);
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, shadow: sh() });
    s.addShape(pres.shapes.OVAL, { x: x + 0.25, y: y + 0.34, w: 0.58, h: 0.58, fill: { color: TEAL } });
    s.addText(it[0], { x: x + 0.25, y: y + 0.34, w: 0.58, h: 0.58, fontFace: HF, fontSize: 20, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    s.addText(it[1], { x: x + 1.05, y: y + 0.22, w: cw - 1.25, h: 0.4, fontFace: BF, fontSize: 15, bold: true, color: INK, margin: 0 });
    s.addText(it[2], { x: x + 1.05, y: y + 0.62, w: cw - 1.25, h: 0.55, fontFace: BF, fontSize: 12, color: MUTED, margin: 0 });
  });
  footer(s, 14);
})();

// ── 15. Decisions needed (dark) ──────────────────────────────────────────────
(() => {
  const s = pres.addSlide();
  s.background = { color: NAVY };
  s.addShape(pres.shapes.OVAL, { x: -1.3, y: 4.8, w: 4.0, h: 4.0, fill: { color: NAVY2 } });
  s.addShape(pres.shapes.OVAL, { x: 11.6, y: -1.4, w: 3.6, h: 3.6, fill: { color: TEAL } });
  s.addText("OPEN QUESTIONS & DECISIONS", { x: 0.7, y: 0.7, w: 12, h: 0.4, fontFace: BF, fontSize: 13, bold: true, color: MINT, charSpacing: 3, margin: 0 });
  s.addText("Inputs to keep the engine moving", { x: 0.7, y: 1.05, w: 12, h: 0.8, fontFace: HF, fontSize: 30, bold: true, color: "FFFFFF", margin: 0 });
  const items = [
    "Oracle DB — schema + access, or confirm Supabase as the interim store.",
    "Spinner / GeneTerrain input schema — exact fields to push.",
    "Benchmark target lists — accept my curated sets, or provide yours.",
    "SRC reference workflow — pointer to the existing work to reproduce.",
    "Confirm priority: pancreatic cancer + traceability first, Alzheimer's next.",
  ];
  let yy = 2.35;
  items.forEach((it, i) => {
    s.addShape(pres.shapes.OVAL, { x: 0.9, y: yy + 0.04, w: 0.45, h: 0.45, fill: { color: TEAL } });
    s.addText(String(i + 1), { x: 0.9, y: yy + 0.04, w: 0.45, h: 0.45, fontFace: HF, fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    s.addText(it, { x: 1.55, y: yy, w: 11, h: 0.55, fontFace: BF, fontSize: 16, color: "E6EEF8", valign: "middle", margin: 0 });
    yy += 0.72;
  });
  s.addText("Disease2Target — a traceable, content-centric scientific engine. Pancreatic cancer first, Alzheimer's next.", { x: 0.7, y: 6.5, w: 12, h: 0.4, fontFace: BF, fontSize: 13, italic: true, color: MINT, margin: 0 });
})();

pres.writeFile({ fileName: "N:/diseasetotarget_version2/docs/Disease2Target_Demo_Roadmap_v2.pptx" }).then(f => console.log("WROTE", f));
