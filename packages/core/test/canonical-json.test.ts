/**
 * 规范 JSON 序列化（canonicalJsonStringify）的用例。
 *
 * 每条断言对应一个「直接 JSON.stringify 会判错」的真实形状：
 * 键序漂移导致零改动被判成更新、数组顺序被误排、undefined 属性导致假差异等。
 * 这些错误不会抛异常，只会让审计日志里出现假变更、让整批种子每次同步都被重写。
 */
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '../src/canonical-json.ts'

describe('canonicalJsonStringify', () => {
  it('对象键序不同但内容相同 -> 输出相同（核心动机）', () => {
    const fromDb = { name: 'A', version: '1.0.0', tags: ['x', 'y'] }
    const fromSeed = { tags: ['x', 'y'], version: '1.0.0', name: 'A' }
    expect(JSON.stringify(fromDb)).not.toBe(JSON.stringify(fromSeed))
    expect(canonicalJsonStringify(fromDb)).toBe(canonicalJsonStringify(fromSeed))
  })

  it('嵌套对象的键序同样被归一', () => {
    const a = { manifest: { ui: { cols: 2, rows: 1 }, kind: 'site-pack' } }
    const b = { manifest: { kind: 'site-pack', ui: { rows: 1, cols: 2 } } }
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b))
  })

  it('数组顺序是语义的一部分，不排序', () => {
    const a = { tags: ['x', 'y'] }
    const b = { tags: ['y', 'x'] }
    expect(canonicalJsonStringify(a)).not.toBe(canonicalJsonStringify(b))
  })

  it('对象里的 undefined 属性被忽略，与 JSON.stringify 一致', () => {
    expect(canonicalJsonStringify({ a: 1, b: undefined })).toBe(canonicalJsonStringify({ a: 1 }))
  })

  it('null 与缺失属性不是同一件事', () => {
    expect(canonicalJsonStringify({ a: null })).not.toBe(canonicalJsonStringify({}))
    expect(canonicalJsonStringify({ a: null })).toBe('{"a":null}')
  })

  it('数组空洞与 undefined 元素输出 null（不产生非法 JSON）', () => {
    const sparse = [1, , 3] as unknown[]
    expect(canonicalJsonStringify(sparse)).toBe('[1,null,3]')
    expect(canonicalJsonStringify([1, undefined, 3])).toBe('[1,null,3]')
  })

  it('数字与 JSON.stringify 同口径：1.0 归一为 1，NaN/Infinity 为 null', () => {
    expect(canonicalJsonStringify({ a: 1.0 })).toBe('{"a":1}')
    expect(canonicalJsonStringify({ a: Number.NaN })).toBe('{"a":null}')
    expect(canonicalJsonStringify({ a: Number.POSITIVE_INFINITY })).toBe('{"a":null}')
  })

  it('带 toJSON 的对象（Date）走标准路径', () => {
    const d = new Date('2026-10-27T00:00:00.000Z')
    expect(canonicalJsonStringify({ at: d })).toBe('{"at":"' + d.toISOString() + '"}')
  })

  it('键排序按 UTF-16 码元（与 RFC 8785 一致，中文/大写字母不被特殊对待）', () => {
    expect(canonicalJsonStringify({ b: 1, A: 2, a: 3, 中: 4 })).toBe('{"A":2,"a":3,"b":1,"中":4}')
  })

  it('循环引用抛 TypeError，不静默截断', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(() => canonicalJsonStringify(a)).toThrow(TypeError)
  })

  it('同一对象重复出现但不是循环（DAG）可以序列化', () => {
    const shared = { x: 1 }
    expect(canonicalJsonStringify({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}')
  })

  it('BigInt 抛 TypeError（JSON 无法表示，不能悄悄变成字符串）', () => {
    expect(() => canonicalJsonStringify({ big: 1n })).toThrow(TypeError)
  })

  it('字符串转义保持 JSON 语义（换行/引号/emoji）', () => {
    const value = { note: 'line1\nline2 "q" 🐐' }
    expect(JSON.parse(canonicalJsonStringify(value))).toEqual(value)
  })
})
