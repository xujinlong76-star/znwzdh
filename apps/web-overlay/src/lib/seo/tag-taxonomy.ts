/**
 * 标签规范词典（单一事实源在 tag-taxonomy.json）。
 *
 * 为什么 JSON 而不是 TS：scripts/normalize-tags.mjs 是 Node ESM 脚本，
 * 与 Next 运行时共用同一份映射才能保证「脚本归并后的规范名」与
 * 「/tags/[slug] 的 canonical 目标」永远一致；两份 TS/JS 拷贝必然漂移。
 *
 * 职责边界：
 * - 这里只做**字符串层**归一（大小写、空格、同义词）；
 * - 与所属一级大类同名的复读标签由治理脚本在**数据层**剥离，
 *   展示层的分类重复判定仍归 tag-hygiene.ts。
 */

import taxonomy from './tag-taxonomy.json'
import { tagSlug } from './tag-slug'

export const FORCED_ACRONYMS: readonly string[] = taxonomy.forcedAcronyms as string[]
export const SPECIAL_ALIASES: Readonly<Record<string, string>> = taxonomy.specialAliases as Record<string, string>
export const TAG_SYNONYM_MAP: Readonly<Record<string, string>> = taxonomy.tagSynonymMap as Record<string, string>

/** 同义词表 / 去重用的键：小写 + 去 # + 去空白/连字符/下划线/分隔符。 */
export function normalizeTagKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/·、，,]+/g, '')
}

/**
 * 标准大小写与空格规则：
 * 1. 词典内缩写强制大写（词边界匹配，不误伤 OpenAI / PostgreSQL / 3DM）；
 * 2. ASCII 字母数字与中日韩字符之间统一插入一个空格；
 * 3. 连续空白折叠为一个。
 */
export function applyTagStyle(raw: string | null | undefined): string {
  let out = String(raw ?? '').trim().replace(/^#+/, '').trim().replace(/\s+/g, ' ')
  if (!out) return ''
  for (const acronym of FORCED_ACRONYMS) {
    out = out.replace(
      new RegExp(`(?<![A-Za-z0-9])${acronym}(?![A-Za-z0-9])`, 'gi'),
      acronym,
    )
  }
  out = out.replace(/([A-Za-z0-9])([\u3400-\u9fff])/g, '$1 $2')
  out = out.replace(/([\u3400-\u9fff])([A-Za-z0-9])/g, '$1 $2')
  return out.trim()
}

/** 原始标签名 → 规范展示名（先查同义词表，再套大小写/空格规则；幂等）。 */
export function canonicalizeTagName(raw: string | null | undefined): string {
  const clean = String(raw ?? '').trim().replace(/^#+/, '').trim()
  if (!clean) return ''
  const key = normalizeTagKey(clean)
  const special = SPECIAL_ALIASES[key]
  if (special) return special
  return applyTagStyle(TAG_SYNONYM_MAP[key] ?? clean)
}

/**
 * 旧 slug / 别名 slug → 规范 slug；没有变更时返回 null。
 * 标签页据此输出 canonical（并在页面层对已知同义词发 308）。
 */
export function resolveCanonicalTagSlug(slug: string | null | undefined): string | null {
  const clean = String(slug ?? '').trim()
  if (!clean) return null
  const canonical = canonicalizeTagName(clean)
  if (!canonical) return null
  const target = tagSlug(canonical)
  return target && target !== clean ? target : null
}

/** 是否命中已知同义词（大小写/空格变体不算，避免规范页自己重定向自己）。 */
export function isTagSynonymAlias(slug: string | null | undefined): boolean {
  const key = normalizeTagKey(slug)
  if (!key) return false
  return Object.prototype.hasOwnProperty.call(TAG_SYNONYM_MAP, key)
}
