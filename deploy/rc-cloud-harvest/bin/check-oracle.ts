// deploy/rc-cloud-harvest/bin/check-oracle.ts — can this machine reach the store?
//
//   npx tsx --env-file=.env deploy/rc-cloud-harvest/bin/check-oracle.ts
//
// Connects with the .env credentials, pings, lists the snapshots, and exits non-zero on
// any failure. Read-only. Prints the host it is trying so a timeout is diagnosable
// (a route/security-group problem looks different from a wrong password).
import { oracleEnabled, ping, listSnapshots, closeOraclePool } from '../../../oracleService.ts';

const t0 = Date.now();
const ms = () => `${Date.now() - t0} ms`;
const host = (process.env.ORACLE_CONNECT_STRING || '').split('/')[0] || '(ORACLE_CONNECT_STRING unset)';

(async () => {
  if (!oracleEnabled()) {
    console.error(`FAIL  .env is missing ORACLE_USER / ORACLE_PASSWORD / ORACLE_CONNECT_STRING`);
    process.exit(2);
  }
  console.log(`      connecting to ${host} as ${process.env.ORACLE_USER} …`);
  const timer = setTimeout(() => {
    console.error(`FAIL  no answer from ${host} after 30 s — no route from this VM, or a firewall (try: nc -zv ${host.replace(':', ' ')})`);
    process.exit(3);
  }, 30_000);
  try {
    const ok = await ping();
    if (!ok) throw new Error('ping returned false');
    console.log(`OK    connected (${ms()})`);
    const snaps = await listSnapshots();
    console.log(`OK    ${snaps.length} snapshot(s) in the store (${ms()})`);
    for (const s of snaps.slice(0, 12)) {
      console.log(`      #${String(s.id).padStart(4)}  v${s.version ?? '?'}  ${String(s.disease_name || '').padEnd(32)}  ${s.gene_count ?? '?'} genes  ${String(s.created_at || '').slice(0, 10)}`);
    }
    if (snaps.length > 12) console.log(`      … and ${snaps.length - 12} more`);
    clearTimeout(timer);
    await closeOraclePool().catch(() => {});
    process.exit(0);
  } catch (e: any) {
    clearTimeout(timer);
    const msg = String(e?.message || e);
    const hint = /ORA-01017/.test(msg) ? 'wrong user or password'
      : /ORA-12541|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(msg) ? 'host/port unreachable from this VM'
      : /ORA-00942/.test(msg) ? 'connected, but the tables are not visible to this user (ORACLE_SCHEMA?)'
      : '';
    console.error(`FAIL  ${msg}${hint ? `  ← ${hint}` : ''}`);
    await closeOraclePool().catch(() => {});
    process.exit(1);
  }
})();
