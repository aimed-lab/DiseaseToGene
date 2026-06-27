// Creates the Disease2Target Oracle tables by running docs/sql/oracle_schema.sql
// as the schema owner. Uses node-oracledb "thin mode" (no Oracle client install).
//
// Setup:
//   1) Put Oracle owner creds in .env (project root) — ORACLE_USER / ORACLE_PASSWORD / ORACLE_CONNECT_STRING.
//      (For creating tables this MUST be the owner account, e.g. DISEASE2TARGET_OWNER.)
//   2) npm install oracledb   (already done)
//   3) node --env-file=.env docs/oracle/create_tables.cjs

const oracledb = require("oracledb");
const fs = require("fs");
const path = require("path");

async function main() {
  // Table creation MUST use the schema OWNER — the app user can't create tables.
  const user = process.env.ORACLE_OWNER_USER || process.env.ORACLE_USER;
  const password = process.env.ORACLE_OWNER_PASSWORD || process.env.ORACLE_PASSWORD;
  const connectString = process.env.ORACLE_CONNECT_STRING;
  if (!user || !password || !connectString) {
    console.error("Missing ORACLE_OWNER_USER / ORACLE_OWNER_PASSWORD / ORACLE_CONNECT_STRING in .env");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "..", "sql", "oracle_schema.sql");
  const raw = fs.readFileSync(sqlPath, "utf8");
  const cleaned = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const statements = cleaned.split(";").map((s) => s.trim()).filter(Boolean);

  let conn;
  try {
    conn = await oracledb.getConnection({ user, password, connectString });
    console.log(`Connected as ${user} @ ${connectString}\n`);
  } catch (e) {
    console.error("Connection failed:", e.message, "\n(On UAB network/VPN? Owner credentials correct?)");
    process.exit(1);
  }

  let ok = 0, fail = 0;
  for (const stmt of statements) {
    const label = stmt.split("\n")[0].slice(0, 64);
    try {
      await conn.execute(stmt);
      console.log("  OK   " + label);
      ok++;
    } catch (e) {
      console.error("  FAIL " + label + "\n         " + e.message);
      fail++;
    }
  }
  await conn.commit();
  await conn.close();
  console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
