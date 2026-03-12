// Aloware SMS Backfill Driver for Vercel Environment
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const FIXTURE     = resolve(__dirname, 'data/aloware-backfill.json');

const BACKFILL_IMPORT_TOKEN = process.env.BACKFILL_IMPORT_TOKEN;
const TARGET_URL  = process.env.BACKFILL_TARGET_URL ?? 'https://team.easylemon.com';
const ENDPOINT    = `${TARGET_URL}/api/webhooks/backfill-sms`;

// ── CLI argument parsing ────────────────────────────────────────────────────
// Supported flags:
//   --dry-run              Validate without writing to DB (max 100 rows)
//   --limit-rows=N         Process exactly N rows (e.g. --limit-rows=5 for staged validation)
//   --batch-size=N         Override batch size sent per API call (default: 20)
//
// Staged validation protocol: 5 → 20 → 100 → 1000 → full
// Always pass --limit-rows for controlled runs; omit only for full import.

function getArgValue(flag) {
  const arg = process.argv.find(a => a.startsWith(`${flag}=`));
  if (arg) return arg.split('=')[1];
  // Support legacy space-separated form: --flag N
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return null;
}

const DRY_RUN     = process.argv.includes('--dry-run');
const DRY_RUN_MAX = 100;

const limitRowsArg = getArgValue('--limit-rows');
const LIVE_LIMIT   = limitRowsArg ? parseInt(limitRowsArg, 10) : Infinity;

const batchSizeArg = getArgValue('--batch-size');
// Auto-cap batch size to row limit for small validation runs
const DEFAULT_BATCH = 20;
const BATCH_SIZE    = batchSizeArg
  ? parseInt(batchSizeArg, 10)
  : (LIVE_LIMIT < DEFAULT_BATCH ? LIVE_LIMIT : DEFAULT_BATCH);

if (limitRowsArg) {
  console.log(`[config] Row limit: ${LIVE_LIMIT} rows (staged validation mode)`);
} else {
  console.log('[config] Row limit: NONE (full import mode)');
}
console.log(`[config] Batch size: ${BATCH_SIZE}`);

if (!BACKFILL_IMPORT_TOKEN) {
  console.error('Error: BACKFILL_IMPORT_TOKEN env var is required');
  process.exit(1);
} else {
  console.log('BACKFILL_IMPORT_TOKEN successfully loaded.');
}

// Define decision for whether to use node-fetch or native fetch (Node 18+ has native fetch)
const useNativeFetch = (version => parseInt(version.split('.')[0]) >= 18)(process.versions.node);

async function postBatch(records, dryRun = false) {
  console.log(`Sending batch of ${records.length} records to ${ENDPOINT}. Dry run: ${dryRun}`);
  console.log('Request body sample:', JSON.stringify({ records: records.slice(0, 1), dryRun })); // Log a sample of the body

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BACKFILL_IMPORT_TOKEN}`,
    },
    body: JSON.stringify({ records, dryRun }),
  });

  const responseText = await res.text();
  console.log(`HTTP Response Status: ${res.status}`);
  console.log(`HTTP Response Body: ${responseText}`);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${responseText}`);
  }

  return JSON.parse(responseText);
}

async function runImport() {
    const records = JSON.parse(readFileSync(FIXTURE, 'utf8')); // records variable loaded here

    const startTime = new Date();
    console.log(`Import started at: ${startTime.toISOString()}`);

    let totalInserted = 0;
    let totalSkipped = 0;
    let totalNeedsReview = 0;
    let totalErrors = [];
    let lastSuccessfulWriteTimestamp = null;

    const recordsToProcess = DRY_RUN ? records.slice(0, DRY_RUN_MAX) : records.slice(0, LIVE_LIMIT);

    if (recordsToProcess.length === 0) {
        console.log('No records to process. Exiting.');
        return;
    }

    console.log(`Processing ${recordsToProcess.length} records in batches of ${BATCH_SIZE}.`);

    for (let i = 0; i < recordsToProcess.length; i += BATCH_SIZE) {
        const batch = recordsToProcess.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(recordsToProcess.length / BATCH_SIZE)} with ${batch.length} records.`);
        try {
            const result = await postBatch(batch, DRY_RUN);
            totalInserted += result.inserted || 0;
            totalSkipped += result.skipped || 0;
            totalNeedsReview += result.needs_review || 0;
            lastSuccessfulWriteTimestamp = new Date();
            console.log(`Batch processed. Inserted: ${result.inserted}, Skipped: ${result.skipped}, Needs Review: ${result.needs_review}`);
        } catch (error) {
            console.error(`Error processing batch: ${error.message}`);
            totalErrors.push(error.message);
            // Decide how to handle batch errors: skip, retry, etc. For now, we'll just log and continue.
        }
    }

    const finishTime = new Date();
    const totalRuntimeMs = finishTime.getTime() - startTime.getTime();
    console.log(`Import finished at: ${finishTime.toISOString()}`);
    console.log(`Total runtime: ${totalRuntimeMs / 1000} seconds`);
    console.log(`Total records processed (attempted): ${recordsToProcess.length}`);
    console.log(`Total inserted: ${totalInserted}`);
    console.log(`Total skipped: ${totalSkipped}`);
    console.log(`Total needing review: ${totalNeedsReview}`);
    console.log(`Total errors encountered: ${totalErrors.length}`);
    if (totalErrors.length > 0) {
        console.log('Errors:', totalErrors);
    }
    console.log(`Last successful write timestamp: ${lastSuccessfulWriteTimestamp ? lastSuccessfulWriteTimestamp.toISOString() : 'N/A'}`);

    // You might want to write these results to a report file as well
    const report = {
        startTime: startTime.toISOString(),
        finishTime: finishTime.toISOString(),
        totalRuntimeSeconds: totalRuntimeMs / 1000,
        processedRecords: recordsToProcess.length,
        inserted: totalInserted,
        skipped: totalSkipped,
        needsReview: totalNeedsReview,
        errors: totalErrors,
        dryRun: DRY_RUN,
        timestamp: new Date().toISOString()
    };
    writeFileSync(resolve(__dirname, `backfill-report-${Date.now()}.json`), JSON.stringify(report, null, 2));
    console.log('Report written to file.');
}

runImport().catch(err => {
    console.error('Fatal error during import process:', err);
    // writeFileSync(resolve(__dirname, `backfill-report-fatal-error-${Date.now()}.json`), JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
    process.exit(1);
});
