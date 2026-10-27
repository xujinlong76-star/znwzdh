const fs = require('fs')
const path = require('path')
const appWeb = path.join(process.cwd(), 'apps', 'web')

function authChunks(dist) {
  const dir = path.join(appWeb, dist, 'static', 'chunks')
  if (!fs.existsSync(dir)) return new Set()
  const out = new Set()
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js')) continue
    const p = path.join(dir, f)
    const st = fs.statSync(p)
    if (st.size < 50000) continue
    const fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(Math.min(st.size, 4 * 1024 * 1024))
    fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    if (buf.includes('authjs.session-token')) out.add('static/chunks/' + f)
  }
  return out
}

function routeChunks(dist, routeKey) {
  const rel = routeKey === '/page' ? '' : routeKey.slice(1, -'/page'.length)
  const manPath = path.join(appWeb, dist, 'server', 'app', rel, 'page_client-reference-manifest.js')
  if (!fs.existsSync(manPath)) return null
  const src = fs.readFileSync(manPath, 'utf8')
  const man = new Function(
    `${src}\nreturn globalThis.__RSC_MANIFEST && globalThis.__RSC_MANIFEST[${JSON.stringify(routeKey)}];`,
  )()
  const set = new Set()
  for (const info of Object.values(man?.clientModules ?? {})) {
    for (const c of info.chunks ?? []) set.add(c.replace(/^\/_next\//, ''))
  }
  return set
}

const routes = ['/page', '/videos/page', '/videos/player/page', '/admin/videos/[id]/items/page', '/hot/page', '/admin/page']
for (const dist of ['.next', '.next-uibuild3']) {
  const auth = authChunks(dist)
  console.log(`\n### ${dist}: auth chunks = ${[...auth].join(', ') || '(none)'}`)
  for (const r of routes) {
    const set = routeChunks(dist, r)
    if (!set) { console.log(`  ${r}: no manifest`); continue }
    const hit = [...set].filter((c) => auth.has(c))
    let bytes = 0
    for (const c of set) { try { bytes += fs.statSync(path.join(appWeb, dist, c)).size } catch {} }
    console.log(`  ${r}: ${(bytes / 1024).toFixed(0)} KB initial, auth=${hit.length ? 'YES' : 'no'}`)
  }
}
