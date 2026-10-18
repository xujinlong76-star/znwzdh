/**
 * 工作台布局的本地存储接缝。
 *
 * 为什么单独成模块：`use-modular-layout` 在 JSON.parse 失败时只 `console.warn`
 * 后回退默认模板，紧接着的自动持久化副作用会把默认模板**写回同一个 key** ——
 * 用户被截断/污染的布局就此静默丢失，事后无现场可查。
 * 这里把「备份现场 + 抑制首次自动写盘」抽成可回归测试的纯函数。
 */

/** 损坏数据的备份 key（带时间戳，避免二次损坏覆盖第一次的现场） */
export function corruptBackupKey(key: string, ts: number): string {
  return `${key}.corrupt.${ts}`
}

export interface StorageWriter {
  setItem(key: string, value: string): void
}

/**
 * 备份损坏的原始字符串，返回备份 key；写盘失败返回 null。
 *
 * 刻意不抛：备份是尽力而为的补救，失败也不该再打断初始化。
 * （隐私模式 / 配额耗尽时 setItem 会抛，与读取失败同源。）
 */
export function backupCorruptPayload(
  key: string,
  raw: string,
  ts: number,
  storage: StorageWriter,
): string | null {
  const backupKey = corruptBackupKey(key, ts)
  try {
    storage.setItem(backupKey, raw)
    return backupKey
  } catch {
    return null
  }
}
