import { describe, it, expect } from 'vitest'
import {
  routeVideoToSubcategory,
  isFuzzyDuplicateVideo,
  extractTechBadgesAndDifficulty,
  normalizeVideoCoverUrl,
} from '@/lib/video-subcategory-router'
import type { NavigationSubCategory } from '@/types/navigation'

describe('Intelligent Subcategory Router & Semantic Classifier', () => {
  const aiSubCategories: NavigationSubCategory[] = [
    { id: 'sub_ai_llm', title: '大模型与本地部署推理', items: [] },
    { id: 'sub_ai_agent', title: 'AI Agent 与智能编程工作流', items: [] },
    { id: 'sub_ai_algo', title: '深度学习与模型算法精粹', items: [] },
  ]

  const mobileSubCategories: NavigationSubCategory[] = [
    { id: 'sub_mob_cross', title: 'Flutter 与 React Native 跨平台开发', items: [] },
    { id: 'sub_mob_harmony', title: 'HarmonyOS 鸿蒙 NEXT 原生开发', items: [] },
    { id: 'sub_mob_native', title: 'Android 与 iOS 原生工程进阶', items: [] },
  ]

  const systemsSubCategories: NavigationSubCategory[] = [
    { id: 'sub_sys_rust', title: 'Rust 系统级开发与并发', items: [] },
    { id: 'sub_sys_go', title: 'Go 语言底层与高并发实战', items: [] },
    { id: 'sub_sys_os', title: '操作系统内核与 GPU 并行计算', items: [] },
  ]

  describe('routeVideoToSubcategory', () => {
    it('accurately routes DeepSeek/Ollama to 大模型与本地部署推理', () => {
      const match = routeVideoToSubcategory(
        { title: 'DeepSeek-R1 满血版本地部署与 Ollama 量化实战' },
        aiSubCategories
      )
      expect(match.targetSub.id).toBe('sub_ai_llm')
      expect(match.score).toBeGreaterThan(10)
    })

    it('accurately routes Cursor/Agent to AI Agent 与智能编程工作流', () => {
      const match = routeVideoToSubcategory(
        { title: '基于 Cursor 与 Claude 3.7 构建自动化 AI Agent 多智能体协同流水线' },
        aiSubCategories
      )
      expect(match.targetSub.id).toBe('sub_ai_agent')
      expect(match.matchedKeywords).toContain('cursor')
    })

    it('accurately routes PyTorch/Transformer to 深度学习与模型算法精粹', () => {
      const match = routeVideoToSubcategory(
        { title: '从零手写 Transformer 注意力机制与 PyTorch 反向传播原理' },
        aiSubCategories
      )
      expect(match.targetSub.id).toBe('sub_ai_algo')
    })

    it('accurately routes HarmonyOS to 鸿蒙 NEXT 原生开发', () => {
      const match = routeVideoToSubcategory(
        { title: '纯血鸿蒙 HarmonyOS NEXT ArkUI 实战教程' },
        mobileSubCategories
      )
      expect(match.targetSub.id).toBe('sub_mob_harmony')
    })

    it('accurately routes Flutter to Flutter 与 React Native 跨平台开发', () => {
      const match = routeVideoToSubcategory(
        { title: 'Flutter 3.29 跨平台企业级项目架构实战' },
        mobileSubCategories
      )
      expect(match.targetSub.id).toBe('sub_mob_cross')
    })

    it('accurately routes Go to Go 语言底层与高并发实战', () => {
      const match = routeVideoToSubcategory(
        { title: 'Golang GMP 调度模型深度解析与 Goroutine 并发调优' },
        systemsSubCategories
      )
      expect(match.targetSub.id).toBe('sub_sys_go')
    })

    it('accurately routes Rust to Rust 系统级开发与并发', () => {
      const match = routeVideoToSubcategory(
        { title: 'Rust Tokio 异步运行时内部机制与多线程内存安全' },
        systemsSubCategories
      )
      expect(match.targetSub.id).toBe('sub_sys_rust')
    })

    it('balances traffic to least populated subcategory when no semantic keywords match', () => {
      const dummySubs: NavigationSubCategory[] = [
        { id: 'sub_1', title: '方向甲', items: [{ id: '1' }, { id: '2' }] as any },
        { id: 'sub_2', title: '方向乙', items: [] as any },
        { id: 'sub_3', title: '方向丙', items: [{ id: '3' }] as any },
      ]
      const match = routeVideoToSubcategory(
        { title: '完全无关的未知技术综合探讨' },
        dummySubs
      )
      // sub_2 has 0 items, should balance to sub_2
      expect(match.targetSub.id).toBe('sub_2')
    })
  })

  describe('isFuzzyDuplicateVideo', () => {
    const existing = [
      '【2025最新】Kubernetes K8s 架构深度实战（全套完整版源码）',
      'Flutter 3 全栈实战开发从入门到进阶',
    ]

    it('detects near-identical video title with different noise tags', () => {
      const dup = isFuzzyDuplicateVideo(
        '[4K超清] Kubernetes K8s 架构深度实战教程 (完整版)',
        existing
      )
      expect(dup.isDuplicate).toBe(true)
      expect(dup.matchedTitle).toBe(existing[0])
    })

    it('allows different tutorials on the same tech stack', () => {
      const diff = isFuzzyDuplicateVideo(
        'Kubernetes 网络插件 Cilium 与 eBPF 性能调优实战',
        existing
      )
      expect(diff.isDuplicate).toBe(false)
    })
  })

  describe('extractTechBadgesAndDifficulty', () => {
    it('extracts tech tokens and labels advanced difficulty for kernel/deep topics', () => {
      const result = extractTechBadgesAndDifficulty(
        'DeepSeek 大模型底层架构与算子加速源码深度剖析',
        '讲解 Transformer 注意力与 GPU 并行'
      )
      expect(result.tags).toContain('DeepSeek')
      expect(result.tags).toContain('Transformer')
      expect(result.difficulty).toBe('advanced')
    })

    it('labels beginner difficulty for starter tutorials', () => {
      const result = extractTechBadgesAndDifficulty(
        '零基础小白 30 分钟速成 Docker 容器入门指南'
      )
      expect(result.tags).toContain('Docker')
      expect(result.difficulty).toBe('beginner')
    })
  })

  describe('normalizeVideoCoverUrl', () => {
    it('normalizes protocol-relative and http URLs to https', () => {
      expect(normalizeVideoCoverUrl('//i0.hdslb.com/bfs/archive/pic.jpg')).toBe(
        'https://i0.hdslb.com/bfs/archive/pic.jpg'
      )
      expect(normalizeVideoCoverUrl('http://img.example.com/cover.png')).toBe(
        'https://img.example.com/cover.png'
      )
    })

    it('strips low-resolution sizing query from Bilibili covers for crisp rendering', () => {
      expect(
        normalizeVideoCoverUrl('https://i0.hdslb.com/bfs/archive/abc.jpg@320w_200h.webp')
      ).toBe('https://i0.hdslb.com/bfs/archive/abc.jpg')
    })
  })
})
