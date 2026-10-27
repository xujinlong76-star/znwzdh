const fs = require('fs')
const { execFileSync } = require('child_process')

const path = 'apps/web-overlay/src/components/plugins/plugin-url-health-panel.tsx'
const hybridPath = 'tmp/run87-panel-hybrid.tsx'

const base = execFileSync('git', ['show', 'HEAD:' + path], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })

const a1 = 'export interface AuditResult {\n  slug: string\n  declared: number'
const b1 =
  'export interface AuditResult {\n  slug: string\n  /** 实时探活结果本身不带体检时间，与历史快照联合消费时可能由上层补齐 */\n  auditedAt?: number | null\n  declared: number'

const a2 = [
  '        return {',
  '          ...cur,',
  '          diagnoses: cur.diagnoses.map((d) =>',
  '            healedSet.has(d.url.trim().toLowerCase()) ? { ...d, resolved: true } : d,',
  '          ),',
  '        }',
].join('\n')
const b2 = [
  '        return {',
  '          ...prev,',
  '          [slug]: {',
  '            ...cur,',
  '            diagnoses: cur.diagnoses.map((d) =>',
  '              healedSet.has(d.url.trim().toLowerCase()) ? { ...d, resolved: true } : d,',
  '            ),',
  '          },',
  '        }',
].join('\n')

const count = (s, sub) => s.split(sub).length - 1
if (count(base, a1) !== 1) throw new Error('anchor1 count=' + count(base, a1))
if (count(base, a2) !== 1) throw new Error('anchor2 count=' + count(base, a2))

const hybrid = base.replace(a1, b1).replace(a2, b2)
if (hybrid === base) throw new Error('hybrid unchanged')
fs.writeFileSync(hybridPath, hybrid)
console.log('hybrid written:', hybridPath, 'bytes', hybrid.length, 'base', base.length, 'lines', hybrid.split('\n').length)
