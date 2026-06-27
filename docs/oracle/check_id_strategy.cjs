// Detects how primary-key IDs are generated (identity column / sequence / trigger)
// so the migration can insert rows and capture generated IDs correctly.
//   node --env-file=.env docs/oracle/check_id_strategy.cjs
const oracledb = require("oracledb");

async function main() {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_OWNER_USER,
    password: process.env.ORACLE_OWNER_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
  });

  console.log("Identity columns:");
  let r = await conn.execute(
    "select table_name, column_name, generation_type from user_tab_identity_cols order by table_name"
  );
  if (!r.rows.length) console.log("  (none)");
  r.rows.forEach((x) => console.log(`  ${x[0]}.${x[1]} : ${x[2]}`));

  console.log("\nColumn defaults on ID columns:");
  r = await conn.execute(
    `select table_name, column_name, data_default from user_tab_columns
       where column_name = 'ID'
         and table_name in ('EVIDENCE','RANKING_SCORES','TARGET_RANKING_SNAPSHOTS','AUDIT_LOG')
       order by table_name`
  );
  r.rows.forEach((x) => console.log(`  ${x[0]}.ID default = ${x[2] || "(none)"}`));

  console.log("\nSequences:");
  r = await conn.execute("select sequence_name from user_sequences order by 1");
  if (!r.rows.length) console.log("  (none)");
  r.rows.forEach((x) => console.log("  " + x[0]));

  console.log("\nTriggers:");
  r = await conn.execute(
    "select trigger_name, table_name, triggering_event, status from user_triggers order by table_name"
  );
  if (!r.rows.length) console.log("  (none)");
  r.rows.forEach((x) => console.log(`  ${x[0]} on ${x[1]} (${x[2]}) ${x[3]}`));

  await conn.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
