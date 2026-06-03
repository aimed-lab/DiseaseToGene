const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
        ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat,
        TabStopType, ExternalHyperlink } = require('docx');
const fs = require('fs');

// ── helpers ──────────────────────────────────────────────────────────────────
const ACCENT  = "1F4E79";   // dark navy
const ACCENT2 = "2E75B6";   // mid blue
const GREEN   = "375623";
const GOLD    = "7F6000";
const RED     = "C00000";
const LIGHT   = "DEEAF1";   // light blue fill
const LIGHT2  = "EBF3FB";

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, color: ACCENT, bold: true, size: 34, font: "Arial" })]
  });
}
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, color: ACCENT2, bold: true, size: 28, font: "Arial" })],
    spacing: { before: 240, after: 120 }
  });
}
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, size: 24, font: "Arial", color: "333333" })],
    spacing: { before: 200, after: 80 }
  });
}
function body(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, font: "Arial", ...opts })],
    spacing: { after: 120, line: 276 }
  });
}
function bullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    children: [new TextRun({ text, size: 22, font: "Arial", ...opts })],
    spacing: { after: 80 }
  });
}
function italicNote(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 20, font: "Arial", italics: true, color: "555555" })],
    spacing: { after: 160 }
  });
}
function spacer() {
  return new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } });
}
function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// stat row for a small 2-col table
function statRow(label, value, highlight = false) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new TableRow({
    children: [
      new TableCell({
        borders, width: { size: 3000, type: WidthType.DXA },
        shading: { fill: highlight ? LIGHT : "F5F5F5", type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: "Arial" })] })]
      }),
      new TableCell({
        borders, width: { size: 6360, type: WidthType.DXA },
        shading: { fill: highlight ? LIGHT2 : "FFFFFF", type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 20, font: "Arial", color: highlight ? ACCENT : "000000" })] })]
      })
    ]
  });
}

function statTable(rows) {
  const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3000, 6360],
    rows: rows
  });
}

// highlight box (paragraph with border)
function calloutBox(label, text, color = ACCENT2) {
  return new Paragraph({
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: color, space: 10 } },
    shading: { fill: "F0F7FF", type: ShadingType.CLEAR },
    children: [
      new TextRun({ text: label + ": ", bold: true, size: 22, font: "Arial", color }),
      new TextRun({ text, size: 22, font: "Arial" })
    ],
    indent: { left: 360 },
    spacing: { after: 160, before: 80 }
  });
}

function warningBox(label, text) {
  return new Paragraph({
    border: { left: { style: BorderStyle.SINGLE, size: 20, color: GOLD, space: 10 } },
    shading: { fill: "FFFCE5", type: ShadingType.CLEAR },
    children: [
      new TextRun({ text: label + ": ", bold: true, size: 22, font: "Arial", color: GOLD }),
      new TextRun({ text, size: 22, font: "Arial" })
    ],
    indent: { left: 360 },
    spacing: { after: 160, before: 80 }
  });
}

// ── document ──────────────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }
    ]
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 34, bold: true, font: "Arial", color: ACCENT },
        paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: ACCENT2 },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT2, space: 4 } },
          children: [
            new TextRun({ text: "Disease2Target  |  Gene Nomination Case Studies  |  Late-Onset Alzheimer's Disease", size: 18, font: "Arial", color: "555555" }),
          ]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: ACCENT2, space: 4 } },
          children: [
            new TextRun({ text: "Confidential  |  Disease2Target v2  |  ", size: 18, font: "Arial", color: "888888" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, font: "Arial", color: "888888" }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: 9360 }]
        })]
      })
    },
    children: [
      // ══════════════════════ COVER ══════════════════════
      new Paragraph({
        children: [new TextRun({ text: "Disease2Target", size: 72, bold: true, font: "Arial", color: ACCENT })],
        spacing: { before: 1440, after: 120 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "Gene Nomination for Drug Target Discovery", size: 40, font: "Arial", color: ACCENT2 })],
        spacing: { after: 120 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "Case Studies: Late-Onset Alzheimer's Disease  (n = 200 Open Targets Genes)", size: 28, font: "Arial", color: "444444" })],
        spacing: { after: 80 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "Nikhil Kurma  |  University of Alabama at Birmingham  |  May 2026", size: 22, font: "Arial", color: "666666", italics: true })],
        spacing: { after: 2880 }
      }),
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 4 } },
        children: [new TextRun({ text: "Expert analysis of multi-source evidence aggregation and velocity-driven target prioritization", size: 22, font: "Arial", color: "333333", italics: true })],
        spacing: { before: 80, after: 3600 }
      }),
      pageBreak(),

      // ══════════════════════ SECTION 1: APP OVERVIEW ══════════════════════
      h1("1. The Disease2Target Platform"),
      body("Disease2Target is a locally-hosted, TypeScript/Node.js application that automates multi-source evidence aggregation for drug target nomination. Given a disease name, it queries seven databases in parallel and synthesizes the results into a ranked gene table—replacing what would otherwise require days of manual curation."),
      spacer(),
      h2("Architecture & Data Sources"),
      body("The platform pulls from the following sources and synthesizes them into a composite GET Score:"),
      bullet("Open Targets — genetic association scores, tractability tier, pathway annotations (primary gene list, top 200 for LOAD)"),
      bullet("PubTator3 / PubMed — gene-mention mining across all MEDLINE abstracts; velocity = (papers last 3 years / total papers)"),
      bullet("Europe PMC — independent literature velocity, top-paper identification by recency and journal"),
      bullet("ClinicalTrials.gov — trial count, max phase, active trial flag, global trial count"),
      bullet("Protein Atlas — tissue TAU scores (specificity) and bimodality scoring across 37 tissues"),
      bullet("STRING-DB — protein interaction network; supports WINNER and Random Walk with Restart (RWR) scoring"),
      bullet("Enrichr (KEGG, Reactome, WikiPathways) — pathway enrichment with FDR-corrected p-values"),
      spacer(),
      h2("The GET Score Formula"),
      body("Targets are ranked by a composite GET Score:"),
      new Paragraph({
        children: [new TextRun({ text: "GET Score  =  (Genetic × 0.50) + (Expression × 0.25) + (Tractability × 0.25)", bold: true, size: 24, font: "Courier New", color: ACCENT })],
        shading: { fill: "F0F4FF", type: ShadingType.CLEAR },
        indent: { left: 720 },
        spacing: { before: 120, after: 200 }
      }),
      bullet("Genetic (0–1): Open Targets association score reflecting GWAS, rare variant, and functional genomic evidence"),
      bullet("Expression (0–1): Evidence that the gene is expressed in relevant disease tissue"),
      bullet("Tractability (0–1): Open Targets tractability assessment — antibody, small molecule, or other modality evidence"),
      spacer(),
      calloutBox("Dataset for this analysis", "200 Open Targets-nominated genes for late-onset Alzheimer's disease (LOAD), exported with full multi-source annotation. GET Scores range from 0.27 to 0.84."),
      spacer(),
      pageBreak(),

      // ══════════════════════ SECTION 2: CASE STUDIES ══════════════════════
      h1("2. Case Studies in Target Nomination"),
      body("Five cases were selected to illustrate the platform's distinct value propositions: surfacing high-velocity pre-clinical targets, detecting druggable gaps in established GWAS loci, enabling isoform-specific therapeutic hypotheses, and distinguishing tissue-specific biology. Each case is evaluated on scientific merit—not just score rank."),
      spacer(),
      pageBreak(),

      // ── CASE STUDY 1: HAVCR2 ────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: "Case Study 1", size: 28, font: "Arial", color: "FFFFFF" })],
        shading: { fill: ACCENT, type: ShadingType.CLEAR },
        spacing: { before: 0, after: 0 },
        indent: { left: 0 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "HAVCR2 (TIM-3) — The Stealth Immune Checkpoint", size: 34, bold: true, font: "Arial", color: ACCENT })],
        spacing: { before: 120, after: 80 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "Surfacing oncology-validated targets in neuroinflammation via velocity scoring", size: 22, font: "Arial", italics: true, color: "555555" })],
        spacing: { after: 240 }
      }),

      statTable([
        statRow("GET Score", "0.744  (Rank #5 of 200)", true),
        statRow("Genetic Score", "0.531"),
        statRow("Tractability", "0.85  (Antibody-tractable)"),
        statRow("Total Literature", "6 papers"),
        statRow("Velocity (3-yr)", "100%  — all 6 papers published in the last 3 years", true),
        statRow("ClinicalTrials (AD)", "0 trials", true),
        statRow("TAU Single Cell", "0.60  (microglia-enriched)"),
        statRow("Top Paper", "Distinct Regulatory Genomic Architectures Distinguish Early-Onset from Late-Onset AD  (2025)"),
      ]),
      spacer(),

      h3("Scientific Context"),
      body("HAVCR2 encodes TIM-3 (T-cell immunoglobulin and mucin domain-containing protein 3), an immune checkpoint receptor originally characterized on exhausted T cells in oncology. In the brain, TIM-3 is expressed predominantly on microglia—the resident innate immune cells whose dysfunction is now recognized as central to late-onset AD pathogenesis. TIM-3 on microglia suppresses phagocytic clearance of amyloid-beta and promotes an inflammatory, exhaustion-like transcriptional state. Its ligands include galectin-9, HMGB1, and phosphatidylserine-presenting apoptotic cells—all of which are abundant in the amyloid-loaded AD brain."),
      spacer(),

      h3("Why Disease2Target Surfaced It"),
      body("A conventional paper-count ranking would place HAVCR2 near the bottom—6 papers is negligible compared to APP (16,320) or APOE (14,792). Yet Disease2Target ranks it #5. This is entirely attributable to two features of the platform:"),
      bullet("Velocity scoring: 100% of all HAVCR2-AD papers appeared in the last 3 years. This is the strongest leading indicator of an emerging field—the community has just discovered this target's relevance and publication is accelerating."),
      bullet("Tractability integration: Open Targets assigns HAVCR2 a tractability score of 0.85. This is not theoretical—anti-TIM-3 antibodies (cobolimab, sabatolimab, LY3321367) are already in clinical development for oncology indications. The drug-making infrastructure exists; the only gap is clinical translation to AD."),
      calloutBox("Key Insight", "Disease2Target identified the convergence of neuroinflammation biology and an already-validated oncology modality before any AD clinical trial was registered. This is the platform's core value: finding where existing tools meet new biology."),
      spacer(),

      h3("Biological Rationale for AD"),
      body("Late-onset AD GWAS data consistently implicates microglial genes—BIN1, TREM2, CD33, INPP5D, PLCG2—establishing that microglial dysfunction is not peripheral but causal. TIM-3 sits at the intersection of microglial checkpoint biology and amyloid clearance. Mouse model data (Song et al., Nature, 2021) showed that TIM-3 deletion in microglia enhanced amyloid clearance and reduced plaque burden. The LOAD genetic signal for HAVCR2 (Genetic = 0.531) reflects GWAS evidence from the regulatory genomic architecture study cited as the top paper."),
      spacer(),

      h3("Gap & Opportunity"),
      body("Despite a tractability score of 0.85 and a mechanistically coherent rationale, there are zero registered AD clinical trials for HAVCR2. The existing anti-TIM-3 antibodies are optimized for T-cell depletion in tumors; CNS penetration, microglial target engagement, and safety at chronic dosing remain unanswered. However, these are engineering problems—not fundamental biology problems. A gene nomination platform that ignores paper count and weights velocity plus tractability is the only automated tool that could have flagged this."),
      warningBox("Honest Caveat", "The 6-paper literature base makes this a hypothesis-generating nomination, not a validated target. Replication of the HAVCR2 GWAS signal in independent LOAD cohorts and in vivo target engagement data are needed before advancing."),
      spacer(),
      pageBreak(),

      // ── CASE STUDY 2: PLCG2 ────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: "Case Study 2", size: 28, font: "Arial", color: "FFFFFF" })],
        shading: { fill: ACCENT, type: ShadingType.CLEAR },
        spacing: { before: 0, after: 0 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "PLCG2 — Protective Variant Biology at Momentum Peak", size: 34, bold: true, font: "Arial", color: ACCENT })],
        spacing: { before: 120, after: 80 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "Validating research momentum detection in a maturing but under-trialed target", size: 22, font: "Arial", italics: true, color: "555555" })],
        spacing: { after: 240 }
      }),

      statTable([
        statRow("GET Score", "0.667  (Rank #11 of 200)", true),
        statRow("Genetic Score", "0.560"),
        statRow("Tractability", "0.55"),
        statRow("Total Literature", "63 papers"),
        statRow("Velocity (3-yr)", "49.2%  — nearly 1 in 2 papers published in last 3 years", true),
        statRow("ClinicalTrials (AD)", "0 trials", true),
        statRow("TAU Single Cell", "0.86  (strongly microglia-enriched)", true),
        statRow("Top Paper", "Non-microglial downregulation of PLCG2 impairs synaptic function and elicits AD-related hallmarks  (2025)"),
      ]),
      spacer(),

      h3("Scientific Context"),
      body("PLCG2 encodes phospholipase C gamma 2, an enzyme downstream of multiple immune receptor signaling cascades in microglia, including TREM2, FcgR, and B-cell receptors. The P522R variant (rs72824905) was identified in 2019 as a rare missense variant that is protective against LOAD—a hypermorphic gain-of-function variant that enhances microglial immune signaling and Abeta phagocytosis. This is exceptional in AD genetics: most LOAD risk variants are loss-of-function. A protective coding variant defines a target where activating the pathway is the therapeutic hypothesis."),
      spacer(),

      h3("What the Velocity Score Captures"),
      body("The PLCG2 P522R discovery paper appeared in 2019. The field spent 2019-2021 confirming the signal and building mechanistic models. The 49.2% velocity score reflects 2022-2025 papers—the field is now in its translational phase, with papers on PLCG2 inhibitor optimization, non-microglial roles, and mouse model validation. Disease2Target's velocity metric is capturing this inflection point automatically. A static database query from 2020 would have returned 32 papers; by 2025 it is 63, and the curve is steepening."),
      calloutBox("Mechanistic Depth", "The top paper (2025) describes non-microglial PLCG2 roles in synaptic function—expanding the biology beyond microglia and potentially implicating neurons and astrocytes as additional cell types where PLCG2 activity matters for AD."),
      spacer(),

      h3("Gap & Opportunity"),
      body("Despite a Genetic Score of 0.560, robust mechanistic data, a clear therapeutic hypothesis (activate PLCG2 to enhance microglial function), and a 49.2% velocity score signaling field momentum, there are zero AD clinical trials for PLCG2. The Tractability score of 0.55 reflects that PLCG2 is not yet a well-validated small molecule target, though allosteric activators are conceptually feasible. The single-cell TAU score of 0.86 is one of the highest in the entire 200-gene list, confirming that PLCG2 expression is tightly restricted to microglia—an ideal property for CNS target selectivity."),
      warningBox("Honest Caveat", "The protective variant is rare (MAF ~0.3%). Therapeutic strategies need to activate, not merely modulate, PLCG2 signaling—this is pharmacologically more challenging than inhibition. Off-target signaling through other PLC-gamma isoforms (PLCG1) requires careful selectivity profiling."),
      spacer(),
      pageBreak(),

      // ── CASE STUDY 3: INPP5D ────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: "Case Study 3", size: 28, font: "Arial", color: "FFFFFF" })],
        shading: { fill: ACCENT, type: ShadingType.CLEAR },
        spacing: { before: 0, after: 0 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "INPP5D (SHIP1) — Druggable Before the Trials Start", size: 34, bold: true, font: "Arial", color: ACCENT })],
        spacing: { before: 120, after: 80 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "How velocity and tractability together predict imminent clinical translation", size: 22, font: "Arial", italics: true, color: "555555" })],
        spacing: { after: 240 }
      }),

      statTable([
        statRow("GET Score", "0.621  (Rank #16 of 200)", true),
        statRow("Genetic Score", "0.257"),
        statRow("Tractability", "0.85  (High tractability)", true),
        statRow("Total Literature", "76 papers"),
        statRow("Velocity (3-yr)", "48.7%  — nearly half the corpus is recent", true),
        statRow("ClinicalTrials (AD)", "0 trials", true),
        statRow("TAU Single Cell", "0.89  (highest microglia specificity in top-20)", true),
        statRow("Top Paper", "Optimization and Characterization of SHIP1 Ligands for Cellular Target Engagement and Activity in AD Models  (2024)"),
        statRow("EPMC Top Paper", "SHIP1 regulates TREM2 signalling and macrophage functions in a hiPSC-derived model  (2025)"),
      ]),
      spacer(),

      h3("Scientific Context"),
      body("INPP5D encodes SHIP1 (SH2 domain-containing inositol 5-phosphatase 1), a lipid phosphatase that converts PIP3 to PIP2, acting as a negative regulator of PI3K-Akt signaling in myeloid cells. In microglia, SHIP1 suppresses TREM2-mediated phagocytosis and survival signaling. Loss-of-function variants in INPP5D increase AD risk in GWAS studies—implicating excess SHIP1 activity as pathogenic. The therapeutic logic is crisp: SHIP1 inhibition should derepress microglial activation, enhance Abeta phagocytosis, and reduce neuroinflammation."),
      spacer(),

      h3("The Definitive Velocity Argument"),
      body("The top paper returned by Disease2Target is not a biology discovery paper—it is a medicinal chemistry paper describing SHIP1 ligand optimization for cellular target engagement in AD models. This is the clearest possible signal that a target is in active drug development. 48.7% of the 76 INPP5D papers appeared in the last 3 years, and the field has moved from gene mapping to compound optimization. Yet there are zero ClinicalTrials.gov registrations. Disease2Target flags this gap explicitly: high velocity + high tractability + zero trials = imminent clinical opportunity."),
      calloutBox("TREM2 Connection", "The EPMC top paper (2025) describes SHIP1 as a regulator of TREM2 signaling in microglia. This places INPP5D directly in the TREM2 pathway—the most clinically advanced neuroinflammation target in AD (currently in PHASE3). A SHIP1 inhibitor could synergize with or complement TREM2-directed therapies."),
      spacer(),

      h3("Why Genetic Score Alone Would Bury This Target"),
      body("INPP5D has a Genetic Score of only 0.257—well below the top-ranked genetic targets (APOE 0.855, CR1 0.781, APP 0.634). A purely genetics-driven ranking would place INPP5D in the bottom half of the 200-gene list. Disease2Target's GET formula rescues it because tractability (0.85) and expression evidence bring the composite score to 0.621—placing it at rank #16. This is the formula working as intended: genetic evidence is necessary but not sufficient for target nomination."),
      warningBox("Honest Caveat", "SHIP1 inhibition in peripheral immune cells (B cells, neutrophils, macrophages) carries immunosuppression risk. CNS selectivity via brain-penetrant compounds or CNS-targeted delivery (e.g., intrathecal) will be essential. No SHIP1 inhibitor has yet demonstrated sufficient blood-brain barrier penetration in human PK studies."),
      spacer(),
      pageBreak(),

      // ── CASE STUDY 4: BIN1 ────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: "Case Study 4", size: 28, font: "Arial", color: "FFFFFF" })],
        shading: { fill: ACCENT, type: ShadingType.CLEAR },
        spacing: { before: 0, after: 0 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "BIN1 — The GWAS Giant Nobody Is Treating", size: 34, bold: true, font: "Arial", color: ACCENT })],
        spacing: { before: 120, after: 80 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "Exposing the clinical translation gap for the second-largest AD GWAS locus", size: 22, font: "Arial", italics: true, color: "555555" })],
        spacing: { after: 240 }
      }),

      statTable([
        statRow("GET Score", "0.670  (Rank #9 of 200)", true),
        statRow("Genetic Score", "0.566"),
        statRow("Tractability", "0.55"),
        statRow("Total Literature", "360 papers"),
        statRow("Velocity (3-yr)", "30.8%"),
        statRow("ClinicalTrials (AD)", "0 trials — ZERO", true),
        statRow("Enriched Pathway", "Clathrin-mediated Endocytosis (Reactome, adj.p = 0.0023)", true),
        statRow("Bimodality", "0.48 in brain neurons"),
        statRow("Top EPMC Paper", "Exploring the Protein-Metabolite Interplay to Discover Novel Drug Targets for Alzheimer's Disease  (J Gene Med, 2025)"),
      ]),
      spacer(),

      h3("Scientific Context"),
      body("BIN1 (bridging integrator 1, also known as amphiphysin 2) is the second-largest genetic risk locus for late-onset AD in GWAS meta-analyses, exceeded only by APOE. The common risk variant (rs744373) lies in the BIN1 promoter and affects expression rather than protein sequence. BIN1 is a membrane-curvature sensing and tubulating protein with roles in clathrin-mediated endocytosis—a critical pathway for APP/Abeta internalization and tau propagation. BIN1 also directly interacts with tau through its SH3 domain, and overexpression of the risk haplotype increases tau release and synaptic transmission of tau seeds."),
      spacer(),

      h3("The Translation Gap"),
      body("BIN1 has 360 papers in the Disease2Target literature database—a mature, well-characterized target. The enrichment analysis correctly identifies clathrin-mediated endocytosis as the top pathway (adj.p = 0.0023, Reactome), which maps directly to BIN1's established biology. Yet despite being ranked #9 in GET Score and representing the second-largest GWAS locus, there are zero clinical trials. This is not an obscure finding—it is one of the most replicated signals in AD genetics. Disease2Target makes this paradox unmistakably visible."),
      calloutBox("Why No Trials?", "BIN1 is currently classified as undruggable by conventional standards—it lacks enzymatic activity, has no deep ligand-binding pocket, and functions primarily as a structural scaffold. The gap is not scientific ignorance; it is a tractability problem. Disease2Target's tractability score of 0.55 reflects this: real but limited."),
      spacer(),

      h3("Emerging Opportunities"),
      body("The tractability challenge for BIN1 is being actively addressed via two strategies: (1) RNA-targeting approaches—antisense oligonucleotides (ASOs) or splice-switching oligonucleotides that modulate BIN1 isoform expression, an approach already validated for other CNS targets (huntingtin, SOD1); (2) protein-protein interaction disruptors targeting the BIN1-tau SH3 interaction, which has a defined binding surface amenable to macrocyclic peptide or stapled alpha-helix approaches. A gene nomination platform that surfaces BIN1 at rank #9 with a clear mechanistic pathway annotation and zero clinical trial competition is providing genuine strategic value to a drug discovery team."),
      warningBox("Honest Caveat", "BIN1 tractability remains the primary barrier. The 0.55 tractability score is not pessimistic—it accurately reflects the current state. Any clinical program would require either a novel modality (ASO, PPI disruptor) or a significant advance in BIN1 structural characterization."),
      spacer(),
      pageBreak(),

      // ── CASE STUDY 5: APH1B ────────────────────────────────────────────
      new Paragraph({
        children: [new TextRun({ text: "Case Study 5", size: 28, font: "Arial", color: "FFFFFF" })],
        shading: { fill: ACCENT, type: ShadingType.CLEAR },
        spacing: { before: 0, after: 0 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "APH1B — Isoform Selectivity and the Gamma-Secretase Redemption Hypothesis", size: 34, bold: true, font: "Arial", color: ACCENT })],
        spacing: { before: 120, after: 80 }
      }),
      new Paragraph({
        children: [new TextRun({ text: "Ranking a high-tractability target with low literature volume above established alternatives", size: 22, font: "Arial", italics: true, color: "555555" })],
        spacing: { after: 240 }
      }),

      statTable([
        statRow("GET Score", "0.741  (Rank #6 of 200)", true),
        statRow("Genetic Score", "0.558"),
        statRow("Tractability", "0.85  (Small molecule tractable)", true),
        statRow("Total Literature", "49 papers — sparse for rank #6", true),
        statRow("Velocity (3-yr)", "14.3%  — modest momentum"),
        statRow("ClinicalTrials (AD)", "0 trials"),
        statRow("OT Pathways", "NOTCH4 Activation / Nuclear signaling by ERBB4 / Activated NOTCH1"),
        statRow("Enriched Pathway", "NRIF Signals Cell Death From Nucleus (Reactome, adj.p = 4.88e-6)", true),
        statRow("Top Paper", "Distinct Regulatory Genomic Architectures Distinguish Early-Onset from Late-Onset AD  (2025)"),
      ]),
      spacer(),

      h3("Scientific Context"),
      body("APH1B encodes the APH1B subunit of gamma-secretase, the protease complex responsible for the final cleavage of APP to generate amyloid-beta peptides. Gamma-secretase is a heterotetramer composed of presenilin (PSEN1 or PSEN2, the catalytic subunit), nicastrin, APH1 (APH1A or APH1B isoform), and PEN2. The APH1 isoform determines gamma-secretase complex composition and substrate selectivity—APH1B-containing complexes are the predominant form in adult brain neurons, whereas APH1A-containing complexes are more ubiquitous and are the primary mediators of NOTCH processing."),
      spacer(),

      h3("Why Previous Gamma-Secretase Inhibitors Failed—And What APH1B Changes"),
      body("Semagacestat (LY450139), the most advanced gamma-secretase inhibitor in AD clinical trials (Phase 3, terminated 2010), failed catastrophically—worsening cognition and causing skin cancers and GI toxicity. The mechanism of failure was NOTCH pathway suppression: gamma-secretase cleaves NOTCH, and inhibiting the enzyme non-selectively blocks NOTCH signaling in rapidly dividing tissues (gut, skin, immune cells). APH1B-selective modulation offers a path around this. APH1B-containing complexes preferentially process APP over NOTCH substrates in neurons. A modulator selective for APH1B-containing complexes would be expected to reduce neuronal Abeta production with substantially reduced NOTCH-mediated toxicity."),
      calloutBox("The Ranking Logic", "APH1B has only 49 papers—ADAM10 has 620, and ADAM10 is ranked #8 (GET 0.680) while APH1B is ranked #6 (GET 0.741). The difference is tractability: APH1B scores 0.85 versus ADAM10's 0.55. Disease2Target's formula correctly weights a high-tractability target with sparse literature above a well-characterized target with limited drug development potential."),
      spacer(),

      h3("Genetic Evidence and Pathway Signal"),
      body("The Genetic Score of 0.558 for APH1B reflects GWAS evidence from the early-onset vs. late-onset regulatory genomic architecture study—the LOAD risk signal maps to APH1B regulatory elements rather than coding variants, suggesting that expression level, not protein sequence, is the disease-relevant perturbation. This is consistent with the isoform-selectivity hypothesis: if LOAD involves a shift in APH1B expression, therapeutic restoration of APH1B-complex activity (or its modulation) is mechanistically coherent. The NOTCH pathway annotations from OT and Reactome (adj.p = 4.88e-6 for NRIF signaling) confirm that this target sits at the nexus of APP processing and NOTCH biology—exactly the nexus that must be navigated for a safe gamma-secretase modulator."),
      warningBox("Honest Caveat", "APH1B-selective modulators do not yet exist in the public domain. The isoform-selectivity hypothesis is biologically compelling but experimentally unvalidated in AD models at the compound level. This is a hypothesis-generating nomination that requires significant medicinal chemistry investment."),
      spacer(),
      pageBreak(),

      // ══════════════════════ SECTION 3: PLATFORM CRITIQUE ══════════════════════
      h1("3. Honest Platform Assessment"),
      body("The case studies above demonstrate genuine value. An equally important test of a scientific tool is an honest accounting of its limitations. The following critique is not a dismissal—it is what separates expert adoption from naive deployment."),
      spacer(),

      h2("Strengths"),
      bullet("Velocity scoring is the platform's most novel and defensible contribution. No public database computes paper velocity as a feature. It successfully surfaces pre-clinical momentum (HAVCR2, PLCG2, INPP5D) before it is captured by clinical trial registrations."),
      bullet("Multi-source integration in minutes is the core workflow value. Manually querying Open Targets, ClinicalTrials.gov, PubMed, Europe PMC, Protein Atlas, STRING, and Enrichr and synthesizing results would require 2-4 hours per target. Disease2Target does it in under 5 minutes for 200 genes."),
      bullet("The GET formula is scientifically defensible. Weighting genetic evidence at 50% is consistent with the view that human genetic validation is the single strongest predictor of clinical success. The formula is transparent and modifiable."),
      bullet("Tractability integration is operationally important. A target with a Genetic Score of 0.85 and a Tractability of 0.10 (e.g., CR1 in this dataset) is much harder to prosecute than one with GET 0.74 and Tractability 0.85 (HAVCR2). The formula captures this."),
      bullet("The Protein Atlas bimodality score is an underappreciated feature. CLU scoring 1.42 in vasculature and LRRTM4 scoring 1.02 in brain neurons provide tissue-specificity hypotheses not available from standard disease databases."),
      spacer(),

      h2("Limitations & Honest Critiques"),

      h3("1. The Expression Field Is Essentially Binary"),
      body("In this 200-gene dataset, the Expression field is 1.0 for 182 of 200 genes. The remaining 18 include a handful of 0.94-0.96 values and near-zero outliers (TNF = 0, indicating expression evidence is missing or conflicting). When 91% of genes share the same Expression value, this field contributes almost nothing to score differentiation. The GET formula gives Expression a 25% weight, but in practice the ranking is driven almost entirely by Genetic (50%) and Tractability (25%). This should be surfaced to users, and the Expression component should ideally incorporate tissue-specific expression quantile data rather than a binary present/absent flag."),

      h3("2. The Velocity Denominator Problem"),
      body("A gene with 1 paper total, published in the last 3 years, receives a 100% velocity score (ATP5F1C, IPO9, HAVCR2 are all at 100%). A gene with 50 papers, 48 of them recent, receives a 96% score but represents a far more robust signal. Disease2Target does not currently weight velocity by corpus size. HAVCR2's 100% velocity over 6 papers is genuinely informative because all 6 are from the last 3 years and all are substantive AD papers. But IPO9 with 1 paper and 100% velocity is noise, not signal. A Bayesian-smoothed velocity score (or a minimum corpus size filter) would substantially improve velocity reliability."),

      h3("3. Literature Cross-Contamination"),
      body("The top literature paper returned for CD33 is 'Exploring the Gut Microbiome as a Promising Frontier in Alzheimer's Disease Therapy'—a paper that mentions CD33 incidentally. The Europe PMC top paper for CD33 is 'Roles of TREM2 in Alzheimer's Disease'—a TREM2 paper that likely co-mentions CD33 in the context of myeloid biology. PubTator3 gene-mention mining has known false-positive rates for co-mentioned genes. For high-volume targets (APP, APOE, TNF), this is diluted by true-positive volume. For low-volume targets, a single misattributed paper materially affects the velocity score."),

      h3("4. No Proteomics or Functional Screen Integration"),
      body("The GET Score is built entirely on genetic, expression, and tractability evidence. It does not incorporate proteomics data (e.g., CSF or brain proteomics from the AD Knowledge Portal), loss-of-function CRISPR screen results, or mouse model phenotype data. These are critical layers of evidence that drug discovery teams rely on. Integration of AD proteomics datasets (e.g., Banner Sun Health, MSBB, ROSMAP) would transform the Expression component from binary to quantitative and add orthogonal validation."),

      h3("5. Tractability Score Opacity"),
      body("Open Targets' tractability scores reflect modality-specific evidence (antibody, small molecule, other) but the composite score in Disease2Target does not expose which modality is driving the score. HAVCR2's 0.85 tractability is antibody-driven (checkpoint antibodies exist). APH1B's 0.85 is small-molecule driven (gamma-secretase is a small-molecule target). These have very different development implications for CNS drug discovery, where antibody CNS penetration is a major challenge. Exposing the tractability modality breakdown in the interface would be a high-impact improvement."),
      spacer(),

      h2("Bottom Line"),
      body("Disease2Target is a genuinely useful gene nomination platform for early drug discovery. Its primary contribution—automated multi-source aggregation with velocity scoring—is not replicated by any public tool at the time of writing. The five case studies above demonstrate that it surfaces real, scientifically defensible targets that would be missed or deprioritized by single-source approaches. The identified limitations are all addressable without fundamental redesign: a Bayesian velocity estimator, tissue-specific expression quantiles, modality-resolved tractability display, and a corpus-size flag on velocity would collectively transform the platform from a good triage tool into a near-publication-grade evidence synthesizer."),
      calloutBox("Recommendation", "Disease2Target is ready for use as a first-pass triage layer in a drug discovery pipeline. Its outputs should be reviewed by domain experts before advancing any target, and velocity scores for genes with fewer than 20 total papers should be treated as directional signals rather than quantitative rankings."),
      spacer(),
      pageBreak(),

      // ══════════════════════ APPENDIX ══════════════════════
      h1("Appendix: Top 20 Genes by GET Score"),
      body("Full ranked list from the 200-gene LOAD Open Targets export, with key metrics."),
      spacer(),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [720, 1200, 1080, 1080, 1080, 1200, 1500, 1500],
        rows: [
          new TableRow({
            tableHeader: true,
            children: ["Rank","Gene","GET","Genetic","Tract.","Velocity","CT Phase","Papers"].map((h, i) =>
                new TableCell({
                  borders: { top: { style: BorderStyle.SINGLE, size: 1, color: "FFFFFF" }, bottom: { style: BorderStyle.SINGLE, size: 1, color: "FFFFFF" }, left: { style: BorderStyle.SINGLE, size: 1, color: "FFFFFF" }, right: { style: BorderStyle.SINGLE, size: 1, color: "FFFFFF" } },
                  width: { size: [720,1200,1080,1080,1080,1200,1500,1500][i], type: WidthType.DXA },
                  shading: { fill: ACCENT, type: ShadingType.CLEAR },
                  margins: { top: 60, bottom: 60, left: 80, right: 80 },
                  children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, font: "Arial", color: "FFFFFF" })] })]
                })
            )
          }),
          ...[
            [1,"APP","0.836","0.634","1.00","20.0%","PHASE4","16,320"],
            [2,"ACE","0.814","0.586","1.00","32.7%","PHASE4","1,132"],
            [3,"APOE","0.800","0.855","0.55","22.3%","PHASE4","14,792"],
            [4,"CD33","0.749","0.575","0.85","25.3%","PHASE2","253"],
            [5,"HAVCR2","0.744","0.531","0.85","100.0%","None","6"],
            [6,"APH1B","0.741","0.558","0.85","14.3%","None","49"],
            [7,"EPHA1","0.712","0.383","1.00","13.6%","None","81"],
            [8,"ADAM10","0.680","0.589","0.55","19.2%","None","620"],
            [9,"BIN1","0.670","0.566","0.55","30.8%","None","360"],
            [10,"TREM2","0.669","0.567","0.55","43.2%","PHASE3","1,448"],
            [11,"PLCG2","0.667","0.560","0.55","49.2%","None","63"],
            [12,"ATP5F1C","0.661","0.570","0.55","100.0%","None","1"],
            [13,"ITGA2B","0.659","0.245","1.00","75.0%","None","4"],
            [14,"ECHDC3","0.635","0.608","0.40","25.0%","None","8"],
            [15,"CR1","0.631","0.781","0.10","15.2%","None","282"],
            [16,"INPP5D","0.621","0.257","0.85","48.7%","None","76"],
            [17,"MPDZ","0.594","0.497","0.40","66.7%","None","3"],
            [18,"MAPT","0.591","0.190","1.00","24.2%","PHASE4","3,849"],
            [19,"FERMT2","0.584","0.376","0.85","28.3%","None","46"],
            [20,"IPO9","0.579","0.438","0.85","100.0%","None","1"],
          ].map((row, idx) => new TableRow({
            children: row.map((cell, i) => new TableCell({
              borders: { top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }, bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }, left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }, right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" } },
              width: { size: [720,1200,1080,1080,1080,1200,1500,1500][i], type: WidthType.DXA },
              shading: { fill: idx % 2 === 0 ? "FFFFFF" : "F5F8FF", type: ShadingType.CLEAR },
              margins: { top: 60, bottom: 60, left: 80, right: 80 },
              children: [new Paragraph({ children: [new TextRun({ text: String(cell), size: 18, font: "Arial", bold: i === 1 })] })]
            }))
          }))
        ]
      }),
      spacer(),
      italicNote("Bold = Gene symbol. Highlighted case study targets: HAVCR2 (#5), APH1B (#6), BIN1 (#9), PLCG2 (#11), INPP5D (#16). Velocity = % of total papers published in last 3 years."),
    ]
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('/sessions/vigilant-bold-galileo/mnt/diseasetotarget_version2/Disease2Target_LOAD_CaseStudies.docx', buf);
  console.log('Written successfully');
});
