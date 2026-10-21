import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** overlay 与 apps/web 两份布局下都指向包根 */
const ROOT = resolve(HERE, '..')
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('移动端 DIY 拖拽通道必须保持在', () => {
  it('卡片带索引标记，手柄接触控 pointerdown', () => {
    const item = read('src/components/modular/modular-item.tsx')
    expect(item).toContain('data-modular-item-index={index}')
    expect(item).toContain('onTouchDragPointerDown')
    expect(item).toContain("touchAction: 'none'")
  })

  it('画布走纯函数判定并复用既有换位入口', () => {
    const canvas = read('src/components/modular/modular-canvas.tsx')
    expect(canvas).toContain("from '@/lib/modular/touch-reorder'")
    expect(canvas).toContain('shouldActivateTouchDrag')
    expect(canvas).toContain('resolveDropIndex')
    // 判定已收敛到纯函数 resolveTouchDragEnd，最终仍复用既有换位入口
    expect(canvas).toContain('resolveTouchDragEnd')
    expect(canvas).toContain('reorderWidgetsRef.current(decision.reorder[0], decision.reorder[1])')
    expect(canvas).toContain('onTouchDragPointerDown={handleTouchDragPointerDown}')
  })

  it('桌面端 HTML5 拖拽通道保留（移动端兜底不替换原实现）', () => {
    const item = read('src/components/modular/modular-item.tsx')
    const canvas = read('src/components/modular/modular-canvas.tsx')
    expect(item).toContain('draggable={isEditing}')
    expect(canvas).toContain('onDragStart={handleDragStart}')
    expect(canvas).toContain('onDragOver={handleDragOver}')
  })
})
