// Regenerates agoraNominated.ts — the gene list the Ranking Board's dataset filter uses.
//
//   node AGORA/scripts/build_gene_list.cjs
//
// Deliberately a bundled list rather than rows in the EVIDENCE table. Agora is an
// Alzheimer's-specific curation; writing it into a snapshot would make it look like
// another scoring axis and would mix it into every disease's evidence. The board only
// needs to know which symbols are in the set in order to filter by it.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(__dirname, '..', 'data', 'agora_nominated.json');
const OUT = path.join(ROOT, 'agoraNominated.ts');

if (!fs.existsSync(SRC)) {
  console.error(`Missing ${path.relative(ROOT, SRC)} — run AGORA/scripts/build_agora_dataset.mjs first.`);
  process.exit(1);
}

const items = JSON.parse(fs.readFileSync(SRC, 'utf8')).items;
const map = {};
for (const g of items) {
  const s = String(g.hgnc_symbol || '').toUpperCase();
  if (s) map[s] = g.total_nominations || 1;
}
const keys = Object.keys(map).sort();
// A bare identifier where the symbol allows it, quoted otherwise (some symbols start
// with a digit or carry a hyphen, which is not a valid unquoted key).
const body = keys.map(k => `  ${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k)}: ${map[k]},`).join('\n');
const today = new Date().toISOString().slice(0, 10);

const out = `// agoraNominated.ts ──────────────────────────────────────────────────────────
// GENERATED — do not hand-edit. Rebuild with:
//   node AGORA/scripts/build_gene_list.cjs
//
// Gene symbol -> how many AMP-AD teams nominated it, from Agora
// (agora.adknowledgeportal.org).
//
// Bundled as a list rather than written into the EVIDENCE table on purpose. Agora is
// an ALZHEIMER-specific curation; putting it in a snapshot would make it look like
// another scoring axis and would follow every other disease around. The board only
// needs the membership to filter on it, and the filter changes no score.
//
// ${keys.length} genes · captured ${today}

export const AGORA_NOMINATED: Record<string, number> = {
${body}
};

export const AGORA_COUNT = ${keys.length};

export const isAgora = (symbol?: string | null): boolean =>
  !!symbol && Object.prototype.hasOwnProperty.call(AGORA_NOMINATED, symbol.toUpperCase());

export const agoraNominations = (symbol?: string | null): number =>
  (symbol && AGORA_NOMINATED[symbol.toUpperCase()]) || 0;
`;

fs.writeFileSync(OUT, out);
console.log(`wrote ${path.relative(ROOT, OUT)} — ${keys.length} genes, ${(out.length / 1024).toFixed(1)} KB`);
