import { describe, it, expect } from 'vitest'
import { evaluateVideoWithAIModel } from '../src/lib/video-autonomous-ai-harvester'
import { calculateFreshnessScore, calculateQualityScore, parseDurationToSeconds } from '../src/lib/video-scoring'

/**
 * 回归守卫：AI 审核的关键词匹配与评分方向。
 *
 * 历史实现有两个真问题：
 *   a) 词表只有英文，而真实入库内容 90% 是中文标题 —— 实测 11 条候选被拒 7 条
 *      （李宏毅/吴恩达/SpringBoot3/JavaScript/RabbitMQ/C++/Git 全部「未识别到关键词」）；
 *   b) 用 `new RegExp(kw)` 匹配，词表里出现 `C++` 会因正则元字符抛
 *      `Invalid regular expression: nothing to repeat`，整个采集循环中断。
 */

describe('evaluateVideoWithAIModel — 中文内容不能被误杀', () => {
  const cases: Array<[string, number]> = [
    ['李宏毅 2021/2022 机器学习与深度学习前沿：从 Transformer 到大模型原理实战', 314062],
    ['吴恩达机器学习经典全套：从监督学习算法到神经网络与工程诊断', 69864],
    ['黑马程序员 SpringBoot3 + Vue3 全套视频教程：企业级全栈开发实战', 87120],
    ['JavaScript 前端全套课程：DOM / BOM / ES6 新语法与异步编程实战', 188921],
    ['RabbitMQ 高可用消息队列：从延迟队列、死信队列到分布式集群运维', 41829],
    ['黑马程序员 C++ 教程从 0 到 1：系统编程、内存模型、STL 泛化与多态实战', 188972],
    ['Git 进阶与项目版本控制：分支策略、冲突解决与 GitHub 协同工作流', 6570],
  ]

  for (const [title, durationSec] of cases) {
    it(`承认中文技术课程：「${title.slice(0, 18)}…」`, () => {
      const res = evaluateVideoWithAIModel({ title, durationSec })
      expect(res.isApproved, `${title} 被误杀：${res.rejectReason}`).toBe(true)
      expect(res.aiQualityScore).toBeGreaterThanOrEqual(70)
      expect(res.conceptTags.length).toBeGreaterThan(0)
    })
  }

  it('标题含 C++ / CI/CD / Next.js 时不因正则元字符抛异常', () => {
    // 旧实现 new RegExp('C++') 直接抛 Invalid regular expression
    expect(() =>
      evaluateVideoWithAIModel({ title: 'C++ 与 CI/CD 流水线实战（Next.js 前端）', durationSec: 2400 })
    ).not.toThrow()
    const res = evaluateVideoWithAIModel({
      title: 'C++ 与 CI/CD 流水线实战（Next.js 前端）',
      durationSec: 2400,
    })
    expect(res.conceptTags).toContain('C++')
    expect(res.conceptTags).toContain('CI/CD')
  })

  it('真正的非技术内容仍被拒绝', () => {
    const res = evaluateVideoWithAIModel({ title: '日常搞笑 vlog 真实记录', durationSec: 1200 })
    expect(res.isApproved).toBe(false)
    expect(res.rejectReason).toContain('未匹配到技术栈关键词')
  })

  it('标题党分数必须低于同内容正常标题（评分方向不能反）', () => {
    const normal = evaluateVideoWithAIModel({
      title: 'TypeScript 5.8 与 React 19 最佳实践',
      durationSec: 1500,
    })
    const clickbait = evaluateVideoWithAIModel({
      title: '震惊！全网最强 TypeScript 5.8 与 React 19 秒杀所有架构！',
      durationSec: 1500,
    })

    expect(clickbait.detectedClickbait).toBe(true)
    // 旧实现：堆关键词带来的 +10 抵消了 -8 惩罚，clickbait 反而 95 > 正常 93
    expect(clickbait.aiQualityScore).toBeLessThan(normal.aiQualityScore)
  })
})

describe('保鲜分：未知发布时间不能被当成「刚发布」', () => {
  it('publishedAt 缺失时返回保守值，而不是接近满分', () => {
    const score = calculateFreshnessScore(undefined, 90, 90)
    // 90 * 0.8 = 72
    expect(score).toBe(72)
    expect(score).toBeLessThan(90)
  })

  it('两年前的视频按半衰期明显衰减，且旧年份标题额外扣分', () => {
    const twoYearsAgo = new Date(Date.now() - 730 * 24 * 3600 * 1000).toISOString()
    const plain = calculateFreshnessScore(twoYearsAgo, 90, 90)
    const withOldYear = calculateFreshnessScore(twoYearsAgo, 90, 90, '2021 年经典课程')
    expect(plain).toBeLessThan(50)
    expect(withOldYear).toBeLessThanOrEqual(plain)
  })
})

describe('质量分与时长解析', () => {
  it('没有统计数据时返回中性分，不因缺失而虚高', () => {
    expect(calculateQualityScore(undefined)).toBe(70)
  })

  it('解析 B 站两种时长格式', () => {
    expect(parseDurationToSeconds('12:34')).toBe(754)
    expect(parseDurationToSeconds('1:02:03')).toBe(3723)
    expect(parseDurationToSeconds(600)).toBe(600)
    expect(parseDurationToSeconds(undefined)).toBe(0)
  })
})
