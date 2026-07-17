# ORDS read-only bridge — setup guide

**Goal:** expose the internal Oracle content store **read-only over HTTPS (ORDS)** so the
Vercel-hosted app can read snapshots/scores/evidence. Vercel cannot open a SQL\*Net
connection to `sparc.informatics.uab.edu`; ORDS speaks plain HTTPS, which it can.

**How the app uses it:** the Express server already switches its READ layer to ORDS when
`USE_ORDS=1` + `ORDS_BASE_URL` are set (see `ordsService.ts`). Writes (harvest/save/delete)
stay on the internal node-oracledb path and are not exposed. The frontend is unchanged.

The app calls ORDS **server-to-server** (Vercel serverless function → ORDS), so **no CORS**
config is needed.

---

## Phase 0 — confirm reachability (make-or-break)

ORDS only helps if Vercel can reach it. From a machine **outside the UAB network** (e.g. your
phone on cellular, or ask IT), open the ORDS landing page, e.g.:

```
https://<apex-host>/ords/
```

- If it loads externally → good, continue.
- If it only works on UAB VPN → Vercel still can't reach it. Options then: ask UAB-IT to expose
  ORDS externally (allowlist), or run a tiny read-only proxy inside UAB. **Stop and resolve this first.**

Note your ORDS host — you'll need the base URL in Phase 5.

---

## Phase 1 — pick the REST schema & confirm table access

You have two schemas: **`DISEASETOTARGET_OWNER`** (owns the tables) and **`DISEASETOTARGET_APP`**
(app access). Host the REST endpoints in the schema that has **SELECT** on the tables. Least-
privilege choice = `DISEASETOTARGET_APP` (it only reads). Run the confirm below **as that schema**:

```sql
-- 1) find the exact owning schema + confirm the three tables exist
--    (NOTE: the app code uses schema name "DISEASE2TARGET_OWNER" — verify the REAL name here;
--     "2" vs "TO" matters. Use whatever this query returns as <OWNER> below.)
SELECT owner, table_name FROM all_tables
WHERE table_name IN ('TARGET_RANKING_SNAPSHOTS','RANKING_SCORES','EVIDENCE')
ORDER BY table_name;

-- 2) confirm THIS schema can read them (replace <OWNER> with the owner from step 1)
SELECT COUNT(*) FROM <OWNER>.target_ranking_snapshots;
SELECT COUNT(*) FROM <OWNER>.evidence;
```

If step 2 fails with "table or view does not exist", grant SELECT (run **as `DISEASETOTARGET_OWNER`**):

```sql
GRANT SELECT ON target_ranking_snapshots TO DISEASETOTARGET_APP;
GRANT SELECT ON ranking_scores           TO DISEASETOTARGET_APP;
GRANT SELECT ON evidence                 TO DISEASETOTARGET_APP;
```

> Throughout the rest of this doc: **`<OWNER>`** = the schema that owns the tables (from step 1),
> and you run every `ORDS.*`/`OAUTH.*` block **as the REST schema** you chose (e.g. `DISEASETOTARGET_APP`).

---

## Phase 2 — REST-enable the schema + create the 6 read-only endpoints

Run this whole block **as the REST schema** (APEX → SQL Workshop → SQL Commands, or SQLcl).
It publishes GET-only handlers — **read-only by construction** (no PUT/POST/DELETE anywhere).

```sql
-- REST-enable this schema; the URL alias becomes part of the base URL.
BEGIN
  ORDS.ENABLE_SCHEMA(
    p_enabled             => TRUE,
    p_schema              => USER,
    p_url_mapping_type    => 'BASE_PATH',
    p_url_mapping_pattern => 'd2tapp',   -- URL alias → https://<host>/ords/d2tapp/...
    p_auto_rest_auth      => FALSE);
  COMMIT;
END;
/

-- One module, base path /d2t/, six templates.
BEGIN
  ORDS.DEFINE_MODULE(
    p_module_name    => 'd2t.read',
    p_base_path      => '/d2t/',
    p_items_per_page => 500,
    p_status         => 'PUBLISHED',
    p_comments       => 'Disease2Target read-only bridge');

  -- 1) GET /d2t/snapshots            (optional ?disease_id=)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'snapshots');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'snapshots', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT id AS "id", disease_id AS "disease_id", disease_name AS "disease_name",
             version AS "version",
             TO_CHAR(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "created_at",
             created_by AS "created_by", label AS "label", gene_count AS "gene_count"
      FROM <OWNER>.target_ranking_snapshots
      WHERE (:disease_id IS NULL OR disease_id = :disease_id)
      ORDER BY created_at DESC
    ]');

  -- 2) GET /d2t/snapshots/:id        (full snapshot incl. CLOB weights/provenance/targets)
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
      FROM <OWNER>.target_ranking_snapshots WHERE id = :id
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
      FROM <OWNER>.ranking_scores WHERE snapshot_id = :id ORDER BY rank_position
    ]');

  -- 4) GET /d2t/snapshots/:id/evidence   (large → paginated)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'snapshots/:id/evidence');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'snapshots/:id/evidence', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT gene_symbol AS "gene_symbol", evidence_type AS "evidence_type", source AS "source",
             value_text AS "value_text", value_json AS "value_json"
      FROM <OWNER>.evidence WHERE snapshot_id = :id
    ]');

  -- 5) GET /d2t/evidence/genes        (distinct gene symbols with evidence; optional ?disease_id=)
  ORDS.DEFINE_TEMPLATE(p_module_name=>'d2t.read', p_pattern=>'evidence/genes');
  ORDS.DEFINE_HANDLER(
    p_module_name=>'d2t.read', p_pattern=>'evidence/genes', p_method=>'GET',
    p_source_type=>ORDS.source_type_collection_feed,
    p_source=>q'[
      SELECT DISTINCT gene_symbol AS "g" FROM <OWNER>.evidence
      WHERE (:disease_id IS NULL OR LOWER(disease_id) LIKE LOWER('%'||:disease_id||'%'))
    ]');

  -- 6) GET /d2t/evidence/gene/:gene   (all evidence rows for one gene)
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
      FROM <OWNER>.evidence WHERE gene_symbol = :gene ORDER BY retrieved_at DESC
    ]');

  COMMIT;
END;
/
```

> **Replace `<OWNER>`** in all six queries with the owning schema from Phase 1. If the REST schema
> IS the owner, you can drop the `<OWNER>.` prefix. The quoted lowercase aliases (`AS "id"`) make
> the JSON keys match exactly what `ordsService.ts` expects — don't change them.

---

## Phase 3 — secure the endpoints

Pick ONE.

### Option A — OAuth2 client credentials (recommended)

The Vercel server holds a client id/secret, exchanges it for a token, and sends it as a Bearer.
Run **as the REST schema**:

```sql
BEGIN
  ORDS.CREATE_ROLE(p_role_name => 'd2t_reader');
  ORDS.DEFINE_PRIVILEGE(
    p_privilege_name => 'd2t.read.priv',
    p_roles          => ORDS_TYPES.T_ROLES('d2t_reader'),
    p_patterns       => ORDS_TYPES.T_PATTERNS('/d2t/*'),
    p_label          => 'Disease2Target read',
    p_description     => 'Read-only snapshots/scores/evidence');

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
/

-- copy these two values into Vercel env (ORDS_CLIENT_ID / ORDS_CLIENT_SECRET):
SELECT name, client_id, client_secret FROM user_ords_clients WHERE name = 'd2t-vercel';
```

### Option B — public read-only (fastest, no auth)

Do nothing extra — the `PUBLISHED` module is world-readable at its URLs. Acceptable only if the
data (rankings/evidence from public sources) is OK to expose. Anyone with the URL can read it.
`ordsService.ts` works with no `ORDS_CLIENT_ID` set.

---

## Phase 4 — test with curl

Public (Option B):
```bash
curl "https://<apex-host>/ords/d2tapp/d2t/snapshots"
```

OAuth2 (Option A):
```bash
# get a token
curl -s --user "<client_id>:<client_secret>" \
  -d "grant_type=client_credentials" \
  "https://<apex-host>/ords/d2tapp/oauth/token"
# then call with it
curl -H "Authorization: Bearer <access_token>" \
  "https://<apex-host>/ords/d2tapp/d2t/snapshots"
```

You should get `{"items":[ ... ],"hasMore":false, ...}`. Spot-check a snapshot id:
```bash
curl ".../d2t/snapshots/<id>/scores"     # ranking scores
curl ".../d2t/snapshots/<id>/evidence"   # evidence (paginated)
```

---

## Phase 5 — point the app at ORDS (Vercel env)

Set these in Vercel (Project → Settings → Environment Variables):

```
USE_ORDS=1
ORDS_BASE_URL=https://<apex-host>/ords/d2tapp        # schema root — NO trailing slash, NO /d2t
# Option A only:
ORDS_CLIENT_ID=<client_id>
ORDS_CLIENT_SECRET=<client_secret>
```

- `ORDS_BASE_URL` is the **schema root** (`.../ords/d2tapp`). `ordsService.ts` appends the module
  base `d2t` itself (data at `.../d2tapp/d2t/...`) and finds the token endpoint at
  `.../d2tapp/oauth/token`.
- Keep `USE_ORACLE_STORE` **off** on Vercel (it can't reach Oracle). Reads go to ORDS; writes/harvest
  are only available on the internal deployment.
- Supabase auth is unchanged (auth-only), so login still works on Vercel.

Redeploy. The funnel / rankings / matrix should now load data on Vercel via ORDS.

---

## Notes / gotchas

- **Read-only by construction:** only GET handlers are defined; there is no write path over ORDS.
- **Pagination:** `evidence` is large; `ordsService.ts` pages through `hasMore`/`offset` automatically
  (`p_items_per_page => 500`).
- **CLOB JSON:** `weights`/`provenance`/`targets`/`value_json` come back as strings; the app parses them.
- **Naming:** double-check the owning schema name (`DISEASE2TARGET_OWNER` in code vs. what Phase-1
  step-1 returns) — a mismatch is the most likely cause of "table or view does not exist".
- **To change/remove:** re-run `ORDS.DEFINE_HANDLER` to update a query; `ORDS.DELETE_MODULE('d2t.read')`
  to remove everything.
```
