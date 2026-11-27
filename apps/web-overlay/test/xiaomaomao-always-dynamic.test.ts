/**
 * 小猫猫挂件「一直动态 + 低开销 + 首页防撞」优化守卫：
 *  1. 默认关闭全时动态（alwaysDynamic 默认 false；U-260：默认 true 时 dockBlocked() 恒真，60 秒闲置贴边永不触发，使 BLOCK 回归 E2E half-screen-dock.spec.ts:178 在全新 profile 上恒失败；全时动态仍可由用户在外观小窗手动开启，开启后贴边抑制逻辑不变）；
 *  2. 懒加载聊天头像与收起圆标（默认展示态下不抢先下载 3.7MB WebP 动图，避免与主视频争抢带宽）；
 *  3. 视频态下保持光标靠近探头跟随（stageEl.style.translate/rotate），并在后台/收起/贴边态零计算跳过；
 *  4. 弹窗观察器过滤掉非弹窗的 data-state 抖动并用 RAF 合并扫描，同时为微按钮扩展 44×44 触控热区；
 *  5. 角落固定微件与小猫猫互不遮挡，外观向导小窗提供全时动态 / 满屏陪玩 / 收起直控入口。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const OVERLAY_ROOT = join(HERE, '..')
const WIDGET = readFileSync(join(OVERLAY_ROOT, 'public/xiaomaomao/xiaomaomao.js'), 'utf8')
const APPEARANCE_DIALOG = readFileSync(
  join(OVERLAY_ROOT, 'src/components/home-windows/appearance-guide-dialog.tsx'),
  'utf8',
)
const PINNED_WIDGETS = readFileSync(
  join(OVERLAY_ROOT, 'src/components/home-windows/pinned-corner-widgets.tsx'),
  'utf8',
)

describe('小猫猫挂件一直动态与性能/布局优化守卫', () => {
  it('默认关闭 alwaysDynamic 全时动态：60 秒闲置贴边仍可生效（U-260）', () => {
    expect(WIDGET).toContain('alwaysDynamic: false')
    expect(WIDGET).toContain('window.XIAOMAOMAO.setAlwaysDynamic')
    expect(WIDGET).toContain('window.XIAOMAOMAO.getState')
    expect(WIDGET).toContain('window.XIAOMAOMAO.setCollapsed')
    const dockAt = WIDGET.indexOf('function dockBlocked()')
    const dockBody = WIDGET.slice(dockAt, dockAt + 320)
    expect(dockBody).toContain('!!store.alwaysDynamic')
  })

  it('默认展示态延迟加载 3.7MB 小图标动图，不抢首屏视频带宽', () => {
    expect(WIDGET).toContain('function ensureHeadIcon()')
    expect(WIDGET).toContain('function ensureTabIcon()')
    const openAt = WIDGET.indexOf('function openPanel()')
    expect(WIDGET.slice(openAt, openAt + 120)).toContain('ensureHeadIcon();')
    const collapseAt = WIDGET.indexOf('function collapseCat()')
    expect(WIDGET.slice(collapseAt, collapseAt + 120)).toContain('ensureTabIcon();')
  })

  it('视频态支持光标靠近探头跟随，且在隐藏/收起/贴边态提前返回省电', () => {
    expect(WIDGET).toContain('stageEl.style.translate')
    expect(WIDGET).toContain('stageEl.style.rotate')
    const moveAt = WIDGET.indexOf("document.addEventListener('mousemove'")
    const moveSlice = WIDGET.slice(moveAt, moveAt + 320)
    expect(moveSlice).toContain("root.classList.contains('xm-closed')")
    expect(moveSlice).toContain('document.hidden')
  })

  it('弹窗 MutationObserver 去除了高频 data-state 噪声并用 RAF 合批', () => {
    expect(WIDGET).toContain('function scheduleSyncModalDim()')
    expect(WIDGET).toContain("attributeFilter: ['aria-modal', 'role']")
    expect(WIDGET).not.toContain("attributeFilter: ['aria-modal', 'data-state']")
  })

  it('微按钮补齐隐形 44×44 触控热区且无残留文案', () => {
    expect(WIDGET).toContain('#xiaomaomao .xm-mini-close::after{content:"";position:absolute;inset:-11px}')
    expect(WIDGET).toContain('#xiaomaomao .xm-dock .xm-btn::after{content:"";position:absolute;inset:-4px}')
    expect(WIDGET).toContain('#xiaomaomao .xm-p-head .xm-hbtn::after{content:"";position:absolute;inset:-8px}')
    expect(WIDGET).not.toContain('从整套在用图里挑一张')
  })

  it('角落固定微件主动避让小猫猫位置，外观小窗接通全时动态开关', () => {
    expect(PINNED_WIDGETS).toContain('sm:right-[146px]')
    expect(PINNED_WIDGETS).toContain('left-3 right-auto')
    expect(APPEARANCE_DIALOG).toContain('setAlwaysDynamic')
    expect(APPEARANCE_DIALOG).toContain('togglePlay')
    expect(APPEARANCE_DIALOG).toContain('navhub:xiaomaomao-state')
  })

  it('apps/web-overlay 中不存在废弃的 poses/ 静态图目录', () => {
    expect(existsSync(join(OVERLAY_ROOT, 'public/xiaomaomao/poses'))).toBe(false)
  })

  it('所有猫猫图片与舞台无边框/背景/阴影，深色模式下做轻微压边降毛刺', () => {
    expect(WIDGET).not.toContain('#xiaomaomao .xm-wrap:after')
    expect(WIDGET).not.toContain('@keyframes xmShadow')
    expect(WIDGET).not.toContain('linear-gradient(155deg,#fff9ec')
    expect(WIDGET).not.toContain('255,176,102,.45')
    const deco = WIDGET.slice(WIDGET.indexOf('#xiaomaomao .xm-deco{'), WIDGET.indexOf('}', WIDGET.indexOf('#xiaomaomao .xm-deco{')) + 1)
    expect(deco).not.toContain('filter:drop-shadow')

    const stage = WIDGET.slice(WIDGET.indexOf('#xiaomaomao .xm-stage{'), WIDGET.indexOf('}', WIDGET.indexOf('#xiaomaomao .xm-stage{')) + 1)
    expect(stage).toContain('background:transparent')
    expect(stage).toContain('border:none')
    expect(stage).toContain('box-shadow:none')
    expect(stage).toContain('border-radius:0')

    const darkStage = WIDGET.slice(WIDGET.indexOf('html.dark #xiaomaomao .xm-stage{'), WIDGET.indexOf('}', WIDGET.indexOf('html.dark #xiaomaomao .xm-stage{')) + 1)
    expect(darkStage).toContain('background:transparent')
    expect(darkStage).toContain('box-shadow:none')

    expect(WIDGET).toContain('html.dark #xiaomaomao .xm-video,html.dark #xiaomaomao .xm-fallback,html.dark #xiaomaomao .xm-tab img{filter:brightness(.93) contrast(1.06)}')

    const tab = WIDGET.slice(WIDGET.indexOf('#xiaomaomao .xm-tab{'), WIDGET.indexOf('}', WIDGET.indexOf('#xiaomaomao .xm-tab{')) + 1)
    expect(tab).toContain('width:48px')
    expect(tab).toContain('background:var(--xm-win-bg)')
    expect(tab).toContain('border:1px solid var(--xm-win-border)')
    expect(tab).toContain('box-shadow:none')

    const tabImgStart = WIDGET.indexOf("'#xiaomaomao .xm-tab img{")
    const tabImg = WIDGET.slice(tabImgStart, WIDGET.indexOf('}', tabImgStart) + 1)
    expect(tabImg).toContain('object-fit:contain')
    expect(tabImg).toContain('background:transparent')
    expect(tabImg).toContain('box-shadow:none')

    const pHeadImg = WIDGET.slice(WIDGET.indexOf('#xiaomaomao .xm-p-head img{'), WIDGET.indexOf('}', WIDGET.indexOf('#xiaomaomao .xm-p-head img{')) + 1)
    expect(pHeadImg).toContain('object-fit:contain')
    expect(pHeadImg).toContain('border:none')
    expect(pHeadImg).toContain('box-shadow:none')

    const lookImg = WIDGET.slice(WIDGET.indexOf('#xiaomaomao .xm-look-item img{'), WIDGET.indexOf('}', WIDGET.indexOf('#xiaomaomao .xm-look-item img{')) + 1)
    expect(lookImg).toContain('object-fit:contain')
    expect(lookImg).toContain('background:transparent')
    expect(lookImg).toContain('box-shadow:none')

    const speakAnim = WIDGET.slice(WIDGET.indexOf('@keyframes xmSpeak{'), WIDGET.indexOf('}}', WIDGET.indexOf('@keyframes xmSpeak{')) + 2)
    expect(speakAnim).not.toContain('box-shadow')
  })

  it('单行 4 键胶囊坞、零碰撞避让、移动端抬高不遮猫、换形象/游戏精细重排均已落地', () => {
    expect(WIDGET).not.toContain('backdrop-filter:blur')
    expect(WIDGET).not.toContain('#xiaomaomao .xm-bubble:after')
    expect(WIDGET).toContain('--xm-win-bg:#ffffff')
    expect(WIDGET).toContain('--xm-win-bg:#18181b')

    for (const winSel of ['#xiaomaomao .xm-bubble{', '#xiaomaomao .xm-dock{', '#xiaomaomao .xm-panel{', '#xiaomaomao .xm-game{']) {
      const rule = WIDGET.slice(WIDGET.indexOf(winSel), WIDGET.indexOf('}', WIDGET.indexOf(winSel)) + 1)
      expect(rule, winSel).toContain('background:var(--xm-win-bg)')
      expect(rule, winSel).toContain('border:1px solid var(--xm-win-border)')
      expect(rule, winSel).toContain('backdrop-filter:none')
      expect(rule, winSel).toContain('box-shadow:none')
      expect(rule, winSel).not.toContain('linear-gradient(')
    }

    const dock = WIDGET.slice(WIDGET.indexOf('#xiaomaomao .xm-dock{'), WIDGET.indexOf('}', WIDGET.indexOf('#xiaomaomao .xm-dock{')) + 1)
    expect(dock).toContain('flex-wrap:nowrap')
    expect(WIDGET).toContain('#xiaomaomao .xm-dock::before{content:""')
    expect(WIDGET).toContain('#xiaomaomao .xm-dock:not(.xm-dock-more) .xm-dock-sec{display:none}')
    expect(WIDGET).toContain('#xiaomaomao .xm-dock .xm-close-btn{display:none}')
    expect(WIDGET).toContain('moreBtn.className = \'xm-btn xm-more-btn\'')
    expect(WIDGET).toContain('function syncFabAvoid()')
    expect(WIDGET).toContain('#xiaomaomao.xm-avoid-fab .xm-dock{')
    expect(WIDGET).toContain('bottom:calc(68px + 88px + 10px + env(safe-area-inset-bottom,0px))')

    const lookGrid = WIDGET.slice(WIDGET.indexOf('#xiaomaomao .xm-look-grid{'), WIDGET.indexOf('}', WIDGET.indexOf('#xiaomaomao .xm-look-grid{')) + 1)
    expect(lookGrid).toContain('display:flex')
    expect(lookGrid).toContain('justify-content:center')

    const gameHud = WIDGET.slice(WIDGET.indexOf('#xiaomaomao .xm-g-hud{'), WIDGET.indexOf('}', WIDGET.indexOf('#xiaomaomao .xm-g-hud{')) + 1)
    expect(gameHud).toContain('grid-template-columns:repeat(3,1fr)')
  })

  it('第三轮细节：气泡左缘翻向、键盘可达、Esc 关窗、状态可见、iOS 输入不缩放、防选字与长按菜单', () => {
    // 猫拖到左缘时气泡与坞一样向右展开，不被视口裁掉
    expect(WIDGET).toContain("bubbleEl.classList.add('xm-fan-r')")
    expect(WIDGET).toContain('#xiaomaomao .xm-bubble.xm-fan-r{right:auto;left:-4px}')
    // 键盘：Esc 关聊天/游戏并还焦点；:focus-visible 聚焦猫/坞自动唤出操作条
    expect(WIDGET).toContain("if (gameEl && gameEl.classList.contains('xm-on')) { closeGame(); return; }")
    expect(WIDGET).toContain("if (root.classList.contains('xm-open')) { closePanel(); return; }")
    expect(WIDGET).toContain("t.matches(':focus-visible')")
    expect(WIDGET).toContain("root.addEventListener('focusin'")
    // 对话区读屏友好
    expect(WIDGET).toContain('role="log" aria-live="polite"')
    // 状态可见：陪玩按下态、小鱼干用完置灰
    expect(WIDGET).toContain('.xm-play-btn[aria-pressed="true"]{background:var(--xm-accent)')
    expect(WIDGET).toContain("fishBtn.classList.toggle('xm-fish-out', left <= 0)")
    // 长标题不撑破卡片
    expect(WIDGET).toContain('#xiaomaomao .xm-card>span:nth-child(2){flex:1;min-width:0}')
    // iOS Safari 输入框字号 <16px 会聚焦缩放页面，移动端抬到 16px 且触控高度 44px
    expect(WIDGET).toContain('#xiaomaomao .xm-input{font-size:16px;height:44px}')
    // 防拖猫时误选字 / iOS 长按唤出图片菜单（长按摸猫要用）
    expect(WIDGET).toContain('-webkit-touch-callout:none')
    // 第四轮错误修复：Radix 弹窗（[role="dialog"][data-state="open"]）降层、Esc 关窗不反弹出坞、更多展开不跳键、换形象可切换、圆标不裁猫耳、靠顶气泡下翻
    // Radix 弹窗降层选择器实际覆盖 dialog + menu（xiaomaomao.js:2585），比旧断言
    // 只匹配 dialog 更强；按真实源码同步字面量，保留「降层逻辑存在」的核心意图。
    expect(WIDGET).toContain('document.querySelectorAll(\'[role="dialog"][data-state="open"], [role="menu"][data-state="open"]\')')
    expect(WIDGET).toContain('var suppressFocusCtl = false;')
    expect(WIDGET).toContain('#xiaomaomao .xm-dock .xm-chat-btn{order:1}#xiaomaomao .xm-dock .xm-fish-btn{order:2}#xiaomaomao .xm-dock .xm-game-btn{order:3}#xiaomaomao .xm-dock .xm-more-btn{order:4}#xiaomaomao .xm-dock .xm-dock-sec{order:5}')
    expect(WIDGET).toContain("if (panelEl.classList.contains('xm-looking')) closeLook();")
    expect(WIDGET).toContain('#xiaomaomao .xm-tab img{width:100%;height:100%;border-radius:0;')
    expect(WIDGET).toContain('#xiaomaomao .xm-bubble.xm-bubble-below{bottom:auto;top:calc(100% + 10px)}')
    // 第五轮易用性深度优化：气泡可点直达聊天、面板一键清空对话、分页场景智能推荐词、上键召回上条输入、接星星按下即判中
    expect(WIDGET).toContain('#xiaomaomao .xm-bubble.xm-show{opacity:1;pointer-events:auto;cursor:pointer}')
    expect(WIDGET).toContain('xm-p-clear')
    expect(WIDGET).toContain('function syncPageChips()')
    expect(WIDGET).toContain("ev.key === 'ArrowUp' && !inputEl.value && lastUserQuery")
    expect(WIDGET).toContain("s.addEventListener('pointerdown'")
  })
})
