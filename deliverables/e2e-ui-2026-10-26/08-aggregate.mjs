import { readFileSync, existsSync } from 'node:fs'
import { OUT } from './harness.mjs'

const j = (f) => (existsSync(OUT + f) ? JSON.parse(readFileSync(OUT + f, 'utf8')) : null)

const crawl = j('01-crawl.json')
const sweeps = ['public', 'dyn', 'authed', 'admin'].map((g) => ({ g, data: j(`03-sweep-${g}.json`) })).filter((x) => x.data)
const flows = ['04-flows'].map((f) => j(f + '.json')).filter(Boolean)
const edge = j('05-edge.json')
const perf = j('06-perf.json')
const verify = j('07-verify.json')
const public2 = ['02-public'].map((f) => j(f + '.json')).filter(Boolean)
const resweep = j('03b-resweep.json')
const adminResweep = j('03c-admin-resweep.json')
const instrument = j('09-instrument-checks.json')
const focus = j('10-focus.json')
const tta = j('11-interactive.json')
const content2 = j('12-content.json')
const dom3 = j('13-dom.json')
const final4 = j('14-final.json')
const mktSb = j('15-mkt-sidebar.json')
const custom1 = j('16-custom.json')
const custom2 = j('17-custom2.json')
const mkt2 = j('18-mkt2.json')
const flows2 = j('19-flows2.json')
const flows3 = j('21-flows3.json')
const focus2 = j('22-focus2.json')
const catCrud = j('23-cat.json')
const homeDlg = j('24-home-dialogs.json')

const lines = []
const push = (s = '') => lines.push(s)

push('# 自动巡检原始数据汇总')
push()
if (crawl) {
  push(`## 全站可达性/性能普查：${crawl.okCount}/${crawl.total} 路由 200，失败 ${crawl.failed?.length || 0}`)
  const bad = crawl.rows.filter((r) => (r.consoleErrors || []).length || (r.pageErrors || []).length || (r.badResponses || []).length)
  push(`带错误路由：${bad.map((r) => r.route).join(', ') || '无'}`)
  push('')
  push('| 路由 | wall | TTFB | LCP | CLS | 长任务ms | DOM | HTML KB | JS KB | btn | link | 字段 |')
  push('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of crawl.rows) {
    const m = r.metrics || {}
    const c = r.counts || {}
    push(
      `| ${r.route} | ${r.wall} | ${m.ttfb} | ${m.lcp} | ${m.cls} | ${(m.longTaskMsTotal || 0) / 1} | ${m.domNodes} | ${m.htmlKB} | ${m.jsKB} | ${c.btn} | ${c.link} | ${c.field} |`
    )
  }
}

if (sweeps.length) {
  push('')
  push('## 逐控件点击巡检')
  push('| 组 | 路由 | 点击控件 | 有响应 | 无响应 | 已激活空点 | 点不着(遮挡) | 慢>900ms | 链接校验 | 坏链 |')
  push('|---|---|---|---|---|---|---|---|---|---|')
  for (const { g, data } of sweeps) {
    for (const r of data.rows || []) {
      if (r.error) {
        push(`| ${g} | ${r.route} | 巡检异常：${r.error} |||||||||`)
        continue
      }
      push(
        `| ${g} | ${r.route} | ${r.clicked} | ${r.responded} | ${(r.dead || []).length} | ${(r.noop || []).length} | ${(r.blocked || []).length} | ${(r.slow || []).length} | ${r.links?.checked ?? 0} | ${(r.links?.bad || []).length} |`
      )
    }
  }
  push('')
  push('### 无响应控件明细')
  for (const { g, data } of sweeps) {
    for (const r of data.rows || []) {
      for (const d of r.dead || []) push(`- [${g}] ${r.route} :: <${d.tag}${d.role ? ' role=' + d.role : ''}> 「${d.label}」 via=${d.via || '?'} delta=${JSON.stringify(d.delta)}`)
    }
  }
  push('')
  push('### 点不着（被遮挡/动画不稳，需 DOM 兜底才点得到）')
  for (const { g, data } of sweeps) {
    for (const r of data.rows || []) {
      for (const d of r.blocked || []) push(`- [${g}] ${r.route} :: <${d.tag}> 「${d.label}」`)
    }
  }
  push('')
  push('### 坏链接')
  for (const { g, data } of sweeps) {
    for (const r of data.rows || []) {
      for (const l of r.links?.bad || []) push(`- [${g}] ${r.route} :: ${l.status} ${l.href} ${l.error || ''}`)
    }
  }
  push('')
  push('### 跳过的危险控件（改数据类，未点）')
  for (const { g, data } of sweeps) {
    for (const r of data.rows || []) {
      if ((r.skippedDanger || []).length) push(`- [${g}] ${r.route} :: ${r.skippedDanger.slice(0, 12).join(' | ')}`)
    }
  }
  push('')
  push('### 响应慢（>900ms，且是常规点击命中）')
  for (const { g, data } of sweeps) {
    for (const r of data.rows || []) {
      for (const s of r.slow || []) push(`- [${g}] ${r.route} :: 「${s.label}」 ${s.ms}ms`)
    }
  }
}

// ---- 复扫对账：同一控件在「复用页面」和「独立上下文」两种条件下的判定差 ----
const origDead = new Map()
for (const { g, data } of sweeps) {
  for (const r of data.rows || []) {
    for (const d of r.dead || []) origDead.set(`${r.route}::${(d.label || '').replace(/\s+/g, ' ').trim().slice(0, 30)}`, g)
  }
}
const resweepRows = [...(resweep?.rows || []), ...(adminResweep?.rows || [])].filter((r) => !r.error)
if (resweepRows.length) {
  push('')
  push('## 复扫对账（每路由独立浏览器上下文；判定以这里为准）')
  push('复用同一页面会被自己的上一次点击污染（localStorage 里的侧边栏折叠态、列表重渲染后 data-audit-idx 失配），')
  push('下表「原判无响应→复扫有响应」的差额就是检测器局限，不是功能缺陷。')
  push('| 路由 | 点击 | 有响应 | 无响应 | 本轮仍无响应控件 |')
  push('|---|---|---|---|---|')
  let recovered = 0
  let still = 0
  for (const r of resweepRows) {
    const deadLabels = (r.dead || []).map((d) => `${d.tag}[${String(d.label).replace(/\s+/g, ' ').slice(0, 24)}]`)
    still += deadLabels.length
    for (const l of deadLabels) if (!origDead.has(`${r.route}::${l.slice(l.indexOf(']') + 1)}`)) recovered++
    push(`| ${r.route}${r.auth ? ' (登录态)' : ''} | ${r.clicked} | ${r.responded} | ${deadLabels.length} | ${deadLabels.slice(0, 5).join(' ') || '—'} |`)
  }
  push('')
  push(`复扫后仍判无响应的控件合计：${still}（原始巡检判定的无响应数：${origDead.size}）`)
}
if (adminResweep) {
  push('')
  push('## 后台错误面（控制台报错 / 接口非 2xx / 坏链）')
  for (const r of adminResweep.rows || []) {
    const bits = []
    if ((r.consoleErrors || []).length) bits.push(`console=${r.consoleErrors.slice(0, 2).join(' ~ ').slice(0, 120)}`)
    if ((r.pageErrors || []).length) bits.push(`pageerror=${r.pageErrors.slice(0, 2).join(' ~ ').slice(0, 120)}`)
    if ((r.badResponses || []).length) bits.push(`http=${r.badResponses.slice(0, 4).join(' ')}`)
    if ((r.links?.bad || []).length) bits.push(`badlink=${r.links.bad.slice(0, 4).join(' ')}`)
    if (bits.length) push(`- ${r.route} :: ${bits.join(' || ')}`)
  }
}
if (instrument) {
  push('')
  push('## 定向取证：用对信号后「无响应」控件的真实形态')
  push('```json')
  push(JSON.stringify(instrument, null, 1).slice(0, 6000))
  push('```')
}
if (focus) {
  push('')
  push('## 定向取证：安装闭环 / 视频筛选 / 市场标签 / 注入判定 / 拒绝访问 / 刷新')
  push('```json')
  push(JSON.stringify(focus, null, 1).slice(0, 9000))
  push('```')
}

// ---- 11~18：把「无响应」三分法（检测器盲区 / 自污染 / 水合延迟）逐个定量 ----
if (tta) {
  push('')
  push('## 首次生效点击耗时（DOM 就绪 ≠ 可点：水合窗口定量）')
  push('每 500ms 重复点同一个控件，直到出现预期信号；「未生效」= 30 次（约 20s）后仍无信号。')
  push('| 路由 | 控件 | 预期信号 | DOM就绪 | 首次生效 | 生效于第几次 | 长任务 | INP |')
  push('|---|---|---|---|---|---|---|---|')
  for (const r of tta.results || []) {
    const x = r.extra || {}
    push(
      `| ${r.route} | ${r.label} | ${r.expect} | ${r.domReady}ms | ${
        r.firstEffectMs == null ? '>20s(未生效)' : r.firstEffectMs + 'ms'
      } | ${r.attempts ?? '-'} | ${x.longTasks ?? 0}(${x.longMs ?? 0}ms) | ${x.inp ?? '-'} |`
    )
  }
  push('')
  push('注：首页「微工具箱 / 快捷键指南」两行的基线 dialog 数本身就是 1（Radix portal 常驻隐藏节点），')
  push('计数差信号在这两个控件上必然恒为 0，属于检测器盲区；07-verify 的 homeDialogs 已证明点击后隐藏节点会被点亮。')
}
if (content2 || final4) {
  push('')
  push('## 内容级判定（不看计数，看标题集合 / URL / aria-selected）')
  push('```json')
  const dump = { c12: content2?.out ?? null, c14: final4?.out ?? null }
  push(JSON.stringify(dump, null, 1).slice(0, 12000))
  push('```')
}
if (dom3 || mktSb) {
  push('')
  push('## DOM 侦察：后台侧边栏分组折叠 / 前台市场专题胶囊')
  push('| 项 | 判据 | 结论 |')
  push('|---|---|---|')
  const sb = dom3?.out?.sidebar
  if (sb) {
    push(
      `| 侧边栏「导航管理」分组 | aside 链接数 ${sb.before?.navLinks} -> ${sb.after?.navLinks} -> ${sb.secondClick?.navLinks}；旋转箭头 ${sb.before?.chevronRotated} -> ${sb.after?.chevronRotated} | 折叠/展开**可用**；aria-expanded=${JSON.stringify(sb.after?.btnExpanded)}（属性缺失） |`
    )
  }
  for (const r of mkt2?.rows || []) {
    push(
      `| 市场专题「${r.label}」 | 卡片 ${r.cards ?? '未找到'}，列表变化=${r.listChanged ?? '-'}，高亮=${JSON.stringify(r.chipActive ?? null)} | ${
        r.found === false ? '控件不存在' : r.listChanged ? '生效' : '无变化（可能等价于当前状态）'
      }${r.dualActive ? '；**同时高亮 2 个胶囊**' : ''} |`
    )
  }
  push('')
  push('```json')
  push(JSON.stringify({ d13: dom3?.out ?? null, m15: mktSb?.out ?? null, m18base: mkt2?.baseSnap ?? null }, null, 1).slice(0, 9000))
  push('```')
}
if (custom1 || custom2) {
  push('')
  push('## DIY 工作台（/custom）动作取证：localStorage 布局串 + 画布文本指纹')
  push('| 控件 | 命中 | 布局串长度 | 文本变化 | 按钮数 |')
  push('|---|---|---|---|---|')
  for (const r of custom1?.rows || []) {
    push(`| ${r.label}（首轮） | ${r.found && r.vis ? '是' : '否'} | ${r.lsChanged ? '变化' : '不变'} | ${r.textChanged ? '是' : '否'} | — |`)
  }
  for (const r of custom2?.rows || []) {
    push(`| ${r.label} | ${r.found && r.vis ? '是' : '否'} | ${r.ls ?? '—'} | ${r.textChanged ? '是' : '否'} | ${r.btnCount ?? '—'} |`)
  }
}

// ---- 19/21/22/23：主流程复测与收尾取证 ----
if (flows3 || focus2 || catCrud || flows2) {
  push('')
  push('## 主流程复测与收尾取证（按源码真实入口重跑）')
  push('| 轮次 | 步骤 | 结果 | 证据 |')
  push('|---|---|---|---|')
  for (const [tag, d] of [['19 标签纠偏', flows2], ['21 条件重跑', flows3]]) {
    for (const r of d?.rows || []) push(`| ${tag} | ${r.name} | ${r.status} | ${String(r.detail || r.error || '').replace(/\|/g, '/').slice(0, 200)} |`)
  }
  if (focus2) {
    for (const [k, v] of Object.entries(focus2.out || {})) push(`| 22 定向 | ${k} | — | ${JSON.stringify(v).replace(/\|/g, '/').slice(0, 420)} |`)
  }
  for (const r of homeDlg?.rows || []) {
    push(`| 24 首页弹层 | ${r.name} | — | 触发=${r.action} 可见层 ${r.beforeVisible}->${r.afterVisible} 内容=${JSON.stringify(r.openedLayer).slice(0, 160)} |`)
  }
  if (catCrud) {
    push(`| 23 类目 CRUD | 新建类目按钮护栏 | — | ${JSON.stringify(catCrud.rows).replace(/\|/g, '/').slice(0, 260)} 写请求=${JSON.stringify(catCrud.reqs).replace(/\|/g, '/').slice(0, 200)} |`)
  }
}

for (const f of flows) {
  push('')
  push(`## 主流程（${f.module}）`)
  push('| 步骤 | 结果 | 耗时 | 详情/错误 |')
  push('|---|---|---|---|')
  for (const st of f.steps) push(`| ${st.name} | ${st.status} | ${st.ms}ms | ${(st.detail || st.error || '').replace(/\|/g, '/').slice(0, 160)} |`)
}
for (const f of public2) {
  push('')
  push(`## 前台交互（${f.module}）`)
  push('| 步骤 | 结果 | 耗时 | 详情/错误 |')
  push('|---|---|---|---|')
  for (const st of f.steps) push(`| ${st.name} | ${st.status} | ${st.ms}ms | ${(st.detail || st.error || '').replace(/\|/g, '/').slice(0, 160)} |`)
}
if (edge) {
  push('')
  push('## 异常/边界场景')
  push('| 步骤 | 结果 | 详情/错误 |')
  push('|---|---|---|')
  for (const st of edge.steps) push(`| ${st.name} | ${st.status} | ${(st.detail || st.error || '').replace(/\|/g, '/').slice(0, 200)} |`)
}
if (perf) {
  push('')
  push('## 性能取样（重复加载）')
  push('| 路由 | wall 中位(最小~最大) | TTFB | LCP | CLS | 长任务ms | DOM | HTML KB |')
  push('|---|---|---|---|---|---|---|---|')
  for (const l of perf.loads) push(`| ${l.route} | ${l.wallMed}(${l.wallMin}~${l.wallMax}) | ${l.ttfbMed} | ${l.lcpMed} | ${l.clsMed} | ${l.longMed} | ${l.dom} | ${l.htmlKB} |`)
  push('')
  push('## 交互延迟（点击→两帧）')
  for (const i of perf.interactions || []) push(`- ${i.route} :: ${i.name} frames=${i.framesMs}ms click=${i.clickMs}ms resp=${i.responded} ${i.error || ''}`)
  push('')
  push('## API 直连耗时')
  for (const a of perf.api || []) push(`- ${a.path} -> ${a.status} p50=${a.p50}ms max=${a.max}ms ${a.kb}KB ${a.error || ''}`)
  push('')
  push('## 移动端 390x844')
  for (const m of perf.mobile || []) push(`- ${m.route} wall=${m.wall} lcp=${m.lcp} cls=${m.cls} overflow=${m.scrollOverflow} dom=${m.domNodes}`)
}
if (verify) {
  push('')
  push('## 定向复核')
  push('```json')
  push(JSON.stringify(verify, null, 1))
  push('```')
}

const text = lines.join('\n')
const file = OUT + '08-raw-summary.md'
import('node:fs').then((fs) => {
  fs.writeFileSync(file, text)
  console.log(text.slice(0, 3000))
  console.log('...\n[saved]', file)
})
