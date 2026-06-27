// Quick check of the content tables after saving a snapshot from the app.
//   node --env-file=.env docs/oracle/verify_snapshots.cjs
const oracledb = require("oracledb");

async function main() {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
  });
  console.log(`Connected as ${process.env.ORACLE_USER}\n`);
  for (const t of ["target_ranking_snapshots", "ranking_scores", "evidence", "audit_log"]) {
    try {
      const r = await conn.execute(`select count(*) from ${t}`);
      console.log(`  ${t}: ${r.rows[0][0]} rows`);
    } catch (e) { console.log(`  ${t}: ERR ${e.message}`); }
  }
  console.log("\nLatest audit events:");
  try {
    const r = await conn.execute(
      "select to_char(event_time,'YYYY-MM-DD HH24:MI') t, action, entity, entity_id from audit_log order by event_time desc fetch first 5 rows only",
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    if (!r.rows.length) console.log("  (none yet)");
    r.rows.forEach((x) => console.log(`  ${x.T} | ${x.ACTION} | ${x.ENTITY} #${x.ENTITY_ID}`));
  } catch (e) { console.log("  " + e.message); }
  await conn.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
