/**
 * 投稿表单 AI 自动流守卫（自动识别→自动采集→自动选主分类升级）。
 *
 * 环境：node vitest 无 jsdom，组件挂载测不了（同 handoff-card.test.ts 说明），
 * 接线纪律走源码守卫体例钉死：
 *  - URL 防抖自动触发（800ms + 同 URL 不重复触发），手动按钮保留做重试；
 *  - 自动采集增强态：图标预览、查重预告、采集状态文案；
 *  - 自动选主分类：低置信度/备选候选 chips 一键切换（含「当前选择」合并展示）；
 *  - categories payload 带 description（分类语料增强的前端供给）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))

function overlaySource(rel: string): string {
  const candidates = [resolve(HERE, '..', rel), resolve(HERE, '..', '..', 'web-overlay', rel)]
  const hit = candidates.find((p) => p.replace(/\\/g, '/').includes('/web-overlay/') && existsSync(p))
  if (!hit) throw new Error('无法定位 overlay 文件 ' + rel)
  return readFileSync(hit, 'utf8')
}

const form = overlaySource('src/components/submission-form.tsx')

describe('投稿表单 AI 自动流守卫', () => {
  it('URL 防抖自动触发：800ms 定时器 + 同 URL 不重复触发 + 手动按钮保留', () => {
    // 自动触发用防抖定时器，且以 lastAutoUrl 去重（同一 URL 不重复烧 LLM）
    expect(form).toContain('autoTimerRef')
    expect(form).toContain('lastAutoUrlRef')
    expect(form).toMatch(/setTimeout\(\(\) => \{[\s\S]{0,120}handleAiPrefill\(\)/)
    expect(form).toContain(', 800)')
    // 手动按钮仍在（识别失败后的重试入口）
    expect(form).toContain('onClick={handleAiPrefill}')
  })

  it('自动采集增强态：图标预览 + 查重预告 + 采集状态文案齐备', () => {
    expect(form).toContain('aiEnhance')
    // 图标预览 img + 加载失败静默收起
    expect(form).toContain('aiEnhance.icon')
    expect(form).toContain('站点图标预览')
    // 查重预告：duplicateSiteId 有值时出 Alert
    expect(form).toContain('duplicateSiteId')
    expect(form).toContain('该网址已被本站收录')
    // 采集中/已采集的状态文案
    expect(form).toContain('正在采集站点元数据并分析分类')
    expect(form).toContain('已采集站点图标与元数据')
  })

  it('自动选主分类：候选 chips 一键切换 + 低置信度提示 + 当前选择合并', () => {
    expect(form).toContain('aiEnhance.candidates')
    expect(form).toContain('AI 对分类把握不足')
    expect(form).toContain('AI 备选分类（可一键切换）')
    // chips 点击写入 category/subcategory
    expect(form).toMatch(/onClick=\{\(\) => setFormData\(\(prev\) => \(\{ \.\.\.prev, category: cand\.category/)
    // 当前选择与备选合并展示
    expect(form).toContain("reason: '当前选择'")
  })

  it('分类语料供给：categories payload 带 description（主分类与子分类）', () => {
    const payloadBlock = form.slice(form.indexOf('categoriesPayload'), form.indexOf('/api/hub/submissions/prefill'))
    expect(payloadBlock).toContain('description')
    expect(payloadBlock).toContain('subCategories')
  })

  it('识别响应全量接住升级字段（confidence/candidates/icon/duplicate）', () => {
    expect(form).toContain('p.confidence')
    expect(form).toContain('p.candidates')
    expect(form).toContain('p.icon')
    expect(form).toContain('p.duplicate')
  })

  it('在飞改网址不跳识别：去掉 isAiPrefilling 布尔锁，新请求必发、旧请求靠 seq 丢弃', () => {
    // 入口只判空 URL，不再用布尔锁拒绝新请求（否则新 URL 被 lastAutoUrlRef
    // 误标已识别、永不自动填表）
    expect(form).toContain('if (!targetUrl) return')
    expect(form).not.toMatch(/if \(!targetUrl \|\| isAiPrefilling\) return/)
    // 防抖回调标记已识别后确实调用识别入口
    expect(form).toMatch(/lastAutoUrlRef\.current = url\s*\n\s*void handleAiPrefill\(\)/)
  })

  it('异步竞态防护：请求序号 + 最新 URL 双守卫，旧响应不得覆盖新 URL 表单', () => {
    expect(form).toContain('prefillSeqRef')
    expect(form).toContain('latestUrlRef')
    expect(form).toMatch(/seq !== prefillSeqRef\.current \|\| latestUrlRef\.current !== targetUrl\) return/)
    // 成功与 catch / finally 都判序号（旧请求不落地、不误关新请求的 loading）
    expect(form).toContain('if (seq !== prefillSeqRef.current) return')
    expect(form).toContain('if (seq === prefillSeqRef.current) setIsAiPrefilling(false)')
  })

  it('分类一致性：主分类变化时旧子分类不得沿用', () => {
    expect(form).toContain('nextCategory === prev.category')
    expect(form).toMatch(/nextCategory === prev\.category\s*\n\s*\? \(p\.subcategory \|\| prev\.subcategory\)/)
  })

  it('提交成功后清理识别态：旧图标/查重不留、同一网址可再识别', () => {
    // 提交成功分支里清 aiEnhance + refs（否则再次输入同一网址防抖不触发）
    const successBlock = form.slice(form.indexOf('if (data.success)'))
    expect(successBlock).toContain('setAiEnhance(null)')
    expect(successBlock).toContain("lastAutoUrlRef.current = ''")
    expect(successBlock).toContain('clearTimeout(autoTimerRef.current)')
  })

  it('细节纪律：查重/图标只认当前 URL、重复禁提交、手动触发掐防抖、识别先清旧态', () => {
    // checkedUrl 作用域：改 URL 后旧查重/图标不得误伤新地址
    expect(form).toContain('checkedUrl')
    expect(form).toMatch(/duplicateSiteId && aiEnhance\.checkedUrl === formData\.url\.trim\(\)/)
    // 已知重复禁用提交按钮（点了必 409）
    expect(form).toMatch(/disabled=\{isSubmitting \|\| Boolean\(aiEnhance\?\.duplicateSiteId/)
    // 手动按钮与防抖共用入口时掐掉挂起定时器 + 记账 lastAutoUrl（防 800ms 内重复识别）
    expect(form).toContain('clearTimeout(autoTimerRef.current)')
    expect(form).toContain('lastAutoUrlRef.current = targetUrl')
    // 新一轮识别先清上一轮增强态（失败不留旧 icon/查重提示）
    expect(form).toContain('setAiEnhance(null)')
  })
})
