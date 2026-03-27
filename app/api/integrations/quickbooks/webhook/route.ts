/**
 * POST /api/integrations/quickbooks/webhook
 * Receives real-time change notifications from QuickBooks.
 * 
 * When a transaction is created/updated in QB:
 * 1. QB sends a signed POST with the changed entity IDs + realmId
 * 2. We verify the signature using the Intuit verifier token
 * 3. We call QB's CDC (Change Data Capture) API to fetch the actual changes
 * 4. We upsert only the changed records into Supabase
 * 
 * Each Intuit app has its own verifier token:
 * - EL_QUICKBOOKS_WEBHOOK_VERIFIER  → Legal Edge app
 * - RPL_QUICKBOOKS_WEBHOOK_VERIFIER → RockPoint app
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac }                from 'crypto'
import { createClient }              from '@supabase/supabase-js'
import { getTokensForEntity, extractExpenseGroup } from '@/lib/quickbooks'

const QB_BASE_URL   = 'https://quickbooks.api.intuit.com/v3/company'
const QB_MINOR_VER  = '65'

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

// ── Signature verification ──────────────────────────────────────────────────

function verifySignature(payload: string, signature: string): boolean {
  const verifiers = [
    process.env.EL_QUICKBOOKS_WEBHOOK_VERIFIER,
    process.env.RPL_QUICKBOOKS_WEBHOOK_VERIFIER,
  ].filter(Boolean) as string[]

  if (verifiers.length === 0) {
    // No verifiers configured — skip verification in dev
    console.warn('QB webhook: no verifier tokens configured, skipping signature check')
    return true
  }

  for (const token of verifiers) {
    const computed = createHmac('sha256', token).update(payload).digest('base64')
    if (computed === signature) return true
  }

  return false
}

// ── CDC fetch — get changed transactions since a timestamp ──────────────────

async function fetchChangedTransactions(
  accessToken: string,
  realmId: string,
  changedSince: string
): Promise<{ type: string; id: string }[]> {
  const entities = 'Purchase,Bill,Invoice,JournalEntry'
  const url = `${QB_BASE_URL}/${realmId}/cdc?entities=${entities}&changedSince=${encodeURIComponent(changedSince)}&minorversion=${QB_MINOR_VER}`

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/json',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`QB CDC fetch failed (${res.status}): ${err}`)
  }

  const data = await res.json()
  const cdcResponse = data?.CDCResponse?.[0]?.QueryResponse || []

  const changed: { type: string; id: string }[] = []
  for (const qr of cdcResponse) {
    // Each QueryResponse entry is keyed by entity type
    for (const [entityType, records] of Object.entries(qr)) {
      if (!Array.isArray(records)) continue
      for (const record of records as any[]) {
        if (record.Id) changed.push({ type: entityType, id: record.Id })
      }
    }
  }

  return changed
}

// ── Fetch a single transaction by type + id ─────────────────────────────────

async function fetchTransaction(
  accessToken: string,
  realmId: string,
  type: string,
  id: string
): Promise<any | null> {
  const url = `${QB_BASE_URL}/${realmId}/${type.toLowerCase()}/${id}?minorversion=${QB_MINOR_VER}`
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const data = await res.json()
  // Response key matches the entity type
  return data?.[type] || null
}

// ── Upsert a single transaction + its line items ────────────────────────────

async function upsertTransaction(
  db: ReturnType<typeof getFinanceDb>,
  entityId: string,
  entityName: string,
  txn: any,
  txnType: string,
  accountMap: Map<string, string> // qb_account_id → fully_qualified_name
) {
  const txnDate    = txn.TxnDate
  const vendorName = txn.EntityRef?.name || txn.VendorRef?.name || null

  const { data: txnRow, error: txnErr } = await db
    .from('qb_transactions')
    .upsert({
      entity_id:         entityId,
      qb_transaction_id: txn.Id,
      transaction_type:  txnType,
      transaction_date:  txnDate,
      doc_number:        txn.DocNumber || null,
      vendor_name:       vendorName,
      customer_name:     txn.CustomerRef?.name || null,
      memo:              txn.PrivateNote || txn.Memo || null,
      total_amount:      txn.TotalAmt || 0,
      currency_code:     txn.CurrencyRef?.value || 'USD',
      synced_at:         new Date().toISOString(),
      raw_json:          txn,
    }, { onConflict: 'entity_id,qb_transaction_id,transaction_type' })
    .select('id')
    .single()

  if (txnErr || !txnRow) {
    console.error('QB webhook upsert transaction error:', txnErr)
    return
  }

  // Re-process line items
  await db.from('qb_transaction_lines').delete().eq('transaction_id', txnRow.id)

  const lines: any[] = txn.Line || []
  const lineRows = []

  for (let i = 0; i < lines.length; i++) {
    const line   = lines[i]
    let accountRef: { value: string; name: string } | null = null
    let amount = line.Amount || 0

    if (txnType === 'Purchase' || txnType === 'Bill') {
      const acctDetail = line.AccountBasedExpenseLineDetail
      if (acctDetail?.AccountRef) {
        accountRef = acctDetail.AccountRef
      } else {
        const itemDetail = line.ItemBasedExpenseLineDetail
        if (itemDetail?.AccountRef) accountRef = itemDetail.AccountRef
        else if (itemDetail?.ItemRef) accountRef = { value: itemDetail.ItemRef.value, name: itemDetail.ItemRef.name || '' }
      }
    } else if (txnType === 'JournalEntry') {
      const detail = line.JournalEntryLineDetail
      if (detail?.AccountRef) accountRef = detail.AccountRef
      if (detail?.PostingType === 'Credit') amount = -Math.abs(amount)
    } else if (txnType === 'Invoice') {
      const detail = line.SalesItemLineDetail
      if (detail?.ItemRef) accountRef = { value: detail.ItemRef.value, name: detail.ItemRef.name || '' }
    }

    if (!accountRef?.value) continue

    const fullyQualifiedName = accountMap.get(accountRef.value) || accountRef.name || ''
    const expenseGroup       = extractExpenseGroup(fullyQualifiedName, accountRef.name || '')

    lineRows.push({
      transaction_id:       txnRow.id,
      entity_id:            entityId,
      line_num:             i + 1,
      qb_account_id:        accountRef.value,
      account_name:         accountRef.name || '',
      fully_qualified_name: fullyQualifiedName,
      expense_group:        expenseGroup,
      description:          line.Description || '',
      amount,
      transaction_date:     txnDate,
      entity_name:          entityName,
    })
  }

  if (lineRows.length > 0) {
    await db.from('qb_transaction_lines').insert(lineRows)
  }
}

// ── Main webhook handler ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const payload   = await req.text()
  const signature = req.headers.get('intuit-signature') || ''

  // Verify signature
  if (!verifySignature(payload, signature)) {
    console.warn('QB webhook: invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: any
  try {
    body = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const notifications: any[] = body?.eventNotifications || []
  if (notifications.length === 0) {
    return NextResponse.json({ ok: true, message: 'No notifications' })
  }

  const db = getFinanceDb()

  for (const notification of notifications) {
    const realmId = notification.realmId
    if (!realmId) continue

    // Find our entity by realmId
    const { data: entity } = await db
      .from('qb_entities')
      .select('id, entity_name, entity_slug')
      .eq('realm_id', realmId)
      .eq('connected', true)
      .single()

    if (!entity) {
      console.warn(`QB webhook: no connected entity for realmId ${realmId}`)
      continue
    }

    const changedEntities: any[] = notification.dataChangeEvent?.entities || []
    if (changedEntities.length === 0) continue

    // Get fresh access token
    let accessToken: string
    try {
      const tokens = await getTokensForEntity(entity.id)
      accessToken = tokens.accessToken
    } catch (err) {
      console.error(`QB webhook: failed to get tokens for ${entity.entity_name}:`, err)
      continue
    }

    // Find earliest change timestamp for CDC
    const timestamps = changedEntities
      .map(e => e.lastUpdated)
      .filter(Boolean)
      .sort()
    const changedSince = timestamps[0] || new Date(Date.now() - 5 * 60 * 1000).toISOString()

    // Fetch account map for this entity
    const { data: accounts } = await db
      .from('qb_accounts')
      .select('qb_account_id, fully_qualified_name')
      .eq('entity_id', entity.id)

    const accountMap = new Map<string, string>(
      (accounts || []).map(a => [a.qb_account_id, a.fully_qualified_name || ''])
    )

    // Use CDC to get changed transactions
    try {
      const changed = await fetchChangedTransactions(accessToken, realmId, changedSince)

      for (const { type, id } of changed) {
        try {
          const txn = await fetchTransaction(accessToken, realmId, type, id)
          if (!txn) continue
          await upsertTransaction(db, entity.id, entity.entity_name, txn, type, accountMap)
        } catch (err) {
          console.error(`QB webhook: failed to upsert ${type} ${id}:`, err)
        }
      }

      console.log(`QB webhook: processed ${changed.length} changes for ${entity.entity_name}`)
    } catch (err) {
      console.error(`QB webhook CDC error for ${entity.entity_name}:`, err)
    }
  }

  // QB requires 200 response quickly
  return NextResponse.json({ ok: true })
}
