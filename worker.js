import { createClient } from '@supabase/supabase-js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'trailer-cuts';
const pollMs = Number(process.env.POLL_INTERVAL_MS || 10000);
if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function fingerprintCut(cut) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'airwatch-'));
  try {
    const { data: blob, error: downloadError } = await supabase.storage.from(bucket).download(cut.storage_path);
    if (downloadError) throw downloadError;
    const inputPath = path.join(tempDir, 'reference.bin');
    await fs.writeFile(inputPath, Buffer.from(await blob.arrayBuffer()));
    const { stdout } = await execFileAsync('fpcalc', ['-json', inputPath], { maxBuffer: 10 * 1024 * 1024, timeout: 120000 });
    const result = JSON.parse(stdout);
    if (!result.Fingerprint || !result.Duration) throw new Error('fpcalc did not return a usable audio fingerprint. Confirm the upload contains decodable audio/video.');
    const fingerprint = {
      algorithm: 'chromaprint-fpcalc',
      version: 1,
      duration_seconds: Number(result.Duration),
      fingerprint: String(result.Fingerprint),
      extracted_at: new Date().toISOString()
    };
    const { error: updateError } = await supabase.from('cuts').update({
      fingerprint,
      fingerprint_status: 'ready',
      fingerprint_error: null,
      fingerprinted_at: new Date().toISOString()
    }).eq('id', cut.id);
    if (updateError) throw updateError;
    console.log(`Fingerprint ready for cut ${cut.id} (${fingerprint.duration_seconds}s)`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function processOne(cut) {
  const { error } = await supabase.from('cuts').update({ fingerprint_status: 'processing', fingerprint_error: null }).eq('id', cut.id);
  if (error) throw error;
  try {
    await fingerprintCut(cut);
  } catch (err) {
    const message = String(err?.message || err).slice(0, 1500);
    await supabase.from('cuts').update({ fingerprint_status: 'failed', fingerprint_error: message }).eq('id', cut.id);
    console.error(`Fingerprint failed for cut ${cut.id}: ${message}`);
  }
}

console.log(`AirWatch fingerprint worker started; bucket=${bucket}; poll=${pollMs}ms`);
while (true) {
  try {
    const { data: cuts, error } = await supabase.from('cuts')
      .select('id, storage_path, filename, content_type, fingerprint_status')
      .eq('fingerprint_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;
    if (cuts?.length) await processOne(cuts[0]);
  } catch (err) {
    console.error('Worker loop error:', err?.message || err);
  }
  await new Promise(resolve => setTimeout(resolve, pollMs));
}
