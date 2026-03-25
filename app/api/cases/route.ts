import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { FilterGroup, FilterCondition } from '@/lib/cases/column-defs'

// Stage → group mapping
const STAGE_GROUPS: Record<string, string> = {
  intake:              'active',
  nurture:             'active',
  document_collection: 'active',
  info_needed:         'active',
  sign_up:             'active',
  attorney_review:     'attorney_review',
  retained:            'retained',
  settled:             'settled',
  dropped:             'dropped',
}

// All stages per group
const GROUP_STAGES: Record<string, string[]> = {
  active:          ['intake','nurture','document_collection','info_needed','sign_up'],
  attorney_review: ['attorney_review'],
  retained:        ['retained'],
  settled:         ['settled'],
  dropped:         ['dropped'],
}

const STAGE_KEYS = ['intake','nurture','document_collection','attorney_review','info_needed','sign_up','retained','settled','dropped']

// Whitelist for sortable core columns
const SORT_COLS: Record<string, string> = {
  notes_last_updated: 'notes_last_updated',
  created_at:         'created_at',
  updated_at:         'updated_at',
  client_first_name:  'client_first_name',
  case_status:        'case_status',
  estimated_value:    'estimated_value',
  vehicle_make:       'vehicle_make',
  case_number:        'case_number',
  state_jurisdiction: 'state_jurisdiction',
}

// ── Apply a single FilterCondition to the Supabase query ─────────────────────
// For hp.* fields we use hubspot_properties->>'field' via a raw filter.
// For core fields we use the PostgREST column filter helpers.
function applyCondition(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  cond: FilterCondition,
) {
  const { field, operator, value } = cond
  const isHp = field.startsWith('hp.')
  const hpKey = isHp ? field.slice(3) : null

  if (isHp && hpKey) {
    // Use raw PostgREST filter syntax for JSONB
    const jsonRef = `hubspot_properties->>'${hpKey}'`
    switch (operator) {
      case 'is':
        return query.filter(jsonRef, 'eq', value)
      case 'is_not':
        return query.filter(jsonRef, 'neq', value)
      case 'contains':
        return query.filter(jsonRef, 'ilike', `%${value}%`)
      case 'not_contains':
        return query.filter(jsonRef, 'not.ilike', `%${value}%`)
      case 'is_any_of':
        return query.filter(jsonRef, 'in', `(${value.split(',').map((v: string) => v.trim()).join(',')})`)
      case 'is_none_of':
        return query.filter(jsonRef, 'not.in', `(${value.split(',').map((v: string) => v.trim()).join(',')})`)
      case 'is_known':
        return query.not(jsonRef, 'is', null)
      case 'is_unknown':
        return query.filter(jsonRef, 'is', null)
      case 'greater_than':
        return query.filter(jsonRef, 'gt', value)
      case 'less_than':
        return query.filter(jsonRef, 'lt', value)
      default:
        return query
    }
  }

  // Core column filters
  switch (operator) {
    case 'is':
      return query.eq(field, value)
    case 'is_not':
      return query.neq(field, value)
    case 'contains':
      return query.ilike(field, `%${value}%`)
    case 'not_contains':
      return query.not(field, 'ilike', `%${value}%`)
    case 'is_any_of':
      return query.in(field, value.split(',').map((v: string) => v.trim()))
    case 'is_none_of':
      return query.not(field, 'in', `(${value.split(',').map((v: string) => v.trim()).join(',')})`)
    case 'is_known':
      return query.not(field, 'is', null)
    case 'is_unknown':
      return query.is(field, null)
    case 'greater_than':
      return query.gt(field, value)
    case 'less_than':
      return query.lt(field, value)
    default:
      return query
  }
}

// Apply a list of FilterGroups — each group is AND'd together, conditions within a group follow group.logic
function applyFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  filterGroups: FilterGroup[],
  db: SupabaseClient,
): // eslint-disable-next-line @typescript-eslint/no-explicit-any
any {
  // For simplicity (PostgREST doesn't support nested OR groups easily),
  // we apply AND between groups and within each group use the group logic.
  // For OR groups we use PostgREST .or() with multiple conditions.
  for (const group of filterGroups) {
    if (group.conditions.length === 0) continue

    if (group.logic === 'AND') {
      for (const cond of group.conditions) {
        query = applyCondition(query, cond)
      }
    } else {
      // OR group — build a PostgREST or() string for non-hp fields
      // HP fields with OR need special handling; we apply them individually
      const coreConds = group.conditions.filter(c => !c.field.startsWith('hp.'))
      const hpConds   = group.conditions.filter(c =>  c.field.startsWith('hp.'))

      // Core OR conditions
      if (coreConds.length > 0) {
        const orParts: string[] = []
        for (const cond of coreConds) {
          const { field, operator, value } = cond
          switch (operator) {
            case 'is':           orParts.push(`${field}.eq.${value}`);                    break
            case 'is_not':       orParts.push(`${field}.neq.${value}`);                   break
            case 'contains':     orParts.push(`${field}.ilike.%${value}%`);               break
            case 'not_contains': orParts.push(`${field}.not.ilike.%${value}%`);           break
            case 'is_any_of':    orParts.push(`${field}.in.(${value.split(',').map((v: string) => v.trim()).join(',')})`); break
            case 'is_known':     orParts.push(`${field}.not.is.null`);                    break
            case 'is_unknown':   orParts.push(`${field}.is.null`);                        break
            case 'greater_than': orParts.push(`${field}.gt.${value}`);                    break
            case 'less_than':    orParts.push(`${field}.lt.${value}`);                    break
          }
        }
        if (orParts.length > 0) {
          query = query.or(orParts.join(','))
        }
      }

      // HP OR conditions — apply individually (effectively AND'd, best effort)
      for (const cond of hpConds) {
        query = applyCondition(query, cond)
      }
    }
  }

  void db // suppress unused warning
  return query
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status      = searchParams.get('status')        // individual stage filter
  const group       = searchParams.get('group')         // group filter: active|retained|settled|dropped
  const search      = searchParams.get('search')
  const sortColRaw  = searchParams.get('sort')          ?? 'notes_last_updated'
  const sortAsc     = searchParams.get('dir')           === 'asc'
  const page        = parseInt(searchParams.get('page') ?? '1')
  const filtersRaw  = searchParams.get('filters')       // JSON string of FilterGroup[]
  const limit       = 25
  const offset      = (page - 1) * limit

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('core')

  const orderCol = SORT_COLS[sortColRaw] ?? 'notes_last_updated'

  // Parse optional filter groups
  let filterGroups: FilterGroup[] = []
  if (filtersRaw) {
    try {
      filterGroups = JSON.parse(filtersRaw) as FilterGroup[]
    } catch { /* ignore parse errors */ }
  }

  let query = db
    .from('cases')
    .select(
      'id, hubspot_deal_id, case_number, client_first_name, client_last_name, client_email, client_phone, ' +
      'vehicle_year, vehicle_make, vehicle_model, vehicle_mileage, vehicle_is_new, ' +
      'state_jurisdiction, case_status, case_priority, estimated_value, ' +
      'notes_last_updated, created_at, updated_at, hubspot_properties',
      { count: 'exact' }
    )
    .eq('is_deleted', false)
    .order(orderCol, { ascending: sortAsc, nullsFirst: false })
    .range(offset, offset + limit - 1)

  // Stage filter (individual stage takes priority over group)
  if (status) {
    query = query.eq('case_status', status)
  } else if (group && GROUP_STAGES[group]) {
    query = query.in('case_status', GROUP_STAGES[group])
  }

  if (search) {
    query = query.or(
      `client_first_name.ilike.%${search}%,client_last_name.ilike.%${search}%,client_email.ilike.%${search}%,vehicle_make.ilike.%${search}%,vehicle_model.ilike.%${search}%,hubspot_deal_id.eq.${search}`
    )
  }

  // Apply custom filter groups
  if (filterGroups.length > 0) {
    query = applyFilters(query, filterGroups, db as unknown as SupabaseClient)
  }

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Per-stage COUNT queries
  const stageCountResults = await Promise.all(
    STAGE_KEYS.map(s =>
      db.from('cases').select('*', { count: 'exact', head: true }).eq('case_status', s).eq('is_deleted', false)
    )
  )
  const stageCounts: Record<string, number> = {}
  STAGE_KEYS.forEach((s, i) => { stageCounts[s] = stageCountResults[i]?.count ?? 0 })

  // Group counts
  const groupCounts: Record<string, number> = { active: 0, attorney_review: 0, retained: 0, settled: 0, dropped: 0 }
  for (const [stage, cnt] of Object.entries(stageCounts)) {
    const g = STAGE_GROUPS[stage]
    if (g) groupCounts[g] = (groupCounts[g] ?? 0) + cnt
  }

  // Enrich cases with comms_state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[]
  const caseIds = rows.map((c) => c.id as string)
  const commsMap: Record<string, { sla_status: string; unread_count: number; awaiting_response: boolean; response_due_at: string | null }> = {}
  if (caseIds.length > 0) {
    const { data: commsRows } = await db
      .from('comms_state')
      .select('case_id, sla_status, unread_count, awaiting_response, response_due_at')
      .in('case_id', caseIds)
    for (const r of commsRows ?? []) {
      commsMap[r.case_id] = {
        sla_status:        r.sla_status,
        unread_count:      r.unread_count      ?? 0,
        awaiting_response: r.awaiting_response ?? false,
        response_due_at:   r.response_due_at   ?? null,
      }
    }
  }

  // Enrich cases with doc_state
  const docMap: Record<string, { total_docs: number; unclassified: number; needs_review: number; missing_required: number }> = {}
  if (caseIds.length > 0) {
    const { data: docRows } = await db
      .from('case_doc_summary')
      .select('case_id, total_docs, unclassified, needs_review, missing_required')
      .in('case_id', caseIds)
    for (const r of docRows ?? []) {
      docMap[r.case_id] = {
        total_docs:       r.total_docs       ?? 0,
        unclassified:     r.unclassified      ?? 0,
        needs_review:     r.needs_review      ?? 0,
        missing_required: r.missing_required  ?? 0,
      }
    }
  }

  const enrichedCases = rows.map((c) => ({
    ...c,
    comms_state: commsMap[c.id] ?? null,
    doc_state:   docMap[c.id]   ?? null,
  }))

  return NextResponse.json({
    cases: enrichedCases,
    total: count ?? 0,
    stageCounts,
    groupCounts,
    page,
    limit,
    sort: orderCol,
    dir:  sortAsc ? 'asc' : 'desc',
  })
}
