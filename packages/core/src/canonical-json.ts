/**
 * 规范 JSON 序列化 —— 用于「内容是否变了」这类纯比较场景。
 *
 * 为什么不能直接 `JSON.stringify(a) !== JSON.stringify(b)`：
 * 两个对象语义相同、只是键的插入顺序不同，stringify 会得到不同字符串。
 * 真实影响：种子同步（`seed.ts` / 后台「在线同步种子插件」）用 stringify 对比
 * 库内 manifest 与新 manifest。而 manifest 的键序不是任何地方承诺过的不变量：
 * payload 里 config/tokens 这类自由结构保留源对象的键序，清理函数在不同版本之间
 * 重建对象时字段顺序也会变。于是语义完全相同的清单会被判成「已更新」，
 * 进而触发 updatePlugin（重置为待审）+ reviewPlugin + 重新入索引——
 * 每次同步都把整批插件刷一遍，审计日志里全是假变更。
 *
 * 口径（对齐 RFC 8785 / JCS 的稳定子集，不引入依赖）：
 *  - 对象键按 UTF-16 码元排序（`Array.prototype.sort()` 的默认序，与 JCS 一致）
 *  - 数组保持原顺序（顺序是语义的一部分，排序会掩盖真实变更）
 *  - 对象里值为 undefined / function / symbol 的属性被忽略（与 JSON.stringify 一致）
 *  - 数组空洞与 undefined 元素输出 null（与 JSON.stringify 一致）
 *  - NaN / Infinity 输出 null（与 JSON.stringify 一致）
 *  - 带 toJSON 的对象（Date 等）先走 toJSON（与 JSON.stringify 一致）
 *  - 循环引用抛 TypeError，不静默截断
 *  - 不做 Unicode 归一化、不处理 BigInt（遇到抛 TypeError）
 *
 * 边界：这是**同语言内的相等比较**工具，不是跨语言签名载荷序列化器。
 * 若将来要跨语言（例如插件清单签名），数字格式等细节需换成 RFC 8785 全量实现；
 * 当前仓库的消费者只有种子同步与插件更新判定，这个子集足够且可解释。
 */
export function canonicalJsonStringify(value: unknown): string {
  return stringifyValue(value, new Set<object>())
}

function stringifyValue(value: unknown, seen: Set<object>): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null"
    case "boolean":
      return value ? "true" : "false"
    case "string":
      return JSON.stringify(value)
    case "bigint":
      throw new TypeError("canonicalJsonStringify: 不支持 BigInt（JSON 同样无法表示）")
    case "undefined":
    case "function":
    case "symbol":
      // 只会从「顶层」或「数组元素」到达这里；对象属性在下面被显式跳过
      return "null"
  }

  const obj = value as object
  const toJSON = (obj as { toJSON?: () => unknown }).toJSON
  if (typeof toJSON === "function") {
    return stringifyValue(toJSON.call(obj), seen)
  }
  if (seen.has(obj)) {
    throw new TypeError("canonicalJsonStringify: 存在循环引用")
  }

  seen.add(obj)
  try {
    if (Array.isArray(obj)) {
      // 不用 map：map 会跳过空洞，导致 `[,1]` 被序列化成 `[,1]` 这种非法 JSON
      const parts: string[] = []
      for (let i = 0; i < obj.length; i += 1) parts.push(stringifyValue(obj[i], seen))
      return "[" + parts.join(",") + "]"
    }
    const record = obj as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      const itemType = typeof item
      if (itemType === "undefined" || itemType === "function" || itemType === "symbol") continue
      parts.push(JSON.stringify(key) + ":" + stringifyValue(item, seen))
    }
    return "{" + parts.join(",") + "}"
  } finally {
    seen.delete(obj)
  }
}
