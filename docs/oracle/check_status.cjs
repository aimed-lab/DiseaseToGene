// Read-only status check: connects to Oracle and reports which Disease2Target
// tables exist (and row counts). Safe to run anytime.
//   node --env-file=.env docs/oracle/check_status.cjs
const oracledb = require("oracledb");

async function main() {
  const user = process.env.ORACLE_USER || process.env.ORACLE_OWNER_USER;
  const password = process.env.ORACLE_PASSWORD || process.env.ORACLE_OWNER_PASSWORD;
  const connectString = process.env.ORACLE_CONNECT_STRING;
  if (!user || !password || !connectString) {
    console.error("Missing ORACLE_USER / ORACLE_PASSWORD / ORACLE_CONNECT_STRING in .env");
    process.exit(1);
  }
  let conn;
  try {
    conn = await oracledb.getConnection({ user, password, connectString });
  } catch (e) {
    console.error("Connection failed:", e.message, "\n(On UAB network/VPN? Credentials correct?)");
    process.exit(1);
  }
  const schema = (process.env.ORACLE_SCHEMA || user).toUpperCase();
  console.log(`Connected as ${user} @ ${connectString}`);
  console.log(`Looking in schema: ${schema}\n`);

  const want = ["GENE_CONTENT", "PAPERS", "EVIDENCE_CARDS", "TARGET_RANKING_SNAPSHOTS", "AUDIT_LOG"];
  const r = await conn.execute("select table_name from all_tables where owner = :o", [schema]);
  const have = new Set(r.rows.map((row) => row[0]));

  console.log("Disease2Target tables:");
  for (const t of want) console.log("  " + (have.has(t) ? "[x] " : "[ ] ") + t);

  console.log("\nRow counts:");
  for (const t of want) {
    if (have.has(t)) {
      try {
        const c = await conn.execute(`select count(*) from ${schema}.${t}`);
        console.log(`  ${t}: ${c.rows[0][0]} rows`);
      } catch (e) {
        console.log(`  ${t}: (exists, but no read access yet — ${e.message})`);
      }
    }
  }

  await conn.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
