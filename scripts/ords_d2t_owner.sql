-- ============================================================================
-- Disease2Target — ORDS read-only bridge, ready to paste.
-- Host schema: DISEASE2TARGET_OWNER (owns the tables → no GRANTs, no prefixes).
--
-- HOW TO RUN (APEX):
--   SQL Workshop → SQL Commands, with the Schema selector set to
--   DISEASE2TARGET_OWNER. Paste SECTION 1, click Run. Then curl-test (see below).
--   Then paste SECTION 2 to lock it down with OAuth2 (recommended).
--
-- Result base URL:  https://<your-apex-host>/ords/d2towner
--   data:   https://<your-apex-host>/ords/d2towner/d2t/snapshots
--   token:  https://<your-apex-host>/ords/d2towner/oauth/token   (SECTION 2 only)
-- Put in Vercel:  USE_ORDS=1  ORDS_BASE_URL=https://<host>/ords/d2towner
-- ============================================================================


-- ============================== SECTION 1 ===================================
-- Register schema with ORDS + create the six READ-ONLY (GET) endpoints.
-- Publicly readable after this runs — good for testing; SECTION 2 locks it down.
BEGIN
  ORDS.ENABLE_SCHEMA(
    p_enabled             => TRUE,
    p_schema              => 'DISEASE2TARGET_OWNER',
    p_url_mapping_type    => 'BASE_PATH',
    p_url_mapping_pattern => 'd2towner',   -- URL alias → .../ords/d2towner/...
    p_auto_rest_auth      => FALSE);

  ORDS.DEFINE_MODULE(
    p_module_name    => 'd2t.read',
    p_base_path      => '/d2t/',
    p_items_per_page => 500,
    p_status         => 'PUBLISHED',
    p_comments       => 'Disease2Target read-only bridge');

  -- 1) GET /d2t/snapshots  (optional ?disease_id=)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'snapshots');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'snapshots', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT id AS "id", disease_id AS "disease_id", disease_name AS "disease_name",
             version AS "version",
             TO_CHAR(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "created_at",
             created_by AS "created_by", label AS "label", gene_count AS "gene_count"
      FROM target_ranking_snapshots
      WHERE (:disease_id IS NULL OR disease_id = :disease_id)
      ORDER BY created_at DESC
    ]');

  -- 2) GET /d2t/snapshots/:id
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'snapshots/:id');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'snapshots/:id', p_method=>'GET',
    p_source_type=>ORDS.source_type_query_one_row,
    p_source=>q'[
      SELECT id AS "id", disease_id AS "disease_id", disease_name AS "disease_name",
             version AS "version",
             TO_CHAR(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "created_at",
             created_by AS "created_by", label AS "label", gene_count AS "gene_count",
             weights AS "weights", provenance AS "provenance", targets AS "targets"
      FROM target_ranking_snapshots WHERE id = :id
    ]');

  -- 3) GET /d2t/snapshots/:id/scores
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'snapshots/:id/scores');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'snapshots/:id/scores', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT gene_symbol AS "gene_symbol", rank_position AS "rank", overall_score AS "overall_score",
             get_score AS "get_score", genetic_score AS "genetic_score", expression_score AS "expression_score",
             target_score AS "target_score", literature_score AS "literature_score",
             tau_tissue AS "tau_tissue", tau_single_cell AS "tau_single_cell",
             bimodality_max AS "bimodality_max", bimodality_tissue AS "bimodality_tissue",
             pubtator_score AS "pubtator_score"
      FROM ranking_scores WHERE snapshot_id = :id ORDER BY rank_position
    ]');

  -- 4) GET /d2t/snapshots/:id/evidence  (large → paginated)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'snapshots/:id/evidence');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'snapshots/:id/evidence', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT gene_symbol AS "gene_symbol", evidence_type AS "evidence_type", source AS "source",
             value_text AS "value_text", value_json AS "value_json"
      FROM evidence WHERE snapshot_id = :id
    ]');

  -- 5) GET /d2t/evidence/genes  (distinct genes with evidence; optional ?disease_id=)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'evidence/genes');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'evidence/genes', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT DISTINCT gene_symbol AS "g" FROM evidence
      WHERE (:disease_id IS NULL OR LOWER(disease_id) LIKE LOWER('%'||:disease_id||'%'))
    ]');

  -- 6) GET /d2t/evidence/gene/:gene
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'evidence/gene/:gene');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'evidence/gene/:gene', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT id AS "id", snapshot_id AS "snapshot_id", disease_id AS "disease_id", gene_symbol AS "gene_symbol",
             evidence_type AS "evidence_type", source AS "source", source_url AS "source_url",
             value_text AS "value_text", value_json AS "value_json",
             TO_CHAR(retrieved_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "retrieved_at",
             generated_by AS "generated_by", audit_status AS "audit_status"
      FROM evidence WHERE gene_symbol = :gene ORDER BY retrieved_at DESC
    ]');

  COMMIT;
END;

-- ^^ APEX SQL Commands: select from "BEGIN" down to "END;" (NO trailing slash) and Run.

-- Quick check that a handler works (run separately after the block above):
--   Public test:  curl "https://<host>/ords/d2towner/d2t/snapshots"
-- Expect: {"items":[ ... ],"hasMore":false, ...}


-- ============================== SECTION 2 ===================================
-- OAuth2 client-credentials — makes the endpoints PRIVATE.
-- NOTE: the ORDS_TYPES.T_ROLES/T_PATTERNS collection types are not available in
-- this ORDS build (PLS-00302), so create the ROLE + PRIVILEGE in the APEX GUI, then
-- run the OAuth-client PL/SQL below (it uses only VARCHAR2 args — no broken types).
--
-- GUI steps (RESTful Services left nav):
--   ROLES → Create Role:  name = d2t_reader
--   PRIVILEGES → Create Privilege:
--       name             = d2t.read.priv
--       title            = Disease2Target read
--       Assigned Roles   = d2t_reader
--       Protected Modules= d2t.read           <-- this protects the endpoints
--   (After this, calling /d2t/* without a token returns 401.)

-- Then run THIS block by itself (BEGIN … END;, no slash) to create the machine client:
BEGIN
  OAUTH.CREATE_CLIENT(
    p_name            => 'd2t-vercel',
    p_grant_type      => 'client_credentials',
    p_owner           => 'Disease2Target',
    p_description     => 'Vercel read-only client',
    p_support_email   => 'nkurmach@uab.edu',
    p_privilege_names => 'd2t.read.priv');
  OAUTH.GRANT_CLIENT_ROLE(p_client_name => 'd2t-vercel', p_role_name => 'd2t_reader');
  COMMIT;
END;

-- Then run THIS SELECT by itself — copy the two values into Vercel
-- (ORDS_CLIENT_ID / ORDS_CLIENT_SECRET):
SELECT name, client_id, client_secret FROM user_ords_clients WHERE name = 'd2t-vercel';

-- OAuth test:
--   curl -s --user "<client_id>:<client_secret>" -d "grant_type=client_credentials" \
--        "https://<host>/ords/d2towner/oauth/token"
--   curl -H "Authorization: Bearer <token>" "https://<host>/ords/d2towner/d2t/snapshots"
