/**
 * 短链失效提示：`/s/<code>` 打不开时统一 302 到 `/marketplace?shortlink=invalid`，
 * 但市场页从不读这个参数——用户被悄悄扔到通用页、没有任何解释，像是点错了链接。
 *
 * 文案只说能确定的事：处理器在「码非法、查无此码、中枢异常」三种情况都返回同一个
 * invalid，所以不编原因——不说「插件被删了」，也不承诺「再试一次就能打开」；
 * 只给真出路（市场搜索框 / 浏览全部插件）。
 */
export const SHORTLINK_INVALID_QUERY_KEY = 'shortlink'
export const SHORTLINK_INVALID_QUERY_VALUE = 'invalid'

export const SHORTLINK_INVALID_NOTICE = {
  title: '这个短链接打不开了',
  body: '它可能已失效或过期。你可以在上方搜索框里搜插件名字，或者浏览下面的全部插件。',
} as const

/**
 * 只有处理器实际发出的那一个值才亮提示：别的 shortlink 取值一律不认，
 * 免得有人拿 ?shortlink=xxx 拼出假提示。
 */
export function isShortlinkInvalidNotice(
  searchParams: Record<string, string | string[] | undefined>,
): boolean {
  return (
    searchParams[SHORTLINK_INVALID_QUERY_KEY] === SHORTLINK_INVALID_QUERY_VALUE
  )
}
