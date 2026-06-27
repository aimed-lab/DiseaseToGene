// Migrate Supabase content into the team's normalized Oracle schema.
//   node --env-file=.env docs/oracle/migrate_to_oracle.cjs
//
// Model (per disease):
//   TARGET_RANKING_SNAPSHOTS (1)  -> RANKING_SCORES (1 per gene, scores flattened)
//                                 -> EVIDENCE (1 per source bundle per gene: clinical,
//                                    literature, druggability/ChEMBL, mutation/cBioPortal)
//   evidence_cards (papers)       -> EVIDENCE (evidence_type='paper')
//   + one AUDIT_LOG entry for the migration
//
// Connects as the APP user (ORACLE_USER) via the public synonyms. IDs are Oracle
// identity columns — we never supply them; we capture them with RETURNING.

const oracledb = require("oracledb");
const { createClient } = require("@supabase/supabase-js");

const J = (v) => (v == null ? null : JSON.stringify(v));
const numv = (v) => (v == null || isNaN(Number(v)) ? null : Number(v));
const D = (v) => (v ? new Date(v) : new Date());
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));

async function main() {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
  });
  console.log(`Connected as ${process.env.ORACLE_USER}\n`);

  const gc = (await sb.from("gene_content").select("*")).data || [];
  const cards = (await sb.from("evidence_cards").select("*")).data || [];
  const papers = {};
  ((await sb.from("papers").select("*")).data || []).forEach((p) => (papers[p.id] = p));

  // group gene_content by disease
  const byDisease = {};
  for (const r of gc) (byDisease[r.disease_id] ||= []).push(r);

  let snaps = 0, scores = 0, evidence = 0, skipped = 0;

  const addEvidence = async (snapshotId, diseaseId, gene, type, source, valueJson, valueText, retrievedAt, generatedBy, audit, sourceUrl) => {
    if (valueJson == null) return;
    await conn.execute(
      `INSERT INTO evidence (snapshot_id, disease_id, gene_symbol, evidence_type, source, source_url,
         value_text, value_json, retrieved_at, generated_by, audit_status)
       VALUES (:snapshot_id, :disease_id, :gene_symbol, :evidence_type, :source, :source_url,
         :value_text, :value_json, :retrieved_at, :generated_by, :audit_status)`,
      { snapshot_id: snapshotId, disease_id: clip(diseaseId, 100), gene_symbol: clip(gene, 64),
        evidence_type: clip(type, 60), source: clip(source, 100), source_url: clip(sourceUrl, 1000),
        value_text: clip(valueText, 4000), value_json: J(valueJson), retrieved_at: retrievedAt,
        generated_by: clip(generatedBy, 200), audit_status: clip(audit, 40) },
      { autoCommit: false }
    );
    evidence++;
  };

  for (const [diseaseId, rows] of Object.entries(byDisease)) {
    const diseaseName = rows[0].disease_name || diseaseId;

    // skip if already migrated (so re-runs don't duplicate)
    const exists = await conn.execute(
      `select count(*) from target_ranking_snapshots where disease_id = :d and label like 'Migrated from Supabase%'`,
      [diseaseId]
    );
    if (exists.rows[0][0] > 0) { console.log(`  skip ${diseaseName} (already migrated)`); skipped++; continue; }

    const snapRes = await conn.execute(
      `INSERT INTO target_ranking_snapshots (disease_id, disease_name, version, created_at, created_by, label, gene_count, provenance)
       VALUES (:disease_id, :disease_name, 1, SYSTIMESTAMP, :created_by, :label, :gene_count, :provenance)
       RETURNING id INTO :id`,
      { disease_id: clip(diseaseId, 100), disease_name: clip(diseaseName, 400), created_by: "migration",
        label: "Migrated from Supabase gene_content", gene_count: rows.length,
        provenance: J({ source: "supabase-migration", migrated_at: new Date().toISOString() }),
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } },
      { autoCommit: false }
    );
    const snapshotId = snapRes.outBinds.id[0];
    snaps++;

    for (const r of rows) {
      const s = r.get_scores || {};
      await conn.execute(
        `INSERT INTO ranking_scores (snapshot_id, disease_id, disease_name, gene_symbol, gene_name, rank_position,
           overall_score, get_score, genetic_score, expression_score, target_score, literature_score,
           tau_tissue, tau_single_cell, bimodality_max, bimodality_tissue, pubtator_score, created_at)
         VALUES (:snapshot_id, :disease_id, :disease_name, :gene_symbol, :gene_name, :rank_position,
           :overall_score, :get_score, :genetic_score, :expression_score, :target_score, :literature_score,
           :tau_tissue, :tau_single_cell, :bimodality_max, :bimodality_tissue, :pubtator_score, SYSTIMESTAMP)`,
        { snapshot_id: snapshotId, disease_id: clip(diseaseId, 100), disease_name: clip(diseaseName, 400),
          gene_symbol: clip(r.gene_symbol, 64), gene_name: null, rank_position: numv(r.rank),
          overall_score: numv(s.overallScore), get_score: numv(s.getScore), genetic_score: numv(s.geneticScore),
          expression_score: numv(s.combinedExpression ?? s.expressionScore), target_score: numv(s.targetScore),
          literature_score: numv(s.literatureScore), tau_tissue: numv(s.tauTissue), tau_single_cell: numv(s.tauSingleCell),
          bimodality_max: null, bimodality_tissue: null, pubtator_score: numv(s.pubTatorScore) },
        { autoCommit: false }
      );
      scores++;

      const retrieved = D(r.provenance?.retrieved || r.updated_at);
      const genBy = r.provenance?.harvested_by || "harvest";
      await addEvidence(snapshotId, diseaseId, r.gene_symbol, "clinical", "ClinicalTrials.gov", r.clinical,
        r.clinical ? `trials: ${r.clinical.trial_count ?? ""}` : null, retrieved, genBy, "not_audited", null);
      await addEvidence(snapshotId, diseaseId, r.gene_symbol, "literature", "PubMed/EuropePMC/PubTator", r.literature,
        null, retrieved, genBy, "not_audited", null);
      await addEvidence(snapshotId, diseaseId, r.gene_symbol, "druggability", "ChEMBL", r.chembl,
        r.chembl?.label || null, retrieved, genBy, "not_audited", null);
      await addEvidence(snapshotId, diseaseId, r.gene_symbol, "mutation", "cBioPortal", r.mutations,
        r.mutations?.dominantVariant || null, retrieved, genBy, "not_audited", null);
    }
    await conn.commit();
    console.log(`  ${diseaseName}: snapshot ${snapshotId} — ${rows.length} genes`);
  }

  // paper-derived evidence cards (not tied to a snapshot)
  for (const c of cards) {
    const p = papers[c.paper_id];
    try {
      await conn.execute(
        `INSERT INTO evidence (snapshot_id, disease_id, gene_symbol, evidence_type, source, source_url,
           value_text, value_json, retrieved_at, generated_by, audit_status)
         VALUES (NULL, :disease_id, :gene_symbol, 'paper', :source, :source_url,
           :value_text, :value_json, :retrieved_at, :generated_by, :audit_status)`,
        { disease_id: clip(c.disease || "unknown", 100), gene_symbol: clip(c.gene_symbol, 64),
          source: clip(p?.title || c.drug || "paper", 100), source_url: clip(p?.doi || p?.url, 1000),
          value_text: clip(c.source_quote || c.key_finding, 4000), value_json: J(c),
          retrieved_at: D(c.created_at), generated_by: "paper extraction (Gemini)",
          audit_status: clip(c.audit_status || "AI-extracted", 40) },
        { autoCommit: true }
      );
      evidence++;
    } catch (e) { console.error(`  ! evidence_card ${c.id}: ${e.message}`); }
  }

  // audit-log the migration
  try {
    await conn.execute(
      `INSERT INTO audit_log (event_time, actor, action, entity, entity_id, disease_id, details)
       VALUES (SYSTIMESTAMP, 'migration', 'migrate', 'supabase->oracle', NULL, NULL, :details)`,
      { details: J({ snapshots: snaps, ranking_scores: scores, evidence, skipped }) },
      { autoCommit: true }
    );
  } catch (e) { console.error("  ! audit_log:", e.message); }

  console.log(`\nDone. snapshots=${snaps}, ranking_scores=${scores}, evidence=${evidence}, skipped_diseases=${skipped}`);
  await conn.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
