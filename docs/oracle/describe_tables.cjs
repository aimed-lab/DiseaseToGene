// Prints the column structure of the team's Oracle content tables, so we can map
// the app's data onto them correctly.
//   node --env-file=.env docs/oracle/describe_tables.cjs
const oracledb = require("oracledb");

async function main() {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_OWNER_USER,
    password: process.env.ORACLE_OWNER_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
  });
  const tables = ["EVIDENCE", "RANKING_SCORES", "TARGET_RANKING_SNAPSHOTS", "AUDIT_LOG"];
  for (const t of tables) {
    const r = await conn.execute(
      `select column_name, data_type, data_length, nullable
         from user_tab_columns where table_name = :t order by column_id`,
      [t]
    );
    console.log(`\n=== ${t} ===`);
    if (!r.rows.length) { console.log("  (no columns / table not found)"); continue; }
    r.rows.forEach((c) => {
      const type = c[1] + (["VARCHAR2", "CHAR", "NUMBER", "RAW"].includes(c[1]) && c[2] ? `(${c[2]})` : "");
      console.log(`  ${c[0].padEnd(28)} ${type.padEnd(16)} ${c[3] === "Y" ? "" : "NOT NULL"}`);
    });
  }
  await conn.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
