/* Oracle connectivity test for Disease2Target.
 * Run:  node --env-file=.env scripts/oracle-test.cjs
 * Verifies: the app can reach the DB, log in, and see all 4 content tables.
 */
const oracledb = require("oracledb");

const SCHEMA = process.env.ORACLE_SCHEMA || process.env.ORACLE_USER;
const TABLES = [
  "target_ranking_snapshots",
  "ranking_scores",
  "evidence",
  "audit_log",
];

(async () => {
  if (!process.env.ORACLE_USER || !process.env.ORACLE_PASSWORD || !process.env.ORACLE_CONNECT_STRING) {
    console.error("✗ Missing ORACLE_USER / ORACLE_PASSWORD / ORACLE_CONNECT_STRING in .env");
    process.exit(1);
  }
  let conn;
  try {
    console.log(`→ Connecting as ${process.env.ORACLE_USER} to ${process.env.ORACLE_CONNECT_STRING} ...`);
    conn = await oracledb.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING,
    });
    console.log("✓ Connected.");

    for (const t of TABLES) {
      try {
        const r = await conn.execute(`SELECT COUNT(*) FROM ${SCHEMA}.${t}`);
        console.log(`✓ ${SCHEMA}.${t} — reachable (${r.rows[0][0]} rows)`);
      } catch (e) {
        console.log(`✗ ${SCHEMA}.${t} — ${e.message}`);
      }
    }
    console.log("\nDONE. If all four show ✓, the app can use Oracle.");
  } catch (e) {
    console.error("✗ Connection failed:", e.message);
    console.error("  • If it hangs/times out from outside UAB, the DB likely isn't reachable from this network.");
    process.exitCode = 1;
  } finally {
    if (conn) { try { await conn.close(); } catch {} }
  }
})();
