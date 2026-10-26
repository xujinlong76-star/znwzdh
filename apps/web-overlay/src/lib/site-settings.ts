import { z } from 'zod'
import type { SiteConfig } from '@/types/site'

/**
 * 站点设置的唯一口径。
 *
 * 两条约束决定了这个文件的形态：
 * 1. `@/types/site` 属于 vendor 底座（scripts/vendor-web.mjs 每次从上游 tarball
 *    重新落盘），不能在那里加字段——新字段只能在本文件用交叉类型扩展。
 * 2. 中枢把 site.json 当无 schema 的 KV 整坨存（apps/api/src/storage.ts 的
 *    writeSiteConfig），少一个键就是少一个键，没有任何兜底。所以**写侧必须合并**、
 *    **读侧必须归一化**，否则一次全量覆盖就把别的工具写入的键抹掉了。
 */

/** 中枢存储路径（与 layout / api/site / metadata 共用同一常量） */
export const SITE_CONTENT_PATH = 'src/navsphere/content/site.json'

export interface SiteSettingsExtra {
  basic: {
    /** 分享卡大图（1200×630）。缺省时用 /og-default.png */
    ogImage?: string
  }
  appearance: {
    /** 品牌主色，进 PWA manifest 的 theme_color */
    themeColor?: string
  }
  footer?: {
    text?: string
    icp?: string
  }
}

export type SiteSettings = SiteConfig & SiteSettingsExtra

/** 表单每个 tab 提交的“部分更新”形状（字段级 null = 显式清空） */
export type SiteSettingsPatch = {
  basic?: Partial<SiteSettings['basic'] & { ogImage?: string | null }>
  appearance?: Partial<SiteSettings['appearance'] & { themeColor?: string | null }>
  navigation?: Partial<SiteSettings['navigation']>
  footer?: { text?: string | null; icp?: string | null }
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

/**
 * 图片/图标类字段允许的形态：绝对 http(s) 或站内相对路径。
 *
 * 这里刻意不放开 `data:` 与 `javascript:`：值会直接落进 `<img src>`、
 * `<link rel=icon>` 与 metadata.icons，`javascript:` 在 link href 上是可执行的；
 * `data:` 则是把几百 KB 的图塞进整坨站点配置里，每次首页渲染都跟着走一遍。
 * 上传走 /api/site/asset，落地后仍然是个站内相对 URL。
 */
const ASSET_RE = /^(https?:\/\/[^\s]+|\/[^\s]*)$/i

const assetField = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || ASSET_RE.test(v), {
    message: '必须是 http(s) 绝对地址或站内相对路径',
  })

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, { message: '必须是 #RRGGBB' })

/** 空串在这里不是「值」，是「没设过」——统一由 normalizeSettings 折叠成 undefined */
export const siteSettingsPatchSchema = z.object({
  basic: z
    .object({
      title: z.string().trim().min(2, '标题至少 2 个字符').max(120).optional(),
      description: z.string().trim().min(10, '描述至少 10 个字符').max(500).optional(),
      keywords: z.string().trim().max(300).nullable().optional(),
      ogImage: assetField.nullable().optional(),
    })
    .strict()
    .optional(),
  appearance: z
    .object({
      logo: assetField.nullable().optional(),
      favicon: assetField.nullable().optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      themeColor: hexColor.nullable().optional(),
    })
    .strict()
    .optional(),
  navigation: z.object({ linkTarget: z.enum(['_blank', '_self']).optional() }).strict().optional(),
  footer: z
    .object({
      text: z.string().trim().max(200).nullable().optional(),
      icp: z
        .string()
        .trim()
        .max(60)
        .refine((v) => v === null || v === '' || /^[\d\u4e00-\u9fa5a-zA-Z\-/（）() ]+$/.test(v), {
          message: '备案号只允许汉字、数字、字母与 -/() 分隔符',
        })
        .nullable()
        .optional(),
    })
    .strict()
    .optional(),
})

/* ------------------------------------------------------------------ *
 * 归一化（读侧）
 * ------------------------------------------------------------------ */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.replace(CONTROL_CHARS, '').trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

function asset(value: unknown): string | undefined {
  const raw = text(value, 500)
  if (!raw) return undefined
  return ASSET_RE.test(raw) ? raw : undefined
}

/**
 * 把库里拿到的原始 JSON 收敛成可用形状，**任何情况下都不抛**。
 *
 * 读侧不做这件事的后果实测过：历史 `kv:site-config` 里存在上游基线的
 * `theme: "auto"`，表单的 z.enum 直接失败，整个 /admin/site 永久打不开。
 * 这里只认白名单，脏值折叠成默认值，页面继续可编辑。
 */
export function normalizeSettings(raw: unknown): SiteSettings {
  const src = (raw ?? {}) as Record<string, unknown>
  const basic = (src.basic ?? {}) as Record<string, unknown>
  const appearance = (src.appearance ?? {}) as Record<string, unknown>
  const navigation = (src.navigation ?? {}) as Record<string, unknown>
  const footer = (src.footer ?? {}) as Record<string, unknown>

  const theme = appearance.theme
  const linkTarget = navigation.linkTarget
  const ogImage = asset(basic.ogImage)
  const themeColor = typeof appearance.themeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(appearance.themeColor.trim())
    ? appearance.themeColor.trim().toLowerCase()
    : undefined
  const footerText = text(footer.text, 200)
  const footerIcp = text(footer.icp, 60)

  return {
    basic: {
      title: text(basic.title, 120) ?? '',
      description: text(basic.description, 500) ?? '',
      keywords: text(basic.keywords, 300) ?? '',
      ...(ogImage ? { ogImage } : {}),
    },
    appearance: {
      logo: asset(appearance.logo) ?? '',
      favicon: asset(appearance.favicon) ?? '',
      theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system',
      ...(themeColor ? { themeColor } : {}),
    },
    navigation: {
      linkTarget: linkTarget === '_self' ? '_self' : '_blank',
    },
    ...(footerText || footerIcp ? { footer: { ...(footerText ? { text: footerText } : {}), ...(footerIcp ? { icp: footerIcp } : {}) } } : {}),
    // 保留本文件不认识的对象键：mergeSettings 负责落库，读侧不该丢别人的数据
    ...unknownSections(src),
  } as SiteSettings
}

/** 本模块未建模、但可能由其它工具写入的顶层键 */
function unknownSections(src: Record<string, unknown>): Record<string, unknown> {
  const known = new Set(['basic', 'appearance', 'navigation', 'footer'])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(src)) if (!known.has(k)) out[k] = v
  return out
}

/* ------------------------------------------------------------------ *
 * 合并（写侧）
 * ------------------------------------------------------------------ */

/**
 * 部分更新：`undefined` = 本次没动，`null` 或 `''` = 显式清空该设置。
 *
 * 为什么必须有这一步：中枢的 writeSiteConfig 是整坨覆盖，而 /admin/site
 * 是分 tab 保存的。没有合并，第一次只存「导航设置」就会把 basic/appearance
 * 全清掉；也没有合并，未来任何新增 tab 都会互相抹数据。
 */
export function mergeSettings(current: unknown, patch: SiteSettingsPatch): SiteSettings {
  const base = normalizeSettings(current)
  const merged: Record<string, unknown> = { ...base }

  for (const section of ['basic', 'appearance', 'navigation', 'footer'] as const) {
    const incoming = patch[section]
    if (!incoming) continue
    const sectionBase = base[section]
    const before: Record<string, unknown> =
      sectionBase && typeof sectionBase === 'object' ? { ...(sectionBase as Record<string, unknown>) } : {}
    for (const [key, value] of Object.entries(incoming)) {
      if (value === undefined) continue
      if (value === null || value === '') delete before[key]
      else before[key] = value
    }
    merged[section] = before
  }

  return normalizeSettings(merged)
}

/** 至少要有一个「本次要动的字段」，否则等于让管理员点了一次空保存 */
export function hasPatchContent(patch: SiteSettingsPatch): boolean {
  return (['basic', 'appearance', 'navigation', 'footer'] as const).some((section) => {
    const value = patch[section]
    return !!value && Object.values(value).some((v) => v !== undefined)
  })
}

/* ------------------------------------------------------------------ *
 * 展示层辅助：配置缺席时必须有兜底，否则首页渲染期抛错
 * ------------------------------------------------------------------ */

export const BRAND_FALLBACK = '山羊胡'

/** 站点默认主题 → next-themes 的 defaultTheme（用户手动选过就以用户为准） */
export function resolveDefaultTheme(settings: Pick<SiteSettings, 'appearance'> | null | undefined): 'light' | 'dark' | 'system' {
  const theme = settings?.appearance?.theme
  return theme === 'light' || theme === 'dark' ? theme : 'system'
}
