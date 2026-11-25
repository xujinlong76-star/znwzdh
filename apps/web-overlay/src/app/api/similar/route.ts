import { NextResponse, type NextRequest } from 'next/server'
import {
  getSimilarSuggestionsServer,
  getSiteSimilarInsightsServer,
  lookupSimilarSitesServer,
} from '@/lib/server/similar-fallback'
import type { HubSimilarQueryParams, HubSimilarScopeFilter, HubSimilarSortBy } from '@/lib/navhub-api'

function parseParams(sp: URLSearchParams): HubSimilarQueryParams {
  const limitRaw = Number(sp.get('limit'))
  const scopeRaw = sp.get('scope')
  const sortRaw = sp.get('sort')
  const scope: HubSimilarScopeFilter | undefined =
    scopeRaw === 'same-category' || scopeRaw === 'cross-category' ? scopeRaw : undefined
  const sort: HubSimilarSortBy | undefined =
    sortRaw === 'popularity' || sortRaw === 'latency' || sortRaw === 'tags' ? sortRaw : undefined
  return {
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(48, Math.trunc(limitRaw)) : undefined,
    scope,
    categoryId: sp.get('categoryId') || undefined,
    openSource: sp.get('openSource') === '1' || sp.get('openSource') === 'true',
    healthyOnly: sp.get('healthyOnly') === '1' || sp.get('healthyOnly') === 'true',
    excludeSameBrand: sp.get('excludeSameBrand') === '1' || sp.get('excludeSameBrand') === 'true',
    tag: sp.get('tag') || undefined,
    sort,
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const mode = sp.get('mode') ?? 'lookup'
  const params = parseParams(sp)

  if (mode === 'suggestions') {
    const data = await getSimilarSuggestionsServer(params.limit ?? 12)
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=300' },
    })
  }

  if (mode === 'insights') {
    const siteId = (sp.get('siteId') ?? '').trim()
    if (!siteId) {
      return NextResponse.json({ error: '缺少 siteId 参数' }, { status: 400 })
    }
    const report = await getSiteSimilarInsightsServer(siteId, params)
    if (!report) {
      return NextResponse.json({ error: '站点不存在' }, { status: 404 })
    }
    return NextResponse.json(report, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' },
    })
  }

  const q = (sp.get('q') ?? '').trim()
  if (!q) {
    return NextResponse.json({ error: '请输入要查询的网址、域名或站点名称' }, { status: 400 })
  }
  const report = await lookupSimilarSitesServer(q, params)
  if (!report) {
    return NextResponse.json({ error: '暂未找到相似站点' }, { status: 404 })
  }
  return NextResponse.json(report, {
    headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
  })
}
