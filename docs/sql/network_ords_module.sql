-- ============================================================================
-- Disease2Target — ORDS handlers for the NETWORK tables (network_run / network_score /
-- network_graph / gene_identifier_mapping). Adds four GET-only endpoints to the
-- EXISTING 'd2t.read' module, readable over HTTPS with no VPN:
--
--   GET /d2t/network/runs                    all runs with their graph context (optional ?snapshot_id=)
--   GET /d2t/network/runs/:id/scores         every score row of one run          (paginated)
--   GET /d2t/network/gene/:gene              one gene across ALL runs, each labelled with its context
--   GET /d2t/network/mapping/:gene           how the symbol resolved to STRING
--
-- Run in APEX SQL Workshop with the Schema selector set to DISEASE2TARGET_OWNER
-- (the same schema that hosts 'd2t.read' — see scripts/ords_d2t_owner.sql).
-- Select from "BEGIN" down to "END;" and Run. No trailing slash.
-- ============================================================================

BEGIN
  -- 1) GET /d2t/network/runs  (optional ?snapshot_id=)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'network/runs');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'network/runs', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT r.id AS "id", r.graph_id AS "graph_id", r.algorithm AS "algorithm",
             r.implementation AS "implementation", r.implementation_version AS "implementation_version",
             r.sigma AS "sigma", r.iterations AS "iterations", r.normalisation AS "normalisation",
             r.disease_id AS "disease_id", r.snapshot_id AS "snapshot_id", r.candidate_rule AS "candidate_rule",
             r.context_label AS "context_label", r.is_primary AS "is_primary",
             TO_CHAR(r.created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "created_at",
             g.graph_key AS "graph_key", g.graph_type AS "graph_type", g.source AS "source",
             g.source_version AS "source_version", g.min_score AS "min_score",
             g.node_count AS "node_count", g.edge_count AS "edge_count", g.isolated_count AS "isolated_count"
      FROM network_run r JOIN network_graph g ON g.id = r.graph_id
      WHERE (:snapshot_id IS NULL OR r.snapshot_id = :snapshot_id)
      ORDER BY r.created_at DESC
    ]');

  -- 2) GET /d2t/network/runs/:id/scores  (paginated with limit/offset)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'network/runs/:id/scores');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'network/runs/:id/scores', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT gene_symbol AS "gene_symbol", string_name AS "string_name", raw_score AS "raw_score",
             norm_score AS "norm_score", percentile AS "percentile", rank_position AS "rank_position",
             degree AS "degree", weighted_degree AS "weighted_degree", p_value AS "p_value", fdr AS "fdr",
             status AS "status"
      FROM network_score WHERE run_id = :id ORDER BY rank_position NULLS LAST, gene_symbol
    ]');

  -- 3) GET /d2t/network/gene/:gene  — every run's view of one gene, with context
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'network/gene/:gene');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'network/gene/:gene', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT s.run_id AS "run_id", r.algorithm AS "algorithm", r.context_label AS "context_label",
             r.snapshot_id AS "snapshot_id", r.disease_id AS "disease_id", r.is_primary AS "is_primary",
             g.graph_type AS "graph_type", g.graph_key AS "graph_key", g.node_count AS "node_count",
             s.gene_symbol AS "gene_symbol", s.string_name AS "string_name", s.raw_score AS "raw_score",
             s.norm_score AS "norm_score", s.percentile AS "percentile", s.rank_position AS "rank_position",
             s.degree AS "degree", s.weighted_degree AS "weighted_degree", s.p_value AS "p_value",
             s.fdr AS "fdr", s.status AS "status"
      FROM network_score s
      JOIN network_run r ON r.id = s.run_id
      JOIN network_graph g ON g.id = r.graph_id
      WHERE s.gene_symbol = :gene
      ORDER BY r.is_primary DESC, r.created_at DESC
    ]');

  -- 4) GET /d2t/network/mapping/:gene
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'network/mapping/:gene');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'network/mapping/:gene', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT gene_symbol AS "gene_symbol", source AS "source", target_source AS "target_source",
             target_version AS "target_version", resolved_identifier AS "resolved_identifier",
             mapping_status AS "mapping_status", mapping_method AS "mapping_method", note AS "note",
             TO_CHAR(updated_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "updated_at"
      FROM gene_identifier_mapping WHERE gene_symbol = :gene
    ]');

  COMMIT;
END;

-- Quick checks after running:
--   curl "https://<host>/ords/d2towner/d2t/network/runs?snapshot_id=103"
--   curl "https://<host>/ords/d2towner/d2t/network/gene/APOE"
