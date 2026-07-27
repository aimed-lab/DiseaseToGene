-- gene_dossier.sql ───────────────────────────────────────────────────────────
-- ONE new table for the dashboard. Nothing else changes.
--
-- WHY IT IS NEEDED AT ALL
--   All 44 new metrics are stored in the EXISTING `evidence` table as new evidence_type
--   rows (annotation, tissue, patents, plus richer druggability/clinical JSON). No schema
--   change was required for storage — `evidence` was already designed to be extensible.
--
--   What `evidence` cannot do is answer the dashboard's questions quickly. Listing 7,000
--   genes means pulling ~40,000 rows and parsing JSON in memory (~30s over ORDS, which is
--   why the server currently caches it for 10 minutes). This table is the pre-computed,
--   one-row-per-gene projection: the grid becomes a single indexed query, sorting and
--   filtering move into SQL, and snapshot-vs-snapshot comparison becomes possible.
--
--   It is DERIVED data. `evidence` remains the source of truth, so this table can always
--   be dropped and rebuilt with `d2t dossier <snapshotId>`.
--
-- Run once on the UAB VPN (SQL Developer or sqlplus), then re-run the builder after any
-- re-enrich to refresh it.

CREATE TABLE gene_dossier (
  id                     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  gene_symbol            VARCHAR2(64)  NOT NULL,
  disease_id             VARCHAR2(64)  NOT NULL,
  disease_name           VARCHAR2(400),
  snapshot_id            NUMBER        NOT NULL,
  rank_position          NUMBER,
  score                  NUMBER,

  -- one paragraph, assembled DETERMINISTICALLY from the stored values (never LLM-written,
  -- so it cannot assert anything the evidence does not contain)
  summary                CLOB,

  -- ── identity / annotation ──
  approved_name          VARCHAR2(400),
  uniprot_id             VARCHAR2(32),
  target_class           VARCHAR2(200),
  surface_or_secreted    NUMBER(1),          -- 1/0 — can an antibody physically reach it
  is_common_essential    NUMBER(1),          -- 1/0 — pan-essential (a dependency-axis confounder)

  -- ── druggability (fact) + tractability (prediction), kept separate ──
  n_drugs                NUMBER,
  n_proven_modalities    NUMBER,
  n_tractable_modalities NUMBER,
  top_modality           VARCHAR2(200),
  max_drug_phase         NUMBER,

  -- ── clinical, scoped to THIS disease ──
  n_disease_trials       NUMBER,
  trials_phase1          NUMBER,
  trials_phase2          NUMBER,
  trials_phase3          NUMBER,
  trials_phase4          NUMBER,
  max_disease_phase      NUMBER,
  n_stopped_trials       NUMBER,             -- trials halted; the reason is in `evidence`

  -- ── biology ──
  mutation_frequency     NUMBER,
  log2fc                 NUMBER,
  chronos                NUMBER,
  loeuf                  NUMBER,
  tissue_tau             NUMBER,             -- 0 = ubiquitous (safety concern), 1 = restricted
  n_safety_liabilities   NUMBER,

  -- ── attention / context (never scored) ──
  n_publications         NUMBER,
  literature_velocity    NUMBER,
  n_patents              NUMBER,

  -- ── quality ──
  completeness           NUMBER,             -- 0..1 share of axes with real evidence
  missing_axes           VARCHAR2(1000),     -- so "sparse" is never misread as "weak"
  schema_version         VARCHAR2(16),       -- 'legacy' | 'v2' — which harvest wrote the evidence
  generated_at           TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,

  -- rebuilding a snapshot REPLACES its rows rather than duplicating them
  -- (the duplicate-row lesson from RANKING_SCORES)
  CONSTRAINT gene_dossier_uq UNIQUE (gene_symbol, disease_id, snapshot_id)
);

CREATE INDEX gene_dossier_snap_ix   ON gene_dossier (snapshot_id, rank_position);
CREATE INDEX gene_dossier_score_ix  ON gene_dossier (disease_id, score DESC);
-- supports the dashboard's headline discovery query:
--   "novel & tractable" = no drug, no trial, but a tractable modality
CREATE INDEX gene_dossier_novel_ix  ON gene_dossier (snapshot_id, n_drugs, n_disease_trials, n_tractable_modalities);

-- ── GRANTS (REQUIRED) ─────────────────────────────────────────────────────────
-- The runtime connects as the APP user and reaches tables through the RW role, exactly
-- like ranking_scores / evidence. WITHOUT this grant the app user cannot see the table
-- and every write fails with ORA-00942 ("table or view does not exist"). Run as the OWNER.
GRANT SELECT, INSERT, UPDATE, DELETE ON gene_dossier TO DISEASE2TARGET_RW;

-- ORDS read layer (only if the dashboard is served through ORDS off-VPN):
-- GRANT SELECT ON gene_dossier TO <ords_reader_role>;
