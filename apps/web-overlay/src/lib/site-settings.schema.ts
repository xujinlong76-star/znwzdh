import { z } from 'zod'
// 同目录互引走相对路径：本文件会被 vitest / 脚本 / Next 三套解析器分别处理，
// 相对路径在三处都成立，不依赖 tsconfig paths 或 vite alias 的配置是否对齐。
import { ASSET_RE, FEATURE_KEYS, HOME_SECTION_KEYS, pwaAssetPattern, type PwaAssetKind } from './site-settings'

/**
 * 站点设置的**写侧校验口径**（zod）。
 *
 * 与 `@/lib/site-settings` 的分工（2026-11-07 首屏预算整改）：
 * - `@/lib/site-settings` = 类型 + 纯函数 + 读侧归一化，**客户端安全、零校验库依赖**；
 * - 本文件 = 表单提交时的 schema，只服务 `/api/site`（服务端）与 `/admin/site`
 *   （后台表单，自身已 `import { z }` 构建 uiSchema）。
 *
 * 为什么必须分成两个文件而不是同一文件的多个导出：首页 / 热榜 / 合集等客户端岛
 * 只从 `@/lib/site-settings` 取 `externalLinkRelAttr`，但 ESM 的 `import { z }`
 * 是模块顶层副作用，摇不掉——实测把 103 KB 的 zod 拖进了上面那些路由的首屏。
 * 分成两个模块后，客户端不再触碰 zod，而写侧校验一行逻辑都没少。
 *
 * 规则来源统一：`ASSET_RE` 与 `pwaAssetPattern` 都从读侧模块引，避免
 * 「表单放行但读侧丢弃」或反之的两套口径。
 */

const assetField = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || ASSET_RE.test(v), {
    message: '必须是 http(s) 绝对地址或站内相对路径',
  })

/**
 * PWA 图标的写侧校验：只接受**同 kind** 的上传成果，且形如
 * `/api/site/asset/<kind>-<10位hex>.png`；空串表示「清空，回退内置图」。
 *
 * 命名规则本身在 `pwaAssetPattern`，读侧 `normalizeSettings` 用的是同一份，
 * 两处不会漂移。
 */
export function pwaAssetField(kind: PwaAssetKind) {
  const uploadedPng = pwaAssetPattern(kind)
  return z.string().trim().max(500).refine((v) => v === '' || uploadedPng.test(v), {
    message: `请上传对应的 ${kind} PNG，或清空以使用默认图标`,
  })
}

const hexColor = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, { message: '必须是 #RRGGBB' })

/** 空串在这里不是「值」，是「没设过」——统一由 normalizeSettings 折叠成 undefined */
export const siteSettingsPatchSchema = z.object({
  basic: z
    .object({
      title: z.string().trim().min(2, '标题至少 2 个字符').max(120).optional(),
      description: z.string().trim().min(10, '描述至少 10 个字符').max(500).optional(),
      keywords: z.string().trim().max(300).nullable().optional(),
      ogImage: assetField.nullable().optional(),
      tagline: z.string().trim().max(120).nullable().optional(),
    })
    .strict()
    .optional(),
  announcement: z
    .object({
      enabled: z.boolean().optional(),
      text: z.string().trim().max(200).nullable().optional(),
      linkUrl: assetField.nullable().optional(),
      linkLabel: z.string().trim().max(30).nullable().optional(),
      startAt: z.number().int().min(0).max(4_102_444_800_000).nullable().optional(),
      endAt: z.number().int().min(0).max(4_102_444_800_000).nullable().optional(),
    })
    .strict()
    .optional(),
  features: z
    .object(
      Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().optional()])),
    )
    .strict()
    .optional(),
  home: z
    .object({
      order: z
        .array(z.enum(HOME_SECTION_KEYS))
        .max(HOME_SECTION_KEYS.length)
        .optional(),
    })
    .strict()
    .optional(),
  appearance: z
    .object({
      logo: assetField.nullable().optional(),
      favicon: assetField.nullable().optional(),
      appleTouchIcon: assetField.nullable().optional(),
      pwaIcon192: pwaAssetField('pwaIcon192').nullable().optional(),
      pwaIcon512: pwaAssetField('pwaIcon512').nullable().optional(),
      pwaMaskable512: pwaAssetField('pwaMaskable512').nullable().optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      themeColor: hexColor.nullable().optional(),
    })
    .strict()
    .optional(),
  navigation: z
    .object({
      linkTarget: z.enum(['_blank', '_self']).optional(),
      externalLinkRel: z.enum(['nofollow', 'dofollow']).optional(),
    })
    .strict()
    .optional(),
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
