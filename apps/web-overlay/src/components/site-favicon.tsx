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
  'ant.design': '/brand-icons/antdesign.png',
  'kubernetes.io': '/brand-icons/kubernetes.svg',
  'spring.io': '/brand-icons/springboot.svg',
  'notion.com': '/brand-icons/notion.png',
  'radix-ui.com': '/brand-icons/radix-ui.svg',
  'boardmix.cn': '/brand-icons/boardmix.jpg',
  'docs.qq.com': '/brand-icons/tencent-docs.jpg',
  'kdocs.cn': '/brand-icons/kdocs.jpg',
  'sspai.com': '/brand-icons/sspai.png',
  'pinduoduo.com': '/brand-icons/pinduoduo.png',
  'hongguoduanju.com': '/brand-icons/hongguo.jpg',
  // 2026-11-17（进化轮第二批 2a）：48 站缺失清单里的 Simple Icons 18 站。
  // 全部 curl 重新验证（200 + SVG 魔数 + <title> 品牌一致）后本地落盘，
  // 与第一批同款做法。Ollama / SourceHut 为纯黑标（fill #000000）：
  // 第一批的 Notion / Radix 同款处理即不做特殊处理（caf73de0 diff 核实：
  // 仅普通 map 条目，无白底色块、无组件改动），此处照抄；深色模式下
  // 黑标对比度弱是已知局限，留待深色底块统一处理轮（研究笔记 §3/§5）。
  // 2026-11-17 深色底块轮：已处理，见下方 LOGO_TILE_MAP（light）。
  'rollupjs.org': '/brand-icons/rollupdotjs.png',
  'webpack.js.org': '/brand-icons/webpack.png',
  'esbuild.github.io': '/brand-icons/esbuild.svg',
  'storybook.js.org': '/brand-icons/storybook.svg',
  'min.io': '/brand-icons/minio.svg',
  'helm.sh': '/brand-icons/helm.svg',
  'pulumi.com': '/brand-icons/pulumi.png',
  'dribbble.com': '/brand-icons/dribbble.svg',
  'behance.net': '/brand-icons/behance.svg',
  'logseq.com': '/brand-icons/logseq.svg',
  'ollama.com': '/brand-icons/ollama.svg',
  'shopee.com': '/brand-icons/shopee.svg',
  'infoq.cn': '/brand-icons/infoq.svg',
  'qianwen.aliyun.com': '/brand-icons/qwen.svg',
  'mantine.dev': '/brand-icons/mantine.svg',
  'sourcehut.org': '/brand-icons/sourcehut.png',
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
  'tantanapp.com': '/brand-icons/tantan.png',
  'reelshort.com': '/brand-icons/reelshort.png',
  'nmc.cn': '/brand-icons/nmc.png',
  'ncpssd.org': '/brand-icons/ncpssd.png',
  'youxi.fullpeace.net': '/brand-icons/youxi.png',
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
  'cursor.com': '/brand-icons/cursor.png',
  'bolt.new': 'https://bolt.new/favicon.ico',
  'v0.dev': '/assets/images/logos/vercel.webp',
  'kimi.moonshot.cn': '/brand-icons/kimi-search.png',
  'doubao.com': '/brand-icons/doubao.png',
  'www.doubao.com': '/brand-icons/doubao.png',
  'yiyan.baidu.com': 'https://www.baidu.com/favicon.ico',
  'lingma.aliyun.com': '/brand-icons/lingma.png',
  'runwayml.com': 'https://runwayml.com/icon.png',
  'deepseek.com': '/brand-icons/deepseek.png',
  'chat.deepseek.com': '/brand-icons/deepseek.png',
  'klingai.com': '/brand-icons/klingai.png',
  'klingai.kuaishou.com': 'https://klingai.com/favicon.ico',
  // 2026-11-16：旧值 https://lumalabs.ai/favicon.ico 经 curl 验证 404，
  // 改用 Luma 官方备用域名 luma.ai 的同名 favicon（200 image/x-icon 15086B，
  // 内容为 Luma 四角星品牌标）。
  'lumalabs.ai': '/brand-icons/luma.png',
  'vidu.studio': 'https://www.vidu.studio/favicon.ico',
  'hailuoai.com': '/brand-icons/hailuoai.png',
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
  // 2026-11-17（图标 B 类第 1 批 b1a）：DeepSeek / Kimi / 文心一言 / Kimi 搜索。
  // 旧键替换（勿重复落键）：'deepseek.com' / 'chat.deepseek.com' /
  // 'kimi.moonshot.cn' 原为热链值，本批改为本地路径；'kimi.com' /
  // 'wenxin.baidu.com' 为新键。来源均经 curl 重新验证（见 map-block-b1a.txt）。
  // chat.deepseek.com/favicon.ico 回的是 SPA HTML 壳页，旧热链值已失效。
  'kimi.com': '/brand-icons/kimi.png',
  'wenxin.baidu.com': '/brand-icons/wenxin.png',
  // 2026-11-17（图标 B 类第 1 批 b1b）：Cline / GitHub Copilot 走 map 前
  // 标题规则（见上方 cline / copilot 规则），此处不建 github.com 键；
  // Cursor 与 Tongyi Lingma 为旧键原地替换值（热链 → 本地路径）。
  // Cursor 仍走既有 isCursorSite 渲染分支（title/url 判定，与 map 值无关，
  // 落盘后渲染仍带 bg-muted/40 底色处理，复审截图核对）。
  // 2026-11-17（图标 B 类 B2a）：Beatoven.ai / Sudowrite 新建键。
  // R1 裁决：这两站 navigation.json 的 icon 为远程热链且不触发拦截，
  // customIcon 优先于 map，单加 map 键不可达——已同步清空两站 icon 字段。
  'beatoven.ai': '/brand-icons/beatoven.png',
  'sudowrite.com': '/brand-icons/sudowrite.png',
  // 2026-11-17（图标 B 类第 4 批 B2b）
  // klingai.com / hailuoai.com 为替换旧键（旧值热链 ICO）；runway.com 为
  // 新建键（旧键 runwayml.com 为死键，全库无站命中，不动；兄弟键
  // klingai.kuaishou.com 全库无站命中，不动）。
  'runway.com': '/brand-icons/runway.png',
  // 2026-11-17（B 类第 5 批之 B3a：Luma AI / Radix UI / Notion / freeCodeCamp）：
  // 4 站热链本地化。lumalabs.ai / radix-ui.com / notion.com 为原地替换旧值
  //（旧值均为远程热链，勿重复建键）；freecodecamp.org 为新键（须与
  // navigation.json.patch 同提交删 icon 行，否则 customIcon 截胡，见 R1）。
  // Radix 为近黑标（fill #1C2024，透明底），与 Ollama / SourceHut 同款处理：
  // 只加普通 map 条目，不做白底色块；深色模式黑标对比度弱是已知局限，
  // 留待深色底块统一处理轮。
  'freecodecamp.org': '/brand-icons/freecodecamp.png',
  // 2026-11-17（图标 B 类第 3 批 b3b）：少数派 / 拼多多 / 微信，本地化。
  // sspai.com、pinduoduo.com 为旧键原地替换值（上方已改，勿重复建键）；
  // weixin.qq.com 为新键（微信 icon 已同步清空，见 navigation-icon-clear-b3b.patch，
  // 仅改这一行）。少数派/拼多多的 customIcon 均为 …/favicon.ico，会被
  // isRemoteRawFavicon 拦截后回落 map，无需清空。
  'weixin.qq.com': '/brand-icons/weixin.png',
  // 2026-11-18（C 类第 1 批 c1g1）：Perplexity / Hugging Face / Suno / ElevenLabs。
  // 4 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。Midjourney 阻塞未落盘（见批次笔记），无条目。
  'perplexity.ai': '/brand-icons/perplexity.svg',
  'huggingface.co': '/brand-icons/huggingface.png',
  'suno.com': '/brand-icons/suno.png',
  'elevenlabs.io': '/brand-icons/elevenlabs.svg',
  // 2026-11-18（C 类第 1 批 c1g2）：智谱清言 / 讯飞星火 / n8n。
  // 3 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。GitHub 走下方标题规则，不建 'github.com' 键。
  'chatglm.cn': '/brand-icons/zhipu.png',
  'xinghuo.xfyun.cn': '/brand-icons/xinghuo.png',
  'n8n.io': '/brand-icons/n8n.png',
  // 2026-11-18（C 类第 1 批 c1g3）：淘宝 / 京东 / 抖音 / 快手 / 哔哩哔哩。
  // 5 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。京东取帧提醒：ICO 最大帧为第 7 帧 48×48 32bpp，
  // PIL 默认帧是 4bpp 抖动帧，复核不要用 PIL 默认帧。
  'taobao.com': '/brand-icons/taobao.png',
  'jd.com': '/brand-icons/jd.png',
  'douyin.com': '/brand-icons/douyin.png',
  'kuaishou.com': '/brand-icons/kuaishou.png',
  'bilibili.com': '/brand-icons/bilibili.png',
  // 2026-11-18（C 类第 1 批 c1g4：办公 + 内容社区）：飞书 / Stack Overflow / 知乎 / 豆瓣 / 小红书。
  // 5 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。
  'feishu.cn': '/brand-icons/feishu.png',
  'stackoverflow.com': '/brand-icons/stackoverflow.png',
  'zhihu.com': '/brand-icons/zhihu.png',
  'douban.com': '/brand-icons/douban.png',
  'xiaohongshu.com': '/brand-icons/xiaohongshu.png',
  // 2026-11-18（C 类第 1 批 Trae 补救）：Trae。
  // icon 为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。源为 docs.trae.ai 首页声明的 shortcut icon
  //（trae.cn 地域墙 403，见批次笔记）；trae.ai 不在站内，不加键。
  'trae.cn': '/brand-icons/trae.png',
  // 2026-11-18（C 类第 2 批 c2g1–c2g7）：元宝搜索 / 秘塔搜索 / 天工AI搜索 /
  // Pika / Viggle AI / Genmo / Vidu / Krea / Deep Dream Generator /
  // Remove.bg / 魔搭 ModelScope / 百度飞桨 / Stability AI / Mistral AI /
  // Meta AI Developers / Gitee AI / Flowise / Apify / Devin Desktop / Topview。
  // 20 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。Devin 的 icon 字段写的是 windsurf.ai 的 favicon
  //（错域，与本站无关），同样以 /favicon.ico 结尾被拦截；只建 'devin.ai' 键，
  // 绝不建 windsurf 键。Meta AI 只建完整子域 'dev.meta.ai'，禁写 'meta.ai'。
  // vidu.studio 旧键（指远程 favicon，不在 navigation.json 中）不动，与
  // 'vidu.cn' 互不干扰。Meta AI 源为 Wayback 存档（官网直连 403，见 C2 测试注释）。
  'so.qq.com': '/brand-icons/yuanbao.png',
  'metaso.cn': '/brand-icons/metaso.png',
  'tiangong.cn': '/brand-icons/tiangong.png',
  'pika.art': '/brand-icons/pika.svg',
  'viggle.ai': '/brand-icons/viggle.svg',
  'genmo.ai': '/brand-icons/genmo.png',
  'vidu.cn': '/brand-icons/vidu.svg',
  'krea.ai': '/brand-icons/krea.png',
  'deepdreamgenerator.com': '/brand-icons/deepdreamgenerator.png',
  'remove.bg': '/brand-icons/removebg.png',
  'modelscope.cn': '/brand-icons/modelscope.png',
  'paddlepaddle.org.cn': '/brand-icons/paddlepaddle.png',
  'stability.ai': '/brand-icons/stability.png',
  'mistral.ai': '/brand-icons/mistral.svg',
  'dev.meta.ai': '/brand-icons/meta-ai.png',
  'moark.com': '/brand-icons/moark.png',
  'flowiseai.com': '/brand-icons/flowise.png',
  'apify.com': '/brand-icons/apify.svg',
  'devin.ai': '/brand-icons/devin.svg',
  'topview.ai': '/brand-icons/topview.png',
  // 2026-11-19（C 类第 3 批 C3）：Jasper / Copy.ai / Writesonic / Grammarly /
  // 秘塔写作猫 / Wordtune / Baidu Comate / Continue.dev / 讯飞开放平台 /
  // Udio / Soundraw / AIVA / Boomy / Mubert / Loudly / Murf AI /
  // Speechify / WellSaid / NaturalReader / 魔音工坊。
  // 20 站 icon 字段均含 favicon（远端 …/favicon.ico、…/favicon.png 或
  // CDN …_favicon.png / …_favicon.ico），被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'xfyun.cn'（讯飞开放平台）与已有
  // 'xinghuo.xfyun.cn'（讯飞星火）互不干扰：精确查找先命中各自键。
  // 'comate.baidu.com' 用完整子域建键，不建 'baidu.com' 键。
  'jasper.ai': '/brand-icons/jasper.png',
  'copy.ai': '/brand-icons/copy-ai.png',
  'writesonic.com': '/brand-icons/writesonic.svg',
  'grammarly.com': '/brand-icons/grammarly.png',
  'xiezuocat.com': '/brand-icons/xiezuocat.png',
  'wordtune.com': '/brand-icons/wordtune.png',
  'comate.baidu.com': '/brand-icons/comate.png',
  'continue.dev': '/brand-icons/continue.png',
  'xfyun.cn': '/brand-icons/xfyun.png',
  'udio.com': '/brand-icons/udio.png',
  'soundraw.io': '/brand-icons/soundraw.png',
  'aiva.ai': '/brand-icons/aiva.png',
  'boomy.com': '/brand-icons/boomy.png',
  'mubert.com': '/brand-icons/mubert.png',
  'loudly.com': '/brand-icons/loudly.png',
  'murf.ai': '/brand-icons/murf.png',
  'speechify.com': '/brand-icons/speechify.png',
  'wellsaid.io': '/brand-icons/wellsaid.png',
  'naturalreaders.com': '/brand-icons/naturalreader.png',
  'moyin.com': '/brand-icons/moyin.png',
  // 2026-11-19（C 类第 4 批 C4）：Gitee 码云 / GitHub Trending / GitLab /
  // GitCode / Codeup / Bitbucket / 掘金 / CSDN / 力扣 LeetCode / 牛客网 /
  // 洛谷 / Codeforces / AtCoder / LeetCode 国际版 / MDN Web Docs /
  // Java 官方文档 / W3C 标准 / ISO/IEC 标准 / roadmap.sh / Shadcn/UI。
  // 20 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。GitHub Trending 不进 map（见下方
  // 'trending' 标题规则，须排在 'github' 规则之前）；'github.com' /
  // 'adobe.com' 键绝不加。子域站用完整 hostname 建键，不建裸域键：
  // 'codeup.aliyun.com'、'developer.mozilla.org'、'docs.oracle.com'、
  // 'ui.shadcn.com'。'leetcode.cn' 与 'leetcode.com' 各自建键、互不干扰。
  // 全库 369 站核对：本批 19 个 map 键各只命中 1 站，无后缀串站
  // （Gitee AI 的 href 是 moark.com，不在 gitee.com 名下）。
  // Java 官方文档：站方 favicon 即红色 Oracle 椭圆 O 标（120×120），
  // 不是 Java 咖啡杯；按“官网在用图标”原样接线，未擅自换标，只记录。
  // ISO/IEC 标准：iso.svg 为白字透明底（fill 仅 #fff，无底色），
  // 浅色主题下不可见；红色底块须用 ISO 品牌红，但 iso.org 站点头色
  // 未能核实具体色值（www.iso.org curl 空回复、官方品牌页无 hex、
  // 候选 #D22630 经查是 Saudi Aramco 的 SA Red、与 ISO 无关），
  // 故本次不加底块分支、不猜 hex，记为未决点，见 C4 测试事实钉死。
  'gitee.com': '/brand-icons/gitee.png',
  'gitlab.com': '/brand-icons/gitlab.png',
  'gitcode.com': '/brand-icons/gitcode.png',
  'codeup.aliyun.com': '/brand-icons/codeup.png',
  'bitbucket.org': '/brand-icons/bitbucket.png',
  'juejin.cn': '/brand-icons/juejin.png',
  'csdn.net': '/brand-icons/csdn.png',
  'leetcode.cn': '/brand-icons/leetcode-cn.png',
  'nowcoder.com': '/brand-icons/nowcoder.png',
  'luogu.com.cn': '/brand-icons/luogu.png',
  'codeforces.com': '/brand-icons/codeforces.png',
  'atcoder.jp': '/brand-icons/atcoder.png',
  'leetcode.com': '/brand-icons/leetcode.png',
  'developer.mozilla.org': '/brand-icons/mdn.svg',
  'docs.oracle.com': '/brand-icons/java-docs.png',
  'w3.org': '/brand-icons/w3c.svg',
  'iso.org': '/brand-icons/iso.svg',
  'roadmap.sh': '/brand-icons/roadmap.png',
  'ui.shadcn.com': '/brand-icons/shadcn.png',
  // 2026-11-19（C 类第 5 批 C5）：Bun / Node.js / Python / Rust / Go /
  // Java / Drizzle ORM / MySQL / PostgreSQL / Redis / MongoDB / Fastify /
  // Express / NestJS / Laravel / Django / Docker Hub / Podman / Compose /
  // Terraform。
  // 20 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 子域站用完整 hostname 建键，不建裸域键：'orm.drizzle.team'、
  // 'hub.docker.com'、'docs.docker.com'、'developer.hashicorp.com'。
  // 全库 369 站核对：本批 20 个 map 键各只命中 1 站，无后缀串站。
  // Java：java.png 为 16×16 咖啡杯原样（java.com 唯一官方 favicon，
  // 其余候选 apple-touch-icon / favicon-32x32 均为 404）；备选 Duke
  // 48px（dev.java favicon，另一图形）未擅自替换，待用户裁决，未决点。
  // 纯黑标：rust.svg（黑齿轮 R）与 terraform.svg（黑 HashiCorp 标，
  // SVG 内含 @media (prefers-color-scheme: dark) 白字规则）深色主题下
  // 对比度弱，属规范 §9 留待统一处理轮次，本批不加底块、不改组件。
  // express.svg / fastify.svg 自带黑底方块（#1a1a1a / #0a0b0d），
  // 双主题均可见，无问题。
  // Compose：标取自官方 docker/compose 仓库根目录 logo.png（README 标注
  // "Docker Compose Logo"）；docs.docker.com 的 favicon 是通用 Docker
  // 鲸鱼，与 Docker Hub 雷同，已弃用、不要用错。
  // MySQL：首页 curl 回 403（机器人拦截），但 favicon 直链 200，海豚标
  // 已验证，无影响。Docker Hub：favicon.ico 实为 PNG 65×65，按内容
  // 解码落盘 .png，无 .ico 残留。
  // 非方标等比缩略（不拉伸不裁切）：nodejs.png 112×128、
  // postgresql.png 124×128、compose.png 117×128。
  'bun.sh': '/brand-icons/bun.svg',
  'nodejs.org': '/brand-icons/nodejs.png',
  'python.org': '/brand-icons/python.png',
  'rust-lang.org': '/brand-icons/rust.svg',
  'go.dev': '/brand-icons/go.svg',
  'java.com': '/brand-icons/java.png',
  'orm.drizzle.team': '/brand-icons/drizzle.png',
  'mysql.com': '/brand-icons/mysql.png',
  'postgresql.org': '/brand-icons/postgresql.png',
  'redis.io': '/brand-icons/redis.png',
  'mongodb.com': '/brand-icons/mongodb.png',
  'fastify.dev': '/brand-icons/fastify.svg',
  'expressjs.com': '/brand-icons/express.svg',
  'nestjs.com': '/brand-icons/nestjs.svg',
  'laravel.com': '/brand-icons/laravel.png',
  'djangoproject.com': '/brand-icons/django.png',
  'hub.docker.com': '/brand-icons/docker-hub.png',
  'podman.io': '/brand-icons/podman.png',
  'docs.docker.com': '/brand-icons/compose.png',
  'developer.hashicorp.com': '/brand-icons/terraform.svg',
  // 2026-11-19（C 类第 6 批 C6）：天猫 / 唯品会 / 苏宁易购 / 1688 /
  // 支付宝 / 全球速卖通 / Temu / SHEIN / eBay / Shopify / 百度地图 /
  // 铁路 12306 / 高德地图 / 携程旅行 / 滴滴出行 / 大众点评 / 顺丰速运 /
  // 圆通速递 / 微博（亚马逊不进 map，见下方 '亚马逊' 标题规则）。
  // 20 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 子域站用完整 hostname 建键，不建裸域键：'map.baidu.com'。
  // 全库 369 站核对：本批 19 个 map 键各只命中 1 站，无后缀串站。
  // 支付宝：落盘 alipay.png 为首页 shortcut icon 的 2600×1950 官方“支”字标
  // 裁透明边距后缩至 128×109（原样，未改画）；同一首页另有 32px 蓝底白“支”
  // ICO 方标（备选）未采用，待复审裁决，见 C6 测试事实钉死。
  // 唯品会 / 全球速卖通 / 携程旅行：官网只有 16px 单帧 favicon，按规范
  // §1.1 原样落盘 16×16、绝不放大；是否接受待裁决，见 C6 测试事实钉死。
  'tmall.com': '/brand-icons/tmall.png',
  'vip.com': '/brand-icons/vip.png',
  'suning.com': '/brand-icons/suning.png',
  '1688.com': '/brand-icons/1688.png',
  'alipay.com': '/brand-icons/alipay.png',
  'aliexpress.com': '/brand-icons/aliexpress.png',
  'temu.com': '/brand-icons/temu.png',
  'shein.com': '/brand-icons/shein.png',
  'ebay.com': '/brand-icons/ebay.png',
  'shopify.com': '/brand-icons/shopify.png',
  'map.baidu.com': '/brand-icons/baidumap.png',
  '12306.cn': '/brand-icons/12306.png',
  'amap.com': '/brand-icons/amap.png',
  'ctrip.com': '/brand-icons/ctrip.png',
  'didiglobal.com': '/brand-icons/didi.png',
  'dianping.com': '/brand-icons/dianping.png',
  'sf-express.com': '/brand-icons/sf-express.png',
  'yto.net.cn': '/brand-icons/yto.png',
  'weibo.com': '/brand-icons/weibo.png',
  // 2026-11-19（C 类第 8 批 C8）：石墨文档 / 语雀 / Obsidian / AppFlowy /
  // AFFiNE / 思源笔记 / Excalidraw / XMind / MindManager / ProcessOn /
  // GitMind / tldraw / Draw.io / Miro / Khan Academy / Skillshare /
  // 慕课网 / 学习强国 / 菜鸟教程。19/20 站，网易云课堂阻塞未入（见下）。
  // 19 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 子域站用完整 hostname 建键：'app.diagrams.net'（Draw.io）；
  // 'b3log.org' 键只命中思源笔记一站（href 为 b3log.org/siyuan，
  // 全库 369 站核对无其他 b3log.org 站）；其余 17 键各只命中 1 站，
  // 无后缀串站。
  // 网易云课堂阻塞未接线：站方 /favicon.ico 仅 16×16（1150 B）质量不达标；
  // 吉祥物图不是 logo；站点头部 logo 是雪碧图区域且直链超时；图标字体无
  // 图片文件。解阻塞二选一：浏览器端取材后复审定夺，或用户拍板接受 16px
  // 原样。本批不放占位图，该站仍走字母徽标兜底。
  // Khan Academy 仅 32px：首页被机器人验证墙拦截，可达的唯一官方标即
  // 32×32 站方 favicon，原样落盘；更大品牌标须浏览器端取材或接受 32px。
  // 慕课网间歇验证墙：favicon 直链约 1/3 概率返回机器人检查页，正确字节
  // 稳定（复验 3 次 2 次命中，md5 与首轮一致）；复核命中检查页请重试，
  // 不要一次墙就判失败。宽版白字 wordmark logo.png（128×40）已排除，
  // 改用 48×48 火焰 favicon，勿以 wordmark 替换。
  // AFFiNE 白底圆角方块：实测 affine.png 96×96、透明像素仅 760/9216
  // （四角透明圆角、底色近白 252–253），深色底上清晰可见，本批不加
  // 底块、不改组件。（原“黑色线稿透明底、深色对比度弱”按实测更正。）
  // SVG 3 站（obsidian / tldraw / xmind）为官网首页声明的 favicon 原样，
  // 本机无渲染器未做栅格渲染复核，留待复审在浏览器/浅深主题确认。
  // MindManager：源 .ico 实为 PNG 50×45，按内容解码原样落盘 .png，
  // 无 .ico 残留。学习强国：站方 favicon 内容为 PNG 30×30，原样落盘。
  // 小尺寸原样站（源 <128 不放大）：32×32（石墨 / AppFlowy / Khan）、
  // 96×96（AFFiNE）、50×45（MindManager）、64×64（ProcessOn）、
  // 72×72（GitMind）、120×120（Skillshare）、48×48（慕课网）、
  // 30×30（学习强国）。
  'shimo.im': '/brand-icons/shimo.png',
  'yuque.com': '/brand-icons/yuque.png',
  'obsidian.md': '/brand-icons/obsidian.svg',
  'appflowy.com': '/brand-icons/appflowy.png',
  'affine.pro': '/brand-icons/affine.png',
  'b3log.org': '/brand-icons/siyuan.png',
  'excalidraw.com': '/brand-icons/excalidraw.png',
  'xmind.cn': '/brand-icons/xmind.svg',
  'mindmanager.com': '/brand-icons/mindmanager.png',
  'processon.com': '/brand-icons/processon.png',
  'gitmind.com': '/brand-icons/gitmind.png',
  'tldraw.com': '/brand-icons/tldraw.svg',
  'app.diagrams.net': '/brand-icons/diagrams.png',
  'miro.com': '/brand-icons/miro.png',
  'khanacademy.org': '/brand-icons/khanacademy.png',
  'skillshare.com': '/brand-icons/skillshare.png',
  'imooc.com': '/brand-icons/imooc.png',
  'xuexi.cn': '/brand-icons/xuexi.png',
  'runoob.com': '/brand-icons/runoob.png',
  // 2026-11-19（C 类第 9 批 C9，15/20）：粉笔 / 华图教育 / 新东方在线 /
  // BOSS直聘 / 拉勾网 / 前程无忧 / 猎聘 / 五百丁 / Codecademy / 维基百科
  // （研招网 / 考研网上报名 / 全国大学英语四、六级考试官网 /
  // 四六级成绩查询 / 中国教育考试网不进 map，见下方 C9 标题规则）。
  // 15 站已设计，5 站阻塞未入：国家公务员局 / 2027年国家公务员考试专题 /
  // 中央机关公开遴选和公开选调专题（scs.gov.cn 机器人验证墙）、
  // 中公教育（403 WAF）、廖雪峰教程（无 favicon），本次不接线、不放占位图。
  // 10 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 子域站用完整 hostname 建键，不建裸域键：'zh.wikipedia.org'。
  // 全库 367 站核对：本批 10 个 map 键各只命中 1 站，无后缀串站。
  // 6 站为 16×16 原样小图（huatu / zhipin / lagou；另 3 站走标题规则，
  // 见下方），按规范 §1.1 原样落盘、绝不放大，卡片上显小是合规状态。
  'fenbi.com': '/brand-icons/fenbi.png',
  'huatu.com': '/brand-icons/huatu.png',
  'koolearn.com': '/brand-icons/koolearn.png',
  'zhipin.com': '/brand-icons/zhipin.png',
  'lagou.com': '/brand-icons/lagou.png',
  '51job.com': '/brand-icons/51job.png',
  'liepin.com': '/brand-icons/liepin.png',
  '500d.me': '/brand-icons/500d.png',
  'codecademy.com': '/brand-icons/codecademy.png',
  'zh.wikipedia.org': '/brand-icons/wikipedia.png',
  // 2026-11-19（C 类第 10 批 C10）：arXiv / 中国知网 / 万方数据 /
  // Web of Science / Semantic Scholar / IEEE Xplore / JSTOR /
  // 国家数字图书馆 / 36氪 / 虎嗅 / 爱范儿 / Canva / Creative Market /
  // Sketch / Penpot / Pixso。17/20 站，Scopus / 读秀 /
  // Project Gutenberg 阻塞未入（见 C10 测试事实钉死）。
  // 17 站 icon 字段均为远端 …/favicon.ico（含 NLC 的模板路径
  // …/img/favicon.ico），被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 子域站用完整 hostname 建键：'ieeexplore.ieee.org'（IEEE Xplore，
  // 不建 'ieee.org' 裸域键）。Hugging Face Papers 不进 map（见下方
  // 'hugging face papers' 标题规则，huggingface.co 键已被 Hugging Face
  // 主站占用）。全库 367 站核对：本批 16 个 map 键各只命中 1 站，
  // 无后缀串站。中国知网 cnki.svg 为白色反白宽版标（viewBox
  // 0 0 2941.51×685.5，白字/白标 + 一颗橙点），宽版原样不裁；
  // 浅/深两主题下白字可见靠下方 LOGO_TILE_MAP 的 'dark' 深色底块
  // （Haiper 白字标同款机制），不另起分支。
  // IEEE Xplore 仅 16×16 官方 favicon（ieeexplore.ieee.org 唯一声明），
  // 按规范 §1.1 原样落盘、绝不放大；是否另寻更大官方标待裁决，见
  // C10 测试事实钉死。36氪首页内嵌 base64 山峰图与品牌不符未用，
  // 以 32×32 官方 favicon（蓝 Kr）为准；虎嗅以首页声明的 120×120
  // apple-touch-icon 为准（favicon.ico 100×100 PNG 未用）；Pixso 以
  // 官网首页引用的 512 品牌标缩至 128 为准（favicon.ico 仅 32×32 未用）。
  'arxiv.org': '/brand-icons/arxiv.png',
  'cnki.net': '/brand-icons/cnki.svg',
  'wanfangdata.com.cn': '/brand-icons/wanfang.png',
  'webofscience.com': '/brand-icons/webofscience.png',
  'semanticscholar.org': '/brand-icons/semanticscholar.png',
  'ieeexplore.ieee.org': '/brand-icons/ieee.png',
  'jstor.org': '/brand-icons/jstor.png',
  'nlc.cn': '/brand-icons/nlc.png',
  '36kr.com': '/brand-icons/36kr.png',
  'huxiu.com': '/brand-icons/huxiu.png',
  'ifanr.com': '/brand-icons/ifanr.png',
  'canva.com': '/brand-icons/canva.png',
  'creativemarket.com': '/brand-icons/creativemarket.png',
  'sketch.com': '/brand-icons/sketch.png',
  'penpot.app': '/brand-icons/penpot.png',
  'pixso.cn': '/brand-icons/pixso.png',
  // 2026-11-19（C 类第 11 批 C11，17/20）：Mixkit / Storyblocks / iStock /
  // Pinterest / Awwwards / Mobbin / Iconify / Dafont / Lucide / Uiverse /
  // Chakra UI / npmmirror / Turbo / 中国天气网 / 生态环境部 /
  // 全国排污许可证管理信息平台 / AWS WAF。
  // 3 站阻塞未入：Pexels / Pixabay（403 Cloudflare 机器人墙）、
  // SiteInspire（429 Vercel 检查点），本次不接线、不放占位图。
  // 17 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 全库 367 站核对：本批 17 个 map 键各只命中 1 站，无后缀串站。
  // 同域两站用完整 hostname 各建键，不互相覆盖：'mee.gov.cn'（生态环境部）
  // 与 'permit.mee.gov.cn'（排污平台）；精确查找先于后缀匹配，
  // permit.mee.gov.cn 命中自有键，不会串到 mee.png。
  // 'aws.amazon.com' 键安全：'amazon.com' 未进 map（C6 注释钉死，
  // 亚马逊走标题规则 '亚马逊'），后缀匹配无串站。
  // npmmirror：源取 npmmirror.com 的 /favicon.ico；href 域名
  // registry.npmmirror.com 的 /favicon.ico 回 73 B JSON（egg 默认路径
  // 指针，非图标），已弃用，键仍按 href hostname 建
  // 'registry.npmmirror.com'。
  // AWS WAF：站方 favicon 为通用 AWS 标（非 WAF 专属），按 Adobe Color
  // 判例未用；落盘为官方 AWS Architecture Icons 包内专属服务标
  // Arch_AWS-WAF_64.svg 原样，来源类别待复审裁决（接受或改阻塞）。
  // permit-mee.png 为灰色齿轮标（站方 /favicon.ico 实测返回），待复审
  // 确认接受或阻塞。pinterest.svg 的 P 无 fill（默认黑色），深色主题
  // 可见性风险留待规范 §9 统一处理轮，不擅自改。mobbin.svg 内嵌
  // base64 PNG + 深色反色滤镜，按规范原样落盘。
  // 小尺寸原样站（源 <128 不放大）：16×16（Mixkit / 生态环境部）、
  // 32×32（Storyblocks / npmmirror / 中国天气网）、48×48（Dafont /
  // Lucide / Uiverse / Chakra UI / 排污平台）。
  'mixkit.co': '/brand-icons/mixkit.png',
  'storyblocks.com': '/brand-icons/storyblocks.png',
  'istockphoto.com': '/brand-icons/istockphoto.png',
  'pinterest.com': '/brand-icons/pinterest.svg',
  'awwwards.com': '/brand-icons/awwwards.svg',
  'mobbin.com': '/brand-icons/mobbin.svg',
  'iconify.design': '/brand-icons/iconify.svg',
  'dafont.com': '/brand-icons/dafont.png',
  'lucide.dev': '/brand-icons/lucide.png',
  'uiverse.io': '/brand-icons/uiverse.png',
  'chakra-ui.com': '/brand-icons/chakra-ui.png',
  'registry.npmmirror.com': '/brand-icons/npmmirror.png',
  'turborepo.dev': '/brand-icons/turborepo.png',
  'weather.com.cn': '/brand-icons/weather.png',
  'mee.gov.cn': '/brand-icons/mee.png',
  'permit.mee.gov.cn': '/brand-icons/permit-mee.png',
  'aws.amazon.com': '/brand-icons/aws-waf.svg',
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
  // 2026-11-19（C 类第 10 批 C10）：中国知网。cnki.svg 为白色反白宽版标
  // （viewBox 0 0 2941.51×685.5，白字/白标 + 一颗橙点，SVG 内唯一 hex
  // 为橙点 #f29600），浅色主题下白字不可见，故给 'dark' 深色底块
  // （Haiper 白字标同款机制，统一规范 §3 深色底块例外）。
  // 底块色值来源：下方 LOGO_TILE_CLASSES.dark = 'bg-neutral-900 …'
  // （Tailwind neutral-900 #171717，代码内已有定值，非新猜色值）。
  // 未擅自挪用 SVG 内橙点 #f29600 作底块色，也未沿用统一规范 §3
  // 旧版极客公园计划值 #101828（该值为计划稿色值，落地代码未采用；
  // 极客公园落地为 'light' 块，因其落盘是黑底方块标）。如复审裁决
  // 改用橙底 #f29600 或 #101828，改一处 LOGO_TILE_CLASSES 即可。
  // 宽版不裁：object-contain + 底块 p-0.5 渲染，不进 isWideLogoSite。
  'cnki.net': 'dark',
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
    // 2026-11-17（图标 B 类第 1 批 b1b，R2 裁决）：Cline 与 GitHub Copilot
    // 同为 github.com，hostname map 无法区分（误加 'github.com' 键会波及
    // GitHub 主站、GitHub Trending、LangGraph、Qwen 3、vLLM 共 7 站）；
    // 仿 Adobe Firefly / Illustrator 先例（a1a/a2b），用 map 前标题规则。
    // 全库核对：标题含 'cline' 仅 Cline 一站、含 'copilot' 仅 GitHub Copilot
    // 一站（navigation.json 与 navigation-default.json 均已核对）。
    // Cline 标为官网主题 favicon（cline-icon-dark.svg，深色 #1C1C24 透明底，
    // 深色主题对比度弱属规范 §9 留待统一处理轮，不加白底）。
    // Copilot 无专属标：落盘的是 GitHub 站方 favicon.svg（Octocat 母品牌标，
    // #24292E 深色透明底），不是 Copilot 专属标，特此钉死。
    if (lowerTitle.includes('cline')) return '/brand-icons/cline.svg'
    if (lowerTitle.includes('copilot')) return '/brand-icons/copilot.svg'
    // 2026-11-17（图标 B 类 B2a，基线 R2 补充裁决）：LangGraph / Qwen 3 与
    // GitHub 主站等 7 站同为 github.com，hostname map 无法区分；切勿加 'github.com' 键。
    // 仿 A2 复审 Illustrator 先例走标题规则，必须放在 map 精确查找之前、
    // GitHub 组织头像分支之前。文件名说明：LangGraph 源为 SVG 故落盘
    // langgraph.svg（原任务单所写 langgraph.png 与规范 §1.1“SVG 原样”冲突，
    // 以规范 + 研究笔记为准）；qwen.svg 已被通义千问占用，故 Qwen 3 落盘 qwen3.png。
    if (lowerTitle.includes('langgraph')) return '/brand-icons/langgraph.svg'
    if (lowerTitle.includes('qwen')) return '/brand-icons/qwen3.png'
    // 2026-11-17（图标 B 类基线 R2 补充裁决）：vLLM 与 GitHub 主站等 7 站
    // 同为 github.com，hostname map 无法区分；切勿加 'github.com' 键。
    // 仿 A2 复审 Illustrator 先例走标题规则，必须放在 map 精确查找之前。
    // 载体裁决（B2 复审 §5.3）：落盘 vllm.svg（官网 SVG 双声明、透明底，
    // 规范 §1.1 SVG 优先）；ICO 版为同一标的白底不透明载体，已裁决废弃。
    if (lowerTitle.includes('vllm')) return '/brand-icons/vllm.svg'
    // 2026-11-19（C 类第 4 批 C4）：GitHub Trending。github.com 为 7 站共享域名，
    // 严禁加 'github.com' 域名映射键（见上方 cline/copilot 规则与 C1 github 规则）。
    // 子串 'trending' 在 navigation.json 全库 369 站标题中仅命中 GitHub Trending
    // 一站，故走标题规则；本条必须放在下方 'github' 规则之前，否则 Trending
    // 会先被 'github' 规则命中、解析为 github.svg。落盘 github-trending.svg
    // 与既有 github.svg 逐字节相同（同为 GitHub 官方 favicon.svg），按任务要求
    // 单独落盘、未复用 github.svg。来源：github.githubassets.com/favicons/favicon.svg。
    if (lowerTitle.includes('trending')) return '/brand-icons/github-trending.svg'
    // 2026-11-18（C 类第 1 批 c1g2）：GitHub 主站。github.com 为 7 站共享域名（GitHub、GitHub Trending、Cline、Copilot、LangGraph、Qwen 3、vLLM），严禁加 'github.com' 域名映射键。
    // 子串 'github' 在 navigation.json 全库 369 站标题中仅命中 3 站：GitHub、GitHub Trending、GitHub Copilot；
    // 其中 Copilot 已由上方 'copilot' 规则（:515）先行命中，不受本条影响；GitHub Trending（C4）暂由本条命中、解析为 github.svg，
    // C4 为 Trending 加 'trending' 规则时必须放在本条之前。来源：官网首页 <link rel="icon"> 声明的 favicon.svg（github.githubassets.com），SVG 原样。
    if (lowerTitle.includes('github')) return '/brand-icons/github.svg'
    // 2026-11-19（C 类第 6 批 C6）：亚马逊。'amazon.com' 严禁进 map：
    // 后缀匹配会让 C11 的 AWS WAF（aws.amazon.com）串站解析为 amazon.png。
    // 子串 '亚马逊' 在 navigation.json 全库 369 站标题中仅命中亚马逊一站，
    // 故走标题规则（map 精确查找之前）；AWS WAF 标题不含该子串，不受影响。
    // 来源：www.amazon.com/favicon.ico 最大帧 48×48 转 PNG 原样。
    if (lowerTitle.includes('亚马逊')) return '/brand-icons/amazon.png'
    // 2026-11-19（C 类第 9 批 C9，15/20）：研招网 / 考研网上报名 /
    // 全国大学英语四、六级考试官网 / 四六级成绩查询 / 中国教育考试网。
    // 同域共享官方源、文件名不同，hostname map 无法区分，仿 C1 GitHub
    // 模式走标题规则，必须放在 map 精确查找之前：
    // - yz.chsi.com.cn 仅此 2 站：'研招网' 与 '考研网上报名' 互不为子串，
    //   各命中 1 站；'chsi.com.cn' 键绝不加。
    // - cet.neea.edu.cn 仅此 2 站 + www.neea.edu.cn 1 站：三条标题子串
    //   在全库 367 站中各仅命中 1 站；'neea.edu.cn' / 'cet.neea.edu.cn'
    //   键绝不加。注意官网标题用 '四、六级'（顿号），与成绩查询的
    //   '四六级' 不重叠，故两条规则互不干扰。
    // 同源像素相同是官方源本身同一文件（yz.png 与 yz-yzwb.png 逐字节
    // 相同；cet.png / cet-query.png / neea.png 逐字节相同），按设计
    // 证据分别落盘、不得复用同一文件名。
    // 16×16 原样小图：cet.png / cet-query.png / neea.png，按规范 §1.1
    // 原样保留、绝不放大，卡片上显小是合规状态而非质量问题。
    if (lowerTitle.includes('考研网上报名')) return '/brand-icons/yz-yzwb.png'
    if (lowerTitle.includes('研招网')) return '/brand-icons/yz.png'
    if (lowerTitle.includes('四六级成绩查询')) return '/brand-icons/cet-query.png'
    if (lowerTitle.includes('全国大学英语四、六级考试官网')) return '/brand-icons/cet.png'
    if (lowerTitle.includes('中国教育考试网')) return '/brand-icons/neea.png'
    // 2026-11-19（C 类第 10 批 C10）：Hugging Face Papers。
    // huggingface.co 键已被 Hugging Face 主站占用（→ huggingface.png），
    // hostname map 无法区分；且其 navigation.json icon 字段是错域的
    // paperswithcode.com/favicon.ico（被 isRemoteRawFavicon 拦截，未用）。
    // 子串 'hugging face papers' 在 navigation.json 全库 367 站标题中
    // 仅命中 Hugging Face Papers 一站，故走标题规则，必须放在 map 精确
    // 查找之前。落盘 huggingface-papers.svg 为 huggingface.co 官方 HF 标
    // SVG 原样（width 95 height 88，viewBox 缺省），与 huggingface.png
    // 不同名、不同文件。
    if (lowerTitle.includes('hugging face papers')) return '/brand-icons/huggingface-papers.svg'

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
