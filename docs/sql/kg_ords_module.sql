-- ============================================================================
-- Disease2Target — ORDS handlers for the KNOWLEDGE GRAPH (kg_nodes / kg_edges)
--
-- Adds three GET-only endpoints to the EXISTING 'd2t.read' module (docs/ORDS_Setup.md),
-- so the graph is readable over the public HTTPS bridge with NO VPN — exactly like
-- snapshots/scores/evidence already are:
--
--   GET /d2t/kg/:id/nodes    all KG nodes for a snapshot   (paginated)
--   GET /d2t/kg/:id/edges    all KG edges for a snapshot   (paginated)
--   GET /d2t/kg/:id/stats    per-type node + edge counts   (small)
--
-- Real schema names are filled in (owner = DISEASE2TARGET_OWNER; grantees match the
-- EVIDENCE table's, which the existing ORDS handlers already read). The quoted lowercase
-- aliases make the JSON keys match ordsService.ts / oracleService.ts EXACTLY — keep them.
--
-- ⚠ TWO SESSIONS — they run as DIFFERENT users:
--   PART A: run as  DISEASE2TARGET_OWNER   (it owns the tables → only it can GRANT)
--   PART B: run as  your ORDS/REST schema  (the SAME schema you ran the first ORDS
--                                            setup as — the one that hosts 'd2t.read')
-- Running the whole file as one user will fail (that's the ORA-00987 / privilege errors).
-- ============================================================================


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ PART A — run as DISEASE2TARGET_OWNER                                       │
-- │ Give the KG tables the same SELECT grantees EVIDENCE already has, so the   │
-- │ ORDS schema can read them just like it reads evidence. (RW already has it; │
-- │ the RO grants are the new part. Re-granting RW is a harmless no-op.)       │
-- └─────────────────────────────────────────────────────────────────────────┘
GRANT SELECT ON kg_nodes TO DISEASE2TARGET_RW;
GRANT SELECT ON kg_edges TO DISEASE2TARGET_RW;
GRANT SELECT ON kg_nodes TO DISEASE2TARGET_RO;
GRANT SELECT ON kg_edges TO DISEASE2TARGET_RO;


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ PART B — run as your ORDS/REST schema (hosts the 'd2t.read' module)        │
-- │ Re-running DEFINE_TEMPLATE/DEFINE_HANDLER updates in place — this REPLACES  │
-- │ the broken <OWNER> handlers from the earlier attempt. Existing 6 endpoints  │
-- │ are untouched.                                                             │
-- └─────────────────────────────────────────────────────────────────────────┘
BEGIN
  -- 7) GET /d2t/kg/:id/nodes   (large → paginated collection feed)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'kg/:id/nodes');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'kg/:id/nodes', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT node_key AS "key", node_type AS "type", label AS "label",
             degree AS "degree", props_json AS "props"
      FROM DISEASE2TARGET_OWNER.kg_nodes WHERE snapshot_id = :id
    ]');

  -- 8) GET /d2t/kg/:id/edges   (large → paginated collection feed)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'kg/:id/edges');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'kg/:id/edges', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT src_key AS "source", dst_key AS "target", rel_type AS "rel",
             weight AS "weight", confidence AS "confidence", source AS "src", props_json AS "props"
      FROM DISEASE2TARGET_OWNER.kg_edges WHERE snapshot_id = :id
    ]');

  -- 9) GET /d2t/kg/:id/stats   (per-type node + edge counts, one small feed)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'kg/:id/stats');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'kg/:id/stats', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT 'node' AS "kind", node_type AS "t", COUNT(*) AS "c"
      FROM DISEASE2TARGET_OWNER.kg_nodes WHERE snapshot_id = :id GROUP BY node_type
      UNION ALL
      SELECT 'edge' AS "kind", rel_type AS "t", COUNT(*) AS "c"
      FROM DISEASE2TARGET_OWNER.kg_edges WHERE snapshot_id = :id GROUP BY rel_type
    ]');

  COMMIT;
END;
/

-- ── Verify (public / Option B) — this deployment's REAL base is /apex/d2towner ─
--   curl "https://aimed.uab.edu/apex/d2towner/d2t/kg/102/stats"
--   curl "https://aimed.uab.edu/apex/d2towner/d2t/kg/102/nodes?limit=3"
-- Expect {"items":[...],"hasMore":...}. To update later: re-run its DEFINE_HANDLER.
-- (App env: ORDS_BASE_URL=https://aimed.uab.edu/apex/d2towner  ·  USE_ORDS=1)
