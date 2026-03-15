import { NextResponse } from 'next/server'
import { getTeamSession, isAdmin } from '@/lib/session'
import { createClient } from '@supabase/supabase-js'

function getIntegrationDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ).schema('integration')
}

export async function GET() {
  const session = await getTeamSession()
  if (!session)          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

  const db = getIntegrationDb()

  const [
    { data: mappings },
    { data: dealProps },
    { data: contactProps },
    { data: syncLogs },
  ] = await Promise.all([
    db.from('hubspot_case_field_mapping').select('*').order('case_column'),
    db.from('hubspot_properties').select('property_name, label, field_type, is_custom').eq('object_type', 'deal').order('property_name'),
    db.from('hubspot_properties').select('property_name, label, field_type, is_custom').eq('object_type', 'contact').order('property_name'),
    db.from('hubspot_sync_log').select('*').order('started_at', { ascending: false }).limit(10),
  ])

  const mappedDealProps    = new Set((mappings ?? []).filter(m => m.hs_object_type === 'deal').map(m => m.hs_property))
  const mappedContactProps = new Set((mappings ?? []).filter(m => m.hs_object_type === 'contact').map(m => m.hs_property))

  return NextResponse.json({
    mappings:      mappings ?? [],
    dealProps:     dealProps ?? [],
    contactProps:  contactProps ?? [],
    syncLogs:      syncLogs ?? [],
    stats: {
      totalDealProps:        dealProps?.length ?? 0,
      totalContactProps:     contactProps?.length ?? 0,
      mappedFields:          mappings?.length ?? 0,
      unmappedDealProps:     (dealProps ?? []).filter(p => !mappedDealProps.has(p.property_name)).length,
      unmappedContactProps:  (contactProps ?? []).filter(p => !mappedContactProps.has(p.property_name)).length,
      lastPropertySync:      syncLogs?.find(l => l.sync_type === 'properties')?.completed_at ?? null,
      lastCaseSync:          syncLogs?.find(l => l.sync_type?.startsWith('cases'))?.completed_at ?? null,
    }
  })
}

// Trigger property sync
export async function POST() {
  const session = await getTeamSession()
  if (!session)          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isAdmin(session)) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

  const HUBSPOT_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
  if (!HUBSPOT_TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_ACCESS_TOKEN not configured' }, { status: 500 })
  }

  const db = getIntegrationDb()

  const { data: logEntry } = await db
    .from('hubspot_sync_log')
    .insert({ sync_type: 'properties', status: 'running' })
    .select('id')
    .single()

  const logId = logEntry?.id

  try {
    const [dealRes, contactRes] = await Promise.all([
      fetch('https://api.hubapi.com/crm/v3/properties/deals?archived=false', {
        headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }
      }).then(r => r.json()),
      fetch('https://api.hubapi.com/crm/v3/properties/contacts?archived=false', {
        headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` }
      }).then(r => r.json()),
    ])

    const toRow = (p: any, type: string) => ({
      object_type:    type,
      property_name:  p.name,
      label:          p.label,
      field_type:     p.type,
      group_name:     p.groupName,
      options:        (p.options ?? []).map((o: any) => ({ label: o.label, value: o.value })),
      is_custom:      !p.hubspotDefined,
      is_hidden:      p.hidden ?? false,
      last_synced_at: new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    })

    const allRows = [
      ...(dealRes.results ?? []).map((p: any) => toRow(p, 'deal')),
      ...(contactRes.results ?? []).map((p: any) => toRow(p, 'contact')),
    ]

    const chunkSize = 100
    for (let i = 0; i < allRows.length; i += chunkSize) {
      const { error } = await db
        .from('hubspot_properties')
        .upsert(allRows.slice(i, i + chunkSize), { onConflict: 'object_type,property_name', ignoreDuplicates: false })
      if (error) throw new Error(error.message)
    }

    if (logId) {
      await db.from('hubspot_sync_log').update({
        status: 'success',
        records_total: allRows.length,
        records_synced: allRows.length,
        completed_at: new Date().toISOString(),
        metadata: { deal_count: dealRes.results?.length, contact_count: contactRes.results?.length }
      }).eq('id', logId)
    }

    return NextResponse.json({ success: true, synced: allRows.length })
  } catch (err: any) {
    if (logId) {
      await db.from('hubspot_sync_log').update({
        status: 'error',
        error_message: err.message,
        completed_at: new Date().toISOString()
      }).eq('id', logId)
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
