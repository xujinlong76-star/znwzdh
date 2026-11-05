/**
 * 导航整包保存的日志：只记体量，不记内容。
 *
 * `POST/PUT /api/navigation` 收到的是**整份 navigation.json**（18 个主类目 /
 * 215 个子分类 / 上千站点）。旧实现在校验之前先打一句
 * `console.log('Received navigation data:', JSON.stringify(data, null, 2))`：
 *   - 一次保存往 stdout 倒几 MB，容器日志盘被撑满是迟早的事；
 *   - 里面是全量用户可见内容（标题、描述、URL），日志的访问面比数据库大得多；
 *   - 请求连「是不是对象」都没通过时也照样全文记录。
 *
 * 现在改成一行摘要（类目数 / 子类数 / 站点数 / 字节数），出错分支只列可疑项的 id。
 * 这里钉四件事：
 *   1. 真的调一次 POST，摘要里出现的是计数，载荷里的标题一条都不出现在日志里；
 *   2. 字节数是真的（等于序列化长度），不是随手写的常量；
 *   3. 结构不合法时仍然拒绝保存，且日志有可定位的 id、没有整包；
 *   4. 全仓 API 路由都不许把请求体整体序列化进日志（唯一例外要带证据）。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  afterAll } from 'vitest'

vi.mock('@/lib/auth', () => ({
  verifyAdminSession: vi.fn(async () => ({ ok: true, githubToken: '' })),
}))
vi.mock('@/lib/github', () => ({
  commitFile: vi.fn(async () => undefined),
  getFileContent: vi.fn(async () => ({ navigationItems: [] })),
}))

import { POST } from '../src/app/api/navigation/route'
import { commitFile } from '@/lib/github'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRoot(): string {
  const candidates = [resolve(HERE, '..'), resolve(HERE, '..', '..', 'web-overlay')]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, '/')
    return s.includes('/web-overlay/') || s.endsWith('/web-overlay')
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error('无法定位 web-overlay 根目录（候选：' + candidates.join(' | ') + '）')
  return hit
}

const ROOT = overlayRoot()

const CANARY = 'CANARY-整包内容-不得进日志'

/** 3 类目 × (2 条直挂 + 1 个子类 × 1 条) = 9 条站点 */
function fixture() {
  return {
    navigationItems: Array.from({ length: 3 }, (_, i) => ({
      id: `cat-${i}`,
      title: `${CANARY}-类目-${i}`,
      items: [
        { id: `s-${i}-0`, title: `${CANARY}-站点-${i}-0`, href: 'https://example.com/1' },
        { id: `s-${i}-1`, title: `${CANARY}-站点-${i}-1`, href: 'https://example.com/2' },
      ],
      subCategories: [
        {
          id: `sub-${i}`,
          title: `${CANARY}-子类-${i}`,
          items: [{ id: `s-${i}-sub`, title: `${CANARY}-子站-${i}`, href: 'https://example.com/3' }],
        },
      ],
    })),
  }
}

let logs: string[]
let errors: string[]

beforeEach(() => {
  vi.mocked(commitFile).mockClear()
  logs = []
  errors = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function post(body: unknown) {
  return POST(new Request('http://127.0.0.1:3000/api/navigation', { method: 'POST', body: JSON.stringify(body) }))
}

// mock 卫生兜底：isolate:false 下同 worker 的后续文件会看到本文件留下的
// 跨模块 mock 与 process.env 改写，这里统一清掉。
afterAll(() => {
  vi.resetModules();
});

describe('整包保存：日志只记体量', () => {
  it('摘要一行，计数与夹具逐字对得上', async () => {
    const res = await post(fixture())
    expect(res.status).toBe(200)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/^Navigation save: 3 类目 \/ 3 子类 \/ 9 条站点, \d+ bytes$/)
  })

  it('字节数是真数出来的序列化长度', async () => {
    const data = fixture()
    await post(data)
    const reported = Number(/(\d+) bytes$/.exec(logs[0])![1])
    expect(reported).toBe(JSON.stringify(data).length)
  })

  it('载荷内容一条都不出现在日志里（旧实现会把整包打出来）', async () => {
    await post(fixture())
    const all = [...logs, ...errors].join('\n')
    expect(all).not.toContain(CANARY)
    expect(all).not.toContain('cat-0')
    expect(all).not.toContain('https://example.com')
    // 摘要必须是「一行」，不是一坨：给一个宽松上限，防有人把 pretty-print 塞回来
    expect(logs[0].length).toBeLessThan(120)
  })

  it('写链没被改坏：仍然按原样序列化后提交同一个路径', async () => {
    const data = fixture()
    await post(data)
    expect(commitFile).toHaveBeenCalledTimes(1)
    const [path, content, message, token] = vi.mocked(commitFile).mock.calls[0]
    expect(path).toBe('src/navsphere/content/navigation.json')
    expect(content).toBe(JSON.stringify(data, null, 2))
    expect(message).toBe('Update navigation data')
    expect(token).toBeUndefined()
  })
})

describe('结构不合法：仍然拒收，但日志只给可定位的 id', () => {
  it('缺 title 的类目被拒，错误路径不带整包', async () => {
    const data = fixture()
    // 只让 cat-1 缺 title：其余保持合法，验证「按 id 指认」而不是「打一坨」
    delete (data.navigationItems[1] as { title?: string }).title
    const res = await post(data)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'Failed to save navigation data' })
    expect(commitFile).not.toHaveBeenCalled()
    expect(logs, '校验没过就不该记一次“保存”').toEqual([])
    const all = [...logs, ...errors].join('\n')
    expect(all).toContain('1 个类目结构不合法')
    expect(all).toContain('cat-1')
    expect(all).not.toContain(CANARY)
  })

  it('可疑项超过上报上限时给计数和省略号，不铺开整包', async () => {
    // 21 个缺 title 的类目：超过 MAX_REPORTED_IDS(20)，必须截断
    const data = {
      navigationItems: Array.from({ length: 21 }, (_, i) => ({
        id: `cat-${i}`,
        description: `${CANARY}-${i}`,
        items: [],
      })),
    }
    const res = await post(data)
    expect(res.status).toBe(500)
    const all = [...logs, ...errors].join('\n')
    expect(all).toContain('21 个类目结构不合法')
    expect(all).toContain('cat-19')
    expect(all).toContain('…')
    expect(all).not.toContain('cat-20') // 第 21 个只进计数，不铺 id
    expect(all).not.toContain(CANARY) // 描述属于内容，一律不进日志
    expect(all.length).toBeLessThan(400)
  })
})

describe('全仓 API 路由：不许把请求体整体序列化进日志', () => {
  function listRouteFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) listRouteFiles(full, out)
      else if (/route\.ts$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, '/'))
    }
    return out
  }

  /** console.*( ... JSON.stringify( ... ) 同一行即算 */
  const LOG_WITH_STRINGIFY = /console\.(?:log|info|debug|warn|error)\s*\([^)]*JSON\.stringify\s*\(/

  /**
   * 已核对的例外：序列化的是**摘要对象**，不是请求体。
   * evidence 必须逐字出现在同一文件里，理由失效即红。
   */
  const SANCTIONED: Array<{ file: string; why: string; evidence: string[] }> = [
    {
      file: 'src/app/api/csp-report/route.ts',
      why: '打的是 parseCspReport 收敛出的摘要，且请求体先过 readCappedBody 的字节上限',
      evidence: ['const summary = parseCspReport(text)', 'readCappedBody(request, MAX_REPORT_BODY_BYTES)'],
    },
  ]

  const hits = listRouteFiles(join(ROOT, 'src/app/api'))
    .map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }))
    .filter((entry) => LOG_WITH_STRINGIFY.test(entry.text))

  it('没有新的「整包进日志」出口（例外要写明理由和证据）', () => {
    const offenders = hits
      .filter((hit) => !SANCTIONED.some((s) => s.file === hit.file))
      .map((hit) => hit.file)
    expect(offenders, '这些路由把数据整体序列化进了日志：\n' + offenders.join('\n')).toEqual([])
  })

  it('例外清单没有过期条目，证据仍然在代码里', () => {
    for (const entry of SANCTIONED) {
      expect(hits.some((h) => h.file === entry.file), `${entry.file} 已不再打 JSON，例外应当删掉`).toBe(true)
      const text = readFileSync(join(ROOT, entry.file), 'utf8')
      for (const evidence of entry.evidence) {
        expect(text, `${entry.file} 缺少证据：${evidence}`).toContain(evidence)
      }
    }
  })

  it('扫描机没瞎：确实抓到过被禁的写法', () => {
    expect(LOG_WITH_STRINGIFY.test("console.log('Received data:', JSON.stringify(data, null, 2))")).toBe(true)
    expect(LOG_WITH_STRINGIFY.test('console.warn(prefix + JSON.stringify(summary))')).toBe(true)
    expect(LOG_WITH_STRINGIFY.test('const json = JSON.stringify(data) // 不是日志')).toBe(false)
    expect(hits.length).toBeGreaterThan(0)
  })
})
