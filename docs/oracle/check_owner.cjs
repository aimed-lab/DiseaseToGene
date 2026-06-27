// Owner-side diagnostic: lists the tables the OWNER actually has, and the grants
// the owner has made (so we can see which tables the app/role can access).
//   node --env-file=.env docs/oracle/check_owner.cjs
const oracledb = require("oracledb");

async function main() {
  const user = process.env.ORACLE_OWNER_USER;
  const password = process.env.ORACLE_OWNER_PASSWORD;
  const connectString = process.env.ORACLE_CONNECT_STRING;
  if (!user || !password || !connectString) {
    console.error("Need ORACLE_OWNER_USER / ORACLE_OWNER_PASSWORD / ORACLE_CONNECT_STRING in .env");
    process.exit(1);
  }
  const conn = await oracledb.getConnection({ user, password, connectString });
  console.log(`Connected as OWNER: ${user}\n`);

  const t = await conn.execute("select table_name from user_tables order by table_name");
  console.log("Tables this owner actually has:");
  if (!t.rows.length) console.log("  (none)");
  t.rows.forEach((r) => console.log("  - " + r[0]));

  const g = await conn.execute(
    "select table_name, grantee, privilege from user_tab_privs_made order by table_name, grantee, privilege"
  );
  console.log("\nGrants the owner has made (table -> grantee : privilege):");
  if (!g.rows.length) console.log("  (none)");
  g.rows.forEach((r) => console.log(`  ${r[0]} -> ${r[1]} : ${r[2]}`));

  await conn.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
