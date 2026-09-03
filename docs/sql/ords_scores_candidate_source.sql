-- ============================================================================
-- Disease2Target — add candidate_source to GET /d2t/snapshots/:id/scores
--
-- RANKING_SCORES gained candidate_source (OPEN_TARGETS | AGORA | MANUAL …) on 2 Sep 2026
-- (docs/sql/network_tables.sql §5). The scores endpoint predates it, so over ORDS every
-- appended gene still looks like an Open Targets candidate. Re-defining the handler
-- replaces it in place; the extra key is additive, existing readers ignore it.
--
-- Run in APEX SQL Workshop with the Schema selector on DISEASE2TARGET_OWNER
-- (the schema that hosts 'd2t.read'). Select from "BEGIN" to "END;" and Run.
-- ============================================================================

BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'snapshots/:id/scores', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT gene_symbol AS "gene_symbol", rank_position AS "rank", overall_score AS "overall_score",
             get_score AS "get_score", genetic_score AS "genetic_score", expression_score AS "expression_score",
             target_score AS "target_score", literature_score AS "literature_score",
             tau_tissue AS "tau_tissue", tau_single_cell AS "tau_single_cell",
             bimodality_max AS "bimodality_max", bimodality_tissue AS "bimodality_tissue",
             pubtator_score AS "pubtator_score",
             candidate_source AS "candidate_source"
      FROM ranking_scores WHERE snapshot_id = :id ORDER BY rank_position
    ]');
  COMMIT;
END;

-- Check:  curl "https://<host>/apex/d2towner/d2t/snapshots/103/scores?limit=1&offset=6000"
--         → the row should carry "candidate_source":"AGORA"
