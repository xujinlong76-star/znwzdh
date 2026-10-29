/**
 * [AI-3] 端到端流式对话 —— 浏览器实测（真实 Chromium，逐段输出 / 停止 / 引用 / 降级）。
 *
 * 为什么必须开浏览器：单测能钉住帧解析与渲染分支，但「逐段输出到底是不是逐段」
 * 「停止按钮到底掐没掐断连接」「草稿有没有可能提前变成可点击链接」都是
 * 传输层 + React 提交时机 + a11y 的合成效应，tsc 和 vitest 都看不见。
 *
 * 栈（全部隔离，不碰并行会话的 8787/3200 与共享 dev 库）：
 *   假模型上游  http://127.0.0.1:8899      （fake-llm.mjs，220ms/半片，含 1 条真候选 + 1 条编造链接）
 *   山羊胡中枢  http://127.0.0.1:8912      （当前工作树启动，库=data/e2e/navhub-ai3-stream.db）
 *   前端        http://127.0.0.1:3412      （next dev，NEXT_DIST_DIR=.next-ai3-dev）
 *
 * 判据来自 ui-audit-2026-10-26 与今天两轮翻车的教训：
 *   1) 选择器必须钉死到 `[role="dialog"][aria-label="智能导航伴侣"]`——裸 `[role="dialog"]`
 *      在严格模式下命中多个节点，innerText 直接返回空串，于是「文案没出现」被误判成产品缺陷；
 *   2) 草稿正文只能取草稿气泡里的 `p.whitespace-pre-wrap`，尾注
 *      「已输出 N 字（尚未定稿）」是个独立 span，取到它就把「长度 16」当成了草稿；
 *   3) 采样必须在页面内跑（page.evaluate 里 setTimeout 轮询）——每次采样一趟
 *      Node↔浏览器往返约 1s，比整条 3s 的流还慢，流早就结束了才采到「停止按钮不见了」；
 *   4) 状态文案在 `role="status"` 的 sr-only 读屏区，不在可视文本里：innerText 永远读不到，
 *      必须 textContent，且要按「变化序列」而不是「某一瞬间」判，因为它只播报一次；
 *   5) 「逐段」的硬判据是增量前缀链，不是「文字在变」——尾注计数器也在变（消融实测：
 *      故意读尾注时，旧的「长度变长 + 指纹数≥3」判据照样绿灯）；
 *   6) 每一轮都要能证明「中枢这一轮真的走了模型」：本机端口被别的客户端共用时，
 *      降级 JSON 会伪装成「前端没有逐段输出」。做法是给每相问题打 `#巡检X` 归属标记，
 *      跑完拿假模型上游日志对账：上游没收到 = BLOCKED（环境不成立），
 *      上游收到了而 UI 没看到流 = 真缺陷。
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('./results/', import.meta.url))
mkdirSync(OUT, { recursive: true })
const FAKE_LOG = fileURLToPath(new URL('./fake-llm.log', import.meta.url))
const BASE = process.env.AI3_BASE || 'http://127.0.0.1:3412'
const HUB = process.env.AI3_HUB || 'http://127.0.0.1:8912'
const QUESTION = '有没有做视频剪辑的站点'
const DIALOG = '[role="dialog"][aria-label="智能导航伴侣"]'
const INPUT = '[aria-label="输入你的问题或需求"]'
const IGNORED_CONSOLE = [/data-trae-ref/i, /Download the React DevTools/i, /chrome-extension:\/\//i, /favicon/i, /\[HMR\]/i]

const results = []
/** 三态：true 通过 / false 缺陷 / 'blocked' 前置条件不成立（不许混进通过率，也不许伪装成缺陷） */
const record = (name, verdict, detail) => {
  const kind = verdict === 'blocked' ? 'blocked' : verdict ? 'pass' : 'fail'
  results.push({ name, kind, pass: kind === 'pass', detail })
  console.log((kind === 'pass' ? 'PASS ' : kind === 'blocked' ? 'BLOCK ' : 'FAIL ') + name + ' :: ' + JSON.stringify(detail).slice(0, 500))
}
const streamVerdict = (observed, servedUpstream) => (observed ? true : servedUpstream ? false : 'blocked')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 上游日志里这一相被调用了几次（`#巡检B` 之类的标记由假模型原样打点） */
function upstreamCalls(tag) {
  let log = ''
  try {
    log = readFileSync(FAKE_LOG, 'utf8')
  } catch {
    return { tagged: 0, untagged: 0 }
  }
  return {
    tagged: (log.match(new RegExp('call tag=#巡检' + tag + '( |$)', 'g')) ?? []).length,
    untagged: (log.match(/call tag=untagged/g) ?? []).length,
  }
}

/**
 * 页面内采样器：整个循环跑在浏览器里，一次 evaluate 拿回全部证据。
 * 传进 page.evaluate 只能是自包含函数，所以 FNV 在这里再写一遍。
 */
async function recorder(o) {
  const fnv = (s) => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
      h >>>= 0
    }
    return h.toString(16)
  }
  const stopButtons = (root) =>
    [...root.querySelectorAll('button')].filter((b) => (b.textContent || '').replace(/\s/g, '') === '停止' && b.offsetParent !== null)

  const snap = () => {
    const root = document.querySelector(o.dialogSel)
    if (!root) return null
    // 草稿气泡唯一标识：尾注 span「（尚未定稿）」→ 上两级就是气泡，正文是气泡里唯一的 p
    const tail = [...root.querySelectorAll('span')].find((s) => (s.textContent || '').includes('尚未定稿'))
    const bubble = tail?.parentElement?.parentElement ?? null
    const dp = bubble ? bubble.querySelector('p.whitespace-pre-wrap') : null
    // 消融口（AI3_ABLATE=tail-label）：故意退回「读尾注」的第一版写法，
    // 用来证明 B2 真的依赖草稿正文节点，而不是碰巧通过的。
    const draftSrc = o.ablateTailLabel ? tail : dp
    const draft = draftSrc ? draftSrc.textContent || '' : null
    return {
      status: [...root.querySelectorAll('[role="status"]')].map((e) => (e.textContent || '').trim()).join('|'),
      draft,
      draftAnchors: dp ? dp.querySelectorAll('a').length : -1,
      stop: stopButtons(root).length > 0,
      stopCount: stopButtons(root).length,
      busy: !!root.querySelector('#copilot-busy-hint'),
      citationCount: root.querySelectorAll('[aria-label="参考来源"] a[href]').length,
      citationLabel: [...root.querySelectorAll('[aria-label="参考来源"] p')].map((p) => (p.textContent || '').trim()).join(' '),
      amber: [...root.querySelectorAll('div')]
        .filter((d) => (typeof d.className === 'string' ? d.className : '').includes('border-amber-500'))
        .map((d) => (d.textContent || '').trim())
        .join(' | '),
      root,
      stopBtn: stopButtons(root)[0] ?? null,
    }
  }

  const t0 = performance.now()
  const samples = []
  const statusSeen = []
  let sawDraft = false
  let draftAnchorsMax = -1
  let stopVisibleDuringStream = false
  let busyPeak = false
  let maxStopButtons = 0
  // 「逐段输出」的硬判据：每一帧都必须以「上一帧全文」开头（增量前缀链）。
  let prevDraft = null
  let prefixViolations = 0
  let maxDraftLen = 0
  let stopClickedAt = -1
  let draftLenAtStop = -1
  const postStopSamples = []
  let amberSeen = ''
  let settleUntil = -1

  while (performance.now() - t0 < o.maxMs) {
    const s = snap()
    if (s) {
      if (s.status && statusSeen[statusSeen.length - 1] !== s.status) statusSeen.push(s.status)
      if (s.busy) busyPeak = true
      maxStopButtons = Math.max(maxStopButtons, s.stopCount)
      if (s.amber) amberSeen = s.amber
      if (s.draft !== null) {
        sawDraft = true
        draftAnchorsMax = Math.max(draftAnchorsMax, s.draftAnchors)
        stopVisibleDuringStream = stopVisibleDuringStream || s.stop
        if (stopClickedAt < 0) {
          if (prevDraft !== null && !s.draft.startsWith(prevDraft)) prefixViolations++
          prevDraft = s.draft
          maxDraftLen = Math.max(maxDraftLen, s.draft.length)
          samples.push({ at: Math.round(performance.now() - t0), len: s.draft.length, fp: fnv(s.draft), anchors: s.draftAnchors })
          if (o.stopAtChars > 0 && s.draft.length >= o.stopAtChars && s.stop) {
            s.stopBtn.click()
            stopClickedAt = Math.round(performance.now() - t0)
            draftLenAtStop = s.draft.length
            settleUntil = performance.now() + 2000
          }
        } else {
          postStopSamples.push({ at: Math.round(performance.now() - t0), len: s.draft.length })
        }
      } else if (stopClickedAt >= 0) {
        postStopSamples.push({ at: Math.round(performance.now() - t0), len: -1 })
      }
      // 终态判定：读屏区报出「已生成 / 已停止 / 没拿到答复 / 失败」之一 → 再观察 400ms 收尾
      if (settleUntil < 0 && /回答已生成|已停止本次回答|这次没有拿到答复|本次回答失败/.test(s.status)) {
        settleUntil = performance.now() + 400
      }
      if (settleUntil > 0 && performance.now() >= settleUntil) break
    }
    await new Promise((r) => setTimeout(r, o.sampleMs))
  }

  const root = document.querySelector(o.dialogSel)
  return {
    samples,
    distinctFingerprints: [...new Set(samples.map((s) => s.fp))].length,
    prefixViolations,
    maxDraftLen,
    sawDraft,
    draftAnchorsMax,
    stopVisibleDuringStream,
    busyPeak,
    maxStopButtons,
    statusSeen,
    stopClickedAt,
    draftLenAtStop,
    postStopSamples,
    amberSeen,
    finalText: root ? root.innerText || '' : '',
    finalHrefs: root ? [...root.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) : [],
    citationCount: root ? root.querySelectorAll('[aria-label="参考来源"] a[href]').length : 0,
    citationLabel: root ? [...root.querySelectorAll('[aria-label="参考来源"] p')].map((p) => (p.textContent || '').trim()).join(' ') : '',
    draftStillOnScreen: !!root && [...root.querySelectorAll('span')].some((x) => (x.textContent || '').includes('尚未定稿')),
    elapsedMs: Math.round(performance.now() - t0),
  }
}

async function openDrawer(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {})
  const dialog = page.locator(DIALOG)
  // dev 包首屏编译要 20~30s，网守的 keydown 监听必须等 hydration 落地；
  // 单次按键 + 固定 sleep 会把「还没 hydrate」误判成「快捷键坏了」。
  for (let i = 0; i < 10; i++) {
    if ((await dialog.count()) > 0 && (await dialog.first().isVisible().catch(() => false))) break
    await page.waitForTimeout(2500)
    await page.keyboard.press('Control+j').catch(() => {})
    await page.waitForTimeout(1200)
  }
  await dialog.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null)
  return dialog
}

function attachNet(page, bagFor) {
  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/hub/copilot/chat')) bagFor().aborted.push({ url: req.url(), failure: req.failure()?.errorText ?? '' })
  })
  page.on('response', (res) => {
    if (res.url().includes('/api/hub/copilot/chat')) {
      bagFor().responses.push({ status: res.status(), contentType: res.headers()['content-type'] ?? '' })
    }
  })
}

/** 发一问并在页面内记录整轮；问题带相标记，跑完能和上游日志对账 */
async function ask(page, tag, opts) {
  const question = `${QUESTION} #巡检${tag}`
  const input = page.locator(INPUT).first()
  await input.waitFor({ state: 'visible', timeout: 15_000 })
  await input.click()
  await input.fill(question)
  await input.press('Enter')
  const r = await page.evaluate(recorder, {
    dialogSel: DIALOG,
    sampleMs: 120,
    maxMs: 30_000,
    stopAtChars: 0,
    ablateTailLabel: process.env.AI3_ABLATE === 'tail-label',
    ...opts,
  })
  return { ...r, question, upstream: upstreamCalls(tag) }
}

async function setConfig(body) {
  const res = await fetch(HUB + '/api/admin/ai/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
  return res ? res.status : 'fetch-failed'
}

const FAKE_CFG = {
  name: 'Fake Stream',
  baseUrl: 'http://127.0.0.1:8899/v1',
  model: 'fake-stream-model',
  allowPrivateNetwork: true,
  thinking: false,
  fallbacks: [],
}

/** 前置门：直连中枢发一问，确认这一轮真的会走流式（不成立就别跑 UI 判据） */
async function hubStreamGate() {
  const put = await setConfig({ ...FAKE_CFG, enabled: true })
  const res = await fetch(HUB + '/api/copilot/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: `${QUESTION} #巡检P0`, stream: true }),
  }).catch(() => null)
  if (!res) return { ok: false, reason: '中枢不可达' }
  // 首块可能只是 `: connected` 注释，要多读几块再判帧型
  const reader = res.body.getReader()
  let head = ''
  while (head.length < 900) {
    const { done, value } = await reader.read()
    if (done) break
    head += new TextDecoder().decode(value)
  }
  await reader.cancel().catch(() => {})
  const ct = res.headers.get('content-type') ?? ''
  return {
    ok: ct.includes('text/event-stream') && /"type":"(reasoning|delta)"/.test(head),
    putStatus: put,
    contentType: ct,
    head: head.slice(0, 140),
  }
}

async function main() {
  const gate = await hubStreamGate()
  record('P0 中枢这一轮确实走流式（直连探测）', gate.ok, gate)
  if (!gate.ok) {
    console.log('\n前置条件不成立：中枢没在流式，UI 判据全部作废（不跑，避免把环境问题写成产品缺陷）')
    writeFileSync(OUT + 'browser-evidence.json', JSON.stringify({ results, gate }, null, 2), 'utf8')
    process.exit(3)
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } })
  context.setDefaultTimeout(25_000)
  const page = await context.newPage()
  const bags = { A: { aborted: [], responses: [] }, B: { aborted: [], responses: [] }, C: { aborted: [], responses: [] }, D: { aborted: [], responses: [] }, E: { aborted: [], responses: [] } }
  let phase = 'A'
  attachNet(page, () => bags[phase])
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(m.text()))) consoleErrors.push(m.text().slice(0, 200))
  })

  /* ---------------- A. 唤起抽屉 ---------------- */
  const drawer = await openDrawer(page)
  record('A1 Ctrl+J 唤起抽屉', (await drawer.count()) === 1 && (await drawer.first().isVisible()), {
    count: await drawer.count(),
    url: page.url(),
  })

  /* ---------------- B. 逐段输出（页面内 120ms 采样） ---------------- */
  phase = 'B'
  const b = await ask(page, 'B')
  const servedB = b.upstream.tagged > 0
  const lens = b.samples.map((s) => s.len)
  record('B1 出现流式草稿气泡', streamVerdict(b.sawDraft, servedB), { servedUpstream: servedB, firstSample: b.samples[0] ?? null, samples: b.samples.length, elapsedMs: b.elapsedMs })
  record(
    'B2 草稿是增量前缀链（真逐段：每帧都以上一帧全文开头）',
    b.maxDraftLen >= 40 && b.distinctFingerprints >= 4 && b.prefixViolations === 0 && lens[lens.length - 1] > lens[0]
      ? true
      : streamVerdict(false, servedB),
    { lengths: lens, distinctFingerprints: b.distinctFingerprints, prefixViolations: b.prefixViolations, maxDraftLen: b.maxDraftLen },
  )
  record('B3 草稿期内没有任何可点击链接', streamVerdict(b.draftAnchorsMax === 0, servedB), { anchorsInDraftMax: b.draftAnchorsMax })
  record('B4 流式期间「停止」按钮可见', streamVerdict(b.stopVisibleDuringStream, servedB), { stopVisibleDuringStream: b.stopVisibleDuringStream })
  record('B5 状态文案切到「逐段输出」（读屏区）', streamVerdict(b.statusSeen.some((s) => /回答开始逐段输出，可随时停止/.test(s)), servedB), {
    statusSeen: b.statusSeen,
  })
  record('B6 首个 token 后转圈让位（全程只有一颗「停止」）', b.maxStopButtons <= 1 && (b.sawDraft || !servedB), {
    maxStopButtons: b.maxStopButtons,
    busyPeak: b.busyPeak,
  })
  await page.screenshot({ path: OUT + 'b-after-stream.png' }).catch(() => {})

  /* ---------------- C. 停止 = 真掐断 ---------------- */
  phase = 'C'
  await openDrawer(page)
  const c = await ask(page, 'C', { stopAtChars: 24 })
  const servedC = c.upstream.tagged > 0
  record('C1 流式中途点得到「停止」', streamVerdict(c.stopClickedAt > 0, servedC), { stopClickedAt: c.stopClickedAt, draftLenAtStop: c.draftLenAtStop })
  record('C2 停止后草稿作废', streamVerdict(!c.draftStillOnScreen, servedC), {
    draftStillOnScreen: c.draftStillOnScreen,
    postStop: c.postStopSamples.slice(0, 6),
  })
  record('C3 停止后不再继续吐字', streamVerdict(c.postStopSamples.every((s) => s.len === -1), servedC), { postStop: c.postStopSamples.slice(0, 6) })
  record('C4 如实播报「已停止本次回答」', streamVerdict(c.statusSeen.some((s) => /已停止本次回答/.test(s)) && /已停止本次回答/.test(c.finalText), servedC), {
    statusSeen: c.statusSeen,
    textHit: /已停止本次回答/.test(c.finalText),
  })
  record('C5 底层请求真的中断（net::ERR_ABORTED）', streamVerdict(bags.C.aborted.length > 0, servedC), {
    aborted: bags.C.aborted,
    responses: bags.C.responses,
  })
  record('C6 停止气泡给了「重试这次提问」出口', streamVerdict(/重试这次提问/.test(c.finalText), servedC), { hit: /重试这次提问/.test(c.finalText) })
  await page.screenshot({ path: OUT + 'c-after-stop.png' }).catch(() => {})

  /* ---------------- D. 完整一轮：引用与降级链接 ---------------- */
  phase = 'D'
  await openDrawer(page)
  const d = await ask(page, 'D')
  const servedD = d.upstream.tagged > 0
  record('D1 终稿渲染出可点击引用', streamVerdict(d.citationCount > 0, servedD), { citationCount: d.citationCount, label: d.citationLabel })
  record('D2 编造链接没有变成 href', streamVerdict(!d.finalHrefs.some((h) => (h ?? '').includes('fabricated.example')), servedD), {
    hrefs: d.finalHrefs.filter((h) => !!h).slice(0, 8),
  })
  record('D3 编造链接降级成纯文本留在正文', streamVerdict(/编造站点/.test(d.finalText), servedD), { hit: /编造站点/.test(d.finalText) })
  record('D4 草稿作废、终稿整体覆盖（无同屏）', streamVerdict(!d.draftStillOnScreen, servedD), { draftStillOnScreen: d.draftStillOnScreen })
  record('D5 走的是事件流（content-type 判定）', streamVerdict(bags.D.responses.some((r) => r.contentType.includes('text/event-stream')), servedD), {
    responses: bags.D.responses,
  })
  record('D6 模型名如实上报', streamVerdict(/由模型 fake-stream-model 生成/.test(d.finalText), servedD), { hit: /由模型 fake-stream-model 生成/.test(d.finalText) })
  record('D7 终稿里有真候选的站内链接', streamVerdict(d.finalHrefs.some((h) => !!h && /^https?:\/\//.test(h) && !h.includes('fabricated.example')), servedD), {
    hrefs: d.finalHrefs.filter((h) => !!h).slice(0, 8),
  })
  await page.screenshot({ path: OUT + 'd-final-answer.png' }).catch(() => {})

  /* ---------------- E. 降级：一次性 JSON + 琥珀横幅 ---------------- */
  const off = await setConfig({ ...FAKE_CFG, enabled: false })
  phase = 'E'
  await openDrawer(page)
  const e = await ask(page, 'E', { maxMs: 12_000 })
  record('E0 关掉模型配置生效', off === 200, { putStatus: off })
  record('E1 降级不开流（全程没有草稿气泡）', !e.sawDraft && !e.draftStillOnScreen, { sawDraft: e.sawDraft, responses: bags.E.responses })
  record('E2 降级回一次性 JSON', bags.E.responses.some((r) => r.contentType.includes('application/json')), { responses: bags.E.responses })
  record('E3 琥珀横幅如实说明不是模型答的', /尚未配置可用的模型密钥|未经模型生成|已降级为站内混合检索/.test(e.amberSeen), {
    amber: e.amberSeen.slice(0, 160),
  })
  record('E4 降级不冒充模型来源', !/由模型 .* 生成/.test(e.finalText), { hit: /由模型 .* 生成/.test(e.finalText) })
  record('E5 降级仍给可点击的站内候选', e.citationCount > 0, { citationCount: e.citationCount, label: e.citationLabel })
  record('E6 降级这一轮没有打上游', e.upstream.tagged === 0, { upstream: e.upstream })

  // 恢复：把系统配置指回假模型（隔离库，收尾会删掉整份副本）
  await setConfig({ ...FAKE_CFG, enabled: true })

  const stray = upstreamCalls('Z')
  record(
    'Z1 无未过滤的 console error',
    consoleErrors.length === 0,
    { console: [...new Set(consoleErrors)] },
  )
  record('Z2 没有别的客户端混进这一轮', stray.untagged === 0, {
    untaggedUpstreamCalls: stray.untagged,
    perPhase: { B: b.upstream.tagged, C: c.upstream.tagged, D: d.upstream.tagged, E: e.upstream.tagged },
  })

  await page.screenshot({ path: OUT + 'final-state.png' }).catch(() => {})
  writeFileSync(OUT + 'browser-evidence.json', JSON.stringify({ results, bags, b, c, d, e, consoleErrors, gate }, null, 2), 'utf8')
  const failed = results.filter((r) => r.kind === 'fail')
  const blocked = results.filter((r) => r.kind === 'blocked')
  console.log(
    '\n==== 汇总 ==== ' +
      (results.length - failed.length - blocked.length) +
      ' 通过 / ' +
      failed.length +
      ' 缺陷 / ' +
      blocked.length +
      ' 前置不成立（共 ' +
      results.length +
      '）',
  )
  if (failed.length) console.log('缺陷：' + failed.map((f) => f.name).join(' | '))
  if (blocked.length) console.log('前置不成立：' + blocked.map((f) => f.name).join(' | '))
  await browser.close()
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('SCRIPT ERROR', e)
  process.exit(2)
})
