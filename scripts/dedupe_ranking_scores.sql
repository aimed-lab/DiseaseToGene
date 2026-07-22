-- dedupe_ranking_scores.sql ──────────────────────────────────────────────────
-- Bug #2 repair: RANKING_SCORES has duplicate gene_symbol rows within one snapshot
-- (one approvedSymbol → several Ensembl targets in Open Targets; the old harvest stored
-- each). Snapshot #84: 7,332 rows for 6,189 unique genes → 1,143 duplicates.
--
-- This keeps the BEST-RANKED row per gene (lowest rank_position = highest priority) and
-- deletes the rest. Run on the UAB VPN in SQL Developer / sqlplus against DISEASE2TARGET.
-- Replace 84 with the snapshot id if different. RUN THE SELECT FIRST to preview the count.
--
-- NOTE: a fresh re-harvest with the fixed CLI (scripts/d2t.ts) also produces a clean,
-- deduped snapshot — prefer that if you don't need to preserve snapshot #84's id.

-- 1) Preview: how many duplicate rows will be removed?
SELECT COUNT(*) AS rows_total,
       COUNT(DISTINCT gene_symbol) AS unique_genes,
       COUNT(*) - COUNT(DISTINCT gene_symbol) AS duplicates_to_remove
FROM   ranking_scores
WHERE  snapshot_id = 84;

-- 2) Delete duplicates, keeping the best-ranked row per gene.
DELETE FROM ranking_scores
WHERE  snapshot_id = 84
AND    ROWID NOT IN (
         SELECT keep_rowid FROM (
           SELECT ROWID AS keep_rowid,
                  ROW_NUMBER() OVER (
                    PARTITION BY gene_symbol
                    ORDER BY NVL(rank_position, 999999) ASC, NVL(get_score, -1) DESC
                  ) AS rn
           FROM   ranking_scores
           WHERE  snapshot_id = 84
         )
         WHERE rn = 1
       );

-- 3) Verify: rows should now equal unique genes (expect 6,189 for #84).
SELECT COUNT(*) AS rows_after, COUNT(DISTINCT gene_symbol) AS unique_genes
FROM   ranking_scores
WHERE  snapshot_id = 84;

COMMIT;
-- (ROLLBACK; instead of COMMIT if the counts look wrong.)
