// scripts/harvestQueue.ts — the RC cloud VM's queue worker.
//
//   npx tsx --env-file=.env scripts/harvestQueue.ts            # loop forever (systemd: deploy/rc-cloud-harvest/systemd/d2t-queue.service)
//   npx tsx --env-file=.env scripts/harvestQueue.ts --once     # process at most one job, then exit
//
// An admin queues a harvest in the app (POST /api/admin/harvest → a row in Supabase
// harvest_jobs, docs/sql/harvest_jobs.sql). This worker polls that table over outbound
// HTTPS — the VM has no inbound ports and needs none — claims the oldest queued job with an
// atomic UPDATE, runs deploy/rc-cloud-harvest/bin/harvest.sh exactly as a person would, and
// writes progress, the log tail, the summary, the snapshot id and the audit verdict back to
// the row. One job at a time. A heartbeat row in harvest_workers tells the admin panel the
// worker is alive. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (the same two
// the server uses); no other credential leaves the VM.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env'); process.exit(2); }
const sb = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const ONCE = process.argv.includes('--once');
const POLL_MS = Number(process.env.HARVEST_QUEUE_POLL_MS || 30_000);
const HOST = os.hostname();
const ROOT = process.cwd();
const HARVEST = path.join(ROOT, 'deploy/rc-cloud-harvest/bin/harvest.sh');
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const commit = () => { try { return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || 'unknown'; } catch { return 'unknown'; } };
const AXES = ['expression', 'proteomics', 'dependency', 'safety', 'tissue', 'mutation', 'annotation', 'druggability', 'clinical', 'patents', 'literature', 'network'];

async function heartbeat(running: string | null, note?: string) {
  const { error } = await sb.from('harvest_workers').upsert({ host: HOST, last_seen: new Date().toISOString(), commit: commit(), running_job: running, note: note ?? null }, { onConflict: 'host' });
  if (error) log(`heartbeat failed: ${error.message}`);
}

async function claim(): Promise<any | null> {
  const { data: next } = await sb.from('harvest_jobs').select('id').eq('status', 'queued').order('created_at', { ascending: true }).limit(1);
  if (!next?.length) return null;
  // Atomic: only one worker can flip queued → running for this id.
  const { data, error } = await sb.from('harvest_jobs')
    .update({ status: 'running', claimed_by: HOST, started_at: new Date().toISOString(), commit: commit(), progress: 'starting' })
    .eq('id', next[0].id).eq('status', 'queued').select('*').maybeSingle();
  if (error) { log(`claim failed: ${error.message}`); return null; }
  return data;
}

function runJob(job: any): Promise<{ code: number; logFile: string | null }> {
  const args = [HARVEST, job.disease, String(job.gene_count)];
  const o = job.options || {};
  // options.snapshot: re-run axes on an existing snapshot instead of harvesting a new one
  // (what enrich.sh does by hand). Used for repairs and for exercising the queue safely.
  if (Number.isInteger(o.snapshot) && o.snapshot > 0) args.push('--snapshot', String(o.snapshot));
  if (Array.isArray(o.axes) && o.axes.length) args.push('--axes', o.axes.join(','));
  if (Array.isArray(o.skip)) for (const a of o.skip) args.push('--skip', String(a));
  if (o.no_kg) args.push('--no-kg');
  log(`job ${job.id}: bash ${args.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  return new Promise(resolve => {
    const child = spawn('bash', args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines: string[] = []; let logFile: string | null = null; let progress = 'starting'; let dirty = false;
    const onData = (buf: Buffer) => {
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        lines.push(line); if (lines.length > 400) lines.shift();
        const m = line.match(/log: (logs\/\S+\.log)/); if (m) logFile = m[1];
        const ax = line.match(/── (?:enrich (\w+)|axis: (\w+) ──)/); const axis = ax?.[1] || ax?.[2];
        if (axis) progress = `enrich ${axis} (${AXES.indexOf(axis) + 1}/${AXES.length})`;
        else if (/── harvest:/.test(line)) progress = 'harvest (Open Targets)';
        else if (/── kg:/.test(line)) progress = 'knowledge graph';
        else if (/── audit:/.test(line)) progress = 'audit';
        dirty = true;
      }
    };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const tick = setInterval(async () => {
      // Heartbeat every tick even when the child is silent (an Oracle save of 6,000 rows prints
      // nothing for a minute or two); the log tail only when something new was printed.
      await heartbeat(job.id, progress);
      if (!dirty) return; dirty = false;
      await sb.from('harvest_jobs').update({ progress, log_tail: lines.slice(-40).join('\n') }).eq('id', job.id);
    }, 15_000);
    child.on('close', code => { clearInterval(tick); sb.from('harvest_jobs').update({ log_tail: lines.slice(-40).join('\n') }).eq('id', job.id).then(() => resolve({ code: code ?? 1, logFile })); });
    child.on('error', e => { clearInterval(tick); lines.push(`spawn error: ${e.message}`); resolve({ code: 1, logFile }); });
  });
}

async function finish(job: any, code: number) {
  // The wrapper leaves runs/<snapshot>.summary.txt; find the newest one written since the job started.
  let summary = '', snapshotId: number | null = null, audit: 'passed' | 'failed' | 'skipped' = 'skipped';
  try {
    const since = new Date(job.started_at || Date.now() - 6 * 3600_000).getTime() - 60_000;
    const files = fs.readdirSync(path.join(ROOT, 'runs')).filter(f => f.endsWith('.summary.txt'))
      .map(f => ({ f, t: fs.statSync(path.join(ROOT, 'runs', f)).mtimeMs })).filter(x => x.t >= since).sort((a, b) => b.t - a.t);
    if (files.length) {
      summary = fs.readFileSync(path.join(ROOT, 'runs', files[0].f), 'utf8').slice(0, 20000);
      snapshotId = Number(files[0].f.split('.')[0]) || null;
      if (/^audit:\s+passed/m.test(summary)) audit = 'passed'; else if (/^audit:\s+FAILED/m.test(summary)) audit = 'failed';
    }
  } catch { /* no runs dir */ }
  if (!snapshotId && Number.isInteger(job.options?.snapshot)) snapshotId = job.options.snapshot;
  const failed = code !== 0 || /^failed:\s+(?!\(none\))/m.test(summary);
  const { error } = await sb.from('harvest_jobs').update({
    status: failed ? 'failed' : 'done', finished_at: new Date().toISOString(), snapshot_id: snapshotId, summary: summary || null, audit_status: audit,
    progress: failed ? 'finished with failures' : 'finished', error: failed ? `harvest.sh exited ${code}${summary ? ' — see summary' : ''}` : null,
  }).eq('id', job.id);
  if (error) log(`finish update failed: ${error.message}`);
  log(`job ${job.id}: ${failed ? 'FAILED' : 'done'} · snapshot ${snapshotId ?? '?'} · audit ${audit}`);
}

process.on('unhandledRejection', e => log(`unhandled rejection: ${(e as any)?.message || e}`));
process.on('uncaughtException', e => { log(`uncaught exception: ${e?.message || e}`); });

// A job left 'running' by this host is orphaned: the worker died (or was restarted) mid-run
// and the child went with it. Say so on the row rather than leaving it "running" forever.
async function reapOrphans() {
  const { data } = await sb.from('harvest_jobs').select('id, progress').eq('status', 'running').eq('claimed_by', HOST);
  for (const j of data || []) {
    await sb.from('harvest_jobs').update({ status: 'failed', finished_at: new Date().toISOString(), error: `worker on ${HOST} restarted while this job was running (last step: ${j.progress || '?'}) — re-queue it` }).eq('id', j.id);
    log(`reaped orphaned job ${j.id}`);
  }
}

(async () => {
  log(`queue worker on ${HOST} · commit ${commit()} · polling every ${POLL_MS / 1000}s${ONCE ? ' · once' : ''}`);
  await reapOrphans();
  for (;;) {
    await heartbeat(null);
    const job = await claim();
    if (job) {
      await heartbeat(job.id, 'starting');
      const { code } = await runJob(job);
      await finish(job, code);
      await heartbeat(null);
      if (ONCE) break;
      continue;   // look for the next job immediately
    }
    if (ONCE) { log('no queued job'); break; }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  process.exit(0);
})().catch(e => { console.error('worker crashed:', e?.message || e); process.exit(1); });
