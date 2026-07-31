// Run a .sql file (CREATE/GRANT/etc.) as the schema OWNER, statement by statement.
// Generic version of create_tables.cjs — pass the SQL path as an argument.
//
//   node --env-file=.env docs/oracle/run_sql.cjs docs/sql/kg_tables.sql
//
// Uses ORACLE_OWNER_USER/PASSWORD if set (needed for CREATE TABLE + GRANT), else
// falls back to ORACLE_USER/PASSWORD. Thin mode — no Oracle client install.

const oracledb = require("oracledb");
const fs = require("fs");
const path = require("path");

async function main() {
  const rel = process.argv[2];
  if (!rel) { console.error("usage: node --env-file=.env docs/oracle/run_sql.cjs <path/to/file.sql>"); process.exit(1); }
  const user = process.env.ORACLE_OWNER_USER || process.env.ORACLE_USER;
  const password = process.env.ORACLE_OWNER_PASSWORD || process.env.ORACLE_PASSWORD;
  const connectString = process.env.ORACLE_CONNECT_STRING;
  if (!user || !password || !connectString) {
    console.error("Missing ORACLE_OWNER_USER / ORACLE_OWNER_PASSWORD / ORACLE_CONNECT_STRING in .env");
    process.exit(1);
  }

  const sqlPath = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  const raw = fs.readFileSync(sqlPath, "utf8");
  // Strip full-line comments, then split on ';' at statement boundaries.
  const cleaned = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const statements = cleaned.split(";").map((s) => s.trim()).filter(Boolean);

  let conn;
  try {
    conn = await oracledb.getConnection({ user, password, connectString });
    console.log(`Connected as ${user} @ ${connectString}\nRunning ${rel} (${statements.length} statements)\n`);
  } catch (e) {
    console.error("Connection failed:", e.message, "\n(On UAB network/VPN? Owner credentials correct?)");
    process.exit(1);
  }

  let ok = 0, fail = 0;
  for (const stmt of statements) {
    const label = stmt.split("\n")[0].slice(0, 72);
    try { await conn.execute(stmt); console.log("  OK   " + label); ok++; }
    catch (e) {
      // "name is already used" / "such column list already indexed" are benign re-runs.
      const benign = /ORA-00955|ORA-01430|ORA-01408|ORA-02275/.test(e.message || "");
      console[benign ? "log" : "error"]((benign ? "  SKIP " : "  FAIL ") + label + "\n         " + e.message);
      benign ? ok++ : fail++;
    }
  }
  await conn.commit();
  await conn.close();
  console.log(`\nDone. ${ok} ok, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
