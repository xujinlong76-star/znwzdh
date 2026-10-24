import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * algorithm-lab 拆分守卫（第五批 A1）。
 *
 * 2216 行巨石组件按 12 个实验区拆成 src/components/algorithm-lab/*.tsx 独立面板。
 * 拆分是纯搬运（状态随面板走、TabsContent 门控留在壳里），本守卫锁两件事：
 * 1. 12 个实验区的 tab 值与标志性文案一个都不能少（防拆丢）；
 * 2. 壳文件保持瘦（< 700 行）——防「拆完又长回去」。
 */

const HERE = dirname(fileURLToPath(import.meta.url))

function overlayRead(rel: string): string {
  const p = resolve(HERE, '..', '..', 'web-overlay', rel)
  if (!existsSync(p)) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(p, 'utf8')
}

const SECTIONS: Array<{ tab: string; anchor: string }> = [
  { tab: 'linucb', anchor: 'LinUCB 情境自适应多臂融合实时推演' },
  { tab: 'hyperbolic', anchor: '庞加莱双曲圆盘（Poincaré Disk）平替拓扑推导' },
  { tab: 'health', anchor: 'Shannon 文本信息熵与防虚假 200 巡检引擎' },
  { tab: 'intent', anchor: '0-RTT 推测意图预执行试验台' },
  { tab: 'vault', anchor: '本地优先零知识 E2EE 端到端加密金库' },
  { tab: 'graph', anchor: '技术栈知识拓扑图谱与双向 Dijkstra 寻路' },
  { tab: 'visual', anchor: '视觉指纹分析与 WCAG 2.1 色彩和谐度' },
  { tab: 'webmcp', anchor: '浏览器端端侧 WebMCP JSON-RPC 2.0 通信总线' },
  { tab: 'federated', anchor: '本地差分隐私 (LDP Laplace) 协同推荐引擎' },
  { tab: 'speculation', anchor: 'W3C Speculation Rules 自适应推测预渲染编译器' },
  { tab: 'synthesizer', anchor: '动态 WebMCP 工具合成器与严苛 SSRF 纵深防护沙箱' },
  { tab: 'mesh', anchor: 'P2P Mesh 去中心化 CRDT 状态向量共识测试台' },
]

const PANEL_DIR = resolve(HERE, '..', '..', 'web-overlay', 'src', 'components', 'algorithm-lab')

/** 壳 + 全部面板的联合源文本（拆分前后都成立） */
function combinedSource(): string {
  const parts = [overlayRead('src/components/algorithm-lab.tsx')]
  if (existsSync(PANEL_DIR)) {
    for (const f of readdirSync(PANEL_DIR)) {
      if (f.endsWith('.tsx')) parts.push(readFileSync(resolve(PANEL_DIR, f), 'utf8'))
    }
  }
  return parts.join('\n')
}

describe('algorithm-lab 拆分守卫', () => {
  it('12 个实验区的 tab 门控与标志文案齐全', () => {
    const src = combinedSource()
    for (const { tab, anchor } of SECTIONS) {
      expect(src, `tab 门控 ${tab}`).toContain(`value="${tab}"`)
      expect(src, `区块文案 ${anchor}`).toContain(anchor)
    }
  })

  it('壳文件保持瘦：拆分完成后 < 700 行且不再堆实验状态', () => {
    const shell = overlayRead('src/components/algorithm-lab.tsx')
    const lines = shell.split('\n').length
    // 拆分完成前面板目录不存在，此时跳过行数断言（首跑即拆）
    if (!existsSync(PANEL_DIR)) return
    expect(lines).toBeLessThan(700)
    // 12 个模块状态块注释应随面板迁走，壳里不再出现
    expect(shell).not.toContain('模块 1：LinUCB 状态')
    expect(shell).not.toContain('模块 12：P2P Mesh')
    // 壳只保留 activeTab 一个业务状态位
    expect(shell.match(/useState/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })

  it('面板组件一一对应 12 个实验区', () => {
    if (!existsSync(PANEL_DIR)) return
    const files = readdirSync(PANEL_DIR).filter((f) => f.endsWith('.tsx'))
    expect(files.length).toBe(12)
    for (const f of files) {
      const body = readFileSync(resolve(PANEL_DIR, f), 'utf8')
      expect(body, f).toMatch(/export function \w+Panel\(\)/)
    }
  })

  it('算法页仍从壳渲染（路由不被拆分改坏）', () => {
    const page = overlayRead('src/app/algorithms/page.tsx')
    expect(page).toContain('AlgorithmLab')
  })
})
