/* Oracle WRITE round-trip test.
 * Run:  npx tsx --env-file=.env scripts/oracle-write-test.ts
 * Saves a sample snapshot (+ scores + audit), reads it back, then deletes it.
 * Requires USE_ORACLE_STORE=1 and the ORACLE_* vars in .env.
 */
import { oracleEnabled, saveSnapshot, listSnapshots, getSnapshot, deleteSnapshot, closeOraclePool } from '../oracleService';

async function main() {
  if (!oracleEnabled()) {
    console.error('✗ Oracle not enabled. Set USE_ORACLE_STORE=1 and ORACLE_* in .env.');
    process.exit(1);
  }
  const sample = {
    disease_id: 'TEST_EFO_0000001',
    disease_name: 'Oracle write test disease',
    label: 'connectivity check',
    weights: { genetic: 0.5, expression: 0.25, target: 0.25 },
    provenance: { app: 'oracle-write-test', generated_by: 'cli', retrieved_at: new Date().toISOString() },
    created_by: 'cli@test',
    targets: [
      { symbol: 'KRAS', name: 'KRAS proto-oncogene', overallScore: 0.91, getScore: 0.88, geneticScore: 0.95, expressionScore: 0.7, targetScore: 0.85, literatureScore: 0.6, tauTissue: 0.4, pubTatorScore: 0.7 },
      { symbol: 'SRC',  name: 'SRC proto-oncogene',  overallScore: 0.72, getScore: 0.7,  geneticScore: 0.6,  expressionScore: 0.65, targetScore: 0.8, literatureScore: 0.5, tauTissue: 0.3, pubTatorScore: 0.55 },
    ],
  };

  console.log('→ Saving sample snapshot...');
  const { id, version } = await saveSnapshot(sample);
  console.log(`✓ Saved snapshot id=${id} version=${version}`);

  console.log('→ Listing snapshots for the test disease...');
  const list = await listSnapshots(sample.disease_id);
  console.log(`✓ Listed ${list.length} snapshot(s):`, list.map((r: any) => `v${r.version} (${r.gene_count} genes)`).join(', '));

  console.log('→ Loading the snapshot back...');
  const full = await getSnapshot(id);
  console.log(`✓ Loaded: ${full.targets.length} targets, first = ${full.targets[0]?.symbol}, provenance.app = ${full.provenance?.app}`);

  console.log('→ Deleting the test snapshot (cascades scores)...');
  await deleteSnapshot(id, 'cli@test');
  console.log('✓ Deleted.');

  await closeOraclePool();
  console.log('\nALL GOOD ✓  Oracle read + write + delete all work. Audit rows for save/delete remain in AUDIT_LOG (append-only).');
}

main().catch(async (e) => {
  console.error('✗ Write test failed:', e.message);
  await closeOraclePool();
  process.exit(1);
});
