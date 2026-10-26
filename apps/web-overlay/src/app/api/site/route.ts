import { NextResponse } from 'next/server'
import { verifyAdminSession } from '@/lib/auth'
import { commitFile, invalidateContentCache, readStorageFresh } from '@/lib/github'
import { StorageError } from '@/lib/storage-adapter'
import {
  SITE_CONTENT_PATH,
  hasPatchContent,
  mergeSettings,
  normalizeSettings,
  siteSettingsPatchSchema,
  type SiteSettingsPatch,
} from '@/lib/site-settings'

export const runtime = 'nodejs'

/**
 * 站点设置的读写口。
 *
 * 与改造前的三处不同，每处都是实测缺陷的直接回应：
 * - GET 不再在中枢不可达时伪造一份空配置（旧实现返回全空串，管理员看不见差别，
 *   一次保存就把真实配置覆盖掉）。现在把「连不上」「还没配过」「有真实值」三种状态分开报。
 * - POST 是**部分更新**语义：先实时读现值再深合并。中枢的 writeSiteConfig 是整坨覆盖，
 *   而本页分 tab 保存；取缓存值做基准会让第二次保存把第一次的字段抹掉（实测丢过
 *   分享图与页脚备案），所以合并基准必须走 readStorageFresh。
 * - POST 只校验本次提交的字段。旧实现三个 tab 共用一份全量 schema，
 *   外观字段为空时「保存导航」会静默失败，错误信息渲染在看不见的 tab 里。
 */

const NO_STORE = { 'cache-control': 'no-store' }

/** 有记录但一个可用字段都没有 = 新部署还没配过 */
function isEmptySettings(s: ReturnType<typeof normalizeSettings>): boolean {
  return (
    !s.basic.title &&
    !s.basic.description &&
    !s.basic.ogImage &&
    !s.appearance.logo &&
    !s.appearance.favicon &&
    !s.appearance.themeColor &&
    !s.footer?.text &&
    !s.footer?.icp
  )
}

/**
 * 后台读取一律绕过缓存，直连中枢（见 github.ts 的 readStorageFresh 注释）。
 *
 * 三个状态必须分开，否则新部署会被自己的保护锁死：
 * - `unreachable`：中枢连不上 → 页面显示基线并**禁止保存**（旧版正是在这里用基线覆盖了真实配置）。
 * - `missing`：中枢可达但没有配置记录 → 表单是空的，保存即创建。
 *   早期实现把它和 unreachable 混成同一个 `degraded`，结果全新环境第一次保存就被禁用。
 * - 两者都不是：中枢返回真实值。
 */
export async function GET() {
  try {
    const data = await readStorageFresh<unknown>(SITE_CONTENT_PATH)
    const settings = normalizeSettings(data)
    const missing = data === null || data === undefined || isEmptySettings(settings)
    return NextResponse.json(
      { settings: missing ? normalizeSettings(null) : settings, degraded: false, missing },
      { headers: NO_STORE },
    )
  } catch (error) {
    const message =
      error instanceof StorageError ? error.message : '读取站点配置失败：' + String(error)
    return NextResponse.json(
      { settings: normalizeSettings(null), degraded: true, missing: false, message },
      { headers: NO_STORE },
    )
  }
}

export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminSession()
    if (!authCheck.ok) {
      return new Response(authCheck.error, { status: authCheck.status })
    }

    const body: unknown = await request.json().catch(() => {
      // 非法 JSON 由下面统一回 400，调用方拿得到明确错误，无需记录
      return null
    })
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: '请求体必须是 JSON 对象' }, { status: 400, headers: NO_STORE })
    }

    const parsed = siteSettingsPatchSchema.safeParse(body)
    if (!parsed.success) {
      // 把「哪个字段、为什么不行」原样交给页面，页面才能把错误显示在正确的 tab 上
      return NextResponse.json(
        {
          error: '字段校验未通过',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400, headers: NO_STORE },
      )
    }
    const patch = parsed.data as SiteSettingsPatch
    if (!hasPatchContent(patch)) {
      return NextResponse.json({ error: '没有任何要保存的字段' }, { status: 400, headers: NO_STORE })
    }

    // 合并基准必须绕过缓存实时读中枢（见 github.ts 的 readStorageFresh 注释）：
    // 取缓存值会让连续两次 tab 保存互相抹字段。读到 null = 中枢确实还没有配置，
    // 从空值起算是正确的；读失败会抛 StorageError，落到 catch 里返回 500，不写。
    const current = await readStorageFresh<unknown>(SITE_CONTENT_PATH)

    const next = mergeSettings(current, patch)
    await commitFile(
      SITE_CONTENT_PATH,
      JSON.stringify(next, null, 2),
      'Update site configuration',
      authCheck.githubToken || undefined,
    )
    // 写成功后立刻丢掉进程内微缓存：否则「保存 → 重新读取」在 2.5 秒内拿到的还是旧值
    invalidateContentCache(SITE_CONTENT_PATH)

    return NextResponse.json(
      {
        success: true,
        settings: next,
        note: '已保存。本页立即反映新值；前台按数据缓存周期刷新（默认最多 60 秒，可用 NAVHUB_STORAGE_REVALIDATE_S=0 改为实时）。',
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error('Failed to save site data:', error)
    // 中枢不可达与代码缺陷要分开报：前者管理员能自己处置（看状态页/重试），
    // 返回 503 也避免页面把「连不上」显示成一个看不懂的 500。
    const status = error instanceof StorageError && error.unreachable ? 503 : 500
    return NextResponse.json(
      {
        error:
          status === 503
            ? '中枢当前不可达，本次未保存（现有配置未被改动）'
            : '保存失败：' + (error instanceof Error ? error.message : String(error)),
      },
      { status, headers: NO_STORE },
    )
  }
}
