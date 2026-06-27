// Direct Oracle write test — bypasses the app. Writes one snapshot + 1 score +
// 1 evidence + 1 audit row (explicit timestamps), commits, shows counts.
//   node --env-file=.env docs/oracle/test_write.cjs
const oracledb = require("oracledb");
const SCHEMA = (process.env.ORACLE_SCHEMA || process.env.ORACLE_USER || "").toUpperCase();
const T = (n) => `${SCHEMA}.${n}`;
const clob = (o) => ({ val: JSON.stringify(o ?? null), type: oracledb.CLOB });

async function main() {
  const conn = await oracledb.getConnection({
    user: process.env.ORACLE_USER, password: process.env.ORACLE_PASSWORD, connectString: process.env.ORACLE_CONNECT_STRING,
  });
  console.log(`Connected as ${process.env.ORACLE_USER}, schema ${SCHEMA}\n`);

  // 1. Do the NOT-NULL timestamp columns have defaults? (confirms the bug)
  console.log("Timestamp column defaults (null = no default = must be set explicitly):");
  const d = await conn.execute(
    `select table_name, column_name, data_default from all_tab_columns
       where owner = :s and column_name in ('CREATED_AT','EVENT_TIME','RETRIEVED_AT')
       order by table_name, column_name`,
    { s: SCHEMA }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  d.rows.forEach((r) => console.log(`  ${r.TABLE_NAME}.${r.COLUMN_NAME} default = ${r.DATA_DEFAULT ?? "(none)"}`));

  // 2. Minimal write (same shape as saveHarvest), explicit timestamps
  console.log("\nWriting a test snapshot...");
  try {
    const ins = await conn.execute(
      `INSERT INTO ${T("target_ranking_snapshots")}
         (disease_id, disease_name, version, created_at, created_by, label, gene_count, weights, provenance, targets)
       VALUES (:disease_id,:disease_name,1,SYSTIMESTAMP,:created_by,'WRITE_TEST',1,:weights,:provenance,:targets)
       RETURNING id INTO :id`,
      { disease_id: "TEST_DISEASE", disease_name: "Write Test", created_by: "test",
        weights: clob({}), provenance: clob({ test: true }), targets: clob([]),
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } }
    );
    const snapId = ins.outBinds.id[0];
    console.log(`  snapshot id = ${snapId}`);

    await conn.execute(
      `INSERT INTO ${T("ranking_scores")}
         (snapshot_id, disease_id, disease_name, gene_symbol, rank_position, get_score, created_at)
       VALUES (:sid,'TEST_DISEASE','Write Test','TESTGENE',1,0.99,SYSTIMESTAMP)`,
      { sid: snapId }
    );
    await conn.execute(
      `INSERT INTO ${T("evidence")}
         (snapshot_id, disease_id, gene_symbol, evidence_type, source, value_json, retrieved_at, audit_status)
       VALUES (:sid,'TEST_DISEASE','TESTGENE','test','unit-test',:vj,SYSTIMESTAMP,'not_audited')`,
      { sid: snapId, vj: clob({ ok: true }) }
    );
    await conn.execute(
      `INSERT INTO ${T("audit_log")} (event_time, actor, action, entity, entity_id, details)
       VALUES (SYSTIMESTAMP,'test','write_test','target_ranking_snapshots',:eid,:dt)`,
      { eid: String(snapId), dt: clob({ test: true }) }
    );
    await conn.commit();
    console.log("  committed OK ✓");
  } catch (e) {
    console.error("  WRITE FAILED:", e.message);
    await conn.rollback().catch(() => {});
  }

  console.log("\nRow counts now:");
  for (const t of ["target_ranking_snapshots", "ranking_scores", "evidence", "audit_log"]) {
    const r = await conn.execute(`select count(*) c from ${T(t)}`, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    console.log(`  ${t}: ${r.rows[0].C}`);
  }
  console.log("\n(To remove the test rows later: DELETE FROM target_ranking_snapshots WHERE label='WRITE_TEST';)");
  await conn.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
