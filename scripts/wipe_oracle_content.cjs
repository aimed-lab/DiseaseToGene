/* Wipe ALL Disease2Target content from Oracle — clean slate before a full-universe run.
 *
 *   Dry run (just shows row counts, changes nothing):
 *     node --env-file=.env scripts/wipe_oracle_content.cjs
 *   Actually wipe (irreversible):
 *     node --env-file=.env scripts/wipe_oracle_content.cjs --yes
 *   Also clear the audit_log (off by default — it's an append-only history):
 *     node --env-file=.env scripts/wipe_oracle_content.cjs --yes --audit
 *
 * Why this isn't a plain TRUNCATE: `ranking_scores.fk_rs_snapshot` and
 * `evidence.fk_ev_snapshot` reference target_ranking_snapshots, and Oracle refuses
 * to TRUNCATE a table referenced by an ENABLED foreign key — even when the children
 * are empty. So we disable those child FKs, truncate all three tables, then
 * re-enable the FKs. Note: deleting snapshots through the APP instead leaves evidence
 * rows orphaned (evidence FK is ON DELETE SET NULL), which is exactly what this
 * script avoids. Requires UAB VPN (Oracle is internal).
 */
const oracledb = require("oracledb");

const SCHEMA = (process.env.ORACLE_SCHEMA || process.env.ORACLE_USER || "").toUpperCase();
const DO_WIPE = process.argv.includes("--yes");
const DO_AUDIT = process.argv.includes("--audit");

// child → parent order; parent last
const CONTENT_TABLES = ["ranking_scores", "evidence", "target_ranking_snapshots"];
const PARENT = "target_ranking_snapshots";

const q = (s) => `${SCHEMA}.${s}`;

async function count(conn, t) {
  try { const r = await conn.execute(`SELECT COUNT(*) FROM ${q(t)}`); return r.rows[0][0]; }
  catch (e) { return `? (${e.message.split("\n")[0]})`; }
}

(async () => {
  if (!process.env.ORACLE_USER || !process.env.ORACLE_PASSWORD || !process.env.ORACLE_CONNECT_STRING) {
    console.error("✗ Missing ORACLE_USER / ORACLE_PASSWORD / ORACLE_CONNECT_STRING (run with --env-file=.env)");
    process.exit(1);
  }
  const tables = [...CONTENT_TABLES, ...(DO_AUDIT ? ["audit_log"] : [])];
  let conn;
  try {
    conn = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING,
    });
    console.log(`✓ Connected as ${process.env.ORACLE_USER} (schema ${SCHEMA})\n`);

    console.log("Row counts BEFORE:");
    for (const t of tables) console.log(`  ${t.padEnd(26)} ${await count(conn, t)}`);

    if (!DO_WIPE) {
      console.log("\nDry run — nothing deleted. Re-run with --yes to wipe (add --audit to also clear audit_log).");
      return;
    }

    // Find every ENABLED FK that references the parent table's PK, so we can
    // disable exactly those (don't hard-code names in case the schema differs).
    const fks = await conn.execute(
      `SELECT owner, table_name, constraint_name
         FROM all_constraints
        WHERE constraint_type = 'R'
          AND r_constraint_name IN (
            SELECT constraint_name FROM all_constraints
             WHERE owner = :o AND table_name = :p AND constraint_type = 'P')
          AND status = 'ENABLED'`,
      { o: SCHEMA, p: PARENT.toUpperCase() },
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    const fkList = fks.rows || [];
    console.log(`\nDisabling ${fkList.length} child FK(s) referencing ${PARENT}…`);
    for (const f of fkList) await conn.execute(`ALTER TABLE ${f.OWNER}.${f.TABLE_NAME} DISABLE CONSTRAINT ${f.CONSTRAINT_NAME}`);

    try {
      for (const t of tables) { await conn.execute(`TRUNCATE TABLE ${q(t)}`); console.log(`  truncated ${t}`); }
    } finally {
      // Always try to put the FKs back, even if a truncate failed midway.
      console.log("Re-enabling FK(s)…");
      for (const f of fkList) {
        try { await conn.execute(`ALTER TABLE ${f.OWNER}.${f.TABLE_NAME} ENABLE CONSTRAINT ${f.CONSTRAINT_NAME}`); }
        catch (e) { console.error(`  ✗ could not re-enable ${f.CONSTRAINT_NAME}: ${e.message.split("\n")[0]}`); }
      }
    }

    console.log("\nRow counts AFTER:");
    for (const t of tables) console.log(`  ${t.padEnd(26)} ${await count(conn, t)}`);
    console.log("\n✓ Wipe complete — clean slate. Run a full-universe job next.");
  } catch (e) {
    console.error("✗ Failed:", e.message);
    process.exitCode = 1;
  } finally {
    if (conn) { try { await conn.close(); } catch {} }
  }
})();
