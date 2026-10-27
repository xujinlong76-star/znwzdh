import { API } from './lib.mjs'

async function j(path) {
  try {
    const r = await fetch(API + path, { headers: { accept: 'application/json' } })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

/** 组装本轮测试要覆盖的路由清单（含从接口取到的真实动态路由） */
export async function buildRoutes() {
  const staticRoutes = [
    '/', '/sites', '/category', '/tags', '/collections', '/hot', '/videos', '/graph',
    '/algorithms', '/marketplace', '/custom', '/preferences', '/submit', '/import',
    '/me', '/favorites', '/offline', '/auth/signin', '/404-probe-not-exist',
  ]
  const authed = [
    '/me', '/me/account', '/me/data', '/me/history', '/me/notifications', '/me/plugins',
    '/me/settings', '/me/vault', '/me/workspaces', '/favorites', '/marketplace/installed',
    '/marketplace/mine', '/marketplace/publish', '/marketplace/import',
  ]
  const admin = [
    '/admin', '/admin/ai', '/admin/audit', '/admin/categories', '/admin/collections',
    '/admin/facets', '/admin/jobs', '/admin/navigation', '/admin/plugin-health', '/admin/plugins',
    '/admin/resources', '/admin/site', '/admin/sitelist', '/admin/stats', '/admin/tags',
    '/admin/taxonomy', '/admin/tokens', '/admin/trash', '/admin/videos', '/admin/data/restore',
  ]

  const dyn = []
  const pick = (x) => (Array.isArray(x) ? x : x?.items || x?.sites || x?.data || [])
  const sites = await j('/api/sites?limit=4')
  for (const s of pick(sites).slice(0, 3)) if (s?.id) dyn.push(`/site/${s.id}`)
  const cats = await j('/api/categories')
  for (const c of pick(cats).slice(0, 3)) if (c?.slug) dyn.push(`/category/${c.slug}`, `/category/${c.slug}?p=2`)
  const tags = await j('/api/tags?limit=4')
  for (const t of pick(tags).slice(0, 2)) if (t?.slug || t?.name) dyn.push(`/tags/${encodeURIComponent(t.slug || t.name)}`)
  const col = await j('/api/collections?limit=4')
  for (const c of pick(col).slice(0, 2)) if (c?.slug) dyn.push(`/collections/${c.slug}`)
  const pl = await j('/api/plugins?limit=6')
  for (const p of pick(pl).slice(0, 3)) if (p?.slug) dyn.push(`/marketplace/${p.slug}`)

  return { staticRoutes, authed, admin, dyn: [...new Set(dyn)] }
}
