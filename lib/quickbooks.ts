/**
 * QuickBooks Online OAuth 2.0 + API client
 * Handles two QB companies: Legal Edge, LLC + RockPoint Law, P.C.
 */

import { createClient } from '@supabase/supabase-js'

// ─── Constants ────────────────────────────────────────────────────────────────

const QB_AUTH_URL     = 'https://appcenter.intuit.com/connect/oauth2'
const QB_TOKEN_URL    = 'https://oauth.platform.intuit.com/op/v2/tokens'
const QB_BASE_URL     = 'https://quickbooks.api.intuit.com/v3/company'
const QB_MINOR_VER    = '65'
const QB_SCOPES       = 'com.intuit.quickbooks.accounting'

function getQBCredentials() {
  const clientId     = process.env.EL_QUICKBOOKS_CLIENT_ID
  const clientSecret = process.env.EL_QUICKBOOKS_CLIENT_SECRET
  const redirectUri  = process.env.QUICKBOOKS_REDIRECT_URI || 'https://team.easylemon.com/api/integrations/quickbooks/callback'
  if (!clientId || !clientSecret) {
    throw new Error('Missing QuickBooks credentials: EL_QUICKBOOKS_CLIENT_ID and EL_QUICKBOOKS_CLIENT_SECRET required')
  }
  return { clientId, clientSecret, redirectUri }
}

function getFinanceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('finance')
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QBTokens {
  accessToken:     string
  refreshToken:    string
  expiresIn:       number   // seconds
  realmId:         string
}

export interface QBAccount {
  id:                   string
  name:                 string
  accountType:          string
  accountSubType:       string
  classification:       string
  parentRef?:           { value: string; name: string }
  fullyQualifiedName:   string
  active:               boolean
}

export interface QBTransactionLine {
  lineNum:            number
  accountId:          string
  accountName:        string
  fullyQualifiedName: string
  expenseGroup:       string
  description:        string
  amount:             number
}

// ─── OAuth helpers ────────────────────────────────────────────────────────────

/**
 * Build the QuickBooks OAuth authorization URL.
 * @param entitySlug  'legal-edge' or 'rockpoint'
 */
export function getAuthUrl(entitySlug: string): string {
  const { clientId, redirectUri } = getQBCredentials()
  const state = Buffer.from(entitySlug).toString('base64')
  const params = new URLSearchParams({
    client_id:     clientId,
    scope:         QB_SCOPES,
    redirect_uri:  redirectUri,
    response_type: 'code',
    access_type:   'offline',
    state,
  })
  return `${QB_AUTH_URL}?${params.toString()}`
}

/**
 * Exchange authorization code for access + refresh tokens.
 */
export async function exchangeCode(code: string, realmId: string): Promise<QBTokens> {
  const { clientId, clientSecret, redirectUri } = getQBCredentials()
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(QB_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`QB token exchange failed (${res.status}): ${err}`)
  }

  const data = await res.json()
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
    realmId,
  }
}

/**
 * Refresh an expired access token.
 */
export async function refreshTokens(refreshToken: string, realmId: string): Promise<QBTokens> {
  const { clientId, clientSecret } = getQBCredentials()
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const res = await fetch(QB_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      'Accept':        'application/json',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`QB token refresh failed (${res.status}): ${err}`)
  }

  const data = await res.json()
  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn:    data.expires_in,
    realmId,
  }
}

/**
 * Get fresh tokens for an entity — auto-refreshes if expired.
 * Returns { accessToken, realmId }
 */
export async function getTokensForEntity(entityId: string): Promise<{ accessToken: string; realmId: string }> {
  const db = getFinanceDb()
  const { data: entity, error } = await db
    .from('qb_entities')
    .select('realm_id, access_token, refresh_token, token_expires_at, entity_name, connected')
    .eq('id', entityId)
    .single()

  if (error || !entity) throw new Error(`Entity not found: ${entityId}`)
  if (!entity.connected || !entity.access_token) throw new Error(`Entity not connected: ${entity.entity_name}`)

  // Check if token needs refresh (refresh if within 5 min of expiry)
  const expiresAt = entity.token_expires_at ? new Date(entity.token_expires_at) : null
  const needsRefresh = !expiresAt || expiresAt.getTime() - Date.now() < 5 * 60 * 1000

  if (needsRefresh && entity.refresh_token) {
    const tokens = await refreshTokens(entity.refresh_token, entity.realm_id!)
    const newExpiry = new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
    await db.from('qb_entities').update({
      access_token:     tokens.accessToken,
      refresh_token:    tokens.refreshToken,
      token_expires_at: newExpiry,
      updated_at:       new Date().toISOString(),
    }).eq('id', entityId)
    return { accessToken: tokens.accessToken, realmId: entity.realm_id! }
  }

  return { accessToken: entity.access_token!, realmId: entity.realm_id! }
}

// ─── QB API queries ───────────────────────────────────────────────────────────

async function qbQuery(accessToken: string, realmId: string, sql: string): Promise<any> {
  const url = `${QB_BASE_URL}/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=${QB_MINOR_VER}`
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/json',
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`QB query failed (${res.status}): ${err}`)
  }
  return res.json()
}

/**
 * Fetch all active accounts from QB Chart of Accounts.
 */
export async function fetchAccounts(accessToken: string, realmId: string): Promise<QBAccount[]> {
  const results: QBAccount[] = []
  let startPos = 1
  const pageSize = 1000

  while (true) {
    const sql = `SELECT * FROM Account WHERE Active = true STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`
    const data = await qbQuery(accessToken, realmId, sql)
    const accounts = data?.QueryResponse?.Account || []
    if (accounts.length === 0) break

    for (const a of accounts) {
      results.push({
        id:                 a.Id,
        name:               a.Name,
        accountType:        a.AccountType,
        accountSubType:     a.AccountSubType,
        classification:     a.Classification,
        parentRef:          a.ParentRef,
        fullyQualifiedName: a.FullyQualifiedName,
        active:             a.Active !== false,
      })
    }

    if (accounts.length < pageSize) break
    startPos += pageSize
  }

  return results
}

/**
 * Extract top-level expense group from a fully qualified account name.
 * 'Advertising & Marketing:PPC - Google' → 'Advertising & Marketing'
 */
export function extractExpenseGroup(fullyQualifiedName: string, accountName: string): string {
  if (!fullyQualifiedName) return accountName
  return fullyQualifiedName.split(':')[0]
}

/**
 * Fetch all transactions of a given type within a date range.
 */
async function fetchTransactionType(
  accessToken: string,
  realmId: string,
  type: 'Purchase' | 'Bill' | 'Invoice' | 'JournalEntry',
  startDate: string,
  endDate: string
): Promise<any[]> {
  const results: any[] = []
  let startPos = 1
  const pageSize = 1000

  while (true) {
    const sql = `SELECT * FROM ${type} WHERE TxnDate >= '${startDate}' AND TxnDate <= '${endDate}' STARTPOSITION ${startPos} MAXRESULTS ${pageSize}`
    try {
      const data = await qbQuery(accessToken, realmId, sql)
      const items = data?.QueryResponse?.[type] || []
      results.push(...items)
      if (items.length < pageSize) break
      startPos += pageSize
    } catch (err) {
      console.warn(`QB fetch ${type} warning:`, err)
      break
    }
  }

  return results
}

/**
 * Extract line items from a QB transaction object.
 * Handles Purchase, Bill, Invoice line detail types.
 */
function extractLineItems(txn: any, txnType: string, accountMap: Map<string, QBAccount>): QBTransactionLine[] {
  const lines: QBTransactionLine[] = []
  const rawLines: any[] = txn.Line || []

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]

    // Determine account ref based on transaction type
    let accountRef: { value: string; name: string } | null = null
    let description = line.Description || ''
    let amount = line.Amount || 0

    if (txnType === 'Purchase' || txnType === 'Bill') {
      const detail = line.AccountBasedExpenseLineDetail
      if (detail?.AccountRef) accountRef = detail.AccountRef
    } else if (txnType === 'Invoice') {
      const detail = line.SalesItemLineDetail
      if (detail?.ItemRef) {
        // For invoices, use the item account; skip if no account info
        accountRef = { value: detail.ItemRef.value, name: detail.ItemRef.name || '' }
      }
    } else if (txnType === 'JournalEntry') {
      const detail = line.JournalEntryLineDetail
      if (detail?.AccountRef) accountRef = detail.AccountRef
      if (detail?.PostingType === 'Credit') amount = -Math.abs(amount)
    }

    if (!accountRef || !accountRef.value) continue

    // Look up full account details from our account map
    const account = accountMap.get(accountRef.value)
    const fullyQualifiedName = account?.fullyQualifiedName || accountRef.name || ''
    const expenseGroup = extractExpenseGroup(fullyQualifiedName, accountRef.name || '')

    lines.push({
      lineNum:            i + 1,
      accountId:          accountRef.value,
      accountName:        accountRef.name || '',
      fullyQualifiedName,
      expenseGroup,
      description,
      amount,
    })
  }

  return lines
}

export interface SyncResult {
  accountsSynced:      number
  transactionsSynced:  number
  lineItemsSynced:     number
}

/**
 * Full sync: accounts + transactions for a date range.
 * Upserts everything into Supabase finance schema.
 */
export async function syncEntity(
  entityId: string,
  startDate: string,
  endDate: string
): Promise<SyncResult> {
  const db = getFinanceDb()
  const { accessToken, realmId } = await getTokensForEntity(entityId)

  // Get entity info
  const { data: entity } = await db.from('qb_entities').select('entity_name').eq('id', entityId).single()
  const entityName = entity?.entity_name || ''

  // Update sync state to running
  await db.from('qb_sync_state').upsert({
    entity_id:   entityId,
    status:      'running',
    started_at:  new Date().toISOString(),
    sync_type:   'full',
  }, { onConflict: 'entity_id' })

  let accountsSynced = 0
  let transactionsSynced = 0
  let lineItemsSynced = 0

  try {
    // ── 1. Sync accounts ─────────────────────────────────────────────────────
    const accounts = await fetchAccounts(accessToken, realmId)
    accountsSynced = accounts.length

    const accountRows = accounts.map(a => ({
      entity_id:            entityId,
      qb_account_id:        a.id,
      name:                 a.name,
      account_type:         a.accountType,
      account_sub_type:     a.accountSubType,
      classification:       a.classification,
      parent_ref_value:     a.parentRef?.value || null,
      fully_qualified_name: a.fullyQualifiedName,
      active:               a.active,
      synced_at:            new Date().toISOString(),
    }))

    if (accountRows.length > 0) {
      await db.from('qb_accounts').upsert(accountRows, { onConflict: 'entity_id,qb_account_id' })
    }

    // Build account map for quick lookup
    const accountMap = new Map<string, QBAccount>(accounts.map(a => [a.id, a]))

    // ── 2. Sync transactions ─────────────────────────────────────────────────
    const txnTypes: Array<'Purchase' | 'Bill' | 'Invoice' | 'JournalEntry'> = ['Purchase', 'Bill', 'Invoice', 'JournalEntry']

    for (const txnType of txnTypes) {
      const txns = await fetchTransactionType(accessToken, realmId, txnType, startDate, endDate)

      for (const txn of txns) {
        const txnDate = txn.TxnDate || txn.MetaData?.CreateTime?.split('T')[0]
        const vendorName  = txn.EntityRef?.name || txn.VendorRef?.name || null
        const customerName = txn.CustomerRef?.name || null

        // Upsert transaction header
        const { data: txnRow, error: txnError } = await db
          .from('qb_transactions')
          .upsert({
            entity_id:          entityId,
            qb_transaction_id:  txn.Id,
            transaction_type:   txnType,
            transaction_date:   txnDate,
            doc_number:         txn.DocNumber || null,
            vendor_name:        vendorName,
            customer_name:      customerName,
            memo:               txn.PrivateNote || txn.Memo || null,
            total_amount:       txn.TotalAmt || txn.Balance || 0,
            currency_code:      txn.CurrencyRef?.value || 'USD',
            synced_at:          new Date().toISOString(),
            raw_json:           txn,
          }, { onConflict: 'entity_id,qb_transaction_id,transaction_type' })
          .select('id')
          .single()

        if (txnError || !txnRow) {
          console.error(`Failed to upsert transaction ${txn.Id}:`, txnError)
          continue
        }

        transactionsSynced++

        // Extract and upsert line items
        const lineItems = extractLineItems(txn, txnType, accountMap)

        if (lineItems.length > 0) {
          // Delete existing lines for this transaction then re-insert
          await db.from('qb_transaction_lines').delete().eq('transaction_id', txnRow.id)

          const lineRows = lineItems.map(l => ({
            transaction_id:       txnRow.id,
            entity_id:            entityId,
            line_num:             l.lineNum,
            qb_account_id:        l.accountId,
            account_name:         l.accountName,
            account_type:         accountMap.get(l.accountId)?.accountType || null,
            fully_qualified_name: l.fullyQualifiedName,
            expense_group:        l.expenseGroup,
            description:          l.description,
            amount:               l.amount,
            transaction_date:     txnDate,
            entity_name:          entityName,
          }))

          await db.from('qb_transaction_lines').insert(lineRows)
          lineItemsSynced += lineRows.length
        }
      }
    }

    // Update sync state to completed
    await db.from('qb_sync_state').upsert({
      entity_id:       entityId,
      status:          'completed',
      last_synced_at:  new Date().toISOString(),
      records_synced:  transactionsSynced + lineItemsSynced,
      completed_at:    new Date().toISOString(),
    }, { onConflict: 'entity_id' })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.from('qb_sync_state').upsert({
      entity_id:      entityId,
      status:         'error',
      error_message:  msg,
      completed_at:   new Date().toISOString(),
    }, { onConflict: 'entity_id' })
    throw err
  }

  return { accountsSynced, transactionsSynced, lineItemsSynced }
}
