// modalityConstants.ts ───────────────────────────────────────────────────────
// The shared modality VOCABULARY: goals, tiers, the 12-modality taxonomy, and the
// numeric thresholds the deterministic rules turn on.
//
// Pure data with NO imports, so both sides can use it:
//   • modalityFitService.ts (server) runs the rules from these values
//   • modalityGlossary.ts (client) documents them for the co-pilot
//
// Keeping one copy is the point: if a threshold changes here it changes in the rules
// AND in what the assistant tells users, at the same time. A second hand-typed copy
// would let the documentation drift silently false.

// ── Rule version ──
// Stamped into every generated artifact alongside the git SHA. Bump it when a rule,
// gate or threshold below changes the OUTPUT of assessModalities — not for comments
// or refactors. v2's published numbers were produced under 2.x and were superseded
// by the molecular-glue correction; 3.0 is the first version whose results carry
// their own provenance, so "which rules produced this table?" is answerable from the
// table rather than from a changelog someone has to be trusted to have updated.
export const RULE_VERSION = '3.0';

// ── Mechanistic goal — what the user wants done TO the target ──
export type MechanisticGoal = 'inhibit' | 'degrade' | 'reduce_level' | 'spare_catalytic' | 'restore_function';
export const MECHANISTIC_GOALS: Record<MechanisticGoal, string> = {
  inhibit:        'Inhibit or block the target’s function (engage and antagonise it).',
  degrade:        'Remove the target protein entirely via induced degradation.',
  reduce_level:   'Lower the amount of target protein / mRNA (knockdown or expression modulation).',
  spare_catalytic:'Modulate the target WITHOUT abolishing its catalytic/enzymatic activity (spare the active site).',
  // The first GAIN-of-function goal. The other four all reduce or block the target, which
  // left drugs like nusinersen (more full-length SMN) and eteplirsen (a restored dystrophin
  // reading frame) with no goal they could honestly be evaluated under.
  restore_function:'Restore or increase functional target protein (splice correction, activation, expression increase).',
};
export const isGoal = (g: any): g is MechanisticGoal => typeof g === 'string' && g in MECHANISTIC_GOALS;

// ── Rule thresholds — the numbers the deterministic tiers actually turn on ──
export const MODALITY_THRESHOLDS = {
  pocketMinVolume: 150,      // Å³ — below this nothing drug-sized fits
  pocketMaxVolume: 1200,     // Å³ — above this it is an open interface: harder, not easier
  pocketMinEnclosure: 0.4,   // 0–1 — how enclosed the groove is; flat sites do not hold a ligand
  chemblChemicalMatter: 50,  // ≥ this many measured bioactivities = chemical matter exists
  multiPocketMin: 2,         // ≥ this many pockets = an allosteric option may exist
  singleExonMax: 1,          // ≤ this many exons = no splicing event to switch
} as const;

// ── The 12-modality taxonomy, grouped into the 5 chart categories ──
export const MODALITY_CATEGORIES = ['Biologic', 'RNA/genetic', 'Peptide', 'Induced-proximity', 'Small molecule'] as const;
export type ModalityCategory = typeof MODALITY_CATEGORIES[number];
export const MODALITY_TAXONOMY: { category: ModalityCategory; modality: string }[] = [
  { category: 'Biologic',        modality: 'Antibody / intrabody' },
  { category: 'Biologic',        modality: 'Interaction-disrupting biologic' },
  { category: 'RNA/genetic',     modality: 'Expression / genetic modulation' },
  { category: 'RNA/genetic',     modality: 'RNA knockdown (siRNA/gapmer ASO)' },
  { category: 'RNA/genetic',     modality: 'Splice-switching ASO' },
  { category: 'Peptide',         modality: 'Stapled / macrocyclic peptide' },
  { category: 'Peptide',         modality: 'Linear peptide' },
  { category: 'Induced-proximity', modality: 'Molecular glue' },
  { category: 'Induced-proximity', modality: 'PROTAC / degrader' },
  { category: 'Small molecule',  modality: 'Covalent ligand' },
  { category: 'Small molecule',  modality: 'Fragments' },
  { category: 'Small molecule',  modality: 'Conventional small molecule' },
];

// ── Anchored ordinal tiers (replaced the original 0–5 LLM score) ──
export type Tier = 'Precedented' | 'Plausible' | 'Speculative' | 'Blocked';
export const TIER_RANK: Record<Tier, number> = { Blocked: 0, Speculative: 1, Plausible: 2, Precedented: 3 };
export const TIER_DEF: Record<Tier, string> = {
  Precedented: 'A drug of this modality has reached the clinic for this target.',
  Plausible:   'Hard requirements met and tractability supportive, but no drug yet.',
  Speculative: 'Requirements met but key evidence is weak or not gathered.',
  Blocked:     'A hard requirement fails — this modality cannot work here.',
};
