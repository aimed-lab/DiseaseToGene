-- ============================================================================
-- Disease2Target — Oracle schema (store of record)
-- Run as the schema owner: DISEASE2TARGET_OWNER
--
-- Oracle translation of the Supabase/Postgres content tables. Notes:
--   • UUIDs        -> VARCHAR2(36) (carries the existing Supabase id on sync;
--                     defaults to a generated id for Oracle-native inserts)
--   • jsonb        -> CLOB with an "IS JSON" check (Oracle 12c+; works everywhere)
--   • text[]       -> CLOB holding a JSON array (Oracle has no array column type)
--   • timestamptz  -> TIMESTAMP WITH TIME ZONE (default SYSTIMESTAMP)
--   • RLS policies  -> NOT used here; access is via the DISEASE2TARGET_RW role
--                     (read/write on content tables, append-only on audit_log)
--   • created_by/updated_by hold the Supabase user id as text (no FK to auth.users)
--   • "rank" -> rank_pos (avoids the Oracle analytic-function keyword)
-- ============================================================================

-- ── gene_content : full evidence profile per (disease, gene) ──────────────────
CREATE TABLE gene_content (
  id            VARCHAR2(36) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) PRIMARY KEY,
  disease_id    VARCHAR2(200) NOT NULL,
  disease_name  VARCHAR2(400),
  gene_symbol   VARCHAR2(100) NOT NULL,
  rank_pos      NUMBER(10),
  get_scores    CLOB,
  clinical      CLOB,
  literature    CLOB,
  chembl        CLOB,
  mutations     CLOB,
  provenance    CLOB,
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  updated_by    VARCHAR2(36),
  CONSTRAINT gene_content_uk UNIQUE (disease_id, gene_symbol),
  CONSTRAINT gc_get_json     CHECK (get_scores IS JSON),
  CONSTRAINT gc_clin_json    CHECK (clinical   IS JSON),
  CONSTRAINT gc_lit_json     CHECK (literature IS JSON),
  CONSTRAINT gc_chembl_json  CHECK (chembl     IS JSON),
  CONSTRAINT gc_mut_json     CHECK (mutations  IS JSON),
  CONSTRAINT gc_prov_json    CHECK (provenance IS JSON)
);
CREATE INDEX idx_gc_disease_rank ON gene_content (disease_id, rank_pos);
CREATE INDEX idx_gc_gene         ON gene_content (gene_symbol);

-- ── papers : one row per ingested paper ──────────────────────────────────────
CREATE TABLE papers (
  id             VARCHAR2(36) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) PRIMARY KEY,
  title          VARCHAR2(1000) NOT NULL,
  authors        CLOB,                       -- JSON array
  journal        VARCHAR2(500),
  pub_year       NUMBER(6),
  doi            VARCHAR2(300),
  url            VARCHAR2(1000),
  study_type     VARCHAR2(100),
  sample_size    NUMBER(12),
  key_finding    CLOB,
  conclusion     CLOB,
  raw_extraction CLOB,
  audit_status   VARCHAR2(40) DEFAULT 'AI-extracted' NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  created_by     VARCHAR2(36),
  CONSTRAINT papers_authors_json CHECK (authors IS JSON),
  CONSTRAINT papers_raw_json     CHECK (raw_extraction IS JSON)
);

-- ── evidence_cards : one fact per gene/drug/mutation, with source quote ───────
CREATE TABLE evidence_cards (
  id               VARCHAR2(36) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) PRIMARY KEY,
  paper_id         VARCHAR2(36),
  gene_symbol      VARCHAR2(100) NOT NULL,
  disease          VARCHAR2(400),
  mutation         VARCHAR2(100),
  drug             VARCHAR2(300),
  drug_action      VARCHAR2(100),
  mechanism        VARCHAR2(1000),
  modality         VARCHAR2(200),
  trial_phase      VARCHAR2(100),
  trial_ids        CLOB,                     -- JSON array
  primary_endpoint VARCHAR2(500),
  efficacy_result  VARCHAR2(1000),
  effect_size      VARCHAR2(500),
  approval_status  VARCHAR2(300),
  key_finding      CLOB,
  source_quote     CLOB,
  audit_status     VARCHAR2(40) DEFAULT 'AI-extracted' NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  created_by       VARCHAR2(36),
  CONSTRAINT ec_paper_fk    FOREIGN KEY (paper_id) REFERENCES papers (id),
  CONSTRAINT ec_trialids_json CHECK (trial_ids IS JSON)
);
CREATE INDEX idx_ec_gene         ON evidence_cards (gene_symbol);
CREATE INDEX idx_ec_gene_disease ON evidence_cards (gene_symbol, disease);
CREATE INDEX idx_ec_paper        ON evidence_cards (paper_id);

-- ── target_ranking_snapshots : versioned ranking history ─────────────────────
CREATE TABLE target_ranking_snapshots (
  id            VARCHAR2(36) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) PRIMARY KEY,
  disease_id    VARCHAR2(200) NOT NULL,
  disease_name  VARCHAR2(400) NOT NULL,
  version       NUMBER(10) DEFAULT 1 NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  created_by    VARCHAR2(36),
  label         VARCHAR2(1000),
  weights       CLOB,
  gene_count    NUMBER(10),
  provenance    CLOB,
  targets       CLOB,
  CONSTRAINT trs_weights_json CHECK (weights    IS JSON),
  CONSTRAINT trs_prov_json    CHECK (provenance IS JSON),
  CONSTRAINT trs_targets_json CHECK (targets    IS JSON)
);
CREATE INDEX idx_trs_disease ON target_ranking_snapshots (disease_id, version DESC);

-- ── audit_log : append-only trail (who/what/when changed) ─────────────────────
CREATE TABLE audit_log (
  id            VARCHAR2(36) DEFAULT LOWER(RAWTOHEX(SYS_GUID())) PRIMARY KEY,
  entity_type   VARCHAR2(60) NOT NULL,       -- gene_content | evidence_card | paper | snapshot
  entity_id     VARCHAR2(36),
  gene_symbol   VARCHAR2(100),
  disease_id    VARCHAR2(200),
  action        VARCHAR2(40) NOT NULL,       -- created | updated | verified | rejected | harvested
  detail        CLOB,
  performed_by  VARCHAR2(36),
  performed_at  TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT audit_detail_json CHECK (detail IS JSON)
);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_time   ON audit_log (performed_at DESC);
