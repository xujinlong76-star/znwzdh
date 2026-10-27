const fs = require('fs')
const path = require('path')

const appWeb = path.join(process.cwd(), 'apps', 'web')

function routeChunks(dist, routeKey) {
  const rel = routeKey === '/page' ? '' : routeKey.slice(1, -'/page'.length)
  const manPath = path.join(appWeb, dist, 'server', 'app', rel, 'page_client-reference-manifest.js')
  const loadPath = path.join(appWeb, dist, 'server', 'app', rel, 'react-loadable-manifest.json')
  if (!fs.existsSync(manPath)) return null
  const src = fs.readFileSync(manPath, 'utf8')
  const factory = new Function(
    `${src}\nreturn globalThis.__RSC_MANIFEST && globalThis.__RSC_MANIFEST[${JSON.stringify(routeKey)}];`,
  )
  const man = factory()
  const asyncSet = new Set()
  if (fs.existsSync(loadPath)) {
    const j = JSON.parse(fs.readFileSync(loadPath, 'utf8'))
    for (const v of Object.values(j)) for (const f of v?.files ?? []) asyncSet.add(f.replace(/^\/_next\//, ''))
  }
  const out = new Map()
  for (const info of Object.values(man?.clientModules ?? {})) {
    if (info.async) continue
    for (const c of info.chunks ?? []) {
      const disk = c.replace(/^\/_next\//, '')
      if (asyncSet.has(disk)) continue
      try {
        out.set(disk, fs.statSync(path.join(appWeb, dist, disk)).size)
      } catch {
        out.set(disk, 0)
      }
    }
  }
  return out
}

const routes = process.argv.slice(2)
for (const route of routes) {
  const oldM = routeChunks('.next', route)
  const newM = routeChunks('.next-uibuild3', route)
  if (!oldM || !newM) {
    console.log(route, 'missing manifest', !!oldM, !!newM)
    continue
  }
  const added = []
  for (const [k, v] of newM) if (!oldM.has(k)) added.push([k, v])
  const removed = []
  for (const [k, v] of oldM) if (!newM.has(k)) removed.push([k, v])
  const sum = (a) => a.reduce((s, [, v]) => s + v, 0)
  console.log(`\n== ${route}`)
  console.log(`  old total ${sum([...oldM])} (${oldM.size} files) | new total ${sum([...newM])} (${newM.size} files)`)
  console.log(`  added ${added.length} files, +${sum(added)} B; removed ${removed.length}, -${sum(removed)} B`)
  added.sort((a, b) => b[1] - a[1])
  for (const [k, v] of added.slice(0, 12)) console.log('   +', (v / 1024).toFixed(1).padStart(8), 'KB', k)
  const shared = [...newM].filter(([k]) => oldM.has(k)).sort((a, b) => b[1] - a[1])
  for (const [k, v] of shared.slice(0, 5)) console.log('   =', (v / 1024).toFixed(1).padStart(8), 'KB', k)
}
