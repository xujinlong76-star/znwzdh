import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const inputPath = resolve(process.argv[2] ?? 'src/navsphere/content/navigation.json')
const data = JSON.parse(await readFile(inputPath, 'utf8'))

if (!Array.isArray(data.navigationItems)) {
  throw new Error('navigationItems must be an array')
}

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'ref',
  'ref_src',
  'source',
  'spm',
])

function normalizeUrl(raw) {
  try {
    const url = new URL(String(raw).trim())
    url.hash = ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        url.searchParams.delete(key)
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  } catch {
    return String(raw).trim().replace(/\/+$/, '').toLowerCase()
  }
}

function normalizeTitle(raw) {
  return String(raw)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s·._\-—–/|]+/g, '')
}

const urlHits = new Map()
const titleHits = new Map()
const repeatedText = []
const leafSizes = []
const categoryCounts = []
let siteCount = 0

function registerItem(item, categoryTitle, leafTitle) {
  siteCount++
  const location = `${categoryTitle} / ${leafTitle}`
  const urlKey = normalizeUrl(item.href)
  const titleKey = normalizeTitle(item.title)

  if (!urlHits.has(urlKey)) urlHits.set(urlKey, [])
  urlHits.get(urlKey).push({ id: item.id, title: item.title, href: item.href, location })

  if (!titleHits.has(titleKey)) titleHits.set(titleKey, [])
  titleHits.get(titleKey).push({ id: item.id, title: item.title, href: item.href, location })

  const repeated = String(item.description ?? '').match(/([\u4e00-\u9fff]{2,})\1/g)
  if (repeated) {
    repeatedText.push({
      id: item.id,
      title: item.title,
      location,
      phrases: [...new Set(repeated)],
      description: item.description,
    })
  }
}

for (const category of data.navigationItems) {
  const before = siteCount
  registerLeaf(category, '直接收录', category.items)
  for (const subCategory of category.subCategories ?? []) {
    registerLeaf(category, subCategory.title, subCategory.items)
  }
  categoryCounts.push({
    id: category.id,
    title: category.title,
    count: siteCount - before,
  })
}

function registerLeaf(category, leafTitle, items) {
  if (!Array.isArray(items) || items.length === 0) return
  leafSizes.push({
    category: category.title,
    leaf: leafTitle,
    count: items.length,
  })
  for (const item of items) registerItem(item, category.title, leafTitle)
}

const duplicateUrls = [...urlHits.values()].filter((hits) => hits.length > 1)
const duplicateTitles = [...titleHits.values()].filter(
  (hits) => hits.length > 1 && new Set(hits.map((hit) => normalizeUrl(hit.href))).size > 1,
)
const sparseLeaves = leafSizes.filter((leaf) => leaf.count < 4).sort((a, b) => a.count - b.count)

console.log(
  JSON.stringify(
    {
      inputPath,
      categories: data.navigationItems.length,
      leaves: leafSizes.length,
      sites: siteCount,
      categoryCounts,
      duplicateUrls,
      duplicateTitleVariants: duplicateTitles,
      repeatedText,
      sparseLeaves,
    },
    null,
    2,
  ),
)

if (duplicateUrls.length > 0 || repeatedText.length > 0) {
  process.exitCode = 1
}
