/**
 * 仿冒判定与出站守卫（W4）——纯函数，无 IO。
 *
 * 只认 `verified-brands.ts` 里的 50 家（核查日期 2026-11-24），不扩；
 * 不发请求、不写存储、不记录用户点了什么。
 *
 * 判定口径（与 /verify 比对页的约定一致）：
 * - official：host 精确等于某品牌的规范域名，或等于该品牌的 www/裸域
 *   变体（www.python.org / figma.com），或等于名单备注里确认的官方入口
 *   （chat.deepseek.com 是 DeepSeek 官方对话入口）；
 * - lookalike：host 与某品牌名强相关（见下），但既非规范域名也非官方
 *   子域/官方入口；
 * - unknown：其余一切——无关域名、未确认的官方子域（如 api.claude.ai）、
 *   名单备注里已说明不是官网也不是仿冒的域（如 didi.cn 母公司占位页、
 *   www.rednote.com 待用户裁决定向）、以及所有拿不准的情况。
 *   不确定的判 unknown，绝不判 lookalike：核实的官网零误拦。
 *
 * 「强相关」只认品牌名/别名里的拉丁 token（长度 ≥ 4，如 chatgpt、alipay、
 * qianwen），且 token 必须在 host 的某个标签里整段出现，或以 -/_ 为界
 * 出现在标签首尾（如 chatgpt-login、www-alipay）；token 藏在字母串中间
 * （如 nodebb 里的 node、qwenwork 里的 qwen）不算，避免把无关站误判为
 * 仿冒。短 token（jd、npm）太容易撞上无关域名，本轮不参与仿冒判定，
 * 宁可漏判也不误判；中文品牌名只作字面 token（host 是 ASCII/ punycode，
 * 实际匹配不到），仿冒面以拉丁 token 为准。
 * 形近拼写（如 chatgpot）不做编辑距离判定：不确定的判 unknown。
 *
 * 同注册域规则：host 与某规范域名落在同一注册域（见 registrableDomain，
 * 如 oversea.cnki.net 与 www.cnki.net、corporate.jd.com 与 www.jd.com）
 * 时，该 host 是品牌方自己 DNS 名下的域，不可能是第三方仿冒，判
 * unknown——既不当 official（未确认），也不当 lookalike。
 *
 * /s/[code] 短链只跳站内 /marketplace/ 路径（见 route.ts 与
 * shortlink-target.ts），不是出站跳转的集中点，本模块不接线到它；
 * 出站守卫的调用点是站内卡片/链接真正离开本站去外链的地方（另见
 * w4-guard-note.md），lookalike 时改跳
 * /verify?brand=<规范域名>&domain=<host>，official/unknown 原样放行。
 */
import { VERIFIED_BRANDS, type VerifiedBrand } from './verified-brands'

export type OutboundVerdict = 'official' | 'lookalike' | 'unknown'

export interface OutboundClassification {
  verdict: OutboundVerdict
  /** official/lookalike 时为所涉品牌；unknown 时为 null。 */
  brand: VerifiedBrand | null
  /** 归一化后的 host；解析不出的输入为空串。 */
  host: string
}

/**
 * 名单备注里确认的官方入口（规范域名之外的 host）。
 * 只有这一处是“已确认的官方子域/官方入口”，其余子域一律不默认官方。
 * 来源：50-brand-list.md 备注 1——chat.deepseek.com 是 DeepSeek 官方对话入口。
 */
const CONFIRMED_OFFICIAL_HOSTS: Readonly<Record<string, readonly string[]>> = {
  DeepSeek: ['chat.deepseek.com'],
}

/**
 * 名单备注里已说明“不是官网、也不是仿冒”的域：判 unknown，永不判 lookalike。
 * - didi.cn：50-brand-list.md 备注 3——母公司北京小桔科技占位页，无滴滴出行
 *   服务内容，不应作为官网；同样也不是第三方仿冒。
 * - rednote.com / www.rednote.com：备注 4——小红书页面品牌已改为 rednote，
 *   一次实测跳转终点为 www.rednote.com/login；规范域名仍为
 *   www.xiaohongshu.com，是否改列 rednote.com 由用户定——未裁决前不判仿冒。
 */
const KNOWN_NOT_LOOKALIKE_HOSTS: Readonly<Record<string, string>> = {
  'didi.cn': '母公司占位页（50-brand-list.md 备注 3）',
  'rednote.com': '品牌更名未裁决（50-brand-list.md 备注 4）',
  'www.rednote.com': '品牌更名未裁决（50-brand-list.md 备注 4）',
}

/** GitHub Pages 托管后缀：host 里的 github 是平台本身，不是仿冒 GitHub。 */
const KNOWN_NOT_LOOKALIKE_SUFFIXES: readonly string[] = ['.github.io']

/** 可能充当二级后缀的组合（如 com.cn），注册域取最后三段；其余取最后两段。 */
const SECOND_LEVEL_SUFFIXES: Readonly<Set<string>> = new Set([
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'ac.cn',
  'edu.cn',
  'co.uk',
  'org.uk',
  'co.jp',
  'com.au',
  'co.kr',
  'com.br',
])

/** 归一化 host：去空白、小写、去尾点、去端口（与 W2 normalizeDomain 同口径）。 */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '')
  s = s.split(/[\/?#]/, 1)[0] ?? ''
  s = s.replace(/:\d+$/, '')
  s = s.replace(/\.$/, '')
  return s
}

/** 该品牌的官方 host 集合：规范域名 + www/裸域变体 + 备注确认的官方入口。 */
function officialHostsFor(brand: VerifiedBrand): Set<string> {
  const hosts = new Set<string>([brand.canonicalDomain])
  if (brand.canonicalDomain.startsWith('www.')) {
    hosts.add(brand.canonicalDomain.slice('www.'.length))
  } else {
    hosts.add(`www.${brand.canonicalDomain}`)
  }
  for (const h of CONFIRMED_OFFICIAL_HOSTS[brand.name] ?? []) hosts.add(h)
  return hosts
}

/**
 * host 是否为该品牌的官方 host。
 * 只认规范域名、www/裸域变体与备注确认的官方入口；未确认的子域返回 false。
 */
export function isOfficialHost(host: string, brand: VerifiedBrand): boolean {
  const h = normalizeHost(host)
  if (!h) return false
  return officialHostsFor(brand).has(h)
}

/** 近似注册域：最后两段，二级后缀组合取最后三段；单段/IP 原样返回。 */
function registrableDomain(host: string): string {
  const labels = host.split('.').filter(Boolean)
  if (labels.length <= 2) return host
  const lastTwo = labels.slice(-2).join('.')
  if (SECOND_LEVEL_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.')
  return lastTwo
}

/** 从品牌名与别名抽拉丁 token（长度 ≥ 4）与中文 token（长度 ≥ 2）。 */
function brandTokens(brand: VerifiedBrand): string[] {
  const tokens = new Set<string>()
  const push = (value: string) => {
    for (const m of value.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]+/g) ?? []) {
      const isLatin = /^[a-z0-9]+$/.test(m)
      if ((isLatin && m.length >= 4) || (!isLatin && m.length >= 2)) tokens.add(m)
    }
  }
  push(brand.name)
  for (const a of brand.aliases) push(a)
  return [...tokens]
}

/**
 * token 是否在 host 的某个标签里以词界出现：整段相等，或以 -/_ 为界
 * 出现在标签首尾。字母串中间的包含（如 nodebb 里的 node）不算。
 */
function hostMatchesToken(host: string, token: string): boolean {
  return host.split('.').some((label) => {
    if (label === token) return true
    if (label.startsWith(`${token}-`) || label.startsWith(`${token}_`)) return true
    if (label.endsWith(`-${token}`) || label.endsWith(`_${token}`)) return true
    return false
  })
}

/**
 * 判定一个出站 URL。
 * 非 http(s) 绝对 URL、相对路径、解析失败一律 unknown（host 为 ''）。
 */
export function classifyOutboundUrl(url: string): OutboundClassification {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { verdict: 'unknown', brand: null, host: '' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { verdict: 'unknown', brand: null, host: '' }
  }
  const host = normalizeHost(parsed.hostname)
  if (!host) return { verdict: 'unknown', brand: null, host: '' }

  // 1）官方：精确等于规范域名、www/裸域变体或备注确认的官方入口。
  for (const brand of VERIFIED_BRANDS) {
    if (isOfficialHost(host, brand)) return { verdict: 'official', brand, host }
  }

  // 2）名单备注已说明不是仿冒的域，与 GitHub Pages 平台后缀：unknown。
  if (host in KNOWN_NOT_LOOKALIKE_HOSTS) return { verdict: 'unknown', brand: null, host }
  if (KNOWN_NOT_LOOKALIKE_SUFFIXES.some((s) => host.endsWith(s))) {
    return { verdict: 'unknown', brand: null, host }
  }

  // 3）与某规范域名同一注册域：品牌方自己 DNS 名下的域，未确认也不判仿冒。
  for (const brand of VERIFIED_BRANDS) {
    if (registrableDomain(host) === registrableDomain(brand.canonicalDomain)) {
      return { verdict: 'unknown', brand: null, host }
    }
  }

  // 4）强相关：某品牌 token 在 host 标签里以词界出现 → lookalike。
  for (const brand of VERIFIED_BRANDS) {
    if (brandTokens(brand).some((t) => hostMatchesToken(host, t))) {
      return { verdict: 'lookalike', brand, host }
    }
  }

  return { verdict: 'unknown', brand: null, host }
}
