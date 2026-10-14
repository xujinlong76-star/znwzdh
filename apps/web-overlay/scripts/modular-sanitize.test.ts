/**
 * 模块实例净化测试（node:assert 风格，与 scripts/ 下其它测试一致）。
 *
 * 锁定"僵尸卡片"回归：含失效模块类型的 JSON 必须在加载/导入时被净化，
 * 否则 UI 上会出现没有删除入口、永远移不掉的占位卡片。
 *
 * 运行：node_modules/.bin/tsx apps/web/scripts/modular-sanitize.test.ts
 */
import assert from 'node:assert'
import { sanitizeWidgetInstances } from '../src/lib/modular/sanitize'

// 模拟注册表谓词（真实场景由 use-modular-layout 传 WIDGET_REGISTRY 查询）
const isKnownType = (type: string) => ['clock-pomodoro', 'quick-tools', 'weather'].includes(type)

const valid = { id: 'w-1', type: 'clock-pomodoro', colSpan: 3, rowSpan: 1, config: {}, createdAt: 1 }

// 有效实例原样保留
assert.strictEqual(sanitizeWidgetInstances([valid], isKnownType).length, 1)
// 失效类型被剔除（旧版导出 / 注册表改名）
assert.strictEqual(sanitizeWidgetInstances([{ ...valid, id: 'w-2', type: 'ghost-widget' }], isKnownType).length, 0)
// 非对象条目被剔除
assert.strictEqual(sanitizeWidgetInstances([null, undefined, 42, 'x'], isKnownType).length, 0)
// 缺 type 字段被剔除
assert.strictEqual(sanitizeWidgetInstances([{ id: 'w-3' }], isKnownType).length, 0)
// type 非字符串被剔除
assert.strictEqual(sanitizeWidgetInstances([{ id: 'w-4', type: 7 }], isKnownType).length, 0)
// 非数组输入安全返回空数组（localStorage 损坏 / JSON 形状意外）
assert.deepStrictEqual(sanitizeWidgetInstances(null, isKnownType), [])
assert.deepStrictEqual(sanitizeWidgetInstances('not-array', isKnownType), [])
assert.deepStrictEqual(sanitizeWidgetInstances({}, isKnownType), [])
// 混合数组：只留有效的，且保持原有顺序
const mixed = [
  { ...valid, id: 'a', type: 'ghost' },
  { ...valid, id: 'b', type: 'quick-tools' },
  null,
  { ...valid, id: 'c', type: 'weather' },
]
const kept = sanitizeWidgetInstances(mixed, isKnownType)
assert.strictEqual(kept.length, 2)
assert.strictEqual(kept[0].id, 'b')
assert.strictEqual(kept[1].id, 'c')
// 不修改原数组
assert.strictEqual(mixed.length, 4)

console.log('All modular-sanitize tests passed.')
