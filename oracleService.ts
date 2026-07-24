// ── Oracle content store (server-side only) ──────────────────────────────────
// The store of record for Disease2Target: ranking snapshots, per-gene scores,
// evidence (provenance), and an append-only audit trail.
// Connects as the runtime app user (DISEASE2TARGET_APP); tables live in
// ORACLE_SCHEMA (DISEASE2TARGET_OWNER). Thin mode — no Oracle client install.

import oracledb from 'oracledb';

oracledb.fetchAsString = [oracledb.CLOB];      // read JSON CLOBs as strings
oracledb.autoCommit = false;

const SCHEMA = () => process.env.ORACLE_SCHEMA || process.env.ORACLE_USER || '';
const T = (name: string) => `${SCHEMA()}.${name}`;

let pool: oracledb.Pool | null = null;

export function oracleEnabled(): boolean {
  return (
    process.env.USE_ORACLE_STORE === '1' &&
    !!process.env.ORACLE_USER &&
    !!process.env.ORACLE_PASSWORD &&
    !!process.env.ORACLE_CONNECT_STRING
  );
}

async function getPool(): Promise<oracledb.Pool> {
  if (pool) return pool;
  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: 0, poolMax: 4, poolIncrement: 1, poolTimeout: 60, poolPingInterval: 60,
  });
  return pool;
}

export async function closeOraclePool(): Promise<void> {
  if (pool) { try { await pool.close(5); } catch { /* ignore */ } pool = null; }
}

// Lightweight connectivity check (used by /api/oracle/health).
export async function ping(): Promise<boolean> {
  const conn = await (await getPool()).getConnection();
  try {
    const r = await conn.execute<any[]>('select 1 from dual');
    return (r.rows as any[])?.[0]?.[0] === 1;
  } finally {
    await conn.close();
  }
}

const num = (v: unknown): number | null =>
  (typeof v === 'number' && isFinite(v)) ? v : null;
// Always emit a JSON object/array (never a bare scalar like `null`) — the content
// columns carry an `IS JSON` check constraint that rejects top-level scalars.
const clob = (obj: unknown) => ({ val: JSON.stringify(obj ?? {}), type: oracledb.CLOB });
// A plain-text CLOB bind (the dossier summary is already a string, not JSON to stringify).
const clobText = (s: unknown) => ({ val: s == null ? '' : String(s), type: oracledb.CLOB });
const safeParse = (s: unknown) => { try { return s ? JSON.parse(String(s)) : null; } catch { return null; } };

export interface SnapshotInput {
  disease_id: string;
  disease_name: string;
  label?: string | null;
  weights?: unknown;
  gene_count?: number;
  provenance?: unknown;
  targets: any[];
  created_by?: string | null;
}

// ── Save: snapshot header + per-gene scores + audit, in one transaction ──────
export async function saveSnapshot(s: SnapshotInput): Promise<{ id: number; version: number }> {
  const conn = await (await getPool()).getConnection();
  try {
    const vres = await conn.execute<any[]>(
      `SELECT NVL(MAX(version),0)+1 FROM ${T('target_ranking_snapshots')} WHERE disease_id = :d`,
      { d: s.disease_id }
    );
    const version: number = vres.rows![0][0];

    const ins = await conn.execute(
      `INSERT INTO ${T('target_ranking_snapshots')}
         (disease_id, disease_name, version, created_at, created_by, label, gene_count, weights, provenance, targets)
       VALUES (:disease_id, :disease_name, :version, SYSTIMESTAMP, :created_by, :label, :gene_count, :weights, :provenance, :targets)
       RETURNING id INTO :id`,
      {
        disease_id: s.disease_id,
        disease_name: s.disease_name,
        version,
        created_by: s.created_by ?? null,
        label: s.label ?? null,
        gene_count: s.gene_count ?? s.targets.length,
        weights: clob(s.weights),
        provenance: clob(s.provenance),
        targets: clob(s.targets),
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const snapshotId: number = (ins.outBinds as any).id[0];

    // Per-gene score rows — ONE bulk insert (executeMany) instead of thousands of
    // separate round-trips. A 7k-gene snapshot then saves in ~1s as a single atomic
    // statement, so a large harvest can no longer be lost to a mid-loop VPN blip.
    if (s.targets.length) {
      const rankBinds = s.targets.map((t: any, i: number) => ({
        snapshot_id: snapshotId, disease_id: s.disease_id, disease_name: String(s.disease_name ?? '').slice(0, 500),
        gene_symbol: String(t.symbol ?? '').slice(0, 64), gene_name: t.name != null ? String(t.name).slice(0, 400) : null,
        rank_position: i + 1,
        overall_score: num(t.overallScore), get_score: num(t.getScore), genetic_score: num(t.geneticScore),
        expression_score: num(t.expressionScore ?? t.combinedExpression), target_score: num(t.targetScore),
        literature_score: num(t.literatureScore), tau_tissue: num(t.tauTissue), tau_single_cell: num(t.tauSingleCell),
        bimodality_max: num(t.bimodalityMax), bimodality_tissue: t.bimodalityTissue != null ? String(t.bimodalityTissue).slice(0, 200) : null,
        pubtator_score: num(t.pubTatorScore),
      }));
      await conn.executeMany(
        `INSERT INTO ${T('ranking_scores')}
           (snapshot_id, disease_id, disease_name, gene_symbol, gene_name, rank_position,
            overall_score, get_score, genetic_score, expression_score, target_score, literature_score,
            tau_tissue, tau_single_cell, bimodality_max, bimodality_tissue, pubtator_score, created_at)
         VALUES (:snapshot_id,:disease_id,:disease_name,:gene_symbol,:gene_name,:rank_position,
            :overall_score,:get_score,:genetic_score,:expression_score,:target_score,:literature_score,
            :tau_tissue,:tau_single_cell,:bimodality_max,:bimodality_tissue,:pubtator_score, SYSTIMESTAMP)`,
        rankBinds,
        {
          autoCommit: false,
          bindDefs: {
            snapshot_id: { type: oracledb.NUMBER }, disease_id: { type: oracledb.STRING, maxSize: 200 },
            disease_name: { type: oracledb.STRING, maxSize: 500 }, gene_symbol: { type: oracledb.STRING, maxSize: 64 },
            gene_name: { type: oracledb.STRING, maxSize: 400 }, rank_position: { type: oracledb.NUMBER },
            overall_score: { type: oracledb.NUMBER }, get_score: { type: oracledb.NUMBER }, genetic_score: { type: oracledb.NUMBER },
            expression_score: { type: oracledb.NUMBER }, target_score: { type: oracledb.NUMBER }, literature_score: { type: oracledb.NUMBER },
            tau_tissue: { type: oracledb.NUMBER }, tau_single_cell: { type: oracledb.NUMBER }, bimodality_max: { type: oracledb.NUMBER },
            bimodality_tissue: { type: oracledb.STRING, maxSize: 200 }, pubtator_score: { type: oracledb.NUMBER },
          },
        }
      );
    }

    await logAudit(conn, {
      actor: s.created_by ?? 'unknown', action: 'snapshot_saved',
      entity: 'target_ranking_snapshots', entity_id: String(snapshotId),
      disease_id: s.disease_id, details: { version, gene_count: s.gene_count ?? s.targets.length },
    });

    await conn.commit();
    return { id: snapshotId, version };
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    await conn.close();
  }
}

export async function listSnapshots(diseaseId?: string): Promise<any[]> {
  const conn = await (await getPool()).getConnection();
  try {
    const r = await conn.execute(
      `SELECT id AS "id", disease_id AS "disease_id", disease_name AS "disease_name",
              version AS "version",
              TO_CHAR(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "created_at",
              created_by AS "created_by", label AS "label", gene_count AS "gene_count"
       FROM ${T('target_ranking_snapshots')}
       ${diseaseId ? 'WHERE disease_id = :d' : ''}
       ORDER BY created_at DESC`,
      diseaseId ? { d: diseaseId } : {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return r.rows as any[];
  } finally {
    await conn.close();
  }
}

export async function getSnapshot(id: number): Promise<any | null> {
  const conn = await (await getPool()).getConnection();
  try {
    const r = await conn.execute(
      `SELECT id AS "id", disease_id AS "disease_id", disease_name AS "disease_name",
              version AS "version",
              TO_CHAR(created_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "created_at",
              created_by AS "created_by", label AS "label", gene_count AS "gene_count",
              weights AS "weights", provenance AS "provenance", targets AS "targets"
       FROM ${T('target_ranking_snapshots')} WHERE id = :id`,
      { id }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const row: any = (r.rows as any[])?.[0];
    if (!row) return null;
    return { ...row, weights: safeParse(row.weights), provenance: safeParse(row.provenance), targets: safeParse(row.targets) ?? [] };
  } finally {
    await conn.close();
  }
}

export async function deleteSnapshot(id: number, actor?: string): Promise<void> {
  const conn = await (await getPool()).getConnection();
  try {
    await conn.execute(`DELETE FROM ${T('target_ranking_snapshots')} WHERE id = :id`, { id });
    await logAudit(conn, { actor: actor ?? 'unknown', action: 'snapshot_deleted', entity: 'target_ranking_snapshots', entity_id: String(id), disease_id: null, details: {} });
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    await conn.close();
  }
}

// ── Evidence (paper cards + per-gene source evidence) ─────────────────────────
export interface EvidenceInput {
  snapshot_id?: number | null;
  disease_id: string;
  gene_symbol: string;
  evidence_type: string;          // clinical | literature | druggability | mutation | paper
  source: string;
  source_url?: string | null;
  value_text?: string | null;
  value_json?: unknown;
  retrieved_at?: string | null;   // ISO; defaults to now
  generated_by?: string | null;
  audit_status?: string | null;
}

async function insertEvidence(conn: oracledb.Connection, e: EvidenceInput): Promise<void> {
  await conn.execute(
    `INSERT INTO ${T('evidence')}
       (snapshot_id, disease_id, gene_symbol, evidence_type, source, source_url, value_text, value_json, retrieved_at, generated_by, audit_status)
     VALUES (:snapshot_id,:disease_id,:gene_symbol,:evidence_type,:source,:source_url,:value_text,:value_json,:retrieved_at,:generated_by,:audit_status)`,
    {
      snapshot_id: e.snapshot_id ?? null,
      disease_id: String(e.disease_id ?? 'unknown').slice(0, 100),
      gene_symbol: String(e.gene_symbol ?? '').slice(0, 64),
      evidence_type: String(e.evidence_type).slice(0, 60),
      source: String(e.source ?? 'unknown').slice(0, 100),
      source_url: e.source_url ? String(e.source_url).slice(0, 1000) : null,
      value_text: e.value_text ? String(e.value_text).slice(0, 4000) : null,
      value_json: clob(e.value_json),
      retrieved_at: e.retrieved_at ? new Date(e.retrieved_at) : new Date(),
      generated_by: e.generated_by ? String(e.generated_by).slice(0, 200) : null,
      audit_status: String(e.audit_status ?? 'not_audited').slice(0, 40),
    }
  );
}

export async function saveEvidenceCards(cards: EvidenceInput[], actor?: string): Promise<{ count: number }> {
  if (!cards.length) return { count: 0 };
  const conn = await (await getPool()).getConnection();
  try {
    for (const c of cards) await insertEvidence(conn, c);
    await logAudit(conn, { actor: actor ?? 'unknown', action: 'evidence_saved', entity: 'evidence', entity_id: '', disease_id: cards[0].disease_id ?? null, details: { count: cards.length, type: cards[0].evidence_type } });
    await conn.commit();
    return { count: cards.length };
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    await conn.close();
  }
}

// Idempotent per-axis evidence write for a snapshot. Clears any existing rows of
// the same evidence_type(s) for this snapshot, then inserts the new ones — so a
// harvest provider can be re-run (or a snapshot enriched over rounds) without
// duplicating. Each value_json should carry the contract { axis, direction,
// display, ...raw }.
export async function saveAxisEvidence(
  snapshotId: number,
  diseaseId: string,
  rows: EvidenceInput[],
  actor?: string,
  genesOnly?: boolean,            // true = only replace rows for THESE genes (incremental add); false = replace the whole type for the snapshot
): Promise<{ count: number; types: string[] }> {
  if (!rows.length) return { count: 0, types: [] };
  const conn = await (await getPool()).getConnection();
  try {
    const types = [...new Set(rows.map((r) => String(r.evidence_type)))];
    if (genesOnly) {
      const genes = [...new Set(rows.map((r) => String(r.gene_symbol)))];
      for (const t of types) {
        for (let i = 0; i < genes.length; i += 500) {
          const chunk = genes.slice(i, i + 500);
          const binds: any = { s: snapshotId, t };
          const ph = chunk.map((g, j) => { binds['g' + j] = g; return ':g' + j; }).join(',');
          await conn.execute(`DELETE FROM ${T('evidence')} WHERE snapshot_id = :s AND evidence_type = :t AND gene_symbol IN (${ph})`, binds);
        }
      }
    } else {
      for (const t of types) {
        await conn.execute(`DELETE FROM ${T('evidence')} WHERE snapshot_id = :s AND evidence_type = :t`, { s: snapshotId, t });
      }
    }
    for (const r of rows) await insertEvidence(conn, { ...r, snapshot_id: snapshotId, disease_id: diseaseId, generated_by: r.generated_by ?? 'job', audit_status: r.audit_status ?? 'not_audited' });
    await logAudit(conn, { actor: actor ?? 'job', action: 'evidence_saved', entity: 'evidence', entity_id: String(snapshotId), disease_id: diseaseId, details: { count: rows.length, types } });
    await conn.commit();
    return { count: rows.length, types };
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    await conn.close();
  }
}

// ── GENE_DOSSIER — the materialised dashboard card (see docs/sql/gene_dossier.sql) ──
// Derived from EVIDENCE, so this is idempotent: rebuilding a snapshot deletes its rows
// first, never duplicating. Wide, scalar columns only — the rich JSON stays in EVIDENCE.
export interface DossierRow {
  gene_symbol: string; disease_id: string; disease_name: string | null; snapshot_id: number;
  rank_position: number | null; score: number | null; summary: string | null;
  approved_name: string | null; uniprot_id: string | null; target_class: string | null;
  surface_or_secreted: number | null; is_common_essential: number | null;
  n_drugs: number | null; n_proven_modalities: number | null; n_tractable_modalities: number | null;
  top_modality: string | null; max_drug_phase: number | null;
  n_disease_trials: number | null; trials_phase1: number | null; trials_phase2: number | null;
  trials_phase3: number | null; trials_phase4: number | null; max_disease_phase: number | null; n_stopped_trials: number | null;
  mutation_frequency: number | null; log2fc: number | null; chronos: number | null; loeuf: number | null;
  tissue_tau: number | null; n_safety_liabilities: number | null;
  n_publications: number | null; literature_velocity: number | null; n_patents: number | null;
  completeness: number | null; missing_axes: string | null; schema_version: string | null;
}

const DOSSIER_COLS = [
  'gene_symbol', 'disease_id', 'disease_name', 'snapshot_id', 'rank_position', 'score', 'summary',
  'approved_name', 'uniprot_id', 'target_class', 'surface_or_secreted', 'is_common_essential',
  'n_drugs', 'n_proven_modalities', 'n_tractable_modalities', 'top_modality', 'max_drug_phase',
  'n_disease_trials', 'trials_phase1', 'trials_phase2', 'trials_phase3', 'trials_phase4', 'max_disease_phase', 'n_stopped_trials',
  'mutation_frequency', 'log2fc', 'chronos', 'loeuf', 'tissue_tau', 'n_safety_liabilities',
  'n_publications', 'literature_velocity', 'n_patents', 'completeness', 'missing_axes', 'schema_version',
] as const;

// `clearFirst` deletes the snapshot's existing rows before inserting — pass true ONLY on the
// first chunk of a multi-chunk write, false on the rest, so chunks append instead of each one
// wiping the previous.
export async function saveDossiers(snapshotId: number, diseaseId: string, rows: DossierRow[], actor?: string, clearFirst = true): Promise<{ count: number }> {
  if (!rows.length) return { count: 0 };
  const conn = await (await getPool()).getConnection();
  try {
    if (clearFirst) await conn.execute(`DELETE FROM ${T('gene_dossier')} WHERE snapshot_id = :s`, { s: snapshotId });
    const cols = DOSSIER_COLS.join(', ');
    const binds = DOSSIER_COLS.map((c) => (c === 'summary' ? ':summary' : ':' + c)).join(', ');
    for (const r of rows) {
      const b: any = {};
      for (const c of DOSSIER_COLS) b[c] = c === 'summary' ? clobText((r as any)[c]) : ((r as any)[c] ?? null);
      await conn.execute(`INSERT INTO ${T('gene_dossier')} (${cols}, generated_at) VALUES (${binds}, SYSTIMESTAMP)`, b);
    }
    await logAudit(conn, { actor: actor ?? 'cli', action: 'dossiers_saved', entity: 'gene_dossier', entity_id: String(snapshotId), disease_id: diseaseId, details: { count: rows.length } });
    await conn.commit();
    return { count: rows.length };
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw e;
  } finally { await conn.close(); }
}

export async function listDossiers(snapshotId: number): Promise<any[]> {
  const conn = await (await getPool()).getConnection();
  try {
    const sel = DOSSIER_COLS.map((c) => `${c} AS "${c}"`).join(', ');
    const r = await conn.execute(`SELECT ${sel} FROM ${T('gene_dossier')} WHERE snapshot_id = :s ORDER BY rank_position`, { s: snapshotId }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return r.rows as any[];
  } finally { await conn.close(); }
}

// Append on-demand genes to an existing snapshot's RANKING_SCORES (idempotent per
// gene — re-adding replaces the gene's row). Used by the "add genes" job so a
// manually-supplied gene (e.g. SRC) joins the same universe as the Open Targets
// genes and competes in the same funnel.
export async function addGenesToSnapshot(
  snapshotId: number,
  disease_id: string,
  disease_name: string,
  targets: any[],
): Promise<{ count: number }> {
  if (!targets.length) return { count: 0 };
  const conn = await (await getPool()).getConnection();
  try {
    const mr = await conn.execute<any[]>(`SELECT NVL(MAX(rank_position),0) FROM ${T('ranking_scores')} WHERE snapshot_id = :s`, { s: snapshotId });
    let rank = Number(mr.rows![0][0]) || 0;
    for (const t of targets) {
      const g = String(t.symbol ?? '').slice(0, 64);
      if (!g) continue;
      rank++;
      await conn.execute(`DELETE FROM ${T('ranking_scores')} WHERE snapshot_id = :s AND gene_symbol = :g`, { s: snapshotId, g });
      await conn.execute(
        `INSERT INTO ${T('ranking_scores')}
           (snapshot_id, disease_id, disease_name, gene_symbol, gene_name, rank_position,
            overall_score, get_score, genetic_score, expression_score, target_score, literature_score,
            tau_tissue, tau_single_cell, bimodality_max, bimodality_tissue, pubtator_score, created_at)
         VALUES (:snapshot_id,:disease_id,:disease_name,:gene_symbol,:gene_name,:rank_position,
            :overall_score,:get_score,:genetic_score,:expression_score,:target_score,:literature_score,
            NULL,NULL,NULL,NULL,NULL, SYSTIMESTAMP)`,
        {
          snapshot_id: snapshotId, disease_id, disease_name, gene_symbol: g,
          gene_name: t.name ? String(t.name).slice(0, 400) : null, rank_position: rank,
          overall_score: num(t.overallScore), get_score: num(t.getScore ?? t.overallScore), genetic_score: num(t.geneticScore),
          expression_score: num(t.expressionScore), target_score: num(t.targetScore), literature_score: num(t.literatureScore),
        }
      );
    }
    await logAudit(conn, { actor: 'job', action: 'genes_added', entity: 'ranking_scores', entity_id: String(snapshotId), disease_id, details: { count: targets.length } });
    await conn.commit();
    return { count: targets.length };
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    await conn.close();
  }
}

export async function evidenceGeneSymbols(diseaseId?: string): Promise<string[]> {
  const conn = await (await getPool()).getConnection();
  try {
    const r = await conn.execute(
      `SELECT DISTINCT gene_symbol AS "g" FROM ${T('evidence')}` +
        (diseaseId ? ` WHERE LOWER(disease_id) LIKE LOWER(:d)` : ''),
      diseaseId ? { d: `%${diseaseId}%` } : {},
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (r.rows as any[]).map((x) => x.g).filter(Boolean);
  } finally {
    await conn.close();
  }
}

export async function evidenceForGene(gene: string): Promise<any[]> {
  const conn = await (await getPool()).getConnection();
  try {
    const r = await conn.execute(
      `SELECT id AS "id", snapshot_id AS "snapshot_id", disease_id AS "disease_id", gene_symbol AS "gene_symbol",
              evidence_type AS "evidence_type", source AS "source", source_url AS "source_url",
              value_text AS "value_text", value_json AS "value_json",
              TO_CHAR(retrieved_at,'YYYY-MM-DD"T"HH24:MI:SS') AS "retrieved_at",
              generated_by AS "generated_by", audit_status AS "audit_status"
       FROM ${T('evidence')} WHERE gene_symbol = :g ORDER BY retrieved_at DESC`,
      { g: gene }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return (r.rows as any[]).map((row) => ({ ...row, value_json: safeParse(row.value_json) }));
  } finally {
    await conn.close();
  }
}

// ── Reads for the Rankings dashboard + Gene × Source matrix ───────────────────
export async function listRankingScores(snapshotId: number): Promise<any[]> {
  const conn = await (await getPool()).getConnection();
  try {
    const r = await conn.execute(
      `SELECT gene_symbol AS "gene_symbol", rank_position AS "rank", overall_score AS "overall_score",
              get_score AS "get_score", genetic_score AS "genetic_score", expression_score AS "expression_score",
              target_score AS "target_score", literature_score AS "literature_score",
              tau_tissue AS "tau_tissue", tau_single_cell AS "tau_single_cell",
              bimodality_max AS "bimodality_max", bimodality_tissue AS "bimodality_tissue",
              pubtator_score AS "pubtator_score"
       FROM ${T('ranking_scores')} WHERE snapshot_id = :id ORDER BY rank_position`,
      { id: snapshotId }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return r.rows as any[];
  } finally { await conn.close(); }
}

export async function snapshotEvidence(snapshotId: number): Promise<any[]> {
  const conn = await (await getPool()).getConnection();
  try {
    const r = await conn.execute(
      `SELECT gene_symbol AS "gene_symbol", evidence_type AS "evidence_type", source AS "source",
              value_text AS "value_text", value_json AS "value_json"
       FROM ${T('evidence')} WHERE snapshot_id = :id`,
      { id: snapshotId }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    return r.rows as any[];
  } finally { await conn.close(); }
}

// ── Harvest: snapshot + per-gene scores + per-source evidence, transactional ──
export interface HarvestInput {
  disease_id: string;
  disease_name: string;
  weights?: unknown;
  provenance?: unknown;
  created_by?: string | null;
  rows: Array<{ gene_symbol: string; rank?: number; get_scores?: any; clinical?: any; literature?: any; chembl?: any; mutations?: any; retrieved?: string | null }>;
}

export async function saveHarvest(h: HarvestInput): Promise<{ id: number; version: number; scores: number; evidence: number }> {
  const conn = await (await getPool()).getConnection();
  try {
    const vres = await conn.execute<any[]>(`SELECT NVL(MAX(version),0)+1 FROM ${T('target_ranking_snapshots')} WHERE disease_id = :d`, { d: h.disease_id });
    const version: number = vres.rows![0][0];
    const ins = await conn.execute(
      `INSERT INTO ${T('target_ranking_snapshots')}
         (disease_id, disease_name, version, created_at, created_by, label, gene_count, weights, provenance, targets)
       VALUES (:disease_id,:disease_name,:version,SYSTIMESTAMP,:created_by,:label,:gene_count,:weights,:provenance,:targets)
       RETURNING id INTO :id`,
      {
        disease_id: h.disease_id, disease_name: h.disease_name, version, created_by: h.created_by ?? null,
        label: 'Harvest', gene_count: h.rows.length, weights: clob(h.weights), provenance: clob(h.provenance),
        targets: clob(h.rows), id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      }
    );
    const snapshotId: number = (ins.outBinds as any).id[0];
    let scores = 0, evidence = 0;
    for (let i = 0; i < h.rows.length; i++) {
      const r = h.rows[i]; const s = r.get_scores || {};
      await conn.execute(
        `INSERT INTO ${T('ranking_scores')}
           (snapshot_id, disease_id, disease_name, gene_symbol, gene_name, rank_position,
            overall_score, get_score, genetic_score, expression_score, target_score, literature_score,
            tau_tissue, tau_single_cell, bimodality_max, bimodality_tissue, pubtator_score, created_at)
         VALUES (:snapshot_id,:disease_id,:disease_name,:gene_symbol,:gene_name,:rank_position,
            :overall_score,:get_score,:genetic_score,:expression_score,:target_score,:literature_score,
            :tau_tissue,:tau_single_cell,:bimodality_max,:bimodality_tissue,:pubtator_score, SYSTIMESTAMP)`,
        {
          snapshot_id: snapshotId, disease_id: h.disease_id, disease_name: h.disease_name,
          gene_symbol: String(r.gene_symbol ?? '').slice(0, 64), gene_name: null,
          rank_position: num(r.rank) ?? (i + 1),
          overall_score: num(s.overallScore), get_score: num(s.getScore), genetic_score: num(s.geneticScore),
          expression_score: num(s.combinedExpression ?? s.expressionScore), target_score: num(s.targetScore),
          literature_score: num(s.literatureScore), tau_tissue: num(s.tauTissue), tau_single_cell: num(s.tauSingleCell),
          bimodality_max: num(s.bimodalityMax), bimodality_tissue: s.bimodalityTissue ? String(s.bimodalityTissue).slice(0, 200) : null, pubtator_score: num(s.pubTatorScore),
        }
      );
      scores++;
      const retrieved = r.retrieved ?? null;
      const add = async (type: string, source: string, json: unknown, text: string | null) => {
        if (json == null) return;
        await insertEvidence(conn, { snapshot_id: snapshotId, disease_id: h.disease_id, gene_symbol: r.gene_symbol, evidence_type: type, source, value_json: json, value_text: text, retrieved_at: retrieved, generated_by: 'harvest', audit_status: 'not_audited' });
        evidence++;
      };
      // Only store evidence that actually has data (so the matrix ✓ means real evidence).
      const clin = (r.clinical && (r.clinical.trial_count ?? 0) > 0) ? r.clinical : null;
      const lit  = (r.literature && (((r.literature.paper_count ?? 0) > 0) || ((r.literature.total_signals ?? 0) > 0))) ? r.literature : null;
      const drug = (r.chembl && r.chembl.label && r.chembl.label !== 'No Drug Data Found') ? r.chembl : null;
      const mut  = (r.mutations && (r.mutations.mutatedSamples ?? 0) > 0) ? r.mutations : null;
      await add('clinical', 'ClinicalTrials.gov', clin,
        clin ? `${clin.trial_count} trials · max phase ${clin.max_phase ?? 'NA'}${clin.active_trial_present ? ' · active' : ''}` : null);
      await add('literature', 'PubMed/EuropePMC/PubTator', lit,
        lit ? `${lit.paper_count ?? 0} papers · ${lit.recent_paper_count ?? 0} recent · velocity ${lit.signal_velocity ?? 'NA'}` : null);
      await add('druggability', 'ChEMBL', drug,
        drug ? `${drug.label}${drug.bestCompound?.ic50Nm != null ? ` · IC50 ${drug.bestCompound.ic50Nm} nM` : ''} · ${drug.totalCompounds ?? 0} compounds` : null);
      await add('mutation', 'cBioPortal', mut,
        mut ? `${mut.mutatedSamples}/${mut.totalSamples} mutated · dominant ${mut.dominantVariant ?? 'NA'}` : null);
    }
    await logAudit(conn, { actor: h.created_by ?? 'unknown', action: 'harvest_saved', entity: 'target_ranking_snapshots', entity_id: String(snapshotId), disease_id: h.disease_id, details: { version, scores, evidence } });
    await conn.commit();
    return { id: snapshotId, version, scores, evidence };
  } catch (e) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw e;
  } finally {
    await conn.close();
  }
}

// ── Append-only audit ────────────────────────────────────────────────────────
async function logAudit(conn: oracledb.Connection, e: { actor: string; action: string; entity: string; entity_id: string; disease_id: string | null; details: unknown }): Promise<void> {
  await conn.execute(
    `INSERT INTO ${T('audit_log')} (event_time, actor, action, entity, entity_id, disease_id, details)
     VALUES (SYSTIMESTAMP, :actor,:action,:entity,:entity_id,:disease_id,:details)`,
    { actor: e.actor?.slice(0, 200) ?? null, action: e.action, entity: e.entity, entity_id: e.entity_id, disease_id: e.disease_id, details: clob(e.details) }
  );
}
