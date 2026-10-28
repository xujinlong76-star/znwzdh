import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 客户端代码里禁止出现硬编码凭证。
 *
 * 起因（真实存在过、差点随一次提交入库）：`lib/client-auto-auth.ts` 里写死了
 * `username=admin / password=admin` 并直接 POST 到凭证端点。三条后果同时成立：
 *   1. 口令常量进客户端 bundle —— 等于公开默认凭证对，可被自动扫描；
 *   2. 服务端 `auth.ts` 的 `username = rawUsername || 'admin'`，未配置
 *      `NAVHUB_ADMIN_PASSWORD` 的实例上这段请求**会成功**——任意访客拿到管理员；
 *   3. 它长得像「开发便利」，代码评审极易放行。
 *
 * 这类问题的共同点是「凭肉眼评审会漏」，所以判据必须可执行：
 * 只要**口令字段与一个非空字面量成对出现**就红灯。只挖注释不挖字符串——
 * 字符串本身正是要检查的对象（注释里的说明不会被误报，因为注释先被挖空）。
 */

const ROOT = fileURLToPath(new URL('../src', import.meta.url))

/** 把注释挖成等长空白（保留换行，便于报错回读原文） */
function blankComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      out += ' '.repeat(stop - i)
      i = stop
      continue
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    out += src[i]
    i += 1
  }
  return out
}

const LIT = `["'][^"']+["']`
const PATTERNS: { re: RegExp; why: string }[] = [
  {
    // formData.append('password', '字面量')
    re: new RegExp(`append\\(\\s*["']password["']\\s*,\\s*${LIT}`, 'g'),
    why: '把口令字面量写进表单（客户端不应该知道任何口令）',
  },
  { re: new RegExp(`password\\s*:\\s*${LIT}`, 'g'), why: '对象字面量里的口令常量' },
  { re: new RegExp(`["']password["']\\s*,\\s*${LIT}`, 'g'), why: '口令字段与字面量成对出现' },
]

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(ts|tsx)$/.test(name)) acc.push(p)
  }
  return acc
}

describe('客户端代码不得硬编码凭证', () => {
  it('0 处硬编码口令', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const masked = blankComments(readFileSync(file, 'utf8'))
      for (const { re, why } of PATTERNS) {
        re.lastIndex = 0
        const m = re.exec(masked)
        if (m) hits.push(`${relative(ROOT, file).replace(/\\/g, '/')}  ${m[0].trim()}  ← ${why}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('守卫本身抓得住（反例）', () => {
    const bad = "const f = new URLSearchParams()\nf.append('password', 'admin')\n"
    for (const { re } of PATTERNS) re.lastIndex = 0
    expect(PATTERNS[0].re.test(blankComments(bad))).toBe(true)
  })

  it('不误报：口令来自变量 / 注释里的说明', () => {
    const ok = [
      '// 这里曾经写过 password: "admin"，已移除',
      "/* append('password', 'admin') 是错的 */",
      "f.append('password', inputValue)",
      'const body = { password: pwd }',
    ].join('\n')
    for (const { re } of PATTERNS) re.lastIndex = 0
    expect(PATTERNS.some(({ re }) => re.test(blankComments(ok)))).toBe(false)
  })
})
