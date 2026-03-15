/**
 * Aloware SMS Historical Backfill
 * 
 * Imports 65,535 historical SMS messages from Excel export into core.communications
 * 
 * Usage:
 *   # Dry run (first 100 rows, no DB writes):
 *   node scripts/backfill-aloware-sms.mjs --dry-run --file /path/to/export.xlsx
 * 
 *   # Full import:
 *   node scripts/backfill-aloware-sms.mjs --file /path/to/export.xlsx
 * 
 *   # Resume from a specific row (1-indexed, after header):
 *   node scripts/backfill-aloware-sms.mjs --file /path/to/export.xlsx --start-row 5001
 * 
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE    = 500
const SOURCE_SYSTEM = 'aloware_backfill'
const EL_MAIN_LINE  = '+18554353666'  // Easy Lemon main line

// Parse CLI args
const args = process.argv.slice(2)
const DRY_RUN     = args.includes('--dry-run')
const FILE_ARG    = args[args.indexOf('--file') + 1]
const START_ROW   = args.includes('--start-row') ? parseInt(args[args.indexOf('--start-row') + 1]) : 1
const LIMIT_ROWS  = DRY_RUN ? 100 : Infinity  // dry run = 100 rows max

if (!FILE_ARG) {
  console.error('Error: --file <path> is required')
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const FILE_PATH = resolve(FILE_ARG)
if (!existsSync(FILE_PATH)) {
  console.error(`Error: File not found: ${FILE_PATH}`)
  process.exit(1)
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const coreDb   = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'core' }
})

// ── Phone normalization ────────────────────────────────────────────────────────
/**
 * Normalize phone to E.164 format (+1XXXXXXXXXX for US numbers)
 * Aloware exports numbers as floats: 19178170436.0 → "+19178170436"
 */
function normalizePhone(raw) {
  if (!raw && raw !== 0) return null
  
  // Convert float to string, strip decimal
  let digits = String(raw).replace(/\.0$/, '').replace(/\D/g, '')
  
  if (!digits) return null
  
  // Already has country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }
  
  // 10 digit US number — add +1
  if (digits.length === 10) {
    return `+1${digits}`
  }
  
  // International or other — add + prefix
  if (digits.length > 10) {
    return `+${digits}`
  }
  
  return null
}

// ── Idempotency hash ──────────────────────────────────────────────────────────
/**
 * Deterministic hash for dedup: sha256(phone + body + timestamp)
 */
function makeImportHash(phone, body, occurredAt) {
  const key = `${phone}|${body ?? ''}|${occurredAt}`
  return createHash('sha256').update(key).digest('hex')
}

// ── Date parsing ──────────────────────────────────────────────────────────────
/**
 * Excel dates come as JS Date objects from xlsx library
 * Aloware export is in UTC
 */
function parseDate(raw) {
  if (!raw) return null
  if (raw instanceof Date) return raw.toISOString()
  if (typeof raw === 'string') {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  // Excel serial number
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (d) return new Date(d.y, d.m - 1, d.d, d.H, d.M, d.S).toISOString()
  }
  return null
}

// ── Load all existing hashes for dedup ────────────────────────────────────────
async function loadExistingHashes() {
  console.log('Loading existing backfill hashes for dedup check...')
  
  const { data, error } = await coreDb
    .from('communications')
    .select('raw_metadata')
    .eq('source_system', SOURCE_SYSTEM)
  
  if (error) {
    console.error('Warning: Could not load existing hashes:', error.message)
    return new Set()
  }
  
  const hashes = new Set()
  for (const row of data ?? []) {
    const h = row.raw_metadata?.import_hash
    if (h) hashes.add(h)
  }
  
  console.log(`Found ${hashes.size} existing backfill records (will skip duplicates)`)
  return hashes
}

// ── Load case contacts for phone matching ─────────────────────────────────────
async function loadCaseContacts() {
  console.log('Loading case contacts for phone matching...')
  
  const { data, error } = await coreDb
    .from('case_contacts')
    .select('case_id, phone, is_primary')
  
  if (error) {
    console.error('Fatal: Could not load case_contacts:', error.message)
    process.exit(1)
  }
  
  // Build phone → [case_id, ...] map
  const phoneMap = {}
  for (const contact of data ?? []) {
    if (!contact.phone) continue
    const normalized = normalizePhone(contact.phone) ?? contact.phone
    if (!phoneMap[normalized]) phoneMap[normalized] = []
    if (!phoneMap[normalized].includes(contact.case_id)) {
      phoneMap[normalized].push(contact.case_id)
    }
  }
  
  const uniquePhones = Object.keys(phoneMap).length
  const totalContacts = data?.length ?? 0
  console.log(`Loaded ${totalContacts} contacts → ${uniquePhones} unique phone numbers`)
  
  return phoneMap
}

// ── Resolve case from phone ───────────────────────────────────────────────────
function resolveCase(phoneMap, contactPhone) {
  if (!contactPhone) return { caseId: null, needsReview: true, reviewReason: 'no_contact_phone' }
  
  const normalized = normalizePhone(contactPhone)
  if (!normalized) return { caseId: null, needsReview: true, reviewReason: 'invalid_phone' }
  
  const matches = phoneMap[normalized] ?? []
  
  if (matches.length === 0) {
    return { caseId: null, needsReview: true, reviewReason: 'no_case_for_phone' }
  }
  
  if (matches.length > 1) {
    return { caseId: null, needsReview: true, reviewReason: 'multiple_cases_for_phone' }
  }
  
  return { caseId: matches[0], needsReview: false, reviewReason: null }
}

// ── Transform Excel row → communications record ───────────────────────────────
function transformRow(row, headers, phoneMap) {
  // Column indices (verified against actual export)
  // [0]  Started At
  // [1]  Type
  // [2]  Direction
  // [3]  Disposition Status
  // [4]  Line Name
  // [5]  Incoming Number   ← EL phone line
  // [6]  Talk Time
  // [7]  Contact Number    ← client phone
  // [8]  Contact First Name
  // [9]  Contact Last Name
  // [10] Contact Owner
  // [11] User Name
  // [12] Tags
  // [13] Notes
  // [14] Body
  // [15] Call Disposition
  // [16] Voicemail
  // [17] Recording
  
  const startedAt      = row[0]
  const type           = String(row[1] ?? '').toLowerCase()
  const directionRaw   = String(row[2] ?? '').toLowerCase()
  const dispositionStatus = row[3]
  const lineName       = row[4]
  const incomingNumber = row[5]   // EL line
  const contactNumber  = row[7]   // client
  const firstName      = row[8]
  const lastName       = row[9]
  const contactOwner   = row[10]
  const userName       = row[11]
  const tags           = row[12]
  const notes          = row[13]
  const body           = row[14]

  // Only process SMS
  if (type !== 'sms') return null

  // Normalize direction
  let direction = 'outbound'
  if (['inbound', 'received', '1'].includes(directionRaw)) {
    direction = 'inbound'
  } else if (['outbound', 'sent', '2'].includes(directionRaw)) {
    direction = 'outbound'
  }

  // Normalize phones
  const elPhone      = normalizePhone(incomingNumber) ?? EL_MAIN_LINE
  const clientPhone  = normalizePhone(contactNumber)

  // from/to based on direction
  const fromNumber = direction === 'inbound' ? clientPhone : elPhone
  const toNumber   = direction === 'inbound' ? elPhone : clientPhone

  // Thread ID — group all messages for same contact phone
  const threadPhone  = clientPhone ?? String(contactNumber ?? '').replace(/\.0$/, '')
  const threadId     = `aloware:${threadPhone}`

  // Timestamp
  const occurredAt = parseDate(startedAt)

  // Body/snippet
  const bodyText    = body ? String(body) : null
  const snippet     = bodyText ? bodyText.substring(0, 500) : null

  // Idempotency hash
  const importHash  = makeImportHash(clientPhone ?? String(contactNumber), bodyText, occurredAt)

  // Case resolution
  const { caseId, needsReview, reviewReason } = resolveCase(phoneMap, contactNumber)

  // Raw metadata (full original row)
  const rawMetadata = {
    import_hash:        importHash,
    source_file:        'aloware-sms-export.xlsx',
    started_at:         occurredAt,
    type:               type,
    direction_raw:      directionRaw,
    disposition_status: dispositionStatus,
    line_name:          lineName,
    incoming_number:    incomingNumber,
    contact_number:     contactNumber,
    contact_first_name: firstName,
    contact_last_name:  lastName,
    contact_owner:      contactOwner,
    user_name:          userName,
    tags:               tags,
    notes:              notes,
  }

  return {
    // Case link
    case_id:          caseId,

    // Channel
    channel:          'sms',
    direction:        direction,

    // Content
    body:             bodyText,
    snippet:          snippet,

    // Timing
    occurred_at:      occurredAt,

    // Phone routing
    from_number:      fromNumber,
    to_number:        toNumber,

    // Thread grouping
    thread_id:        threadId,

    // Source
    source_system:    SOURCE_SYSTEM,

    // Review flags
    needs_review:     needsReview,
    review_reason:    reviewReason,

    // Full original row
    raw_metadata:     rawMetadata,
  }
}

// ── Insert batch ──────────────────────────────────────────────────────────────
async function insertBatch(records) {
  if (records.length === 0) return { inserted: 0, error: null }
  
  const { data, error } = await coreDb
    .from('communications')
    .insert(records)
    .select('id')
  
  if (error) return { inserted: 0, error }
  return { inserted: data?.length ?? records.length, error: null }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log(' Aloware SMS Historical Backfill')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`Mode:       ${DRY_RUN ? '🧪 DRY RUN (no DB writes, first 100 rows)' : '🚀 FULL IMPORT'}`)
  console.log(`File:       ${FILE_PATH}`)
  console.log(`Batch size: ${BATCH_SIZE}`)
  console.log(`Start row:  ${START_ROW}`)
  console.log('')

  // Load Excel
  console.log('Loading Excel file...')
  const workbook  = XLSX.readFile(FILE_PATH, { type: 'file', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  const sheet     = workbook.Sheets[sheetName]
  const allRows   = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm:ss' })
  
  const headers   = allRows[0]
  const dataRows  = allRows.slice(1)  // skip header
  
  console.log(`Total rows in file: ${dataRows.length}`)
  console.log(`Headers: ${headers.join(', ')}`)
  console.log('')

  // Load lookup data from DB (skip in dry run if no DB creds)
  let existingHashes = new Set()
  let phoneMap       = {}
  
  if (!DRY_RUN) {
    existingHashes = await loadExistingHashes()
    phoneMap       = await loadCaseContacts()
  } else {
    console.log('DRY RUN: Skipping DB lookups, using empty phone map')
    phoneMap = {}
  }
  
  console.log('')

  // Stats
  const stats = {
    rows_processed:        0,
    rows_skipped_type:     0,    // non-SMS rows
    rows_skipped_dup:      0,    // duplicate hash
    rows_inserted:         0,
    rows_failed:           0,
    rows_needing_review:   0,
    cases_linked:          0,
    batch_errors:          [],
  }

  // Process rows in batches
  let batch         = []
  let batchNum      = 0
  const startIdx    = Math.max(0, START_ROW - 1)  // 0-indexed
  const endIdx      = DRY_RUN ? Math.min(startIdx + LIMIT_ROWS, dataRows.length) : dataRows.length

  console.log(`Processing rows ${startIdx + 1} to ${endIdx}...`)
  console.log('')

  for (let i = startIdx; i < endIdx; i++) {
    const row = dataRows[i]
    stats.rows_processed++

    // Transform
    const record = transformRow(row, headers, phoneMap)
    
    // Skip non-SMS
    if (!record) {
      stats.rows_skipped_type++
      continue
    }

    // Dedup check
    const importHash = record.raw_metadata?.import_hash
    if (importHash && existingHashes.has(importHash)) {
      stats.rows_skipped_dup++
      continue
    }
    
    // Track hash to avoid dupes within this run
    if (importHash) existingHashes.add(importHash)

    // Track stats
    if (record.needs_review) stats.rows_needing_review++
    if (record.case_id)      stats.cases_linked++

    batch.push(record)

    // Flush batch
    if (batch.length >= BATCH_SIZE) {
      batchNum++
      const batchLabel = `Batch ${batchNum} (rows ~${i - batch.length + 2}–${i + 1})`
      
      if (DRY_RUN) {
        console.log(`[DRY RUN] ${batchLabel}: would insert ${batch.length} records`)
        // Show sample record
        if (batchNum === 1) {
          console.log('\nSample record (first row):')
          const sample = { ...batch[0] }
          sample.raw_metadata = { ...sample.raw_metadata, body_preview: sample.body?.substring(0, 80) }
          console.log(JSON.stringify(sample, null, 2))
          console.log('')
        }
      } else {
        process.stdout.write(`${batchLabel}: inserting... `)
        const { inserted, error } = await insertBatch(batch)
        if (error) {
          console.error(`FAILED: ${error.message}`)
          stats.batch_errors.push({ batch: batchNum, error: error.message })
          stats.rows_failed += batch.length
        } else {
          console.log(`✓ inserted ${inserted}`)
          stats.rows_inserted += inserted
        }
      }
      
      batch = []
    }

    // Progress log every 5000 rows
    if (stats.rows_processed % 5000 === 0) {
      console.log(`  → Progress: ${stats.rows_processed} rows processed, ${stats.rows_inserted} inserted, ${stats.rows_skipped_dup} skipped (dups), ${stats.rows_needing_review} need review`)
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    batchNum++
    const batchLabel = `Batch ${batchNum} (final, ${batch.length} records)`
    
    if (DRY_RUN) {
      console.log(`[DRY RUN] ${batchLabel}: would insert ${batch.length} records`)
    } else {
      process.stdout.write(`${batchLabel}: inserting... `)
      const { inserted, error } = await insertBatch(batch)
      if (error) {
        console.error(`FAILED: ${error.message}`)
        stats.batch_errors.push({ batch: batchNum, error: error.message })
        stats.rows_failed += batch.length
      } else {
        console.log(`✓ inserted ${inserted}`)
        stats.rows_inserted += inserted
      }
    }
  }

  // ── Final Report ─────────────────────────────────────────────────────────────
  console.log('')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(' Import Complete — Summary Report')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`Total rows processed:      ${stats.rows_processed}`)
  console.log(`SMS records evaluated:     ${stats.rows_processed - stats.rows_skipped_type}`)
  console.log(`Skipped (non-SMS):         ${stats.rows_skipped_type}`)
  console.log(`Skipped (duplicates):      ${stats.rows_skipped_dup}`)
  console.log(`${DRY_RUN ? 'Would insert' : 'Inserted'}:                ${DRY_RUN ? (stats.rows_processed - stats.rows_skipped_type - stats.rows_skipped_dup) : stats.rows_inserted}`)
  console.log(`Failed:                    ${stats.rows_failed}`)
  console.log(`Needing review:            ${stats.rows_needing_review}`)
  console.log(`Linked to cases:           ${stats.cases_linked}`)
  
  if (stats.batch_errors.length > 0) {
    console.log(`\nBatch errors (${stats.batch_errors.length}):`)
    stats.batch_errors.forEach(e => console.log(`  Batch ${e.batch}: ${e.error}`))
  }

  // Save report to file
  const reportPath = `/home/ctobot/workspace/aloware-backfill-report-${Date.now()}.json`
  writeFileSync(reportPath, JSON.stringify({ ...stats, dry_run: DRY_RUN, timestamp: new Date().toISOString() }, null, 2))
  console.log(`\nFull report saved: ${reportPath}`)

  // SQL to verify
  console.log('\nVerification query:')
  console.log(`
  SELECT 
    COUNT(*)                                          AS total_imported,
    SUM(CASE WHEN case_id IS NOT NULL THEN 1 ELSE 0 END) AS linked_to_cases,
    SUM(CASE WHEN needs_review THEN 1 ELSE 0 END)   AS needs_review,
    SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
    SUM(CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END) AS outbound,
    MIN(occurred_at)                                  AS earliest_message,
    MAX(occurred_at)                                  AS latest_message
  FROM core.communications
  WHERE source_system = 'aloware_backfill';
  `)

  if (DRY_RUN) {
    console.log('\n✅ DRY RUN complete. Review the output above, then run without --dry-run for full import.')
  } else {
    console.log('\n✅ Import complete!')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
