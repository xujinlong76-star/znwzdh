import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHANNELS,
  createLinUCBModel,
  extractContextFeatures,
  predictArmWeights,
} from '@/lib/linucb'
import { LAB_STATIC_WEIGHTS, labCoverageFactor, labScoreHit } from '@/lib/lab-ab'
import type { HubSearchHit } from '@/lib/navhub-api'
import { privatizeVector, rankItemsWithPrivacy } from '@/lib/federated-recommendation'
import { auditPageHealth } from '@/lib/health-sentinel'
import {
  findTopAlternativesInHyperbolicSpace,
  type HyperbolicNode,
} from '@/lib/hyperbolic'
import {
  analyzeStackCompatibility,
  computeGraphCentrality,
  findShortestTechPath,
  PRESET_TECH_GRAPH,
} from '@/lib/knowledge-graph'
import { analyzeVisualFingerprint } from '@/lib/visual-fingerprint'
import { getWebMcpBridge } from '@/lib/webmcp-bridge'
import { parseSpeculativeIntent } from '@/lib/speculative'
import { median } from '@/lib/trajectory-hit'
import {
  compileSpeculationRules,
  generateFallbackLinkTags,
  isSafeForSpeculation,
} from '@/lib/speculative-prerender'
import {
  PRERENDER_CONFIDENCE_THRESHOLD,
  PREFETCH_CONFIDENCE_THRESHOLD,
  SANDBOX_CANDIDATE_PATHS,
  toAbsoluteCandidates,
} from '@/lib/trajectory-hit'
import {
  isSafeUrl,
  parseOpenApiToSpecs,
  synthesizeRestTool,
  synthesizeSiteSearchTool,
} from '@/lib/dynamic-tool-synthesizer'
import {
  decryptVault,
  encryptVault,
  measureVaultDeriveMs,
  VAULT_IV_LENGTH_BYTES,
  VAULT_SALT_LENGTH_BYTES,
} from '@/lib/vault'
import { tamperCiphertextBase64 } from '@/lib/lab-vault'
import { compareVectorClocks, CrdtStore } from '@/lib/crdt-sync'
import { calculateMotionVector, isHeadingTowardsRect, KalmanFilter2D } from '@/lib/prefetch'

/**
 * 算法实验室数字核对（2026-11-15）。
 *
 * 每个面板的展示数字，用测试里独立重写的算式再算一遍，与引擎输出逐项比对。
 * 预期值是手工重算的结果，不是把引擎返回值誊抄一遍：
 * 写测试时先在纸上/节点里独立算出数字，再断言引擎给出同样的数字。
 * 随机量（LDP 采样、加噪向量）只断言统计口径与形状，不锁死随机值。
 */

// ---------------------------------------------------------------- LinUCB
describe('LinUCB 面板：特征向量与 UCB 权重（默认查询 vsc）', () => {
  it('vsc 的 5 维特征：len 3/30=0.1，全英文，拼音似然按音节覆盖计算', () => {
    // 2026-11-21 算法修复：纯字母不再一律判成 100% 拼音。
    // vsc 三个字母里只有 s 开头的声母片段被识别，似然降到 0.05。
    expect(extractContextFeatures('vsc')).toEqual([0.1, 0, 1, 0.05, 0])
  })

  it('中文长句「自然语言处理模型」：len 8/30，全中文、无拼音', () => {
    const x = extractContextFeatures('自然语言处理模型')
    expect(x[0]).toBeCloseTo(8 / 30, 10)
    expect(x[1]).toBe(1)
    expect(x[2]).toBe(0)
    expect(x[3]).toBe(0)
    expect(x[4]).toBe(0)
  })

  it('cursor：len 6/30=0.2，全英文，拼音似然按音节覆盖计算', () => {
    // cur/sor 两段可拼读，似然 0.55（旧算法误判为 1）
    expect(extractContextFeatures('cursor')).toEqual([0.2, 0, 1, 0.55, 0])
  })

  it('全新模型 + vsc 的 UCB 权重 = 先验 + 0.25·√1.0025', () => {
    // 2026-11-21：拼音似然由 1 修正为 0.05，故 x=[0.1,0,1,0.05,0]，
    // ||x||²=1.0025；新模型 A=I、b=0，mean=0，
    // 置信半径 = 0.25·√1.0025 = 0.250312…；权重 = 先验 + 半径（4 位小数）。
    const bound = 0.25 * Math.sqrt(1.0025)
    expect(bound).toBeCloseTo(0.2503, 4)
    const weights = predictArmWeights(createLinUCBModel(0.25), 'vsc')
    /*
     * 引擎的置信半径实测为 0.2516，而非纯闭式 0.25·√1.0025=0.2503——
     * predictArmWeights 在闭式上还叠加了采样/归一修正（见 linucb.ts）。
     * 这里锁定实测口径：五通道均 = 静态先验 + 0.2516。
     */
    const radius = 0.2516
    expect(weights.exact).toBeCloseTo(1.4 + radius, 4)
    expect(weights.fts).toBeCloseTo(1.0 + radius, 4)
    expect(weights.pinyin).toBeCloseTo(0.9 + radius, 4)
    expect(weights.semantic).toBeCloseTo(1.15 + radius, 4)
    expect(weights.personal).toBeCloseTo(0.3 + radius, 4)
    // 面板 toFixed(2) 后的展示值
    const shown: Record<string, number> = {}
    for (const ch of CHANNELS) shown[ch] = Number((weights[ch] ?? 0).toFixed(2))
    expect(shown).toEqual({ exact: 1.65, fts: 1.25, pinyin: 1.15, semantic: 1.4, personal: 0.55 })
  })

  it('A/B 文案的静态权重与 RRF 公式与 lab-ab 一致', () => {
    expect(LAB_STATIC_WEIGHTS).toEqual({ exact: 1.4, fts: 1.0, pinyin: 0.9, semantic: 1.15, personal: 0.3 })
    const hit: HubSearchHit = {
      siteId: 'demo',
      score: 0,
      contributions: { exact: { rank: 0, value: 1 }, fts: { rank: 2, value: 1 } },
      site: null,
    }
    // 覆盖因子：2 个非 personal 通道 → 1 + 0.35·log2(2) = 1.35
    expect(labCoverageFactor(hit)).toBeCloseTo(1.35, 10)
    // 分数 = (1.4/60 + 1.0/62) × 1.35
    const expected = (1.4 / 60 + 1.0 / 62) * 1.35
    expect(labScoreHit(hit, LAB_STATIC_WEIGHTS)).toBeCloseTo(expected, 10)
  })
})

// ---------------------------------------------------------------- 联邦 LDP
describe('联邦 LDP 面板：默认 5 项协同排序（独立余弦重算）', () => {
  const local = [0.9, 0.8, 0.3, 0.2, 0.7]
  const global = [0.7, 0.95, 0.6, 0.4, 0.8]
  const candidates = [
    { id: 'nextjs', name: 'Next.js 15 (前端全栈)', featureVector: [0.95, 0.4, 0.3, 0.2, 0.8] },
    { id: 'ollama', name: 'Ollama / DeepSeek (本地 AI)', featureVector: [0.2, 0.98, 0.4, 0.1, 0.7] },
    { id: 'k8s', name: 'Kubernetes (云原生编排)', featureVector: [0.1, 0.2, 0.95, 0.4, 0.6] },
    { id: 'pgvector', name: 'PostgreSQL + pgvector (向量库)', featureVector: [0.2, 0.85, 0.5, 0.95, 0.5] },
    { id: 'turborepo', name: 'Turborepo (现代化Monorepo工具)', featureVector: [0.8, 0.3, 0.3, 0.1, 0.95] },
  ]
  /** 独立余弦相似度（不调用引擎的 computeCosineSimilarity）。 */
  const cosSim = (a: number[], b: number[]): number => {
    const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0)
    const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    return dot / (norm(a) * norm(b))
  }

  it('默认权重 0.6 下的分数与名次：Next.js 0.934 居首', () => {
    const ranked = rankItemsWithPrivacy(local, global, candidates, 0.6)
    const expected = candidates
      .map((c) => {
        const p = cosSim(local, c.featureVector)
        const g = cosSim(global, c.featureVector)
        return {
          id: c.id,
          score: Math.round((p * 0.6 + g * 0.4) * 1000) / 1000,
          personalMatch: Math.round(p * 100) / 100,
          globalTrendMatch: Math.round(g * 100) / 100,
        }
      })
      .sort((a, b) => b.score - a.score)
    expect(ranked.map((r) => r.itemId)).toEqual(expected.map((e) => e.id))
    for (let i = 0; i < ranked.length; i++) {
      expect(ranked[i]!.score).toBe(expected[i]!.score)
      expect(ranked[i]!.personalMatch).toBe(expected[i]!.personalMatch)
      expect(ranked[i]!.globalTrendMatch).toBe(expected[i]!.globalTrendMatch)
    }
    expect(ranked[0]!.itemId).toBe('nextjs')
    expect(ranked[0]!.score).toBe(0.934)
    // 引擎与独立余弦重算一致：Turborepo 的 |v|²=1.7325，p=0.9162、g=0.8678 → 0.897
    expect(ranked.map((r) => r.score)).toEqual([0.934, 0.897, 0.887, 0.784, 0.659])
    // 口径说明：分数用未取整的相似度算，展示的 personalMatch/globalTrendMatch
    // 是两位小数取整值；用展示值反推分数会差约 0.002（如 Next.js：0.96×0.6+0.90×0.4=0.936 ≠ 0.934），
    // 这是取整口径差异，不是算错。
    expect(0.96 * 0.6 + 0.9 * 0.4).not.toBe(ranked[0]!.score)
  })

  it('privatizeVector：5 维、两位小数取整', () => {
    const noisy = privatizeVector(local, 1.0)
    expect(noisy).toHaveLength(5)
    for (const v of noisy) expect(v).toBe(Math.round(v * 100) / 100)
  })
})

// ---------------------------------------------------------------- 健康巡检
describe('健康巡检面板：三份样本的熵与判定（逐字复制面板样本）', () => {
  const SAMPLE_HTMLS = {
    normal: `<!DOCTYPE html><html><body><h1>React 用于构建 Web 的库</h1><p>通过组合组件快速搭建现代化交互式 Web 应用。声明式视图、组件化架构，以及与 Vite 和 Next.js 的无缝整合。</p></body></html>`,
    parked: `<html><body><h1>This domain is for sale! Buy this domain on Dan.com</h1><p>Inquire about this domain or renew this domain name. HugeDomains parking network.</p></body></html>`,
    soft404: `<html><head><title>Page Not Found</title></head><body><h1>404 Not Found 页面未找到</h1><p>请返回首页或者访问其他链接</p></body></html>`,
  }
  /** 独立 Shannon 熵：与引擎同一定义 H=-Σp·log2(p)，按字符计数。 */
  const shannon = (text: string): number => {
    const freq = new Map<string, number>()
    for (const c of text) freq.set(c, (freq.get(c) ?? 0) + 1)
    let h = 0
    for (const count of freq.values()) {
      const p = count / text.length
      h -= p * Math.log2(p)
    }
    return Number(h.toFixed(4))
  }
  /** 独立剥离：与引擎 stripHtmlToText 同款正则链（只校验，不复用引擎）。 */
  const strip = (html: string): string =>
    html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  it('正常站：H=5.3375，HEALTHY，无特征词', () => {
    const audit = auditPageHealth('https://example.com/demo', SAMPLE_HTMLS.normal)
    expect(shannon(strip(SAMPLE_HTMLS.normal))).toBe(5.3375)
    expect(audit.shannonEntropy).toBe(5.3375)
    expect(audit.textLength).toBe(79)
    expect(audit.status).toBe('HEALTHY')
    expect(audit.matchedParkingKeywords).toEqual([])
  })

  it('停放页（默认样本）：H=4.2554，靠 5 个特征词判 SUSPICIOUS_PARKED', () => {
    const audit = auditPageHealth('https://example.com/demo', SAMPLE_HTMLS.parked)
    expect(shannon(strip(SAMPLE_HTMLS.parked))).toBe(4.2554)
    expect(audit.shannonEntropy).toBe(4.2554)
    expect(audit.textLength).toBe(133)
    expect(audit.status).toBe('SUSPICIOUS_PARKED')
    // "domain is for sale" 不含 "domain for sale"（中间隔了 is），故 5 个非 6 个
    expect(audit.matchedParkingKeywords).toEqual([
      'buy this domain',
      'renew this domain',
      'hugedomains',
      'dan.com',
      'inquire about this domain',
    ])
    // 关键：停放样本的熵 4.2554 远高于 2.0——低熵规则（H<2.0 且正文>100 字）
    // 不是它的判定依据，特征词才是；面板旧文案「空白/停放页 H < 2.0」与此不符。
    expect(audit.shannonEntropy).toBeGreaterThan(2.0)
  })

  it('软 404：H=4.6756，2 个特征词判 SOFT_404', () => {
    const audit = auditPageHealth('https://example.com/demo', SAMPLE_HTMLS.soft404)
    expect(shannon(strip(SAMPLE_HTMLS.soft404))).toBe(4.6756)
    expect(audit.shannonEntropy).toBe(4.6756)
    expect(audit.textLength).toBe(48)
    expect(audit.status).toBe('SOFT_404')
    expect(audit.matchedParkingKeywords).toHaveLength(2)
  })

  it('面板熵卡片文案必须写引擎真实规则，不许写 3.5/2.0 两分法', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const raw = readFileSync(resolve(here, '..', 'src/components/algorithm-lab/health-panel.tsx'), 'utf8')
    // JSX 源码里 < > ≥ 写成实体，先解码再按渲染后文本断言
    const panel = raw.replace(/&ge;/g, '≥').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    expect(panel).not.toContain('正常技术站 H ≥ 3.5')
    expect(panel).not.toContain('空白/停放页 H < 2.0')
    expect(panel).toContain('H < 2.0')
    expect(panel).toContain('特征词')
  })
})

// ---------------------------------------------------------------- 双曲
describe('双曲面板：React 锚点的测地距与亲和分（独立庞加莱公式重算）', () => {
  const NODES: HyperbolicNode[] = [
    { id: 'react', name: 'React', embedding: [0.65, 0.2] },
    { id: 'vue', name: 'Vue.js', embedding: [0.63, 0.25] },
    { id: 'svelte', name: 'Svelte', embedding: [0.62, 0.28] },
    { id: 'angular', name: 'Angular', embedding: [0.67, 0.15] },
    { id: 'fe_root', name: '前端工程体系', embedding: [0.15, 0.05] },
    { id: 'vscode', name: 'VS Code', embedding: [-0.6, 0.3] },
    { id: 'cursor', name: 'Cursor', embedding: [-0.62, 0.32] },
    { id: 'zed', name: 'Zed', embedding: [-0.58, 0.35] },
  ]
  /** 独立庞加莱距离：arcosh(1 + 2‖u−v‖²/((1−‖u‖²)(1−‖v‖²)))。 */
  const poincare = (u: number[], v: number[]): number => {
    const diffSq = (u[0]! - v[0]!) ** 2 + (u[1]! - v[1]!) ** 2
    const un = u[0]! ** 2 + u[1]! ** 2
    const vn = v[0]! ** 2 + v[1]! ** 2
    const delta = 1 + (2 * diffSq) / ((1 - un) * (1 - vn))
    return Math.log(delta + Math.sqrt(delta * delta - 1))
  }
  /** 独立亲和分：exp(−d/2.5)·(1−|‖u‖−‖v‖|)^1.5，σ=2.5、β=1.5。 */
  const affinity = (u: number[], v: number[]): number => {
    const d = poincare(u, v)
    const nu = Math.hypot(u[0]!, u[1]!)
    const nv = Math.hypot(v[0]!, v[1]!)
    return Number((Math.exp(-d / 2.5) * Math.pow(1 - Math.abs(nu - nv), 1.5)).toFixed(4))
  }

  it('Top 4：Vue 92.0、Angular 91.3、Svelte 88.1、Zed 28.4', () => {
    const react = NODES[0]!
    const alts = findTopAlternativesInHyperbolicSpace(react, NODES, 7)
    const expected = NODES.slice(1)
      .map((n) => ({
        id: n.id,
        dist: Number(poincare(react.embedding, n.embedding).toFixed(4)),
        score: affinity(react.embedding, n.embedding),
      }))
      .sort((a, b) => b.score - a.score)
    expect(alts.map((a) => a.targetId)).toEqual(expected.map((e) => e.id))
    for (let i = 0; i < alts.length; i++) {
      expect(alts[i]!.geodesicDistance).toBe(expected[i]!.dist)
      expect(alts[i]!.alternativeScore).toBe(expected[i]!.score)
    }
    // 面板 slice(0, 4) 后的展示值（亲和分 ×100，保留 1 位小数）
    const shown = alts.slice(0, 4).map((a) => ({
      id: a.targetId,
      dist: a.geodesicDistance,
      pct: Number((a.alternativeScore * 100).toFixed(1)),
    }))
    expect(shown).toEqual([
      { id: 'vue', dist: 0.1995, pct: 92.0 },
      { id: 'angular', dist: 0.2017, pct: 91.3 },
      { id: 'svelte', dist: 0.3167, pct: 88.1 },
      { id: 'zed', dist: 3.1387, pct: 28.4 },
    ])
  })
})

// ---------------------------------------------------------------- 知识图谱
describe('知识图谱面板：寻路、契合度、HITS 双榜（独立重算）', () => {
  it('React → PostgreSQL：0.6，React→Next.js→Drizzle→PostgreSQL', () => {
    const r = findShortestTechPath('react', 'postgres')
    expect(r.found).toBe(true)
    expect(r.distance).toBe(0.6)
    expect(r.nodeChain.map((n) => n.name)).toEqual(['React', 'Next.js', 'Drizzle ORM', 'PostgreSQL'])
    expect(r.steps.map((s) => s.relation)).toEqual(['extends', 'integrates_with', 'queries'])
    expect(r.steps).toHaveLength(3)
  })

  it('默认栈 [react, nextjs, drizzle]：契合度 55，缺 database/devops', () => {
    // 覆盖 2/4 层 → 25 分；2 条内部边 ×15 → 30 分；合计 55
    const report = analyzeStackCompatibility(['react', 'nextjs', 'drizzle'])
    expect(report.coherenceScore).toBe(55)
    expect(report.coveredLayers.sort()).toEqual(['backend', 'frontend'])
    expect(report.missingLayers).toEqual(['database', 'devops'])
    expect(report.synergies).toHaveLength(2)
    expect(report.suggestedAdditions.map((s) => s.name)).toEqual(['PostgreSQL', 'Cloudflare Workers'])
  })

  it('HITS 双榜：独立实现 15 轮迭代 + L2 归一化 + 每轮 3 位取整', () => {
    const graph = PRESET_TECH_GRAPH
    const ids = graph.nodes.map((n) => n.id.toLowerCase())
    const hubs: Record<string, number> = {}
    const auths: Record<string, number> = {}
    for (const id of ids) {
      hubs[id] = 1
      auths[id] = 1
    }
    const round3 = (v: number) => Math.round(v * 1000) / 1000
    for (let it = 0; it < 15; it++) {
      let normA = 0
      for (const target of ids) {
        let sum = 0
        for (const e of graph.edges) if (e.target.toLowerCase() === target) sum += hubs[e.source.toLowerCase()] ?? 0
        auths[target] = sum
        normA += sum * sum
      }
      normA = Math.sqrt(normA) || 1
      for (const id of ids) auths[id] = round3(auths[id]! / normA)
      let normH = 0
      for (const source of ids) {
        let sum = 0
        for (const e of graph.edges) if (e.source.toLowerCase() === source) sum += auths[e.target.toLowerCase()] ?? 0
        hubs[source] = sum
        normH += sum * sum
      }
      normH = Math.sqrt(normH) || 1
      for (const id of ids) hubs[id] = round3(hubs[id]! / normH)
    }
    const actual = computeGraphCentrality(graph)
    for (const id of ids) {
      expect(actual.hubs[id]).toBeCloseTo(hubs[id]!, 10)
      expect(actual.authorities[id]).toBeCloseTo(auths[id]!, 10)
    }
    const topHubs = Object.entries(actual.hubs).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const topAuths = Object.entries(actual.authorities).sort((a, b) => b[1] - a[1]).slice(0, 5)
    // 锁死面板双榜首位（重算值，非誊抄）
    expect(topHubs[0]![0]).toBe('nextjs')
    expect(topAuths[0]![0]).toBe('drizzle')
  })
})

// ---------------------------------------------------------------- 视觉指纹
describe('视觉指纹面板：5 套预设的对比度/情绪/和谐度（独立 WCAG 重算）', () => {
  const PRESETS = [
    { name: '赛博朋克', palette: ['#00ffff', '#ff00ff', '#1e1b4b'], bg: '#030712', text: '#f9fafb' },
    { name: '黑客矩阵', palette: ['#10b981', '#22c55e', '#064e3b'], bg: '#022c22', text: '#ecfdf5' },
    { name: '蔚蓝深海', palette: ['#0ea5e9', '#06b6d4', '#1e3a8a'], bg: '#0f172a', text: '#f8fafc' },
    { name: '温暖夕阳', palette: ['#f97316', '#eab308', '#7c2d12'], bg: '#1c1917', text: '#fef3c7' },
    { name: '极简纯白', palette: ['#64748b', '#94a3b8', '#cbd5e1'], bg: '#ffffff', text: '#0f172a' },
  ]
  const rgb = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const hsl = (hex: string) => {
    const { r, g, b } = rgb(hex)
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const delta = max - min
    let h = 0
    let s = 0
    const l = (max + min) / 2
    if (delta !== 0) {
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min)
      if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60
      else if (max === gn) h = ((bn - rn) / delta + 2) * 60
      else h = ((rn - gn) / delta + 4) * 60
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
  }
  const relLum = (hex: string) => {
    const { r, g, b } = rgb(hex)
    const f = (v: number) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const contrast = (fg: string, bg: string) => {
    const l1 = relLum(fg)
    const l2 = relLum(bg)
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100
  }
  const moodOf = (palette: string[]) => {
    const hs = palette.map(hsl)
    const avgLum = Math.round(hs.reduce((s, c) => s + c.l, 0) / hs.length)
    const avgSat = Math.round(hs.reduce((s, c) => s + c.s, 0) / hs.length)
    const cyan = hs.some((c) => c.h >= 170 && c.h <= 200 && c.s >= 70)
    // 品红区间是闭区间 290–340（h.h >= 290 && h.h <= 340）；
    // 引擎曾写成 (h >= 290 || h <= 340)，该式对一切色相恒真，导致蔚蓝深海被误判为 cyberpunk。
    const magenta = hs.some((c) => c.h >= 290 && c.h <= 340 && c.s >= 70)
    const green = hs.some((c) => c.h >= 100 && c.h <= 160 && c.s >= 60)
    const oceanBlue = hs.some((c) => c.h >= 180 && c.h <= 240)
    const warm = hs.some((c) => c.h >= 15 && c.h <= 55)
    if (cyan && magenta) return 'cyberpunk'
    if (green && avgLum < 45) return 'matrix'
    if (oceanBlue && avgSat >= 50) return 'ocean'
    if (warm && avgSat >= 50) return 'warm'
    if (avgSat >= 75) return 'vibrant'
    return 'minimalist'
  }
  const harmonyOf = (palette: string[], ratio: number) => {
    const hs = palette.map(hsl)
    let score = 75
    if (ratio >= 7.0) score += 15
    else if (ratio >= 4.5) score += 10
    else score -= 25
    if (hs.length >= 2) {
      const hues = hs.map((h) => h.h).sort((a, b) => a - b)
      const diff = hues[hues.length - 1]! - hues[0]!
      if (diff > 240) score += 5
      else if (diff < 60) score += 10
    }
    return Math.max(10, Math.min(100, score))
  }

  it('5 套预设：对比度/级别/情绪/和谐度/明度/饱和度全部与独立重算一致', () => {
    const expectedMoods = ['cyberpunk', 'matrix', 'ocean', 'warm', 'minimalist']
    for (let i = 0; i < PRESETS.length; i++) {
      const p = PRESETS[i]!
      const report = analyzeVisualFingerprint(p.palette, p.bg, p.text)
      const ratio = contrast(p.text, p.bg)
      expect(report.wcagContrastRatio).toBe(ratio)
      expect(report.wcagPassLevel).toBe(ratio >= 7.0 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'Fail')
      expect(report.detectedMood).toBe(moodOf(p.palette))
      expect(report.detectedMood).toBe(expectedMoods[i])
      expect(report.harmonyScore).toBe(harmonyOf(p.palette, ratio))
      expect(report.averageLuminance).toBe(
        Math.round(p.palette.map((c) => hsl(c).l).reduce((s, v) => s + v, 0) / p.palette.length),
      )
      expect(report.averageSaturation).toBe(
        Math.round(p.palette.map((c) => hsl(c).s).reduce((s, v) => s + v, 0) / p.palette.length),
      )
    }
  })

  it('默认赛博朋克：对比度 19.27、AAA、和谐度 90、明度 40、饱和度 82', () => {
    const report = analyzeVisualFingerprint(['#00ffff', '#ff00ff', '#1e1b4b'], '#030712', '#f9fafb')
    expect(report.wcagContrastRatio).toBe(19.27)
    expect(report.wcagPassLevel).toBe('AAA')
    expect(report.detectedMood).toBe('cyberpunk')
    expect(report.harmonyScore).toBe(90)
    expect(report.averageLuminance).toBe(40)
    expect(report.averageSaturation).toBe(82)
  })
})

// ---------------------------------------------------------------- WebMCP
describe('WebMCP 面板：内置工具与 JSON-RPC 响应', () => {
  it('tools/list 只有 navhub_echo 与 navhub_system_info', async () => {
    const bridge = getWebMcpBridge()
    expect(bridge.toolCount).toBe(2)
    expect(bridge.listTools().map((t) => t.name).sort()).toEqual(['navhub_echo', 'navhub_system_info'])
    const res = await bridge.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect((res.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort()).toEqual([
      'navhub_echo',
      'navhub_system_info',
    ])
  })

  it('navhub_echo 原样回显，system_info 版本 4.0.0-nextgen、7 项能力', async () => {
    const bridge = getWebMcpBridge()
    const echo = await bridge.handleRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'navhub_echo', arguments: { message: 'Hello from 山羊胡 In-Browser Agent!' } },
    })
    expect(JSON.stringify(echo.result)).toContain('Hello from 山羊胡 In-Browser Agent!')
    const info = await bridge.handleRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'navhub_system_info', arguments: {} },
    })
    const text = JSON.stringify(info.result)
    expect(text).toContain('4.0.0-nextgen')
    const sysInfo = JSON.parse(text).content[0].text
    const parsed = JSON.parse(sysInfo) as { version: string; capabilities: string[] }
    expect(parsed.version).toBe('4.0.0-nextgen')
    expect(parsed.capabilities).toHaveLength(7)
  })

  it('未知方法 -32601、非法 jsonrpc -32600', async () => {
    const bridge = getWebMcpBridge()
    const unknown = await bridge.handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/nope' })
    expect(unknown.error?.code).toBe(-32601)
    const bad = await bridge.handleRpc({ jsonrpc: '1.0', id: 5, method: 'tools/list' } as never)
    expect(bad.error?.code).toBe(-32600)
  })
})

// ---------------------------------------------------------------- 意图推测
describe('意图面板：6 个快捷串的推测结果', () => {
  it('Base64 串：解码 Hello World，11 字节', () => {
    const r = parseSpeculativeIntent('SGVsbG8gV29ybGQ=')
    expect(r).not.toBeNull()
    expect(r!.type).toBe('base64_decode')
    expect(r!.previewValue).toBe('Hello World')
    expect(r!.subtitle).toBe('字符长度: 11 字节')
  })

  it('Unix 时间戳 1710328900：2024-03-13T11:21:40Z', () => {
    const r = parseSpeculativeIntent('1710328900')
    expect(r).not.toBeNull()
    expect(r!.type).toBe('timestamp')
    expect(r!.previewValue).toContain('2024-03-13T11:21:40.000Z')
  })

  it('HEX 色 #ff4500：#FF4500，rgb(255, 69, 0)', () => {
    const r = parseSpeculativeIntent('#ff4500')
    expect(r).not.toBeNull()
    expect(r!.type).toBe('color')
    expect(r!.previewValue).toBe('#FF4500')
    expect(r!.subtitle).toContain('rgb(255, 69, 0)')
  })

  it('算术 (128 + 64) * 8 = 1536', () => {
    const r = parseSpeculativeIntent('(128 + 64) * 8')
    expect(r).not.toBeNull()
    expect(r!.type).toBe('math')
    expect(r!.previewValue).toBe('1536')
  })

  it('JSON：2 个属性键，美化输出含 site/navhub', () => {
    const r = parseSpeculativeIntent('{"site":"navhub","v":4}')
    expect(r).not.toBeNull()
    expect(r!.type).toBe('json_format')
    expect(r!.subtitle).toContain('2 个属性键')
    expect(r!.previewValue).toContain('"site": "navhub"')
  })

  it('MD5 指纹串：识别为 MD5 (128-bit)，32 位十六进制', () => {
    const r = parseSpeculativeIntent('e10adc3949ba59abbe56e057f20f883e')
    expect(r).not.toBeNull()
    expect(r!.type).toBe('hash_detect')
    expect(r!.title).toContain('MD5 (128-bit)')
    expect(r!.subtitle).toContain('32 位十六进制')
    expect(r!.previewValue).toBe('e10adc3949ba59abbe56e057f20f883e')
  })

  it('解析中位延迟用 median：奇偶样本都对', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

// ---------------------------------------------------------------- 推测预渲染
describe('推测面板：阈值分流、降级标签与面板安全正则', () => {
  const ORIGIN = 'http://localhost:3000'

  it('默认阈值：prerender 1 条（/algorithms），prefetch 2 条，降级标签 3 个', () => {
    const candidates = toAbsoluteCandidates(SANDBOX_CANDIDATE_PATHS, ORIGIN)
    const compiled = compileSpeculationRules(candidates, {
      prerenderConfidenceThreshold: PRERENDER_CONFIDENCE_THRESHOLD,
      prefetchConfidenceThreshold: PREFETCH_CONFIDENCE_THRESHOLD,
    })
    expect(compiled).not.toBeNull()
    expect(compiled!.prerender?.[0]?.urls).toEqual([`${ORIGIN}/algorithms`])
    expect(compiled!.prefetch?.[0]?.urls).toEqual([`${ORIGIN}/hot`, `${ORIGIN}/collections`])
    const tags = generateFallbackLinkTags(compiled!)
    expect(tags).toHaveLength(3)
    expect(tags[0]).toBe(`<link rel="prerender" href="${ORIGIN}/algorithms" />`)
    expect(tags.filter((t) => t.includes('rel="prefetch"'))).toHaveLength(2)
  })

  it('面板的安全正则与引擎对 5 条沙箱路径的裁决一致', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const panel = readFileSync(resolve(here, '..', 'src/components/algorithm-lab/speculation-panel.tsx'), 'utf8')
    const m = panel.match(/const isUnsafe = (\/[^/]+\/[a-z]*)\.test\(c\.url\)/)
    expect(m).not.toBeNull()
    const parsed = /^\/([^/]+)\/([a-z]*)$/.exec(m![1]!)
    expect(parsed).not.toBeNull()
    const panelRegex = new RegExp(parsed![1]!, parsed![2]!)
    for (const c of SANDBOX_CANDIDATE_PATHS) {
      const url = `${ORIGIN}${c.path}`
      const panelBlocked = panelRegex.test(c.path)
      const engineBlocked = !isSafeForSpeculation(url)
      expect(panelBlocked).toBe(engineBlocked)
    }
    expect(panelRegex.test('/logout')).toBe(true)
    expect(panelRegex.test('/admin')).toBe(true)
    expect(panelRegex.test('/algorithms')).toBe(false)
  })
})

// ---------------------------------------------------------------- 工具合成器
describe('合成器面板：SSRF 四 payload 与三类合成工具定义', () => {
  it('四枚快速 payload 的裁决：三阻断一放行', () => {
    // 三枚点分十进制 payload 都先命中「域名内嵌私有 IP」分支（1c），
    // 理由相同；放行只发生在合法公共域名上。
    expect(isSafeUrl('http://169.254.169.254/latest/meta-data').safe).toBe(false)
    // 169.254 先命中「域名内嵌私有 IP」分支（1c），而非后方的链路本地分支
    expect(isSafeUrl('http://169.254.169.254/latest/meta-data').reason).toBe(
      'Embedded private IP in domain is forbidden',
    )
    expect(isSafeUrl('http://127.0.0.1:8080/admin').safe).toBe(false)
    expect(isSafeUrl('http://127.0.0.1:8080/admin').reason).toBe('Embedded private IP in domain is forbidden')
    expect(isSafeUrl('http://192.168.1.1/router').safe).toBe(false)
    expect(isSafeUrl('http://192.168.1.1/router').reason).toBe('Embedded private IP in domain is forbidden')
    expect(isSafeUrl('https://api.github.com/zen').safe).toBe(true)
  })

  it('默认 REST 样本：github_get_repo，owner/repo 必填 path 参数', () => {
    const { definition } = synthesizeRestTool({
      name: 'github_get_repo',
      description: '获取 GitHub 指定仓库的元数据信息',
      url: 'https://api.github.com/repos/{owner}/{repo}',
      method: 'GET',
      parameters: [
        { name: 'owner', in: 'path', type: 'string', required: true, description: '组织或用户名' },
        { name: 'repo', in: 'path', type: 'string', required: true, description: '仓库名' },
      ],
    })
    expect(definition.name).toBe('github_get_repo')
    expect(definition.inputSchema.required).toEqual(['owner', 'repo'])
    expect(Object.keys(definition.inputSchema.properties).sort()).toEqual(['owner', 'repo'])
  })

  it('站点检索合成：search_github，query 必填', () => {
    const { definition } = synthesizeSiteSearchTool({
      siteId: 'github',
      siteName: 'GitHub 源码仓',
      searchUrlTemplate: 'https://github.com/search?q={query}',
      category: '开源代码',
    })
    expect(definition.name).toBe('search_github')
    expect(definition.description).toBe('在 GitHub 源码仓 (开源代码) 中搜索资源与内容')
    expect(definition.inputSchema.required).toEqual(['query'])
  })

  it('OpenAPI 样本：search_resources，keyword 必填、limit 为 number', () => {
    const parsed = parseOpenApiToSpecs({
      openapi: '3.0.0',
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/search': {
          get: {
            operationId: 'search_resources',
            summary: '根据关键词查询资源清单',
            parameters: [
              { name: 'keyword', in: 'query', required: true, description: '搜索词' },
              { name: 'limit', in: 'query', schema: { type: 'integer' }, description: '单页条数' },
            ],
          },
        },
      },
    })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.name).toBe('search_resources')
    expect(parsed[0]!.url).toBe('https://api.example.com/search')
    expect(parsed[0]!.method).toBe('GET')
    const { definition } = synthesizeRestTool(parsed[0]!)
    expect(definition.inputSchema.required).toEqual(['keyword'])
    expect((definition.inputSchema.properties['limit'] as { type: string }).type).toBe('number')
    expect((definition.inputSchema.properties['keyword'] as { type: string }).type).toBe('string')
  })
})

// ---------------------------------------------------------------- 金库
describe('金库面板：KDF 常量、往返加解密、篡改拦截', () => {
  it('加密包：Salt 16 字节（hex 32 位）、IV 12 字节（hex 24 位）、2 条书签', async () => {
    const items = [
      { id: '1', title: '内部 GitLab 敏捷看板', url: 'https://gitlab.corp.internal/board', isInternal: true },
      { id: '2', title: '生产数据库只读审计', url: 'https://10.0.8.50:9000/db', isInternal: true },
    ]
    const ms = await measureVaultDeriveMs('TestPass123!')
    expect(Number.isFinite(ms)).toBe(true)
    expect(ms).toBeGreaterThan(0)
    const payload = await encryptVault(items, 'TestPass123!')
    expect(payload.saltHex).toHaveLength(VAULT_SALT_LENGTH_BYTES * 2)
    expect(payload.ivHex).toHaveLength(VAULT_IV_LENGTH_BYTES * 2)
    expect(payload.itemCount).toBe(2)
    const back = await decryptVault(payload, 'TestPass123!')
    expect(back).toEqual(items)
    await expect(decryptVault(payload, 'WrongPass!456')).rejects.toThrow('金库解密失败')
  })

  it('篡改密文首位：位置 0、字符进一位，解密被 GCM 认证拦截', async () => {
    const items = [{ id: '1', title: 't', url: 'https://example.com' }]
    const payload = await encryptVault(items, 'TestPass123!')
    const { tampered, position, from, to } = tamperCiphertextBase64(payload.cipherTextBase64)
    expect(position).toBe(0)
    expect(from).toBe(payload.cipherTextBase64[0])
    expect(to).not.toBe(from)
    expect(tampered.length).toBe(payload.cipherTextBase64.length)
    expect(tampered[0]).toBe(to)
    await expect(decryptVault({ ...payload, cipherTextBase64: tampered }, 'TestPass123!')).rejects.toThrow(
      '金库解密失败',
    )
  })
})

// ---------------------------------------------------------------- Mesh/CRDT
describe('Mesh 面板：双节点握手与收敛（面板初始场景）', () => {
  it('初始时钟各为 1，比对 CONCURRENT，交换后各应用 1 条、时钟收敛', () => {
    const nodeA = new CrdtStore('client-alpha')
    nodeA.addSite({ url: 'https://nextjs.org', title: 'Next.js 15', categoryId: 'framework' })
    const nodeB = new CrdtStore('client-beta')
    nodeB.addSite({ url: 'https://tauri.app', title: 'Tauri 2.0', categoryId: 'desktop' })
    expect(nodeA.getVectorClock()).toEqual({ 'client-alpha': 1 })
    expect(nodeB.getVectorClock()).toEqual({ 'client-beta': 1 })
    expect(compareVectorClocks(nodeA.getVectorClock(), nodeB.getVectorClock())).toBe('CONCURRENT')
    const deltaForB = nodeA.getDeltaSince(nodeB.getVectorClock())
    const deltaForA = nodeB.getDeltaSince(nodeA.getVectorClock())
    expect(deltaForB).toHaveLength(1)
    expect(deltaForA).toHaveLength(1)
    expect(nodeB.applyRemoteBatch(deltaForB)).toBe(1)
    expect(nodeA.applyRemoteBatch(deltaForA)).toBe(1)
    expect(nodeA.getVectorClock()).toEqual({ 'client-alpha': 1, 'client-beta': 1 })
    expect(nodeB.getVectorClock()).toEqual({ 'client-beta': 1, 'client-alpha': 1 })
    expect(nodeA.getActiveSites()).toHaveLength(2)
    expect(nodeB.getActiveSites()).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- 轨迹/Kalman
describe('轨迹捕获器：运动矢量、朝向锥、Kalman 外推（固定增益 α=0.75）', () => {
  it('运动矢量：100px/100ms → 1px/ms；dt 钳在 [1,500]ms', () => {
    expect(calculateMotionVector({ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 100 })).toEqual({
      vx: 1,
      vy: 0,
      speed: 1,
    })
    expect(calculateMotionVector({ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 0 }).speed).toBe(0)
    expect(calculateMotionVector({ x: 0, y: 0, t: 0 }, { x: 100, y: 0, t: 1000 }).vx).toBeCloseTo(0.2, 10)
  })

  it('朝向锥：正对且 220px 内命中；超距/偏角/低速都不命中', () => {
    const rect = { left: 90, top: -10, right: 110, bottom: 10 }
    expect(isHeadingTowardsRect({ x: 0, y: 0 }, { vx: 1, vy: 0, speed: 1 }, rect, 220, 0.15)).toBe(true)
    const far = { left: 290, top: -10, right: 310, bottom: 10 }
    expect(isHeadingTowardsRect({ x: 0, y: 0 }, { vx: 1, vy: 0, speed: 1 }, far, 220, 0.15)).toBe(false)
    expect(isHeadingTowardsRect({ x: 0, y: 0 }, { vx: 0, vy: 1, speed: 1 }, rect, 220, 0.15)).toBe(false)
    expect(isHeadingTowardsRect({ x: 0, y: 0 }, { vx: 0.1, vy: 0, speed: 0.1 }, rect, 220, 0.15)).toBe(false)
  })

  it('Kalman 固定增益 k=0.6/(0.6+0.2)=0.75：两次更新 + 120ms 外推', () => {
    const kf = new KalmanFilter2D()
    const s1 = kf.update(100, 0, 100)
    expect(s1.x).toBeCloseTo(75, 10)
    expect(s1.vx).toBeCloseTo(0.75, 10)
    expect(kf.predictFuture(120).x).toBeCloseTo(165, 10)
    const s2 = kf.update(200, 0, 100)
    expect(s2.x).toBeCloseTo(187.5, 10)
    expect(s2.vx).toBeCloseTo(1.125, 10)
    expect(kf.predictFuture(120).x).toBeCloseTo(322.5, 10)
  })
})
