// modalityGlossary.ts ────────────────────────────────────────────────────────
// The single source of truth for what every MODALITY FIT term means: the 4 mechanistic
// goals, the 4 tiers, the 12 modalities, and every evidence field with its threshold,
// source and the caveat needed to not misread it.
//
// Used by modalityPromptBlock(), injected into the AI co-pilot's system prompt, so the
// assistant answers "what is a PROTAC?", "why is antibody Speculative?", "what counts as
// a druggable pocket?" from FACTS rather than guesses.
//
// Numeric thresholds are INTERPOLATED from MODALITY_THRESHOLDS — the same constants the
// deterministic rules use. Never retype a threshold here: a hand-typed copy would let this
// documentation drift silently false while still reading as authoritative.

import {
  MODALITY_THRESHOLDS as T, MECHANISTIC_GOALS, MODALITY_TAXONOMY, TIER_DEF,
} from './modalityConstants';

export interface ModalityGlossaryEntry {
  term: string;
  category: 'goal' | 'tier' | 'modality' | 'evidence' | 'concept';
  definition: string;
  plain?: string;      // the non-specialist version — for users who are not bioinformaticians
  rule?: string;       // how this term actually affects a tier, when it does
  source?: string;     // where the value comes from
  caveat?: string;     // the thing a reader needs in order to not misread it
}

export const MODALITY_GLOSSARY: ModalityGlossaryEntry[] = [
  // ── core concepts ────────────────────────────────────────────────────────
  { term: 'Modality', category: 'concept',
    definition: 'The KIND of therapeutic used to engage a target — not a specific compound. Twelve are assessed, grouped into five categories.',
    plain: 'What sort of drug you would build: a pill, an injected antibody, an RNA drug, and so on.' },
  { term: 'Target', category: 'concept',
    definition: 'The protein being acted upon. The drug acts ON the target; the target never acts on anything.',
    plain: 'The protein you want to interfere with. It is the destination, never the actor.',
    caveat: 'A common misreading is that the target does the blocking. It is the thing being blocked.' },
  { term: 'Modality Fit', category: 'concept',
    definition: 'For one target and one mechanistic goal, an anchored tier for each of the 12 modalities, computed from live public evidence.',
    rule: 'Evidence is gathered ONCE per gene and does not depend on the goal; the goal is applied afterwards by the rules. The same evidence therefore backs all four goal charts.' },
  { term: 'Fact vs prediction split', category: 'concept',
    definition: 'Measured facts (developed drugs, sequence, structure, measured bioactivity) are kept structurally separate from assessments (tractability predictions, tiers).',
    caveat: 'Only "Precedented" is a fact about the clinic. Plausible and Speculative are assessments; Blocked is a hard rule.' },
  { term: 'Basis', category: 'concept',
    definition: 'The list of evidence bullets the deterministic rules recorded for a tier — the audit trail for why that tier was assigned.',
    rule: 'Every "why is this tier X?" answer must come from the basis and gate. The rules produce them; nothing else may.' },
  { term: 'Gate', category: 'concept',
    definition: 'A hard requirement that failed, capping or blocking a modality regardless of other evidence.',
    plain: 'A physical dealbreaker — for example, an antibody cannot reach a protein locked inside the cell.' },

  // ── the 4 mechanistic goals ──────────────────────────────────────────────
  { term: 'Inhibit function (goal)', category: 'goal', definition: MECHANISTIC_GOALS.inhibit,
    plain: 'Leave the protein in place but stop it working — like jamming a lock so the real key will not turn.',
    rule: 'The most permissive goal: no additional goal-based caps are applied.' },
  { term: 'Degrade protein (goal)', category: 'goal', definition: MECHANISTIC_GOALS.degrade,
    plain: 'Do not block it — remove it, by tagging it for the cell’s disposal machinery.',
    rule: 'Caps every occupancy modality (small molecule, antibody, peptide, interaction-disrupting) at Speculative: "inhibits but does not remove the protein".' },
  { term: 'Reduce level (goal)', category: 'goal', definition: MECHANISTIC_GOALS.reduce_level,
    plain: 'Stop the protein being made in the first place, by intercepting its mRNA instruction.',
    rule: 'Caps occupancy modalities at Speculative with the gate "occupancy does not change protein level".' },
  { term: 'Spare catalytic activity (goal)', category: 'goal', definition: MECHANISTIC_GOALS.spare_catalytic,
    plain: 'Change the protein’s behaviour without switching off its main chemical job, because healthy cells need that job too.',
    rule: `BLOCKS degraders and knockdown ("removes the protein — cannot spare its catalytic activity") and caps occupancy small molecules at Plausible, which must then bind allosterically. Having at least ${T.multiPocketMin} pockets is what makes an allosteric site plausible.` },

  { term: 'Restore function (goal)', category: 'goal', definition: MECHANISTIC_GOALS.restore_function,
    plain: 'Get more working protein, or make a broken one work again — the opposite of the other four goals.',
    rule: 'BLOCKS degraders and RNA knockdown (they remove the target). PROMOTES splice-switching to Plausible on a multi-exon gene, since correcting splicing is the mechanism. Expression modulation is allowed because it can raise as well as lower protein. Occupancy modalities need an activating or corrector mechanism rather than blockade.',
    caveat: 'The only gain-of-function goal. Nusinersen, eteplirsen and risdiplam belong here; running them under "inhibit" is a category error.' },

  // ── the 4 tiers ──────────────────────────────────────────────────────────
  { term: 'Precedented (tier)', category: 'tier', definition: TIER_DEF.Precedented,
    plain: 'A drug of this kind already exists for this exact protein. A database lookup, not a prediction.',
    source: 'Open Targets developed drugs',
    rule: 'Only awarded when a developed drug of the matching modality family exists for the target.',
    caveat: 'A genuinely novel target (no developed drugs) can NEVER reach this tier, however strong its other evidence is.' },
  { term: 'Plausible (tier)', category: 'tier', definition: TIER_DEF.Plausible,
    plain: 'No drug of this kind yet, but the evidence supports it — a pocket, measured chemistry, or an interface.' },
  { term: 'Speculative (tier)', category: 'tier', definition: TIER_DEF.Speculative,
    plain: 'No evidence either way. Not ruled out, just unsupported.',
    caveat: 'Read the basis: "no evidence exists" and "we could not fetch the evidence" both display as Speculative but mean different things — the first is biology, the second is a data-gathering gap.' },
  { term: 'Blocked (tier)', category: 'tier', definition: TIER_DEF.Blocked,
    plain: 'Physically ruled out by a hard rule — not a weak score, an impossibility.',
    caveat: 'In benchmarking, Blocked never fired on a clinically precedented modality (0 violations).' },

  // ── the 12 modalities ────────────────────────────────────────────────────
  { term: 'Conventional small molecule', category: 'modality',
    definition: 'A classical low-molecular-weight drug that occupies a binding site.',
    plain: 'A normal pill. Small enough to get inside cells, but it needs a groove to grip.',
    rule: `Precedented if a small-molecule drug exists for the target; Plausible if ChEMBL has at least ${T.chemblChemicalMatter} measured bioactivities, or Open Targets rates it small-molecule tractable, or a druggable-shaped pocket exists.` },
  { term: 'Covalent ligand', category: 'modality',
    definition: 'A small molecule that forms a permanent covalent bond with a residue, usually a cysteine.',
    plain: 'A pill that locks on permanently instead of drifting on and off.',
    rule: 'Capped at Speculative when the protein has no cysteines — there is nothing for the warhead to bond to.' },
  { term: 'Fragments', category: 'modality',
    definition: 'Fragment-based discovery: start from very small chemical pieces and grow them into a lead.',
    plain: 'Begin with tiny chemical building blocks and build a drug up from them.' },
  { term: 'Antibody / intrabody', category: 'modality',
    definition: 'A large protein therapeutic that binds the target with high specificity.',
    plain: 'A big, precise injected drug — it cannot get inside cells.',
    rule: 'BLOCKED when the target is intracellular. Speculative when localization is unknown. Requires surface or secreted access.',
    source: 'UniProt transmembrane / signal peptide; Human Protein Atlas breaks genuine ties only' },
  { term: 'Interaction-disrupting biologic', category: 'modality',
    definition: 'A biologic that breaks a specific protein-protein interaction rather than occupying a catalytic site.',
    plain: 'Instead of jamming the machine, it separates it from its partner.',
    rule: 'Plausible when the target has at least one high-confidence STRING partner — an interface exists to disrupt.' },
  { term: 'Stapled / macrocyclic peptide', category: 'modality',
    definition: 'A conformationally constrained peptide, between a small molecule and a biologic in size.',
    plain: 'A short protein chain, stiffened so it holds its shape and survives longer.',
    rule: 'Plausible when STRING partners exist. Intracellular delivery and permeability remain the constraint.' },
  { term: 'Linear peptide', category: 'modality',
    definition: 'An unconstrained peptide binder.',
    plain: 'The same idea as a stapled peptide but floppy — it degrades fast and struggles to get into cells.',
    rule: 'Always capped at Speculative: poor permeability and stability.' },
  { term: 'PROTAC / degrader', category: 'modality',
    definition: 'A bifunctional molecule that recruits an E3 ligase to the target, tagging it for proteasomal degradation.',
    plain: 'A two-headed molecule: one end grabs the protein, the other grabs the cell’s disposal crew.',
    rule: 'BLOCKED when the target is secreted — no access to the intracellular ubiquitin-proteasome system. Plausible when a ligandable pocket or PROTAC tractability exists; lysine count and known ubiquitination strengthen the basis.' },
  { term: 'Molecular glue', category: 'modality',
    definition: 'A small molecule that stabilises a new interface between the target and an E3 ligase.',
    plain: 'Same outcome as a PROTAC, but usually discovered by luck rather than designed.',
    rule: 'Always capped at Speculative — glues are largely serendipity-driven and cannot be designed to order.' },
  { term: 'RNA knockdown (siRNA/gapmer ASO)', category: 'modality',
    definition: 'An oligonucleotide that degrades the target mRNA so the protein is not translated.',
    plain: 'Destroys the instruction so the protein is never built.',
    rule: 'Structure-independent, so a pocket is not required. Delivery to the disease tissue is the real constraint. BLOCKED under the spare-catalytic goal.' },
  { term: 'Splice-switching ASO', category: 'modality',
    definition: 'An oligonucleotide that redirects splicing to produce a different transcript isoform.',
    plain: 'Changes how the instruction is edited, to make a different version of the protein.',
    rule: `BLOCKED when the canonical transcript has ${T.singleExonMax} exon or fewer — there is no splicing event to switch. Multi-exon is necessary but not sufficient.` },
  { term: 'Expression / genetic modulation', category: 'modality',
    definition: 'Broader genetic control of how much target protein is produced.',
    plain: 'Turn the production line down rather than attacking the finished protein.',
    rule: 'BLOCKED under the spare-catalytic goal — it removes the protein.' },

  // ── evidence fields ──────────────────────────────────────────────────────
  { term: 'Developed drugs', category: 'evidence',
    definition: 'Drugs that have reached development for this target, grouped by modality family with the most advanced clinical stage.',
    source: 'Open Targets drugAndClinicalCandidates',
    rule: 'The ONLY evidence that can produce the Precedented tier.',
    caveat: 'Zero developed drugs means a novel target, not a bad one — it caps the ceiling at Plausible.' },
  { term: 'ChEMBL bioactivities', category: 'evidence',
    definition: 'Count of measured experiments where a molecule was assayed against this target.',
    source: 'ChEMBL',
    rule: `At least ${T.chemblChemicalMatter} counts as "chemical matter exists" and supports Plausible for small molecules.`,
    caveat: 'The empirical anchor: a measured binding molecule outranks any in-silico druggability prediction.' },
  { term: 'Druggable pocket', category: 'evidence',
    definition: 'A detected cavity whose SHAPE could hold a drug-sized ligand.',
    source: 'DoGSite3 via proteins.plus',
    rule: `Counted as druggable only when volume is between ${T.pocketMinVolume} and ${T.pocketMaxVolume} cubic angstroms AND enclosure is at least ${T.pocketMinEnclosure}.`,
    caveat: 'Bigger is NOT better. A very large pocket is usually an open protein-protein interface, which is harder to drug, not easier.' },
  { term: 'Enclosure', category: 'evidence',
    definition: 'How enclosed a pocket is, on a 0-1 scale. Higher means a deeper, more surrounded groove.',
    source: 'DoGSite3',
    rule: `Must be at least ${T.pocketMinEnclosure} for a pocket to count as druggable — a flat, open site cannot hold a ligand.` },
  { term: 'Surface access / localization', category: 'evidence',
    definition: 'Where the protein sits: surface, secreted, intracellular, or unknown. The single most decisive evidence field.',
    source: 'UniProt transmembrane and signal-peptide features; HPA breaks genuine ties only',
    rule: 'surface or secreted means antibodies can reach it. secreted BLOCKS degraders (no cytoplasmic access). intracellular BLOCKS antibodies. unknown leaves antibodies Speculative rather than blocked.',
    caveat: 'Only the curated UniProt TRANSMEMBRANE feature is trusted for "surface". A location string saying "membrane" is unreliable — a protein can sit on the inner face and still be unreachable.' },
  { term: 'STRING partners', category: 'evidence',
    definition: 'Count of high-confidence protein-protein interaction partners.',
    source: 'STRING',
    rule: 'At least one partner means an interface exists to disrupt — supports peptides and interaction-disrupting biologics.',
    caveat: 'These are proteins the target touches. They are extra handles for a drug, not things the target is drugging.' },
  { term: 'Lysine count', category: 'evidence',
    definition: 'Number of lysine residues in the sequence.', source: 'UniProt sequence',
    rule: 'Lysines are where ubiquitin is attached, so they are a prerequisite for degrader tagging. Strengthens a PROTAC basis.' },
  { term: 'Known ubiquitination', category: 'evidence',
    definition: 'Whether the protein is annotated as naturally ubiquitinated.', source: 'UniProt (Ubl conjugation)',
    rule: 'Evidence the cell already tags this protein for disposal — degradation-compatible, strengthens a PROTAC basis.' },
  { term: 'Cysteine count', category: 'evidence',
    definition: 'Number of cysteine residues in the sequence.', source: 'UniProt sequence',
    rule: 'A covalent drug needs a cysteine to bond to; zero cysteines caps covalent ligands at Speculative.' },
  { term: 'Active sites', category: 'evidence',
    definition: 'Annotated catalytic residues. More than zero implies the target is an enzyme.', source: 'UniProt',
    rule: 'Being an enzyme is what makes the spare-catalytic goal meaningful — you may want to modulate it without abolishing chemistry the healthy cell also needs.' },
  { term: 'Exon count', category: 'evidence',
    definition: 'Exons in the canonical transcript.', source: 'Ensembl',
    rule: `${T.singleExonMax} exon or fewer BLOCKS splice-switching — no splicing event exists to redirect.`,
    caveat: 'Ensembl is the slowest and least reliable source; when it fails the field reads "not resolved", which is a fetch gap, not a biological finding.' },
  { term: 'Open Targets tractability', category: 'evidence',
    definition: 'Per-modality tractability assessment (small molecule, antibody, PROTAC, other clinical precedence).',
    source: 'Open Targets tractability',
    caveat: 'A PREDICTION, not a measurement. Weaker evidence than a measured ChEMBL bioactivity.' },
  { term: '3D structure', category: 'evidence',
    definition: 'The structure pockets were detected on, with method and resolution.',
    source: 'PDBe experimental structures, AlphaFold as fallback',
    caveat: 'An AlphaFold model is one, often-closed conformation — a hypothesis. Cryptic pockets are NOT predicted, so the absence of a pocket is not proof of undruggability.' },
];

// Compact reference for the AI system prompt — one block per term, deterministic.
export function modalityPromptBlock(): string {
  const line = (e: ModalityGlossaryEntry) => {
    const bits = [e.definition];
    if (e.plain)  bits.push(`Plain: ${e.plain}`);
    if (e.rule)   bits.push(`Rule: ${e.rule}`);
    if (e.source) bits.push(`Source: ${e.source}`);
    if (e.caveat) bits.push(`Caveat: ${e.caveat}`);
    return `- ${e.term} [${e.category}]: ${bits.join(' · ')}`;
  };
  const cats = `The 12 modalities by category: ${MODALITY_TAXONOMY.map(m => `${m.modality} (${m.category})`).join('; ')}.`;
  return `${cats}\n${MODALITY_GLOSSARY.map(line).join('\n')}`;
}

// The LIVE result, rendered for the prompt so the assistant can explain THIS gene's tiers
// from the rules' own recorded reasoning rather than reasoning independently. Every tier
// arrives with its gate and basis — which is exactly what a "why?" answer must quote.
// Returns '' when no analysis is loaded, so the prompt stays small in that case.
export function modalityResultBlock(data: any): string {
  if (!data?.gene || !Array.isArray(data?.modalities)) return '';
  const e = data.evidence || {};
  // "not retrieved" is stated explicitly rather than omitted: a fetch gap and a genuine
  // absence lead to different answers, and the assistant must be able to tell them apart.
  const ev = [
    e.uniprot ? `UniProt ${e.uniprot}` : null,
    e.surfaceAccess ? `access: ${e.surfaceAccess}${e.surfaceSource ? ` (${e.surfaceSource})` : ''}` : null,
    e.pocket?.hasStructure
      ? `${e.pocket.structureLabel} · ${e.pocket.totalPockets} pockets (${e.pocket.druggablePockets} druggable-shaped)`
      : 'no 3D structure resolved',
    e.likelyEnzyme ? `enzyme (${e.activeSiteCount} active sites)` : null,
    e.cysCount != null ? `${e.cysCount} Cys` : null,
    e.lysineCount != null ? `${e.lysineCount} Lys` : null,
    e.isUbiquitinated ? 'known ubiquitination' : null,
    e.chemblActivities != null ? `ChEMBL ${e.chemblActivities} bioactivities` : 'ChEMBL not retrieved',
    e.ppiPartners != null ? `STRING ${e.ppiPartners} partners` : 'STRING not retrieved',
    e.exonCount != null ? `${e.exonCount} exons` : 'exon count not retrieved',
    e.provenModalities?.length
      ? `developed drugs: ${e.provenModalities.map((p: any) => `${p.family} (${p.drugCount}, ${p.topStage})`).join(', ')}`
      : 'no developed drugs (novel target)',
  ].filter(Boolean).join(' · ');

  const rows = data.modalities.map((m: any) =>
    `  - ${m.modality} [${m.category}] -> ${m.tier}${m.gate ? ` · GATE: ${m.gate}` : ''}${m.basis?.length ? ` · BASIS: ${m.basis.join('; ')}` : ' · BASIS: none recorded'}`
  ).join('\n');

  const notes = e.notes?.length ? `\nEvidence caveats recorded this run: ${e.notes.join(' | ')}` : '';

  return `CURRENT MODALITY FIT RESULT — gene ${data.gene}, goal "${data.goal}" (${data.goalText || ''}).
Evidence gathered for this run: ${ev}${notes}
Tiers assigned by the deterministic rules:
${rows}`;
}
