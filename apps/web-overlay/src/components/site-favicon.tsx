'use client'

import React, { useState } from 'react'
import { cn } from '@/lib/utils'

export interface SiteFaviconProps {
  title?: string
  url?: string
  icon?: string | null
  useDefaultIcon?: boolean
  className?: string
  /**
   * 首屏主图标（如详情页 64px 徽标）传 `true`：`loading="lazy"` 在视口内的图上
   * 仍会让浏览器推迟一次解码调度，而这张图常常就是该页的 LCP 元素。
   */
  eager?: boolean
}

export const PRESET_GRADIENTS = [
  { from: '#6366f1', to: '#a855f7', textColor: '#ffffff' }, // 蓝紫极光
  { from: '#3b82f6', to: '#06b6d4', textColor: '#ffffff' }, // 蔚蓝海流
  { from: '#10b981', to: '#14b8a6', textColor: '#ffffff' }, // 极光翡翠
  { from: '#f59e0b', to: '#ef4444', textColor: '#ffffff' }, // 暖阳晚霞
  { from: '#ec4899', to: '#8b5cf6', textColor: '#ffffff' }, // 霓虹浆果
  { from: '#06b6d4', to: '#3b82f6', textColor: '#ffffff' }, // 赛博电光
  { from: '#84cc16', to: '#10b981', textColor: '#ffffff' }, // 春晓青柠
  { from: '#f43f5e', to: '#fb923c', textColor: '#ffffff' }, // 珊瑚朝霞
  { from: '#8b5cf6', to: '#ec4899', textColor: '#ffffff' }, // 幻境晶体
  { from: '#0ea5e9', to: '#6366f1', textColor: '#ffffff' }, // 深邃星空
  { from: '#14b8a6', to: '#0ea5e9', textColor: '#ffffff' }, // 浅滩清波
  { from: '#d946ef', to: '#8b5cf6', textColor: '#ffffff' }, // 幻彩紫晶
  { from: '#f97316', to: '#e11d48', textColor: '#ffffff' }, // 熔岩烈焰
  { from: '#059669', to: '#0284c7', textColor: '#ffffff' }, // 森林薄雾
  { from: '#4f46e5', to: '#06b6d4', textColor: '#ffffff' }, // 钛金属辉光
  { from: '#7c3aed', to: '#2563eb', textColor: '#ffffff' }, // 极夜苍穹
] as const

export function fnv1aHash(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function getDeterministicGradient(seed: string): {
  from: string
  to: string
  textColor: string
  angle: number
  cssGradient: string
} {
  const normalizedSeed = (seed || 'navhub').trim().toLowerCase()
  const hash = fnv1aHash(normalizedSeed)
  const paletteIndex = hash % PRESET_GRADIENTS.length
  const palette = PRESET_GRADIENTS[paletteIndex]!
  const angleSteps = [135, 45, 120, 160, 90]
  // 必须用无符号右移：hash 是 32 位无符号，`>>` 会先转成有符号，
  // hash ≥ 2^31 时变成负数，负索引取到 undefined，SSR 就渲染出
  // `linear-gradient(undefineddeg, …)` 这条无效 CSS，图标底色直接丢失。
  const angle = angleSteps[(hash >>> 4) % angleSteps.length]!

  return {
    from: palette.from,
    to: palette.to,
    textColor: palette.textColor,
    angle,
    cssGradient: `linear-gradient(${angle}deg, ${palette.from}, ${palette.to})`,
  }
}

export function extractFaviconMonogram(title: string, _url?: string): string {
  const cleanTitle = (title || '').trim()
  if (cleanTitle) {
    // 严格从站点名称 (title) 提取第一个有效汉字或英文字母，严禁从 url hostname 提取
    const stripped = cleanTitle.replace(/^[\p{P}\p{S}\s]+/u, '')
    if (stripped.length > 0) {
      const char = stripped[0]!
      if (/[\u4e00-\u9fa5]/.test(char)) return char
      if (/[a-zA-Z0-9]/.test(char)) return char.toUpperCase()
    }
  }

  return '山'
}

export const LOCAL_LOGO_MAP: Record<string, string> = {
  // 2026-11-09：高频开发工具的品牌图标本地静态化。
  // 这些站点原先走 /api/hub/assets/icon 代理，而代理在拿不到外网 favicon 时会
  // 回落到「渐变底 + 首字母」的生成 SVG，视觉上和纯字母色块没有区别。
  // 构建期把 Simple Icons 的官方矢量图落到 public/，运行时零外网依赖。
  // 放 public/brand-icons/ 而不是 public/assets/images/logos/：后者被
  // scripts/lib/overlay-drift.mjs 的 EXCLUDE_PREFIX 整目录排除（那是上游底座资产），
  // 放进去的文件永远不会被镜像同步到 apps/web/public。
  // 2026-11-16（进化第 94 轮第一批）：61 站图标缺失清单里的高可见站点。
  // 本地 Simple Icons 资产优先（零运行时依赖）；无 Simple Icons 的站用
  // 站方自有 favicon 或官方应用图标本地化文件（public/brand-icons/），
  // 每个远程地址与本地文件均经 curl 逐个验证（200 + image MIME + >32B）。
  'dify.ai': '/brand-icons/dify.svg',
  'ant.design': '/brand-icons/antdesign.svg',
  'kubernetes.io': '/brand-icons/kubernetes.svg',
  'spring.io': '/brand-icons/springboot.svg',
  'notion.com': 'https://www.notion.so/images/favicon.ico',
  'radix-ui.com': 'https://github.com/radix-ui.png?size=64',
  'boardmix.cn': '/brand-icons/boardmix.jpg',
  'docs.qq.com': '/brand-icons/tencent-docs.jpg',
  'kdocs.cn': '/brand-icons/kdocs.jpg',
  'sspai.com': 'https://sspai.com/apple-touch-icon.png',
  'pinduoduo.com': 'https://www.pinduoduo.com/favicon.png',
  'hongguoduanju.com': '/brand-icons/hongguo.jpg',
  // 2026-11-17（进化轮第二批 2a）：48 站缺失清单里的 Simple Icons 18 站。
  // 全部 curl 重新验证（200 + SVG 魔数 + <title> 品牌一致）后本地落盘，
  // 与第一批同款做法。Ollama / SourceHut 为纯黑标（fill #000000）：
  // 第一批的 Notion / Radix 同款处理即不做特殊处理（caf73de0 diff 核实：
  // 仅普通 map 条目，无白底色块、无组件改动），此处照抄；深色模式下
  // 黑标对比度弱是已知局限，留待深色底块统一处理轮（研究笔记 §3/§5）。
  // 2026-11-17 深色底块轮：已处理，见下方 LOGO_TILE_MAP（light）。
  'rollupjs.org': '/brand-icons/rollupdotjs.svg',
  'webpack.js.org': '/brand-icons/webpack.svg',
  'esbuild.github.io': '/brand-icons/esbuild.svg',
  'storybook.js.org': '/brand-icons/storybook.svg',
  'min.io': '/brand-icons/minio.svg',
  'helm.sh': '/brand-icons/helm.svg',
  'pulumi.com': '/brand-icons/pulumi.svg',
  'dribbble.com': '/brand-icons/dribbble.svg',
  'behance.net': '/brand-icons/behance.svg',
  'logseq.com': '/brand-icons/logseq.svg',
  'ollama.com': '/brand-icons/ollama.svg',
  'shopee.com': '/brand-icons/shopee.svg',
  'infoq.cn': '/brand-icons/infoq.svg',
  'qianwen.aliyun.com': '/brand-icons/qwen.svg',
  'mantine.dev': '/brand-icons/mantine.svg',
  'sourcehut.org': '/brand-icons/sourcehut.svg',
  'coze.cn': '/brand-icons/coze.svg',
  'lintcode.com': '/brand-icons/lintcode.svg',
  // 2026-11-17（进化轮第二批 2b 之开发设计类）：48 站缺失清单里的站方自有
  // 图标 10 站。全部 curl 重新验证（200 + image MIME + 魔数 + 尺寸与研究
  // 笔记逐个相符）后本地落盘，与第一批/2a 同款做法。Naive UI 的远程路径
  // 含构建 hash、IETF 的路径含版本段 12.83.2，均已本地化钉死，不可热链；
  // SegmentFault 的 CDN 无 Referer 回 403，下载时带 Referer 且已本地化，
  // 不可热链。CodeGeeX 自带黑底（312x312 PNG），深色模式可用；其余按 2a
  // 对 Ollama / SourceHut 的做法——不做特殊处理，已知局限留待深色底块
  // 统一处理轮（研究笔记 §3/§5）。
  'codegeex.cn': '/brand-icons/codegeex.png',
  'coding.net': '/brand-icons/coding.png',
  'element-plus.org': '/brand-icons/element-plus.svg',
  'naiveui.com': '/brand-icons/naiveui.svg',
  'go-zero.dev': '/brand-icons/go-zero.svg',
  'coolors.co': '/brand-icons/coolors.png',
  'squoosh.app': '/brand-icons/squoosh.png',
  'segmentfault.com': '/brand-icons/segmentfault.png',
  'gogs.io': '/brand-icons/gogs.png',
  'datatracker.ietf.org': '/brand-icons/ietf.png',
  // 2026-11-17（进化轮第二批 2b 剩余 + 2c）：48 站缺失清单里站方自有
  // 图标 12 站（剪映/即梦/天音/中国大学 MOOC/极客时间/智联/番茄小说/
  // 探探/ReelShort/中央气象台/国家哲学/有戏 AI）+ iTunes 128px 应用
  // 图标 5 站（时光网/超级简历/国家医保局/12333/小云雀 AI）。全部
  // curl 重新验证（200 + image MIME + 魔数 + 尺寸与研究笔记逐个相符）
  // 后本地落盘，与第一批/2a/2b 同款做法。有戏 AI 600x600 422KB 已压
  // 到 128px（23013B）；天音 .ico 实为 PNG、智联 .png 实为 ICO，文件
  // 名按魔数定。时光网站方图标仅 16px，改用 iTunes 128px 版。宽版
  // logo（中央气象台 255x65、国家哲学 385x56）与天音黑字透明底按 2a
  // 对 Ollama / SourceHut 的做法——不做特殊处理，已知局限留待深色
  // 底块统一处理轮（研究笔记 §3/§5）。海珀/国家公务员局不在本批，
  // 未动；极客公园由 B 批合批新入 map（见下方 geekpark.net）。
  'capcut.cn': '/brand-icons/capcut.png',
  'jimeng.jianying.com': '/brand-icons/jimeng.png',
  'tianyin.163.com': '/brand-icons/tianyin.png',
  'icourse163.org': '/brand-icons/icourse163.png',
  'time.geekbang.org': '/brand-icons/geekbang.jpg',
  'zhaopin.com': '/brand-icons/zhaopin.png',
  'fanqienovel.com': '/brand-icons/fanqie.png',
  'tantan.com': '/brand-icons/tantan.png',
  'reelshort.com': '/brand-icons/reelshort.png',
  'nmc.cn': '/brand-icons/nmc.png',
  'ncpssd.org': '/brand-icons/ncpssd.png',
  'youxi.fullpeace.net': '/brand-icons/youxi.png',
  // 2026-11-17（B 批合批）：极客公园入 map；远端已换方形标，底块走
  // LOGO_TILE_MAP 统一处理（见下方 logoTile），不再单独立分支。
  'geekpark.net': '/brand-icons/geekpark.png',
  'mtime.com': '/brand-icons/mtime.jpg',
  'wondercv.com': '/brand-icons/wondercv.jpg',
  'nhsa.gov.cn': '/brand-icons/nhsa.jpg',
  '12333.gov.cn': '/brand-icons/12333.jpg',
  'xiaoyunque.com': '/brand-icons/xiaoyunque.jpg',
  // 2026-11-17（深色底块统一处理轮）：Haiper。站方首页只有内联 SVG
  // wordmark（无可热链 URL、176x72、7 条 path 全跟随文字颜色），本轮
  // 重取首页（200）提取后本地落盘为 haiper.svg：fill 钉死 #ffffff，
  // 配下方 LOGO_TILE_MAP 的 dark 底块。
  'haiper.ai': '/brand-icons/haiper.svg',
  // 2026-11-17（同轮追加）：极客公园。1361x261 白字宽版 wordmark 仍不
  // 可用（24px 卡片内只剩 3.8px 高，比渐变字母更差，不进 map）；但并行
  // 研究线找到站方 /about 页 head 三重官方指定的方形标
  // imgslim.geekpark.net/geekpark-icon-196-black.png，curl 200、3705B、
  // 实测 100×100（文件名按实测尺寸，不沿用虚标 196）：黑底白 G、全
  // 10000 像素不透明，24/36/64 三档 G 高 9.8/15.7/29.4px 均可读。
  // 黑底方块配下方 LOGO_TILE_MAP 的 light 底块（与 Ollama 黑标同款处理）。
  'geekpark.net': '/brand-icons/geekpark.png',
  'vuejs.org': '/brand-icons/vue.svg',
  'npmjs.com': '/brand-icons/npm.svg',
  'vite.dev': '/brand-icons/vite.svg',
  'pnpm.io': '/brand-icons/pnpm.svg',
  'video.hunyuan.tencent.com': 'https://hunyuan.tencent.com/favicon.ico',
  'hunyuan.tencent.com': 'https://hunyuan.tencent.com/favicon.ico',
  'tongyi.aliyun.com': 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png',
  'wan2.aliyun.com': 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png',
  // 2026-11-16：旧值 https://zhiwen.xfyun.cn/favicon.ico 经 curl 验证 404，
  // 改用同站验证过的 favicon.png（200 image/png 14725B）。
  'zhiwen.xfyun.cn': 'https://zhiwen.xfyun.cn/favicon.png',
  'cursor.com': 'https://www.cursor.com/favicon.ico',
  'bolt.new': 'https://bolt.new/favicon.ico',
  'v0.dev': '/assets/images/logos/vercel.webp',
  'kimi.moonshot.cn': 'https://kimi.moonshot.cn/pwa-192.png',
  'doubao.com': '/brand-icons/doubao.png',
  'www.doubao.com': '/brand-icons/doubao.png',
  'yiyan.baidu.com': 'https://www.baidu.com/favicon.ico',
  'lingma.aliyun.com': 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png',
  'runwayml.com': 'https://runwayml.com/icon.png',
  'deepseek.com': 'https://chat.deepseek.com/favicon.ico',
  'chat.deepseek.com': 'https://chat.deepseek.com/favicon.ico',
  'klingai.com': 'https://klingai.com/favicon.ico',
  'klingai.kuaishou.com': 'https://klingai.com/favicon.ico',
  // 2026-11-16：旧值 https://lumalabs.ai/favicon.ico 经 curl 验证 404，
  // 改用 Luma 官方备用域名 luma.ai 的同名 favicon（200 image/x-icon 15086B，
  // 内容为 Luma 四角星品牌标）。
  'lumalabs.ai': 'https://luma.ai/favicon.ico',
  'vidu.studio': 'https://www.vidu.studio/favicon.ico',
  'hailuoai.com': 'https://hailuoai.com/favicon.ico',
  'chatgpt.com': '/brand-icons/chatgpt.svg',
  'chat.openai.com': '/brand-icons/chatgpt.svg',
  'openai.com': '/brand-icons/openai.png',
  'claude.ai': '/brand-icons/claude.svg',
  'anthropic.com': '/assets/images/logos/claude.webp',
  'cloudflare.com': '/brand-icons/cloudflare.png',
  'figma.com': '/brand-icons/figma.svg',
  'tinypng.com': '/brand-icons/tinypng.png',
  'unsplash.com': '/brand-icons/unsplash.png',
  'vercel.com': '/brand-icons/vercel.png',
  'fonts.google.com': '/brand-icons/google-fonts.svg',
  'material.io': '/assets/images/logos/Materialicons.webp',
  'colorhunt.co': '/assets/images/logos/colorhunt.webp',
  'flinto.com': '/assets/images/logos/flinto.webp',
  'flaticon.com': '/brand-icons/flaticon.png',
  'fontawesome.com': '/brand-icons/font-awesome.svg',
  'framer.com': '/assets/images/logos/framer.webp',
  'freepik.com': '/assets/images/logos/freepik.webp',
  'gemini.google.com': '/brand-icons/gemini.svg',
  'iconarchive.com': '/assets/images/logos/iconarchive.webp',
  'iconfinder.com': '/assets/images/logos/Iconfinder.webp',
  'iconfont.cn': '/assets/images/logos/iconfont.webp',
  'iconmonstr.com': '/assets/images/logos/iconmonstr.webp',
  'ionicons.com': '/assets/images/logos/ionicons.webp',
  'leonardo.ai': '/brand-icons/leonardo.png',
  'poe.com': '/assets/images/logos/poe.svg',
  'producthunt.com': '/assets/images/logos/producthunt.webp',
  'tensor.art': '/assets/images/logos/tensorart.webp',
  'icomoon.io': '/assets/images/logos/IcoMoonApp.webp',
  'findicons.com': '/assets/images/logos/FindIcons.webp',
  'principleformac.com': '/assets/images/logos/principle.webp',
  'worldvectorlogo.com': '/assets/images/logos/worldvectorlogo.webp',
  'shots.so': '/assets/images/logos/shots.webp',
  'simplelineicons.com': '/assets/images/logos/simplelineicons.webp',
  'sqlformat.org': '/assets/images/logos/sqlformat.webp',
  'tableconvert.com': '/assets/images/logos/tableconvert.webp',
  'json.cn': '/assets/images/logos/json.webp',
  'beautifier.io': '/assets/images/logos/beautifier.webp',
  'ui-cloud.com': '/assets/images/logos/UICloud.webp',
  'ads.google.com': '/assets/images/logos/gads.webp',
  'analytics.google.com': '/assets/images/logos/analytics.webp',
  'photoshop.com': '/assets/images/logos/photoshop.webp',
  'affinity.serif.com': '/assets/images/logos/AffinityDesigner.webp',
  'instantlogosearch.com': '/assets/images/logos/InstantLogoSearch.webp',
  'iconsfeed.com': '/assets/images/logos/iconsfeed.webp',
  'iosicongallery.com': '/assets/images/logos/iosicongallery.webp',
  // 2026-11-17（图标 A 类第 1 批 a1a + a1b，独立复审 R1–R6 后合批）：
  // 本批 8 个键均为原地替换旧值（旧值指向不存在的 /assets/images/logos/*，
  // 不另起重复块）：chatgpt.com → chatgpt.svg；chat.openai.com → chatgpt.svg
  //（复审 R5 死键，同一产品旧域名）；openai.com → openai.png（DALL-E 3 与
  // OpenAI 主站共用，复审裁决 (c)）；claude.ai → claude.svg；
  // gemini.google.com → gemini.svg；leonardo.ai → leonardo.png；
  // vercel.com → vercel.png；cloudflare.com → cloudflare.png（Cloudflare
  // Pages 共用此键，复审裁决 (d)；重复文件 cloudflare-pages.png 已删，
  // 复审 R3）。adobe.com 键整行删除（复审 R2 撞站），Adobe Firefly 改走
  // map 查找前的标题规则。来源与字节见轮次笔记 icon-a1a / icon-a1b。
  // 2026-11-17（图标 A 类第 2 批 a2a + a2b，独立复审打回 2 项后合批）：
  // 本批 6 个键原地替换旧值（旧值指向不存在的 /assets/images/logos/*，
  // 不另起重复块）：tinypng.com → tinypng.png；fonts.google.com →
  // google-fonts.svg；fontawesome.com → font-awesome.svg；flaticon.com →
  // flaticon.png（128×114 等比，非方形源不硬压，复审裁决 (d)）；unsplash.com
  // → unsplash.png；figma.com → figma.svg。以下 2 个为新键，另起本块追加：
  // fonts.adobe.com → adobe-fonts.png；helpx.adobe.com → adobe-xd.svg
  //（精确键优先于 adobe.com 后缀匹配）。Illustrator 无 hostname 键，改走
  // map 查找前的标题规则（复审裁决 (a)）。Adobe Color 阻塞未落盘：资产、
  // map 值、测试用例均未合入，待 429 冷却后重取验过再补（复审裁决 (c)）。
  'fonts.adobe.com': '/brand-icons/adobe-fonts.png',
  'helpx.adobe.com': '/brand-icons/adobe-xd.svg',
}

/**
 * 品牌图标底块（2026-11-17，深色底块统一处理轮）。
 *
 * 问题：图标是 `w-full h-full object-contain`、透明底直出，logo 自身的亮暗
 * 与页面主题是两套独立变量——黑标/黑字标（Ollama、SourceHut、网易天音）
 * 在深色模式下消失，白字标（Haiper）在浅色模式下消失。之前每轮都是
 * “落地、不做特殊处理、留待统一轮”，本轮一次性还：按 logo 的亮/暗属性
 * 给一块固定底色，不许每站打散补丁。
 *
 * 先例就是 Cursor 的 `bg-muted/40 dark:bg-muted/20 rounded-xs p-0.5
 * border border-border/30` 芯片——本轮把它推广为统一机制：map 管“谁要块、
 * 要哪块”（键与 LOCAL_LOGO_MAP 同款：去 www 后的 hostname），
 * `resolveLogoTile` 管主机名归一化与后缀匹配，`LOGO_TILE_CLASSES` 管
 * “块长什么样”（改样式只改一处）。Cursor 本体不动（已有芯片双主题可用）。
 *
 * 底块颜色是主题无关的固定色：浅色块永远纯白、深色块永远 neutral-900，
 * 浅/深模式下同一张图对比度恒定——这正是“同时覆盖浅色与深色模式”的做法。
 * 不接标题关键词兜底：底块是按 logo 形态定的资产属性，标题兜底的远端
 * 图标形态未知，不能默认给块。
 *
 * 每站形态证据见轮次笔记 evolution-round-2026-11-17-1122.md §1：
 * Ollama/SourceHut 为 fill #000000 的 SI 黑标；天音不透明像素均值亮度 10
 * （黑字透明底）；Notion 自带白底圆角方块（tile 为冗余加固，防远端 favicon
 * 换成透明黑标）；Radix 为黑方块 + 白字形（tile 让方块在深色下有界）；
 * Haiper 为白字 wordmark（fill 已钉死 #ffffff）。
 * Luma 自带白底（白像素 73%），不在点名清单内，不进 map。
 * 极客公园：1361x261 白字宽版仍不可用（24px 卡片内只剩 3.8px），
 * 但方形标（100×100 黑底白 G）可读——像素实测：10000/10000 不透明，
 * 中位亮度 9、6818 像素亮度 <20，黑底方块在深色下与底色相融，故给
 * light 底块（与 Ollama/SourceHut 黑标同款处理）；详情页大尺寸特判
 * 不做（宽版在 48px 内容盒里总高仅 9.2px 仍不可读，且同一站两种形象）。
 */
export type LogoTileTone = 'light' | 'dark'

export const LOGO_TILE_MAP: Record<string, LogoTileTone> = {
  'ollama.com': 'light',
  'sourcehut.org': 'light',
  'notion.com': 'light',
  'radix-ui.com': 'light',
  'tianyin.163.com': 'light',
  'haiper.ai': 'dark',
  'geekpark.net': 'light',
}

/** 底块 class：主题无关固定底色 + 与 Cursor 芯片同款的内边距、描边与圆角。 */
export const LOGO_TILE_CLASSES: Record<LogoTileTone, string> = {
  light: 'bg-white p-0.5 border border-border/30 rounded-xs',
  dark: 'bg-neutral-900 p-0.5 border border-border/30 rounded-xs',
}

export function resolveLogoTile(url?: string): LogoTileTone | null {
  if (!url || typeof url !== 'string') return null
  try {
    const parsed = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`)
    let hostname = parsed.hostname.toLowerCase()
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4)
    }

    if (LOGO_TILE_MAP[hostname]) {
      return LOGO_TILE_MAP[hostname]!
    }

    for (const [domainKey, tone] of Object.entries(LOGO_TILE_MAP)) {
      if (hostname.endsWith(`.${domainKey}`)) {
        return tone
      }
    }

    return null
  } catch {
    return null
  }
}

/**
 * 第三方图标服务域名黑名单。
 *
 * 这些服务把用户「渲染过哪些域名」实时送到第三方服务器上——对一个导航站来说，
 * 这就是把完整浏览记录交出去。种子数据（seed-data.json）里存了一大批
 * icon.horse 链接，只改代码不够：自定义 icon 优先级最高，脏数据会一直被用。
 * 所以在这里按域名拦掉，让它们回落到下方「目标站自己的 favicon → 渐变徽标」链路。
 */
const THIRD_PARTY_ICON_HOSTS = ['icon.horse', 'favicon.cc', 'yandex.st', 'favicon.yandex.net']
/** 路径型图标服务（整站不是图标服务，只有这个路径是），按 URL 前缀拦 */
const THIRD_PARTY_ICON_PATHS = ['https://www.google.com/s2/favicons', 'https://icons.duckduckgo.com/ip3/']

function isThirdPartyIcon(value: string): boolean {
  try {
    const u = new URL(value)
    const host = u.hostname.toLowerCase()
    if (THIRD_PARTY_ICON_HOSTS.some((bad) => host === bad || host.endsWith(`.${bad}`))) return true
    return THIRD_PARTY_ICON_PATHS.some((p) => u.href.startsWith(p))
  } catch {
    return false
  }
}

/**
 * 校验是否属于远端自动生成的 /favicon.ico 盲猜探测地址。
 * 这类地址来自爬虫或种子数据生成，并非人工上传的品牌图标。
 * 外部站点普遍开启了 CORP (Cross-Origin-Resource-Policy: same-origin) 拦截，
 * 在前端直接请求会抛出 ERR_BLOCKED_BY_RESPONSE.NotSameOrigin 403 / 404 / 502 等控制台错误。
 */
export function isRemoteRawFavicon(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return false
  try {
    const u = new URL(trimmed)
    const p = u.pathname.toLowerCase()
    if (
      p.endsWith('/favicon.ico') ||
      p.endsWith('/favicon.png') ||
      p.endsWith('/favicon.svg') ||
      p === '/favicon.ico' ||
      p.includes('favicon')
    ) {
      return true
    }
    if (p === '/' || p === '') {
      return true
    }
  } catch {
    return true
  }
  return false
}

export function resolveSiteIcon(
  url?: string,
  title?: string,
  customIcon?: string | null
): string {
  // 自定义 icon 优先，但第三方图标服务与远端盲猜 favicon 探测地址除外
  if (
    customIcon &&
    typeof customIcon === 'string' &&
    customIcon.trim().length > 0 &&
    !isThirdPartyIcon(customIcon.trim()) &&
    !isRemoteRawFavicon(customIcon.trim())
  ) {
    return customIcon.trim()
  }

  if (!url || typeof url !== 'string') {
    return ''
  }

  try {
    const rawUrl = url.trim()
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
    let hostname = parsed.hostname.toLowerCase()

    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4)
    }

    // 2026-11-17（图标 A 类第 1 批 a1a，独立复审 R2 裁决）：Adobe Firefly 与
    // Adobe Illustrator 去 www 后同为 adobe.com，hostname map 无法区分；
    // adobe.com 键已从 map 整行删除，Firefly 改走标题规则。本规则必须放在
    // map 精确查找之前——否则 adobe.com 精确查找先命中，规则永不可达。
    // Illustrator 的同类规则见第 2 批（标题含 illustrator）。
    const lowerTitle = (title || '').toLowerCase()
    if (lowerTitle.includes('firefly')) return '/brand-icons/firefly.png'
    // 2026-11-17（图标 A 类第 2 批 a2b，独立复审裁决 (a)）：Adobe Illustrator
    // 与 Firefly 去 www 后同为 adobe.com，hostname map 无法区分；且 map 里
    // 已无 adobe.com 键（第 1 批整行删除）。本规则与 Firefly 规则一样必须
    // 放在 map 精确查找之前，否则 adobe.com 查不到、标题规则又走不到。
    // 切勿把 adobe.com 改指 Illustrator——那会让 Firefly 错指 Illustrator。
    if (lowerTitle.includes('illustrator')) return '/brand-icons/illustrator.svg'

    if (LOCAL_LOGO_MAP[hostname]) {
      return LOCAL_LOGO_MAP[hostname]!
    }

    for (const [domainKey, assetPath] of Object.entries(LOCAL_LOGO_MAP)) {
      if (hostname === domainKey || hostname.endsWith(`.${domainKey}`)) {
        return assetPath
      }
    }

    // 自动解析 GitHub 仓库专属组织/用户 Avatar，杜绝连续黑猫 Octocat 撞脸
    if (hostname === 'github.com') {
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts.length >= 1) {
        const owner = parts[0]!
        if (!['features', 'topics', 'trending', 'collections', 'pricing', 'about', 'security', 'login', 'signup'].includes(owner.toLowerCase())) {
          return `https://github.com/${owner}.png?size=64`
        }
      }
    }

    // lowerTitle 已在上方主机名规范化后声明（Firefly 标题规则需先于 map 查找）。
    if (lowerTitle.includes('混元')) return 'https://hunyuan.tencent.com/favicon.ico'
    if (lowerTitle.includes('万相') || lowerTitle.includes('wan2')) return 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png'
    if (lowerTitle.includes('智文')) return 'https://zhiwen.xfyun.cn/favicon.png'
    if (lowerTitle.includes('roo code')) return 'https://github.com/RooVetGit.png?size=64'
    if (lowerTitle.includes('kimi')) return 'https://kimi.moonshot.cn/pwa-192.png'
    if (lowerTitle.includes('豆包')) return 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/favicon/new-doubao/128x128.png'
    if (lowerTitle.includes('文心一言')) return 'https://www.baidu.com/favicon.ico'
    if (lowerTitle.includes('通义灵码')) return 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png'
    if (lowerTitle.includes('runway')) return 'https://runwayml.com/icon.png'
    if (lowerTitle.includes('deepseek')) return 'https://chat.deepseek.com/favicon.ico'
    if (lowerTitle.includes('copilot')) return 'https://github.com/github.png?size=64'
    if (lowerTitle.includes('gemini')) return '/assets/images/logos/gemini.svg'
    if (lowerTitle.includes('chatgpt') || lowerTitle.includes('openai')) return '/assets/images/logos/chatgpt.webp'
    if (lowerTitle.includes('claude')) return '/assets/images/logos/claude.webp'
    if (lowerTitle.includes('cloudflare')) return '/assets/images/logos/cloudflar.webp'
    if (lowerTitle.includes('figma')) return '/assets/images/logos/figma.webp'
    if (lowerTitle.includes('tinypng')) return '/assets/images/logos/tinypng.webp'
    if (lowerTitle.includes('unsplash')) return '/assets/images/logos/unsplash.webp'
    if (lowerTitle.includes('vercel')) return '/assets/images/logos/vercel.webp'

    // 未命中内置 Logo 且无合法自定义图标时，不向浏览器返回远端裸 /favicon.ico，
    // 避免浏览器盲发跨域请求触发 CORP (NotSameOrigin) 阻断或 404/502 报错；
    // 返回空字符串让组件安全回落到确定性渐变字母徽标。
    return ''
  } catch {
    return ''
  }
}

/**
 * 记录加载失败过的图标地址，避免同一会话里反复发起失效请求。
 *
 * 带 TTL：瞬时网络抖动 / 代理冷启动失败不能把一个站点**永久**钉死成字母徽标。
 * 之前用 Set 不过期，一次失败后该 URL 在本页生命周期内再也不会重试，
 * 正是「高频工具长期显示纯字母色块」的隐藏成因之一。
 */
const FAILED_FAVICON_TTL_MS = 5 * 60 * 1000
const failedFaviconCache = new Map<string, number>()

export function isKnownBadIcon(src: string): boolean {
  const failedAt = failedFaviconCache.get(src)
  if (failedAt === undefined) return false
  if (Date.now() - failedAt > FAILED_FAVICON_TTL_MS) {
    failedFaviconCache.delete(src)
    return false
  }
  return true
}

export function markIconFailed(src: string): void {
  failedFaviconCache.set(src, Date.now())
}

export function SiteFavicon({
  title = '',
  url,
  icon,
  useDefaultIcon = false,
  className = 'w-full h-full object-contain',
  eager = false,
}: SiteFaviconProps) {
  const [imgError, setImgError] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const prevIconRef = React.useRef(icon)
  const imgRef = React.useRef<HTMLImageElement | null>(null)

  // 1. 综合计算有效图标地址
  let effectiveIcon = resolveSiteIcon(url, title, icon)
  if (!effectiveIcon && url && (url.startsWith('http://') || url.startsWith('https://'))) {
    // 图标代理端点由中枢提供（apps/api/src/routes/assets.ts）
    // 通过 /api/hub 隧道代理，已在网关清单中登记为 public
    effectiveIcon = `/api/hub/assets/icon?url=${encodeURIComponent(url)}${title ? `&title=${encodeURIComponent(title)}` : ''}`
  }

  // 当 icon 变化时重置状态
  if (prevIconRef.current !== icon) {
    prevIconRef.current = icon
    if (imgError) setImgError(false)
    if (imgLoaded) setImgLoaded(false)
  }

  // 特殊站点图标自愈：部分站点原生返回纯白/透明矢量图，在浅色底色下对比度不足（如 Cursor 官网透明白立方体）
  const isCursorSite = Boolean(
    (title && title.toLowerCase().includes('cursor')) ||
    (url && url.toLowerCase().includes('cursor.com'))
  )

  // 深色底块统一处理：黑标/黑字标给浅色块、白字标给深色块（LOGO_TILE_MAP）；
  // 与 Cursor 芯片互斥——cursor.com 不在 map 里，tile 优先于芯片。
  const logoTile = resolveLogoTile(url)

  // 宽版 logo（中央气象台 255x65、国家哲学 385x56）：横长条在方形卡片里
  // object-contain 后上下留空已够、左右贴边，img 级统一加 p-1 免得贴边；
  // nmc 自带浅色底，深色卡上会露白矩形是已知特性，只加 p-1、不加深色底块。
  const isWideLogoSite =
    effectiveIcon === '/brand-icons/nmc.png' || effectiveIcon === '/brand-icons/ncpssd.png'

  const monogram = extractFaviconMonogram(title, url)
  const gradient = getDeterministicGradient(title || url || 'navhub')
  const shouldRenderImg = !useDefaultIcon && !imgError && Boolean(effectiveIcon) && !isKnownBadIcon(effectiveIcon)

  // 水合与缓存即时感知：若图片已由浏览器完成解码（或来自本地/HTTP缓存），立即置为已加载，防止依赖 onLoad 漏触发
  const handleImgRef = React.useCallback((node: HTMLImageElement | null) => {
    imgRef.current = node
    if (node && node.complete) {
      if (node.naturalWidth > 1) {
        setImgLoaded(true)
      } else if (node.naturalWidth === 1 || node.naturalWidth === 0) {
        // 尚未开始加载或空像素，等待 onLoad/onError
      }
    }
  }, [])

  // 2. 双层渲染架构 (Dual-Layer Architecture)：
  // 底层（Layer 1）：确定性彩色首字母/汉字徽标，常驻存在，零延迟、零灰块
  // 顶层（Layer 2）：真实图片图标，未解码/加载前透明，成功加载后平滑淡入（透明矢量图不透底）
  return (
    <div
      className={cn('relative w-full h-full flex items-center justify-center overflow-hidden rounded-xs select-none', className)}
      title={title}
      aria-label={title ? `${title} 图标` : '站点图标'}
    >
      {/* 真实站点图标：正在加载或加载成功（未触发 onError）时置于顶层可见 (z-10 opacity-100) */}
      {shouldRenderImg ? (
        <img
          ref={handleImgRef}
          src={effectiveIcon}
          alt={title ? `${title} 图标` : '站点图标'}
          className={cn(
            'relative z-10 w-full h-full object-contain opacity-100 transition-opacity duration-150',
            logoTile
              ? LOGO_TILE_CLASSES[logoTile]
              : isCursorSite
                ? 'bg-muted/40 dark:bg-muted/20 rounded-xs p-0.5 border border-border/30'
                : undefined,
            isWideLogoSite && 'p-1'
          )}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager ? 'high' : 'low'}
          decoding="async"
          width={24}
          height={24}
          onError={() => {
            markIconFailed(effectiveIcon)
            setImgError(true)
          }}
          onLoad={(e) => {
            if (
              e.currentTarget.complete &&
              (e.currentTarget.naturalWidth <= 1 ||
                (e.currentTarget.naturalWidth === 16 &&
                  e.currentTarget.naturalHeight === 16 &&
                  effectiveIcon.includes('google.com/s2/favicons')))
            ) {
              markIconFailed(effectiveIcon)
              setImgError(true)
            } else if (e.currentTarget.naturalWidth > 1) {
              setImgLoaded(true)
            }
          }}
        />
      ) : (
        /* 仅在无有效图标或图片加载失败时显示彩色首字母徽章兜底 */
        <div
          className="absolute inset-0 flex items-center justify-center font-bold text-xs rounded-xs shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_1px_2px_rgba(0,0,0,0.15)] ring-1 ring-white/20 dark:ring-white/10"
          style={{
            background: gradient.cssGradient,
            color: gradient.textColor,
          }}
        >
          <span className="leading-none font-semibold tracking-wider drop-shadow-xs select-none">{monogram}</span>
        </div>
      )}
    </div>
  )
}
