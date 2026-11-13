/**
 * DRAG-2：新拖拽系统的源码守卫。
 *
 * 旧的 touch-dnd-guard.test.ts 钉的是 HTML5 DnD + 手写触控长按
 * （touch-reorder.ts），那套已随本次迁移退役：本文件改为钉新系统
 * 的不变量——三处组件里不再有原生拖拽，RGL + dnd-kit + ⋯ 菜单在位，
 * touch-reorder.ts 已删除。
 *
 * 注意：分类拖拽源（category-in-situ-controls.tsx 的手柄）同样已是
 * dnd-kit（DiyCategoryDragGrip，useDraggable），不再是旧的 HTML5
 * 实现——W4 修了它缺失的触屏/键盘接入与播报，见本文件末尾的 W4 段。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')
const exists = (rel: string) => existsSync(resolve(ROOT, rel))

describe('HTML5 DnD 已从三处组件移除', () => {
  it('navigation-card 不再有 draggable/dataTransfer', () => {
    const card = read('src/components/navigation-card.tsx')
    expect(card).not.toContain('dataTransfer')
    expect(card).not.toContain('text/navhub-card-payload')
    expect(card).not.toContain('draggable={isDraggable}')
    expect(card).not.toContain('onDragStart={handleDragStart}')
  })

  it('navigation-category-section 不再有 section 级拖拽处理', () => {
    const section = read('src/components/navigation-category-section.tsx')
    expect(section).not.toContain('dataTransfer')
    expect(section).not.toContain('text/navhub-card-payload')
    expect(section).not.toContain('text/navhub-category-id')
    expect(section).not.toContain('onDragOver={(e)')
    expect(section).not.toContain('onDrop={(e)')
    expect(section).not.toContain('onDragLeave={()')
  })

  it('modular-canvas 不再有 HTML5 拖拽与手写触控长按', () => {
    const canvas = read('src/components/modular/modular-canvas.tsx')
    expect(canvas).not.toContain('dataTransfer')
    expect(canvas).not.toContain("from '@/lib/modular/touch-reorder'")
    expect(canvas).not.toContain('onTouchDragPointerDown')
    expect(canvas).not.toContain('handleDragStart')
    expect(canvas).not.toContain('resolveDropIndex')
    expect(canvas).not.toContain('shouldActivateTouchDrag')
  })

  it('touch-reorder.ts 已删除（由 dnd-kit PointerSensor 接管）', () => {
    expect(exists('src/lib/modular/touch-reorder.ts')).toBe(false)
  })
})

describe('新拖拽系统在位', () => {
  it('卡片有拖拽手柄（dnd-kit handle）与 ⋯ 菜单', () => {
    const card = read('src/components/navigation-card.tsx')
    expect(card).toContain('useDiyDragHandleRef')
    expect(card).toContain('data-diy-drag-handle')
    expect(card).toContain('DiyCardMenu')
    expect(card).toContain('onMoveCard')
    expect(card).toContain("touchAction: 'none'")
  })

  it('分区在编辑态注册 dnd-kit 落点，卡片包上可拖拽层', () => {
    const section = read('src/components/navigation-category-section.tsx')
    expect(section).toContain('DiyCategoryDropTarget')
    expect(section).toContain('DiyDraggableCard')
    expect(section).toContain('useHomeDiyGrid')
    expect(section).toContain("import('@/components/diy/diy-drag-kit')")
  })

  it('画布走 RGL v2 外层网格 + dnd-kit 内层排序', () => {
    const canvas = read('src/components/modular/modular-canvas.tsx')
    expect(canvas).toContain('DiyRglGrid')
    expect(canvas).toContain('DiySortableWidget')
    expect(canvas).toContain('DiyDragProvider')
    expect(canvas).toContain('commitGridLayout')
    // ModularItem 的原生拖拽 props 已从接口删除，画布不再传任何原生
    // 拖拽处理函数（此前靠 preventDefault 中和的空处理已随之删除）：
    // 下面三条断言锁定“画布不向 ModularItem 传原生拖拽处理”。
    expect(canvas).not.toContain('onDragStart={(e) => {')
    expect(canvas).not.toContain('onDragOver={(e) => {')
    expect(canvas).not.toContain('onDragEnd={() => {}}')
  })

  it('dnd-kit 层配了 Pointer/Keyboard 传感器与 live-region 播报', () => {
    const kit = read('src/components/diy/diy-drag-kit.tsx')
    expect(kit).toContain('PointerSensor.configure')
    expect(kit).toContain('KeyboardSensor.configure')
    // 传感器只从 @dnd-kit/react import：@dnd-kit/dom 不是直接依赖，
    // pnpm 下直接 import 它构建会失败；激活约束走 PointerSensor 库
    // 默认值（鼠标在手柄上按下即激活，触屏 250ms + 5px 容差）。
    expect(kit).toContain("from '@dnd-kit/react'")
    expect(kit).not.toContain("from '@dnd-kit/dom'")
    expect(kit).not.toContain('PointerActivationConstraints.Distance')
    expect(kit).toContain('DragDropProvider')
    expect(kit).toContain('useSortable')
    expect(kit).toContain('aria-live="polite"')
    expect(kit).toContain('buildDragAnnouncement')
  })

  it('RGL 层用 v2 配置对象（gridConfig/dragConfig/resizeConfig）', () => {
    const grid = read('src/components/diy/diy-rgl-grid.tsx')
    expect(grid).toContain('GridLayout')
    expect(grid).toContain('useContainerWidth')
    expect(grid).toContain('gridConfig')
    expect(grid).toContain('dragConfig')
    expect(grid).toContain('resizeConfig')
    expect(grid).toContain('react-grid-layout/css/styles.css')
  })

  it('⋯ 菜单不依赖拖拽库：移动/复制/隐藏齐全', () => {
    const menu = read('src/components/diy/diy-card-menu.tsx')
    expect(menu).not.toContain('@dnd-kit')
    expect(menu).not.toContain('dataTransfer')
    expect(menu).toContain('移到顶部')
    expect(menu).toContain('移到末尾')
    expect(menu).toContain('复制链接')
    expect(menu).toContain('隐藏此站点')
    expect(menu).toContain('role="menu"')
  })
})

describe('W4：拖拽 + 键盘 a11y 修复（源码守卫，node 环境无 jsdom）', () => {
  it('分类拖拽手柄可触摸、可聚焦、可键盘激活（P0）', () => {
    const kit = read('src/components/diy/diy-drag-kit.tsx')
    // 原生 button + tabIndex={0}：KeyboardSensor 只在手柄元素本身收到
    // keydown 时激活（event.target 必须是手柄），不可聚焦的 div 按
    // Space 永远到不了传感器
    expect(kit).toContain('DiyCategoryDragGrip')
    expect(kit).toContain("tabIndex={0}")
    expect(kit).toContain("touchAction: 'none'")
    // aria-label 带分类名（不是 categoryId），触摸目标 ≥32px
    expect(kit).toContain('拖动排序分类：')
    expect(kit).toContain('h-8 w-8')
    // 手柄 data 里带 title，provider 播报才能念分类名
    expect(kit).toContain('data: { kind: \'category\', categoryId, isCustom, title }')
  })

  it('RGL 拖拽排除缩放手柄，且不再有自己的 se 手柄与 ModularItem 重叠', () => {
    const grid = read('src/components/diy/diy-rgl-grid.tsx')
    // ModuleResizeHandles 的手柄只 stop 掉 pointerdown，RGL 监听 mousedown，
    // 必须进 cancel 才能拦住「抓缩放手柄同时启动 RGL 拖拽」
    expect(grid).toContain('[data-resize-handle]')
    // RGL 自己的 se 手柄已关（ModularItem 的 8 方向手柄是权威入口），
    // 右下角只剩一个 se 手柄
    expect(grid).not.toContain("handles: ['se']")
    expect(grid).toContain('enabled: false')
    const handles = read('src/components/modular/module-resize-handles.tsx')
    expect(handles).toContain('data-resize-handle="se"')
  })

  it('RGL 网格按容器宽度响应式收窄列数', () => {
    const grid = read('src/components/diy/diy-rgl-grid.tsx')
    expect(grid).toContain('colsForWidth')
    expect(grid).toContain('widgetsToGrid(widgets, cols)')
    expect(grid).toContain('cols,')
  })

  it('画布拖拽开始压快照、提交先顺序后尺寸（一步撤销）', () => {
    const canvas = read('src/components/modular/modular-canvas.tsx')
    expect(canvas).toContain('onDragStart={handleGridDragStart}')
    expect(canvas).toContain('handleGridDragStart')
    // 先 reorder、后 resize：第一次 reorder 推的快照就是拖拽前状态
    const commit = canvas.slice(canvas.indexOf('const commitGridLayout'))
    const reorderAt = commit.indexOf('reorderWidgets(from, to, false)')
    const resizeAt = commit.indexOf('resizeWidget(w.id, w.colSpan, w.rowSpan, false)')
    expect(reorderAt).toBeGreaterThan(-1)
    expect(resizeAt).toBeGreaterThan(-1)
    expect(reorderAt).toBeLessThan(resizeAt)
  })

  it('W5：多步顺序移动只记一步撤销——reorderWidgets 默认记历史，提交显式传 false', () => {
    const layout = read('src/lib/modular/use-modular-layout.ts')
    // 签名带 recordHistory = true 默认值，透传给 updateCurrentWidgets
    expect(layout).toContain('(sourceIndex: number, destinationIndex: number, recordHistory = true)')
    const reorder = layout.slice(layout.indexOf('const reorderWidgets'))
    expect(reorder).toContain('}, recordHistory)')
    // 单步移动仍走默认 true：移位按钮与 dnd-kit 落点都不传第三个参数
    expect(layout).toContain('reorderWidgets(index, targetIndex)')
    const canvas = read('src/components/modular/modular-canvas.tsx')
    expect(canvas).toContain('reorderWidgets(source.index, target.index)')
    // 只有 RGL 提交（多步 planOrderMoves）显式关历史：beginInteraction 那份
    // 拖拽前快照是唯一的一步，撤销一次即回到拖拽前
    const commit = canvas.slice(canvas.indexOf('const commitGridLayout'))
    expect(commit).toContain('reorderWidgets(from, to, false)')
    expect(commit).not.toContain('reorderWidgets(from, to)\n')
  })

  it('拖拽播报念分类名、无变化报 nochange 而不是取消', () => {
    const kit = read('src/components/diy/diy-drag-kit.tsx')
    expect(kit).toContain('displayTitle')
    expect(kit).toContain('source.title ?? source.categoryId')
    expect(kit).toContain("buildDragAnnouncement('nochange'")
    const drag = read('src/lib/modular/diy-drag.ts')
    expect(drag).toContain("phase === 'nochange'")
    expect(drag).toContain('位置没有变化')
    // 落点 data 带 title（section 传分类名）
    const section = read('src/components/navigation-category-section.tsx')
    expect(section).toContain('title: category.title')
  })

  it('卡片 ⋯ 菜单隐藏项用 EyeOff 而不是 Trash2', () => {
    const menu = read('src/components/diy/diy-card-menu.tsx')
    expect(menu).toContain('EyeOff')
    expect(menu).not.toContain('Trash2')
  })

  it('图标按钮都有 aria-label（分类就地按钮 / 小组件移位 / 看板删除）', () => {
    const controls = read('src/components/category-in-situ-controls.tsx')
    expect(controls).toContain('上移分类：')
    expect(controls).toContain('下移分类：')
    expect(controls).toContain('置顶分类：')
    expect(controls).toContain('隐藏分类：')
    const item = read('src/components/modular/modular-item.tsx')
    expect(item).toContain('向前移动小组件：')
    expect(item).toContain('向后移动小组件：')
    const canvas = read('src/components/modular/modular-canvas.tsx')
    expect(canvas).toContain('删除看板：')
  })

  it('移动与撤销/重做有播报（菜单移动 / 分类移位 / 画布提交 / 撤销重做）', () => {
    const card = read('src/components/navigation-card.tsx')
    expect(card).toContain('handleMenuMove')
    expect(card).toContain('现在是第')
    const controls = read('src/components/category-in-situ-controls.tsx')
    expect(controls).toContain('已将分类「${title}」上移')
    expect(controls).toContain('已将分类「${title}」下移')
    const canvas = read('src/components/modular/modular-canvas.tsx')
    expect(canvas).toContain('handleShiftWidget')
    expect(canvas).toContain('已撤销上一步操作')
    expect(canvas).toContain('已重做操作')
  })

  it('拖拽手柄与 ⋯ 触发器有可见焦点环（WCAG 2.4.7）', () => {
    const kit = read('src/components/diy/diy-drag-kit.tsx')
    expect(kit).toContain('focus-visible:ring-2 focus-visible:ring-primary/60')
    const menu = read('src/components/diy/diy-card-menu.tsx')
    expect(menu).toContain('focus-visible:ring-2 focus-visible:ring-primary/60')
    const card = read('src/components/navigation-card.tsx')
    expect(card).toContain('focus-visible:ring-2 focus-visible:ring-primary/60')
  })

  it('过时注释已更新：分类手柄不再是「旧 HTML5 实现」', () => {
    const section = read('src/components/navigation-category-section.tsx')
    expect(section).not.toContain('仍是旧的 HTML5')
    expect(section).not.toContain('迁移是 coordinator 的后续项')
    expect(section).toContain('DiyCategoryDragGrip')
  })
})

describe('W2-11：已隐藏分类的占位行不半透明（活按钮在里面）', () => {
  it('隐藏行不再有 opacity-70：恢复显示按钮必须全对比度可点', () => {
    const section = read('src/components/navigation-category-section.tsx')
    const hiddenRow = section.slice(section.indexOf('if (isHidden) {'))
    // 锚点从 className 之后找「恢复显示」：行首注释里也提到了它，不能从头找
    const classStart = hiddenRow.indexOf('className="')
    const rowClass = hiddenRow.slice(0, hiddenRow.indexOf('恢复显示', classStart))
    expect(rowClass).not.toContain('opacity-70')
    expect(rowClass).not.toContain('hover:opacity-100')
    // 隐藏状态仍有其它表达：虚线边框 + 柔和底色 +「(已隐藏)」标签 + EyeOff
    expect(rowClass).toContain('border-dashed')
    expect(rowClass).toContain('(已隐藏)')
  })
})

describe('W2-10：全部分类被隐藏的空态能真正恢复', () => {
  it('空态按「是否全被隐藏」分流：全隐藏时恢复两份账本，不只切工作区', () => {
    const content = read('src/components/navigation-content.tsx')
    expect(content).toContain('allCategoriesHidden')
    expect(content).toContain('handleRecoverHiddenCategories')
    expect(content).toContain('恢复全部隐藏分类')
    // 恢复动作：掩码逐个恢复 + DIY 全部取消隐藏 + 切回全部工作区
    expect(content).toContain('restoreFeature(id)')
    expect(content).toContain('unhideAllCategories()')
    expect(content).toContain("setActiveWorkspace('all')")
    // 判定用两份账本合并（掩码 id 带前缀，先剥掉），不是只看 DIY 一份
    expect(content).toContain('stripFeaturePrefix(id)')
    // 非隐藏原因的空态仍保留原来的「查看全部站点」
    expect(content).toContain('查看全部站点')
  })
})

describe('W2-8：只留中文播报，排除插件英文播报', () => {
  it('provider 用 withoutAccessibilityPlugin 过滤默认插件，且不 import @dnd-kit/dom', () => {
    const kit = read('src/components/diy/diy-drag-kit.tsx')
    expect(kit).toContain('plugins={(defaults) => withoutAccessibilityPlugin(defaults)}')
    expect(kit).not.toContain("from '@dnd-kit/dom'")
    // 中文 live-region 仍在：它是唯一播报源
    expect(kit).toContain('aria-live="polite"')
    expect(kit).toContain('buildDragAnnouncement')
    // 旧注释「两套并存、等真机验证」已作废
    expect(kit).not.toContain('两套并存可能重复播报')
    expect(kit).not.toContain('需 Ryan 真机验证后决定是否把插件默认播报关掉')
  })
})

describe('W2-7：分类落点按指针半区算，卡片拖拽不承诺位置', () => {
  it('分类拖拽结束按指针上下半区换算插入序号（不是裸目标序号）', () => {
    const content = read('src/components/navigation-content.tsx')
    const handler = content.slice(content.indexOf('const handleCategoryDragEnd'))
    expect(handler).toContain('activatorEvent')
    expect(handler).toContain('instanceof PointerEvent')
    expect(handler).toContain('position?.current?.y')
    expect(handler).toContain('getBoundingClientRect()')
    expect(handler).toContain('afterTarget')
    expect(handler).toContain('moveCategoryToIndex(source.categoryId, toIndex, afterTarget)')
    const grid = read('src/lib/modular/use-home-diy-grid.ts')
    expect(grid).toContain('resolveCategoryDropIndex')
    expect(grid).toContain('afterTarget?: boolean')
  })

  it('卡片落点引导条按目标类型说收录/重归类，不说位置', () => {
    const section = read('src/components/navigation-category-section.tsx')
    expect(section).toContain('将卡片重归类至')
    expect(section).toContain('直接收录卡片至')
    // 旧文案是无条件 JSX：所有目标都说「收录至专属分类」，内置分类也被说成收录
    expect(section).not.toContain('「{category.title}」专属分类</span>')
  })
})
