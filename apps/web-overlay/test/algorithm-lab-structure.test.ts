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

describe('知识星图：HITS 中心性展示', () => {
  // 2026-11-10：computeGraphCentrality（HITS：hubs/authorities，15 轮迭代 + L2 归一化）
  // 一直在 lib/knowledge-graph.ts 里实现完整，但**全仓零调用** ——
  // 算法实验室把图谱画出来了、能寻路、能算兼容度，却从没告诉用户
  // 「哪几个技术是这张图的枢纽、哪些是被依赖的权威」。
  // 本守卫锁住这条接线：引擎在、面板真的调用、两个榜单都有文案。
  it('面板真的调用 computeGraphCentrality 并渲染双榜', () => {
    const lib = overlayRead('src/lib/knowledge-graph.ts')
    expect(lib).toContain('export function computeGraphCentrality')

    const panel = overlayRead('src/components/algorithm-lab/graph-panel.tsx')
    // 必须真的 import 并调用（只 import 不调用等于没接）
    expect(panel).toContain('computeGraphCentrality')
    expect(panel).toContain('computeGraphCentrality(PRESET_TECH_GRAPH)')
    // 两侧榜单的文案与数据源都要在
    expect(panel).toContain('生态枢纽 (Hubs)')
    expect(panel).toContain('被依赖权威 (Authorities)')
    expect(panel).toContain('centrality.hubs')
    expect(panel).toContain('centrality.authorities')
    // 不许出现 Tailwind JIT 生成不了的动态色阶类（bg-${x}-500 这类不会产出 CSS）
    expect(/bg-\$\{/.test(panel)).toBe(false)
    expect(/text-\$\{/.test(panel)).toBe(false)
  })
})

describe('LinUCB 面板必须用真引擎，不许手工线性加权', () => {
  // 2026-11-10：这个面板此前是**手工线性加权冒充 LinUCB** ——
  // weight + 0.3 * (1 - lenNorm) 这种固定系数，既没有上下文特征向量 x、
  // 也没有 A 矩阵求逆与置信上界探索项 sqrt(x^T A^{-1} x)。
  // 而页面标题写的是「LinUCB 情境自适应多臂融合…动态求解最优置信上界权重」。
  // 真引擎 packages/core/src/linucb.ts 一直存在但零调用。
  // 本守卫锁住：面板必须从 core 镜像调用引擎，且不许再出现手写加权的痕迹。
  it('调用 createLinUCBModel / predictArmWeights / updateArmReward', () => {
    const panel = overlayRead('src/components/algorithm-lab/linucb-panel.tsx')
    // 走 core 镜像（apps/web 无法直接 import @navhub/core）
    expect(panel).toContain("from '@/lib/linucb'")
    expect(panel).toContain('createLinUCBModel(')
    expect(panel).toContain('predictArmWeights(')
    expect(panel).toContain('updateArmReward(')
    expect(panel).toContain('extractContextFeatures(')

    // 手写加权的痕迹必须消失（回归防线）
    expect(panel).not.toContain('arms.exact.weight + 0.3')
    expect(panel).not.toContain('cur.weight + 0.15')
    expect(panel).not.toContain('DEFAULT_ARMS')
  })

    it('A/B 对比展示第 5 维与本地复算，且标注本地模型不等同生产权重', () => {
    const panel = overlayRead('src/components/algorithm-lab/linucb-panel.tsx')
    expect(panel).toContain('digitRatio')
    expect(panel).toContain('labTop3')
    expect(panel).toContain('ResultRow')
    expect(panel).toContain('面板本地模型')
    expect(panel).toContain('不会写入生产 recordFeedback')
    const labAb = overlayRead('src/lib/lab-ab.ts')
    expect(labAb).toContain('LAB_STATIC_WEIGHTS')
    expect(labAb).toContain('labTop3')
    expect(labAb).toContain('1.4')
    expect(labAb).toContain('labCoverageFactor')
  })

it('core 镜像已登记 linucb（否则 apps/web 会 TS2307 解析失败）', () => {
    // scripts/ 不在 overlay 里，且测试可能是 overlay/test 或镜像 apps/web/test 两种位置，
    // 所以向上逐级找仓库根（含 scripts/core-mirrors.json 的那一层）。
    let rootDir = HERE
    let manifestPath = ''
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(rootDir, 'scripts', 'core-mirrors.json')
      if (existsSync(candidate)) { manifestPath = candidate; break }
      rootDir = resolve(rootDir, '..')
    }
    expect(manifestPath, 'core-mirrors.json 应能在仓库根找到').not.toBe('')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const names: string[] = (manifest.verbatim ?? []).map((e: { name: string }) => e.name)
    expect(names).toContain('linucb')
  })

  it('镜像文件确实是 core 生成物（带 @core-mirror 标记）', () => {
    const mirror = overlayRead('src/lib/linucb.ts')
    expect(mirror).toContain('@core-mirror')
  })
})

describe('庞加莱双曲面板必须用 core 引擎，不许手写距离公式', () => {
  // 2026-11-10：这个面板此前手写了 poincareDist2D，与 core 引擎有三处实质差异：
  //  1. 缺 clampToBall 边界钳制 —— 公式要求 ‖u‖<1，越界时 denom≤0 直接返回魔法值；
  //  2. 上界截断写 25.0（引擎 30.0），同场景两个答案；
  //  3. 打分缺 beta=1.5 指数，排序会不同。
  // 真引擎 packages/core/src/hyperbolic.ts（284 行，含 expMap0/logMap0/mobiusAdd/
  // lorentzDistance 等完整双曲几何）；洛伦兹距离由线上排序 routes/rank.ts 实际调用，
  // 庞加莱函数由本面板经 findTopAlternativesInHyperbolicSpace 调用（2026-11-11 核对）。
  it('调用 findTopAlternativesInHyperbolicSpace', () => {
    const panel = overlayRead('src/components/algorithm-lab/hyperbolic-panel.tsx')
    expect(panel).toContain("from '@/lib/hyperbolic'")
    expect(panel).toContain('findTopAlternativesInHyperbolicSpace(')
    // 手写距离公式必须消失（回归防线）
    expect(panel).not.toContain('function poincareDist2D')
    expect(panel).not.toContain('return 25.0')
    expect(panel).not.toContain('Math.exp(-dist / 2.5) * depthParity')
  })

  it('core 镜像已登记 hyperbolic 且文件带 @core-mirror 标记', () => {
    let rootDir = HERE
    let manifestPath = ''
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(rootDir, 'scripts', 'core-mirrors.json')
      if (existsSync(candidate)) { manifestPath = candidate; break }
      rootDir = resolve(rootDir, '..')
    }
    expect(manifestPath).not.toBe('')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const names: string[] = (manifest.verbatim ?? []).map((e: { name: string }) => e.name)
    expect(names).toContain('hyperbolic')

    const mirror = overlayRead('src/lib/hyperbolic.ts')
    expect(mirror).toContain('@core-mirror')
    expect(mirror).toContain('export function findTopAlternativesInHyperbolicSpace')
    // 引擎必须真的带边界钳制（这是手写版缺的那一条）
    expect(mirror).toContain('clampToBall')
  })
})

describe('防虚假 200 面板必须用 core 引擎，不许手写熵 + 硬编码词表', () => {
  // 2026-11-10：此面板此前手写 calculateTextEntropy 并内联硬编码 6 个停放关键词，
  // 而 core 的 health-sentinel 是完整引擎：
  //  - 19 条关键词（面板漏掉 dan.com / godaddy / sedo / 域名出售 / forbidden /
  //    access denied / blocked by cloudflare 等 13 条）；
  //  - stripHtmlToText() 独立函数（面板用单条正则近似，会漏掉 script/style）；
  //  - 支持视觉感知哈希比对与 confidence / textLength / truncated 感知。
  // 面板标题写的是「防虚假 200 巡检引擎」，就该用引擎。
  it('调用 auditPageHealth，且不再内联停放词表', () => {
    const panel = overlayRead('src/components/algorithm-lab/health-panel.tsx')
    expect(panel).toContain("from '@/lib/health-sentinel'")
    expect(panel).toContain('auditPageHealth(')
    // 手写实现与硬编码词表必须消失
    expect(panel).not.toContain('function calculateTextEntropy')
    expect(panel).not.toContain("'domain for sale', 'buy this domain'")
    // 引擎返回值要真的被用上（不是调了却丢掉）
    expect(panel).toContain('audit.shannonEntropy')
    expect(panel).toContain('audit.matchedParkingKeywords')
    expect(panel).toContain('audit.status')
  })

  it('core 镜像已登记 health-sentinel 且带完整关键词表', () => {
    let rootDir = HERE
    let manifestPath = ''
    for (let i = 0; i < 6; i++) {
      const candidate = resolve(rootDir, 'scripts', 'core-mirrors.json')
      if (existsSync(candidate)) { manifestPath = candidate; break }
      rootDir = resolve(rootDir, '..')
    }
    expect(manifestPath).not.toBe('')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const names: string[] = (manifest.verbatim ?? []).map((e: { name: string }) => e.name)
    expect(names).toContain('health-sentinel')

    const mirror = overlayRead('src/lib/health-sentinel.ts')
    expect(mirror).toContain('@core-mirror')
    expect(mirror).toContain('export function auditPageHealth')
    expect(mirror).toContain('DOMAIN_PARKING_KEYWORDS')
    // 关键词必须比手写版那 6 条多（这是本次修复的核心收益）
    expect(mirror).toContain('dan.com')
    expect(mirror).toContain('blocked by cloudflare')
  })
})
describe('算法实验室 W1-2：LDP ε 滑块 + 分布对比 + 加噪排序', () => {
  const panel = () => overlayRead('src/components/algorithm-lab/federated-panel.tsx')
  const lib = () => overlayRead('src/lib/lab-ldp.ts')

  it('ε 由 5 档按钮改为 range 滑块 0.2–5 step 0.1，并保留 5 档 chips', () => {
    expect(panel()).toContain('type="range"')
    expect(panel()).toContain('aria-label="隐私预算 ε"')
    expect(panel()).toContain('LDP_EPSILON_PRESETS')
    expect(panel()).toContain('LDP_EPSILON_MIN')
    expect(panel()).toContain('LDP_EPSILON_MAX')
    expect(panel()).toContain('LDP_EPSILON_STEP')
    expect(panel()).not.toContain('[0.2, 0.5, 1.0, 2.0, 5.0].map((eps)')
  })

  it('每维 N=200 采样直方图：原始值刻度线 + 均值±SD + P(|噪声|>0.5)', () => {
    expect(panel()).toContain('每维噪声分布')
    expect(panel()).toContain('LDP_SAMPLE_COUNT')
    expect(panel()).toContain('sampleLdpDimension')
    expect(panel()).toContain('均值')
    expect(panel()).toContain('P(|噪声|>')
    expect(panel()).toContain('重新采样')
  })

  it('排序改用加噪向量：原始/加噪双榜单 + 名次变化标记', () => {
    expect(panel()).toContain('rankItemsWithPrivacy(noisyVector')
    expect(panel()).toContain('原始向量排序')
    expect(panel()).toContain('加噪向量排序')
    expect(panel()).toContain('名次变化')
    expect(panel()).toContain('rankChangeLabel')
  })

  it('强制诚实文案：演示用聚合，本页不上传任何向量；群体向量为写死示例', () => {
    expect(panel()).toContain('演示用聚合——本页不上传任何向量；群体向量为写死示例；真实上报不存在')
  })

  it('面板零网络请求：不含 fetch/axios/XMLHttpRequest', () => {
    expect(panel()).not.toContain('fetch(')
    expect(panel()).not.toContain('axios')
    expect(panel()).not.toContain('XMLHttpRequest')
  })

  it('lab-ldp 导出滑块常量与采样/名次变化工具', () => {
    expect(lib()).toContain('LDP_SAMPLE_COUNT = 200')
    expect(lib()).toContain('LDP_EPSILON_PRESETS')
    expect(lib()).toContain('export function sampleLdpDimension')
    expect(lib()).toContain('export function rankChangeLabel')
  })
})
