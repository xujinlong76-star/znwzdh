/**
 * /verify 比对页的纯函数（W2）。
 *
 * 只认 `verified-brands.ts` 里的 50 家，不扩；不做网络请求、不写存储、
 * 不作安全判断——这里只做域名归一化、逐字对照与参数解析。
 */
import {
  VERIFIED_BRANDS_CHECKED_AT,
  findVerifiedBrandByQuery,
  getVerifiedBrandByDomain,
  type VerifiedBrand,
} from '@/lib/verified-brands'

export { VERIFIED_BRANDS_CHECKED_AT }

/** 对照片段：same 为 true 是两边逐字相同的字符，false 是差异处。 */
export interface DiffSegment {
  text: string
  same: boolean
}

export interface DomainDiff {
  /** 官网域名一侧的片段 */
  canonical: DiffSegment[]
  /** 用户点的域名一侧的片段 */
  clicked: DiffSegment[]
  /** 两边归一化后是否逐字相同 */
  identical: boolean
  /** 不同的标签（以 . 分隔的段）数量 */
  differingLabels: number
}

/**
 * 归一化一个域名输入：去空白、去协议头、去路径/查询/锚点、去尾点、
 * 去端口、小写。只做清洗，不判断真假。
 */
export function normalizeDomain(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = raw.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '')
  s = s.split(/[\/?#]/, 1)[0] ?? ''
  s = s.replace(/:\d+$/, '')
  s = s.replace(/\.$/, '')
  return s
}

/** 对一段标签做逐字对照（左对齐，超长部分全标差异）。 */
function diffLabel(a: string, b: string): { a: DiffSegment[]; b: DiffSegment[] } {
  const outA: DiffSegment[] = []
  const outB: DiffSegment[] = []
  const n = Math.max(a.length, b.length)
  let runA = ''
  let runB = ''
  let runSame: boolean | null = null
  const flush = () => {
    if (runSame === null) return
    if (runA) outA.push({ text: runA, same: runSame })
    if (runB) outB.push({ text: runB, same: runSame })
    runA = ''
    runB = ''
  }
  for (let i = 0; i < n; i++) {
    const ca = a[i] ?? ''
    const cb = b[i] ?? ''
    const same = ca !== '' && ca === cb
    if (runSame === null || same !== runSame) {
      flush()
      runSame = same
    }
    runA += ca
    runB += cb
  }
  flush()
  return { a: outA, b: outB }
}

/**
 * 官网域名与用户点的域名逐字对照：先去掉两边公共的前缀标签与后缀标签，
 * 中间段按位置逐字对照（标签内逐字、缺失的标签整段标差异）。
 * 这样“少了 www”与“多了 .cn”都只计 1 处不同，而不是整条尾巴全红。
 * 只陈述“相同/不同”，不作安全结论。
 */
export function diffDomains(canonicalDomain: string, clickedDomain: string): DomainDiff {
  const canonical = normalizeDomain(canonicalDomain)
  const clicked = normalizeDomain(clickedDomain)
  if (canonical === clicked) {
    return {
      canonical: canonical ? [{ text: canonical, same: true }] : [],
      clicked: clicked ? [{ text: clicked, same: true }] : [],
      identical: true,
      differingLabels: 0,
    }
  }
  const labelsA = canonical ? canonical.split('.') : []
  const labelsB = clicked ? clicked.split('.') : []
  let prefix = 0
  while (
    prefix < labelsA.length &&
    prefix < labelsB.length &&
    labelsA[prefix] === labelsB[prefix]
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < labelsA.length - prefix &&
    suffix < labelsB.length - prefix &&
    labelsA[labelsA.length - 1 - suffix] === labelsB[labelsB.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const midA = labelsA.slice(prefix, labelsA.length - suffix)
  const midB = labelsB.slice(prefix, labelsB.length - suffix)
  const differingLabels = Math.max(midA.length, midB.length)

  // 中间段逐对对照：每侧按标签块收集，块之间再补分隔点，避免单侧
  // 缺标签时多出一个点。
  const midChunksA: DiffSegment[][] = []
  const midChunksB: DiffSegment[][] = []
  for (let i = 0; i < differingLabels; i++) {
    const labelA = midA[i] ?? ''
    const labelB = midB[i] ?? ''
    if (labelA === labelB) {
      if (labelA) {
        midChunksA.push([{ text: labelA, same: true }])
        midChunksB.push([{ text: labelB, same: true }])
      }
      continue
    }
    if (labelA) {
      if (labelB === '') midChunksA.push([{ text: labelA, same: false }])
      else midChunksA.push(diffLabel(labelA, labelB).a)
    }
    if (labelB) {
      if (labelA === '') midChunksB.push([{ text: labelB, same: false }])
      else midChunksB.push(diffLabel(labelA, labelB).b)
    }
  }

  const joinWith = (
    head: string[],
    midChunks: DiffSegment[][],
    tail: string[],
  ): DiffSegment[] => {
    const out: DiffSegment[] = []
    const pushChunk = (chunk: DiffSegment[]) => {
      if (chunk.length === 0) return
      if (out.length > 0) out.push({ text: '.', same: true })
      out.push(...chunk)
    }
    head.forEach((label) => pushChunk([{ text: label, same: true }]))
    midChunks.forEach((chunk) => pushChunk(chunk))
    tail.forEach((label) => pushChunk([{ text: label, same: true }]))
    return out
  }

  return {
    canonical: joinWith(
      labelsA.slice(0, prefix),
      midChunksA,
      labelsA.slice(labelsA.length - suffix),
    ),
    clicked: joinWith(
      labelsB.slice(0, prefix),
      midChunksB,
      labelsB.slice(labelsB.length - suffix),
    ),
    identical: false,
    differingLabels,
  }
}

export type VerifyParamsError = 'missing-brand' | 'unknown-brand' | 'missing-domain'

export interface VerifyParams {
  brand: VerifiedBrand
  /** 用户点的域名（归一化后） */
  clickedDomain: string
  /** 官网地址：https:// + 规范域名 */
  officialUrl: string
  /** 用户点的地址：https:// + 用户点的域名 */
  clickedUrl: string
  /** 用户点的域名与规范域名是否逐字相同 */
  identical: boolean
  error: null
}

export interface VerifyParamsFailure {
  brand: null
  clickedDomain: string
  officialUrl: null
  clickedUrl: string | null
  identical: false
  error: VerifyParamsError
}

/**
 * 解析 /verify 的查询参数。
 * brand 只认规范域名（getVerifiedBrandByDomain），退而认品牌名/别名
 * （findVerifiedBrandByQuery）；不在 50 家名单里的品牌一律 unknown-brand，
 * 绝不放行、不猜测。domain 只做归一化，不作真假判断。
 */
export function parseVerifyParams(
  brandParam: string | null | undefined,
  domainParam: string | null | undefined,
): VerifyParams | VerifyParamsFailure {
  const clickedDomain = normalizeDomain(domainParam)
  const clickedUrl = clickedDomain ? `https://${clickedDomain}` : null
  const rawBrand = (brandParam ?? '').trim()
  if (!rawBrand) {
    return { brand: null, clickedDomain, officialUrl: null, clickedUrl, identical: false, error: 'missing-brand' }
  }
  const brand =
    getVerifiedBrandByDomain(normalizeDomain(rawBrand)) ??
    findVerifiedBrandByQuery(rawBrand)
  if (!brand) {
    return { brand: null, clickedDomain, officialUrl: null, clickedUrl, identical: false, error: 'unknown-brand' }
  }
  if (!clickedDomain) {
    return { brand: null, clickedDomain, officialUrl: null, clickedUrl, identical: false, error: 'missing-domain' }
  }
  return {
    brand,
    clickedDomain,
    officialUrl: `https://${brand.canonicalDomain}`,
    clickedUrl: `https://${clickedDomain}`,
    identical: normalizeDomain(brand.canonicalDomain) === clickedDomain,
    error: null,
  }
}
