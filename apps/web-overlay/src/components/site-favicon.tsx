'use client'

import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import { isAbsoluteHttpUrl, isAllowedHost, parseSiteUrl } from '@/lib/safe-url'

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

/* P2-1：渐变色板 Token 化——from/to 只引 globals.css 的 --gradient-brand-*-from/to，
   textColor 只引 --color-on-gradient；hex 值只出现在 globals.css 的 Token 定义处，
   本文件无裸 hex。深色模式沿用同值（白字在渐变上浅深对比度相同）。 */
export const PRESET_GRADIENTS = [
  { from: 'var(--gradient-brand-01-from)', to: 'var(--gradient-brand-01-to)', textColor: 'var(--color-on-gradient)' }, // 蓝紫极光
  { from: 'var(--gradient-brand-02-from)', to: 'var(--gradient-brand-02-to)', textColor: 'var(--color-on-gradient)' }, // 蔚蓝海流
  { from: 'var(--gradient-brand-03-from)', to: 'var(--gradient-brand-03-to)', textColor: 'var(--color-on-gradient)' }, // 极光翡翠
  { from: 'var(--gradient-brand-04-from)', to: 'var(--gradient-brand-04-to)', textColor: 'var(--color-on-gradient)' }, // 暖阳晚霞
  { from: 'var(--gradient-brand-05-from)', to: 'var(--gradient-brand-05-to)', textColor: 'var(--color-on-gradient)' }, // 霓虹浆果
  { from: 'var(--gradient-brand-06-from)', to: 'var(--gradient-brand-06-to)', textColor: 'var(--color-on-gradient)' }, // 赛博电光
  { from: 'var(--gradient-brand-07-from)', to: 'var(--gradient-brand-07-to)', textColor: 'var(--color-on-gradient)' }, // 春晓青柠
  { from: 'var(--gradient-brand-08-from)', to: 'var(--gradient-brand-08-to)', textColor: 'var(--color-on-gradient)' }, // 珊瑚朝霞
  { from: 'var(--gradient-brand-09-from)', to: 'var(--gradient-brand-09-to)', textColor: 'var(--color-on-gradient)' }, // 幻境晶体
  { from: 'var(--gradient-brand-10-from)', to: 'var(--gradient-brand-10-to)', textColor: 'var(--color-on-gradient)' }, // 深邃星空
  { from: 'var(--gradient-brand-11-from)', to: 'var(--gradient-brand-11-to)', textColor: 'var(--color-on-gradient)' }, // 浅滩清波
  { from: 'var(--gradient-brand-12-from)', to: 'var(--gradient-brand-12-to)', textColor: 'var(--color-on-gradient)' }, // 幻彩紫晶
  { from: 'var(--gradient-brand-13-from)', to: 'var(--gradient-brand-13-to)', textColor: 'var(--color-on-gradient)' }, // 熔岩烈焰
  { from: 'var(--gradient-brand-14-from)', to: 'var(--gradient-brand-14-to)', textColor: 'var(--color-on-gradient)' }, // 森林薄雾
  { from: 'var(--gradient-brand-15-from)', to: 'var(--gradient-brand-15-to)', textColor: 'var(--color-on-gradient)' }, // 钛金属辉光
  { from: 'var(--gradient-brand-16-from)', to: 'var(--gradient-brand-16-to)', textColor: 'var(--color-on-gradient)' }, // 极夜苍穹
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

/**
 * 品牌图标本地映射的紧凑表（2026-11-19 U-248 体积压缩；2026-11-20 U-248
 * 再压缩：条目由 ['host', 'file'] 二元组改为 'host=file' 一行字符串，
 * 每条省 5 B 标点，首屏再少发约 1.7 KB。host 里无 '='，值里也无 '='
 * （全表已校验），故按第一个 '=' 切分即无歧义；顺序与重键保留原样，
 * 展开后的 Record 与旧表逐键一致）。
 * 2026-11-21 U-248 三压缩：裸文件名后缀改 1 字符编码（.svg→s、.png→p、
 * .jpg→j，末字符即编码），每条再省 3 B，共 323 条、毛省 969 B，展开时
 * 按末字符查 LOGO_EXT 还原，展开后的 Record 与改前逐键一致（已校验
 * 358/358）。完整路径条目（35 条）不编码。
 * 358 条里 323 条的值共享 '/brand-icons/' 前缀；前缀只写一次、条目只存
 * 裸文件名，值里带 '/' 的是完整路径（/assets/... 或 https://...），
 * 原样使用，不加前缀。新增条目时裸文件名进 brand-icons（后缀照 1 字符
 * 编码写），完整路径照写即可。
 */
const LOCAL_LOGO_ENTRIES: ReadonlyArray<string> = [
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
  'dify.ai=difys',
  'ant.design=antdesignp',
  'kubernetes.io=kubernetess',
  'spring.io=springboots',
  'notion.com=notionp',
  'radix-ui.com=radix-uis',
  'boardmix.cn=boardmixj',
  'docs.qq.com=tencent-docsj',
  'kdocs.cn=kdocsj',
  'sspai.com=sspaip',
  'pinduoduo.com=pinduoduop',
  'hongguoduanju.com=hongguoj',
  // 2026-11-17（进化轮第二批 2a）：48 站缺失清单里的 Simple Icons 18 站。
  // 全部 curl 重新验证（200 + SVG 魔数 + <title> 品牌一致）后本地落盘，
  // 与第一批同款做法。Ollama / SourceHut 为纯黑标（fill #000000）：
  // 第一批的 Notion / Radix 同款处理即不做特殊处理（caf73de0 diff 核实：
  // 仅普通 map 条目，无白底色块、无组件改动），此处照抄；深色模式下
  // 黑标对比度弱是已知局限，留待深色底块统一处理轮（研究笔记 §3/§5）。
  // 2026-11-17 深色底块轮：已处理，见下方 LOGO_TILE_MAP（light）。
  'rollupjs.org=rollupdotjsp',
  'webpack.js.org=webpackp',
  'esbuild.github.io=esbuilds',
  'storybook.js.org=storybooks',
  'min.io=minios',
  'helm.sh=helms',
  'pulumi.com=pulumip',
  'dribbble.com=dribbbles',
  'behance.net=behances',
  'logseq.com=logseqs',
  'ollama.com=ollamas',
  'shopee.com=shopees',
  'infoq.cn=infoqs',
  'qianwen.aliyun.com=qwens',
  'qianwen.com=qwens',
  'www.qianwen.com=qwens',
  'mantine.dev=mantines',
  'sourcehut.org=sourcehutp',
  'coze.cn=cozes',
  'lintcode.com=lintcodes',
  // 2026-11-17（进化轮第二批 2b 之开发设计类）：48 站缺失清单里的站方自有
  // 图标 10 站。全部 curl 重新验证（200 + image MIME + 魔数 + 尺寸与研究
  // 笔记逐个相符）后本地落盘，与第一批/2a 同款做法。Naive UI 的远程路径
  // 含构建 hash、IETF 的路径含版本段 12.83.2，均已本地化钉死，不可热链；
  // SegmentFault 的 CDN 无 Referer 回 403，下载时带 Referer 且已本地化，
  // 不可热链。CodeGeeX 自带黑底（312x312 PNG），深色模式可用；其余按 2a
  // 对 Ollama / SourceHut 的做法——不做特殊处理，已知局限留待深色底块
  // 统一处理轮（研究笔记 §3/§5）。
  'codegeex.cn=codegeexp',
  'coding.net=codingp',
  'element-plus.org=element-pluss',
  'naiveui.com=naiveuis',
  'go-zero.dev=go-zeros',
  'coolors.co=coolorsp',
  'squoosh.app=squooshp',
  'segmentfault.com=segmentfaultp',
  'gogs.io=gogsp',
  'datatracker.ietf.org=ietfp',
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
  'capcut.cn=capcutp',
  'jimeng.jianying.com=jimengp',
  'tianyin.163.com=tianyinp',
  'icourse163.org=icourse163p',
  'time.geekbang.org=geekbangj',
  'zhaopin.com=zhaopinp',
  'fanqienovel.com=fanqiep',
  'tantanapp.com=tantanp',
  'reelshort.com=reelshortp',
  'nmc.cn=nmcp',
  'ncpssd.org=ncpssdp',
  'youxi.fullpeace.net=youxip',
  'mtime.com=mtimej',
  'wondercv.com=wondercvj',
  'nhsa.gov.cn=nhsaj',
  '12333.gov.cn=12333j',
  'xiaoyunque.com=xiaoyunquej',
  // 2026-11-17（深色底块统一处理轮）：Haiper。站方首页只有内联 SVG
  // wordmark（无可热链 URL、176x72、7 条 path 全跟随文字颜色），本轮
  // 重取首页（200）提取后本地落盘为 haiper.svg：fill 钉死 #ffffff，
  // 配下方 LOGO_TILE_MAP 的 dark 底块。
  'haiper.ai=haipers',
  // 2026-11-17（同轮追加）：极客公园。1361x261 白字宽版 wordmark 仍不
  // 可用（24px 卡片内只剩 3.8px 高，比渐变字母更差，不进 map）；但并行
  // 研究线找到站方 /about 页 head 三重官方指定的方形标
  // imgslim.geekpark.net/geekpark-icon-196-black.png，curl 200、3705B、
  // 实测 100×100（文件名按实测尺寸，不沿用虚标 196）：黑底白 G、全
  // 10000 像素不透明，24/36/64 三档 G 高 9.8/15.7/29.4px 均可读。
  // 黑底方块配下方 LOGO_TILE_MAP 的 light 底块（与 Ollama 黑标同款处理）。
  'geekpark.net=geekparkp',
  'vuejs.org=vues',
  'npmjs.com=npms',
  'vite.dev=vites',
  'pnpm.io=pnpms',
  'tongyi.aliyun.com=https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png',
  'wan2.aliyun.com=https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png',
  // 2026-11-16：旧值 https://zhiwen.xfyun.cn/favicon.ico 经 curl 验证 404，
  // 改用同站验证过的 favicon.png（200 image/png 14725B）。
  'zhiwen.xfyun.cn=https://zhiwen.xfyun.cn/favicon.png',
  'cursor.com=cursorp',
  'v0.dev=/brand-icons/vercel.png',
  'kimi.moonshot.cn=kimi-searchp',
  'doubao.com=doubaop',
  'www.doubao.com=doubaop',
  'yiyan.baidu.com=wenxinp',
  'lingma.aliyun.com=lingmap',
  'runwayml.com=runwayp',
  'deepseek.com=deepseekp',
  'chat.deepseek.com=deepseekp',
  'klingai.com=klingaip',
  'klingai.kuaishou.com=klingaip',
  // 2026-11-16：旧值 https://lumalabs.ai/favicon.ico 经 curl 验证 404，
  // 改用 Luma 官方备用域名 luma.ai 的同名 favicon（200 image/x-icon 15086B，
  // 内容为 Luma 四角星品牌标）。
  'lumalabs.ai=lumap',
  'vidu.studio=vidus',
  'hailuoai.com=hailuoaip',
  'chatgpt.com=chatgpts',
  'chat.openai.com=chatgpts',
  'openai.com=openaip',
  'claude.ai=claudes',
  'anthropic.com=/brand-icons/claude.svg',
  'cloudflare.com=cloudflarep',
  'figma.com=figmas',
  'tinypng.com=tinypngp',
  'unsplash.com=unsplashp',
  'vercel.com=vercelp',
  'fonts.google.com=google-fontss',
  'material.io=/brand-icons/Materialicons.webp',
  'colorhunt.co=/brand-icons/colorhunt.webp',
  'flinto.com=/brand-icons/flinto.webp',
  'flaticon.com=flaticonp',
  'fontawesome.com=font-awesomes',
  'framer.com=/brand-icons/framer.webp',
  'freepik.com=/brand-icons/freepik.webp',
  'gemini.google.com=geminis',
  'iconarchive.com=/brand-icons/iconarchive.webp',
  'iconfinder.com=/brand-icons/Iconfinder.webp',
  // 2026-11-20（U-08 补站 Iconfont）：原值 '/assets/images/logos/iconfont.webp'
  // 为上游底座 44×44 WebP（apps/web 镜像树资产）；改指站方 favicon 本体 SVG
  // （www.iconfont.cn/favicon.ico 302 至 img.alicdn.com 官方标，83×82，5,688 B，
  // md5 dcc980d06bc7209d1c9ec24870620f0d），与导航条目同源、矢量更清晰。
  // 全库 383 站核对：'iconfont.cn' 键只命中 Iconfont 一站，无后缀串站。
  'iconfont.cn=iconfonts',
  'iconmonstr.com=/brand-icons/iconmonstr.webp',
  'ionicons.com=/brand-icons/ionicons.webp',
  'leonardo.ai=leonardop',
  'poe.com=/brand-icons/poe.svg',
  'producthunt.com=/brand-icons/producthunt.webp',
  'tensor.art=/brand-icons/tensorart.webp',
  'icomoon.io=/brand-icons/IcoMoonApp.webp',
  'findicons.com=/brand-icons/FindIcons.webp',
  'principleformac.com=/brand-icons/principle.webp',
  'worldvectorlogo.com=/brand-icons/worldvectorlogo.webp',
  'shots.so=/brand-icons/shots.webp',
  'simplelineicons.com=/brand-icons/simplelineicons.webp',
  'sqlformat.org=/brand-icons/sqlformat.webp',
  'tableconvert.com=/brand-icons/tableconvert.webp',
  'json.cn=/brand-icons/json.webp',
  'beautifier.io=/brand-icons/beautifier.webp',
  'ui-cloud.com=/brand-icons/UICloud.webp',
  'ads.google.com=/brand-icons/gads.webp',
  'analytics.google.com=/brand-icons/analytics.webp',
  'photoshop.com=/brand-icons/photoshop.webp',
  'affinity.serif.com=/brand-icons/AffinityDesigner.webp',
  'instantlogosearch.com=/brand-icons/InstantLogoSearch.webp',
  'iconsfeed.com=/brand-icons/iconsfeed.webp',
  'iosicongallery.com=/brand-icons/iosicongallery.webp',
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
  'fonts.adobe.com=adobe-fontsp',
  'helpx.adobe.com=adobe-xds',
  // 2026-11-17（图标 B 类第 1 批 b1a）：DeepSeek / Kimi / 文心一言 / Kimi 搜索。
  // 旧键替换（勿重复落键）：'deepseek.com' / 'chat.deepseek.com' /
  // 'kimi.moonshot.cn' 原为热链值，本批改为本地路径；'kimi.com' /
  // 'wenxin.baidu.com' 为新键。来源均经 curl 重新验证（见 map-block-b1a.txt）。
  // chat.deepseek.com/favicon.ico 回的是 SPA HTML 壳页，旧热链值已失效。
  'kimi.com=kimip',
  'wenxin.baidu.com=wenxinp',
  // 2026-11-17（图标 B 类第 1 批 b1b）：Cline / GitHub Copilot 走 map 前
  // 标题规则（见上方 cline / copilot 规则），此处不建 github.com 键；
  // Cursor 与 Tongyi Lingma 为旧键原地替换值（热链 → 本地路径）。
  // Cursor 仍走既有 isCursorSite 渲染分支（title/url 判定，与 map 值无关，
  // 落盘后渲染仍带 bg-muted/40 底色处理，复审截图核对）。
  // 2026-11-17（图标 B 类 B2a）：Beatoven.ai / Sudowrite 新建键。
  // R1 裁决：这两站 navigation.json 的 icon 为远程热链且不触发拦截，
  // customIcon 优先于 map，单加 map 键不可达——已同步清空两站 icon 字段。
  'beatoven.ai=beatovenp',
  'sudowrite.com=sudowritep',
  // 2026-11-17（图标 B 类第 4 批 B2b）
  // klingai.com / hailuoai.com 为替换旧键（旧值热链 ICO）；runway.com 为
  // 新建键（旧键 runwayml.com 为死键，全库无站命中，不动；兄弟键
  // klingai.kuaishou.com 全库无站命中，不动）。
  'runway.com=runwayp',
  // 2026-11-17（B 类第 5 批之 B3a：Luma AI / Radix UI / Notion / freeCodeCamp）：
  // 4 站热链本地化。lumalabs.ai / radix-ui.com / notion.com 为原地替换旧值
  //（旧值均为远程热链，勿重复建键）；freecodecamp.org 为新键（须与
  // navigation.json.patch 同提交删 icon 行，否则 customIcon 截胡，见 R1）。
  // Radix 为近黑标（fill #1C2024，透明底），与 Ollama / SourceHut 同款处理：
  // 只加普通 map 条目，不做白底色块；深色模式黑标对比度弱是已知局限，
  // 留待深色底块统一处理轮。
  'freecodecamp.org=freecodecampp',
  // 2026-11-17（图标 B 类第 3 批 b3b）：少数派 / 拼多多 / 微信，本地化。
  // sspai.com、pinduoduo.com 为旧键原地替换值（上方已改，勿重复建键）；
  // weixin.qq.com 为新键（微信 icon 已同步清空，见 navigation-icon-clear-b3b.patch，
  // 仅改这一行）。少数派/拼多多的 customIcon 均为 …/favicon.ico，会被
  // isRemoteRawFavicon 拦截后回落 map，无需清空。
  'weixin.qq.com=weixinp',
  // 2026-11-18（C 类第 1 批 c1g1）：Perplexity / Hugging Face / Suno / ElevenLabs。
  // 4 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。Midjourney 阻塞未落盘（见批次笔记），无条目。
  'perplexity.ai=perplexitys',
  'huggingface.co=huggingfacep',
  'suno.com=sunop',
  'elevenlabs.io=elevenlabss',
  // 2026-11-18（C 类第 1 批 c1g2）：智谱清言 / 讯飞星火 / n8n。
  // 3 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。GitHub 走下方标题规则，不建 'github.com' 键。
  'chatglm.cn=zhipup',
  'xinghuo.xfyun.cn=xinghuop',
  'n8n.io=n8np',
  // 2026-11-18（C 类第 1 批 c1g3）：淘宝 / 京东 / 抖音 / 快手 / 哔哩哔哩。
  // 5 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。京东取帧提醒：ICO 最大帧为第 7 帧 48×48 32bpp，
  // PIL 默认帧是 4bpp 抖动帧，复核不要用 PIL 默认帧。
  'taobao.com=taobaop',
  'jd.com=jdp',
  'douyin.com=douyinp',
  'kuaishou.com=kuaishoup',
  'bilibili.com=bilibilip',
  // 2026-11-18（C 类第 1 批 c1g4：办公 + 内容社区）：飞书 / Stack Overflow / 知乎 / 豆瓣 / 小红书。
  // 5 站 icon 均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。
  'feishu.cn=feishup',
  'stackoverflow.com=stackoverflowp',
  'zhihu.com=zhihup',
  'douban.com=doubanp',
  'xiaohongshu.com=xiaohongshup',
  // 2026-11-18（C 类第 1 批 Trae 补救）：Trae。
  // icon 为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，map 生效，
  // navigation.json 不动。源为 docs.trae.ai 首页声明的 shortcut icon
  //（trae.cn 地域墙 403，见批次笔记）；trae.ai 不在站内，不加键。
  'trae.cn=traep',
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
  'so.qq.com=yuanbaop',
  'metaso.cn=metasop',
  'tiangong.cn=tiangongp',
  'pika.art=pikas',
  'viggle.ai=viggles',
  'genmo.ai=genmop',
  'vidu.cn=vidus',
  'krea.ai=kreap',
  'deepdreamgenerator.com=deepdreamgeneratorp',
  'remove.bg=removebgp',
  'modelscope.cn=modelscopep',
  'paddlepaddle.org.cn=paddlepaddlep',
  'stability.ai=stabilityp',
  'mistral.ai=mistrals',
  'dev.meta.ai=meta-aip',
  'moark.com=moarkp',
  'flowiseai.com=flowisep',
  'apify.com=apifys',
  'devin.ai=devins',
  'topview.ai=topviewp',
  // 2026-11-19（C 类第 3 批 C3）：Jasper / Copy.ai / Writesonic / Grammarly /
  // 秘塔写作猫 / Wordtune / Baidu Comate / Continue.dev / 讯飞开放平台 /
  // Udio / Soundraw / AIVA / Boomy / Mubert / Loudly / Murf AI /
  // Speechify / WellSaid / NaturalReader / 魔音工坊。
  // 20 站 icon 字段均含 favicon（远端 …/favicon.ico、…/favicon.png 或
  // CDN …_favicon.png / …_favicon.ico），被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'xfyun.cn'（讯飞开放平台）与已有
  // 'xinghuo.xfyun.cn'（讯飞星火）互不干扰：精确查找先命中各自键。
  // 'comate.baidu.com' 用完整子域建键，不建 'baidu.com' 键。
  'jasper.ai=jasperp',
  'copy.ai=copy-aip',
  'writesonic.com=writesonics',
  'grammarly.com=grammarlyp',
  'xiezuocat.com=xiezuocatp',
  'wordtune.com=wordtunep',
  'comate.baidu.com=comatep',
  'continue.dev=continuep',
  'xfyun.cn=xfyunp',
  'udio.com=udiop',
  'soundraw.io=soundrawp',
  'aiva.ai=aivap',
  'boomy.com=boomyp',
  'mubert.com=mubertp',
  'loudly.com=loudlyp',
  'murf.ai=murfp',
  'speechify.com=speechifyp',
  'wellsaid.io=wellsaidp',
  'naturalreaders.com=naturalreaderp',
  'moyin.com=moyinp',
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
  // 全库 383 站核对：本批 19 个 map 键各只命中 1 站，无后缀串站
  // （Gitee AI 的 href 是 moark.com，不在 gitee.com 名下）。
  // Java 官方文档：站方 favicon 即红色 Oracle 椭圆 O 标（120×120），
  // 不是 Java 咖啡杯；按“官网在用图标”原样接线，未擅自换标，只记录。
  // ISO/IEC 标准：iso.svg 为白字透明底（fill 仅 #fff，无底色），
  // 浅色主题下不可见；红色底块须用 ISO 品牌红，但 iso.org 站点头色
  // 未能核实具体色值（www.iso.org curl 空回复、官方品牌页无 hex、
  // 候选 #D22630 经查是 Saudi Aramco 的 SA Red、与 ISO 无关），
  // 故本次不加底块分支、不猜 hex，记为未决点，见 C4 测试事实钉死。
  'gitee.com=giteep',
  'gitlab.com=gitlabp',
  'gitcode.com=gitcodep',
  'codeup.aliyun.com=codeupp',
  'bitbucket.org=bitbucketp',
  'juejin.cn=juejinp',
  'csdn.net=csdnp',
  'leetcode.cn=leetcode-cnp',
  'nowcoder.com=nowcoderp',
  'luogu.com.cn=luogup',
  'codeforces.com=codeforcesp',
  'atcoder.jp=atcoderp',
  'leetcode.com=leetcodep',
  'developer.mozilla.org=mdns',
  'docs.oracle.com=java-docsp',
  'w3.org=w3cs',
  'iso.org=isos',
  'roadmap.sh=roadmapp',
  'ui.shadcn.com=shadcnp',
  // 2026-11-19（C 类第 5 批 C5）：Bun / Node.js / Python / Rust / Go /
  // Java / Drizzle ORM / MySQL / PostgreSQL / Redis / MongoDB / Fastify /
  // Express / NestJS / Laravel / Django / Docker Hub / Podman / Compose /
  // Terraform。
  // 20 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 子域站用完整 hostname 建键，不建裸域键：'orm.drizzle.team'、
  // 'hub.docker.com'、'docs.docker.com'、'developer.hashicorp.com'。
  // 全库 383 站核对：本批 20 个 map 键各只命中 1 站，无后缀串站。
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
  'bun.sh=buns',
  'nodejs.org=nodejsp',
  'python.org=pythonp',
  'rust-lang.org=rusts',
  'go.dev=gos',
  'java.com=javap',
  'orm.drizzle.team=drizzlep',
  'mysql.com=mysqlp',
  'postgresql.org=postgresqlp',
  'redis.io=redisp',
  'mongodb.com=mongodbp',
  'fastify.dev=fastifys',
  'expressjs.com=expresss',
  'nestjs.com=nestjss',
  'laravel.com=laravelp',
  'djangoproject.com=djangop',
  'hub.docker.com=docker-hubp',
  'podman.io=podmanp',
  'docs.docker.com=composep',
  'developer.hashicorp.com=terraforms',
  // 2026-11-19（C 类第 6 批 C6）：天猫 / 唯品会 / 苏宁易购 / 1688 /
  // 支付宝 / 全球速卖通 / Temu / SHEIN / eBay / Shopify / 百度地图 /
  // 铁路 12306 / 高德地图 / 携程旅行 / 滴滴出行 / 大众点评 / 顺丰速运 /
  // 圆通速递 / 微博（亚马逊不进 map，见下方 '亚马逊' 标题规则）。
  // 20 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 子域站用完整 hostname 建键，不建裸域键：'map.baidu.com'。
  // 全库 383 站核对：本批 19 个 map 键各只命中 1 站，无后缀串站。
  // 支付宝：落盘 alipay.png 为首页 shortcut icon 的 2600×1950 官方“支”字标
  // 裁透明边距后缩至 128×109（原样，未改画）；同一首页另有 32px 蓝底白“支”
  // ICO 方标（备选）未采用，待复审裁决，见 C6 测试事实钉死。
  // 唯品会 / 全球速卖通 / 携程旅行：官网只有 16px 单帧 favicon，按规范
  // §1.1 原样落盘 16×16、绝不放大；是否接受待裁决，见 C6 测试事实钉死。
  'tmall.com=tmallp',
  'vip.com=vipp',
  'suning.com=suningp',
  '1688.com=1688p',
  'alipay.com=alipayp',
  'aliexpress.com=aliexpressp',
  'temu.com=temup',
  'shein.com=sheinp',
  'ebay.com=ebayp',
  'shopify.com=shopifyp',
  'map.baidu.com=baidumapp',
  '12306.cn=12306p',
  'amap.com=amapp',
  'ctrip.com=ctripp',
  'didiglobal.com=didip',
  'dianping.com=dianpingp',
  'sf-express.com=sf-expressp',
  'yto.net.cn=ytop',
  'weibo.com=weibop',
  // 2026-11-19（C 类第 8 批 C8）：石墨文档 / 语雀 / Obsidian / AppFlowy /
  // AFFiNE / 思源笔记 / Excalidraw / XMind / MindManager / ProcessOn /
  // GitMind / tldraw / Draw.io / Miro / Khan Academy / Skillshare /
  // 慕课网 / 学习强国 / 菜鸟教程。19/20 站，网易云课堂阻塞未入（见下）。
  // 19 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 子域站用完整 hostname 建键：'app.diagrams.net'（Draw.io）；
  // 'b3log.org' 键只命中思源笔记一站（href 为 b3log.org/siyuan，
  // 全库 383 站核对无其他 b3log.org 站）；其余 17 键各只命中 1 站，
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
  'shimo.im=shimop',
  'yuque.com=yuquep',
  'obsidian.md=obsidians',
  'appflowy.com=appflowyp',
  'affine.pro=affinep',
  'b3log.org=siyuanp',
  'excalidraw.com=excalidrawp',
  'xmind.cn=xminds',
  'mindmanager.com=mindmanagerp',
  'processon.com=processonp',
  'gitmind.com=gitmindp',
  'tldraw.com=tldraws',
  'app.diagrams.net=diagramsp',
  'miro.com=mirop',
  'khanacademy.org=khanacademyp',
  'skillshare.com=skillsharep',
  'imooc.com=imoocp',
  'xuexi.cn=xuexip',
  'runoob.com=runoobp',
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
  // 全库 383 站核对：本批 10 个 map 键各只命中 1 站，无后缀串站。
  // 6 站为 16×16 原样小图（huatu / zhipin / lagou；另 3 站走标题规则，
  // 见下方），按规范 §1.1 原样落盘、绝不放大，卡片上显小是合规状态。
  'fenbi.com=fenbip',
  'huatu.com=huatup',
  'koolearn.com=koolearnp',
  'zhipin.com=zhipinp',
  'lagou.com=lagoup',
  '51job.com=51jobp',
  'liepin.com=liepinp',
  '500d.me=500dp',
  'codecademy.com=codecademyp',
  'zh.wikipedia.org=wikipediap',
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
  // 主站占用）。全库 383 站核对：本批 16 个 map 键各只命中 1 站，
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
  'arxiv.org=arxivp',
  'cnki.net=cnkis',
  'wanfangdata.com.cn=wanfangp',
  'webofscience.com=webofsciencep',
  'semanticscholar.org=semanticscholarp',
  'ieeexplore.ieee.org=ieeep',
  'jstor.org=jstorp',
  'nlc.cn=nlcp',
  '36kr.com=36krp',
  'huxiu.com=huxiup',
  'ifanr.com=ifanrp',
  'canva.com=canvap',
  'creativemarket.com=creativemarketp',
  'sketch.com=sketchp',
  'penpot.app=penpotp',
  'pixso.cn=pixsop',
  // 2026-11-19（C 类第 11 批 C11，17/20）：Mixkit / Storyblocks / iStock /
  // Pinterest / Awwwards / Mobbin / Iconify / Dafont / Lucide / Uiverse /
  // Chakra UI / npmmirror / Turbo / 中国天气网 / 生态环境部 /
  // 全国排污许可证管理信息平台 / AWS WAF。
  // 3 站阻塞未入：Pexels / Pixabay（403 Cloudflare 机器人墙）、
  // SiteInspire（429 Vercel 检查点），本次不接线、不放占位图。
  // 17 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 全库 383 站核对：本批 17 个 map 键各只命中 1 站，无后缀串站。
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
  'mixkit.co=mixkitp',
  'storyblocks.com=storyblocksp',
  'istockphoto.com=istockphotop',
  'pinterest.com=pinterests',
  'awwwards.com=awwwardss',
  'mobbin.com=mobbins',
  'iconify.design=iconifys',
  'dafont.com=dafontp',
  'lucide.dev=lucidep',
  'uiverse.io=uiversep',
  'chakra-ui.com=chakra-uip',
  'registry.npmmirror.com=npmmirrorp',
  'turborepo.dev=turborepop',
  'weather.com.cn=weatherp',
  'mee.gov.cn=meep',
  'permit.mee.gov.cn=permit-meep',
  'aws.amazon.com=aws-wafs',
  // 2026-11-19（C 类第 12 批 C12，17/20）：国家信访局 / 国家税务局 /
  // 国家林业和草原局 / Soul / 积目 / 百合网 / 世纪佳缘 / Akamai /
  // F5 Networks / Imperva / Ansible Collaborative / Alibaba Cloud /
  // Qiniu Cloud / 腾讯云 / 华为云 / Coolify。国家网信办举报中心 /
  // 公安部 / 伊对阻塞未入（见 C12 测试事实钉死）；中国政府网不进
  // map（见上方 '中国政府网' 标题规则，'gov.cn' 键绝不加）。
  // 17 站 icon 字段均为远端 …/favicon.ico（含 Ansible 的错域
  // ansible.com/favicon.ico 与 Akamai 的 akamai.com/favicon.ico），
  // 被 isRemoteRawFavicon 拦截，map 生效，navigation.json 不动。
  // 'github.com' / 'adobe.com' 键绝不加。子域站用完整 hostname 建键：
  // 'cloud.tencent.com'（腾讯云，不建 'tencent.com' 裸域键）。
  // 全库 383 站核对：本批 16 个 map 键中 14 个各只命中 1 站；
  // 'aliyun.com' 命中 4 站但其 3 个子域站（通义千问 qianwen /
  // Tongyi Lingma lingma / Codeup codeup）各有精确键先行命中，
  // 故只剩 Alibaba Cloud 一站落到本键，无后缀串站；'redhat.com'
  // 全库仅命中 Ansible Collaborative 一站（无 Red Hat 主站）。
  // Ansible 落盘为页面 favicon 即 Red Hat 红帽标（48×48），保留或
  // 改用宽版 lockup SVG / Ansible “A” 单标待复审裁决，见 C12 测试
  // 事实钉死，本轮按设计原样接线、不擅自换图。chinatax.png 98,842 B
  //（967×217 宽版页眉标原样）与 forestry.jpg 21,108 B（58×53 JPEG
  // 原样）均超光栅单站 ~15 KB 参考线，按原样接线、待复审裁决
  // （接受原样或无损压缩、尺寸须保持），见 C12 测试事实钉死。
  // gov.png / baihe.png / jiayuan.png 为 16×16 原样小图（无更大官方
  // 方标），按规范 §1.1 原样保留、绝不放大。
  'gjxfj.gov.cn=gjxfjp',
  'chinatax.gov.cn=chinataxp',
  'forestry.gov.cn=forestryj',
  'soulapp.cn=soulp',
  'jimoapp.com=jimop',
  'baihe.com=baihep',
  'jiayuan.com=jiayuanp',
  'akamai.com=akamaip',
  'f5.com=f5p',
  'imperva.com=impervap',
  'redhat.com=ansible-collaborativep',
  'aliyun.com=aliyunp',
  'qiniu.com=qiniup',
  'cloud.tencent.com=tencent-cloudp',
  'huaweicloud.com=huaweicloudp',
  'coolify.io=coolifyp',
  // 2026-11-19（C 类第 13 批 C13，尾巴 1 站）：Zeabur。
  // 站 icon 字段为远端 https://zeabur.com/favicon.svg，被
  // isRemoteRawFavicon 拦截（pathname '/favicon.svg'），map 生效，
  // navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 全库 383 站核对：'zeabur.com' 键只命中 Zeabur 一站，无后缀串站。
  // 落盘 zeabur.svg 为官网声明的浅色 favicon /logo.svg 原样
  // （370 B，viewBox 0 0 32 32，三色 #19181B / #6300FF / #EE430E，
  // 见 C13 测试事实钉死）。深色变体 /logo-dark.svg（368 B，仅黑
  // 元素改为白色）未另行落盘：按统一规范 §9，只落默认浅色标、
  // 不做单站补丁，深色底块问题留待统一处理轮；接线/复审如需
  // 定夺深色变体，请裁决（见 C13 测试事实钉死）。
  'zeabur.com=zeaburs',
  // 2026-11-20（C 类第 13 批 C13 续，尾巴 1 站）：Midjourney。
  // 原属 C1 清单，当时被 Cloudflare 墙阻塞未入；设计经 Wayback 路线
  // 取回后解堵（staging specials/midjourney.png，128×128、9,084 B，
  // SHA-1 与 CDX 摘要一致，md5 685a01a27d7876273584052dd06f846e）。
  // 站 icon 字段为远端 https://midjourney.com/favicon.ico，被
  // isRemoteRawFavicon 拦截（pathname '/favicon.ico'），map 生效，
  // navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 全库 383 站核对：'midjourney.com' 键只命中 Midjourney 一站，
  // 无后缀串站、无子域站。落盘为白底不透明 PNG 原样（128×128，
  // 全图不透明像素 16,384/16,384，深色帆船标 bbox x18–109 y19–96），
  // 浅/深主题下均显白底方块，无底块（resolveLogoTile 为 null），
  // 不做单站补丁，留待统一处理轮。
  'midjourney.com=midjourneyp',
  // 2026-11-20（U-08 补站 Rancher）：站方 favicon.ico 为 0 B 不可用，
  // 站 icon 字段用站方 head 自声明的 favicon.png，被 isRemoteRawFavicon
  // 拦截后回落 map；品牌标为 Simple Icons 原样 SVG（1,337 B，fill
  // #0075A8，<title>Rancher</title>，与 CDN 内容 md5 一致）。
  // 全库 383 站核对：'rancher.com' 键只命中 Rancher 一站，无后缀串站。
  // 深色下品牌蓝偏暗，按统一规范 §9 不做单站补丁、不配底块，留待统一处理轮。
  'rancher.com=ranchers',
  // 2026-11-20（U-253 补站 Portainer）：站方 favicon.ico / favicon.svg / apple-touch-icon.png 均为 404，
  // head icon 为内联 data URI 不可用；导航条目省略 icon 字段，解析走 map；品牌标为 Simple Icons 原样 SVG（1,043 B，fill
  // #13BEF9，<title>Portainer</title>，与 CDN 内容 md5 一致）。
  // 全库 383 站核对：'portainer.io' 键只命中 Portainer 一站，无后缀串站。
  // 品牌色 #13BEF9 明亮，无需底块（resolveLogoTile 为 null），不做单站补丁。
  'portainer.io=portainers',
  // 2026-11-20（U-254 补站 Nomad）：站方 favicon.ico 实为跳转目标页 HTML 不可用，
  // developer.hashicorp.com 的 favicon 是通用 HashiCorp 标、非 Nomad 专属；导航条目省略 icon 字段，解析走 map；
  // 品牌标为 Simple Icons 原样 SVG（277 B，fill #00CA8E，<title>Nomad</title>，与 CDN 内容 md5 一致）。
  // 全库 383 站核对：'nomadproject.io' 键只命中 Nomad 一站，无后缀串站。
  // 注意：切勿把 href 改成 developer.hashicorp.com/nomad——该 hostname 的 map 键已被 Terraform 占用
  // （['developer.hashicorp.com', 'terraform.svg']），改 href 会让 Nomad 错指 terraform.svg。
  // 品牌绿 #00CA8E 明亮，无需底块（resolveLogoTile 为 null），不做单站补丁。
  'nomadproject.io=nomads',
  // 2026-11-20（U-08 补站 OpenShift）：站方 favicon.ico 实为 cloud.redhat.com/favicon.ico
  //（Red Hat 通用站标、非 OpenShift 专属），不可用；导航条目省略 icon 字段，解析走 map；
  // 品牌标为 Simple Icons 原样 SVG（1,046 B，fill #EE0000，<title>Red Hat Open Shift</title>，
  // 与 CDN 内容 md5 一致；注意 Simple Icons 的 slug 是 redhatopenshift，openshift 会 404）。
  // 全库 383 站核对：'openshift.com' 键只命中 OpenShift 一站，无后缀串站。
  // 注意：切勿把 href 改成 www.redhat.com/en/technologies/cloud-computing/openshift——该 hostname
  // 的 map 键已被 Ansible Collaborative 占用（['redhat.com', 'ansible-collaborative.png']），
  // 改 href 会让 OpenShift 错指 ansible-collaborative.png。
  // 品牌红 #EE0000 明亮，无需底块（resolveLogoTile 为 null），不做单站补丁。
  'openshift.com=openshifts',
  // 2026-11-20（U-08 补站 彩云天气）：站方 favicon.ico 内容实为 PNG 190×190
  // （7,165 B，md5 1452fa082142f0db9dff9a9ad7ea27a9，白圆角底 + 橙绿渐变云标，
  // 四角透明），原样落盘 caiyun.png；导航条目 icon 字段写远端 favicon.ico，
  // 被 isRemoteRawFavicon 拦截后走 map。href 用 /weather（在线天气查询入口，
  // 302 至 h5.caiyunapp.com，200、301,616 B，标题「彩云天气」），不用公司
  // 首页 www.caiyunapp.com/（标题「彩云科技」，非天气页）。
  // 全库 383 站核对：'caiyunapp.com' 键只命中 彩云天气 一站，无后缀串站。
  // 云标彩色明亮、无需底块（resolveLogoTile 为 null），不做单站补丁。
  'caiyunapp.com=caiyunp',
  // 2026-11-20（U-08 补站 Microsoft Learn）：站方 favicon.ico 为 6 尺寸 ICO，
  // 最大 128×128 帧（微软四色方块标 #F25022/#7FBA00/#00A4EF/#FFB900，间隙透明），
  // PIL 转 RGBA PNG 原样落盘 microsoft-learn.png（426 B，md5
  // b61c4227f5dcd0ed5368ea1ab8a42ad6）；按「官网在用图标」原样接线（仿 Java
  // 官方文档的 Oracle 红 O 标先例），未擅自换成 Learn 专属标。导航条目 icon
  // 字段写远端 favicon.ico，被 isRemoteRawFavicon 拦截后走 map；键用完整
  // hostname 'learn.microsoft.com'（不建 'microsoft.com' 裸域键，防后缀串站）。
  // 全库 383 站核对：'learn.microsoft.com' 键只命中 Microsoft Learn 一站，无后缀串站。
  // 四色方块明亮、无需底块（resolveLogoTile 为 null），不做单站补丁。
  'learn.microsoft.com=microsoft-learnp',
  // 2026-11-20（C 类第 7 批 C7，W1 视频组 1：爱奇艺 / 腾讯视频 / 优酷）。
  // 3 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 来源（2026-11-20 15:01 CST 实测，Chrome UA，见 C7-W1 测试事实钉死）：
  // 爱奇艺首页声明 //www.iqiyi.com/favicon.ico，200、32,038 B、
  // image/x-icon，ICO 4 帧（16/32/48/64），最大 64×64 帧 PIL 转 RGBA
  // PNG 原样落盘 iqiyi.png（7,036 B，绿底白字 iQIYI 爱奇艺标）；
  // 腾讯视频首页声明 //v.qq.com/favicon.ico，200、4,286 B、
  // image/x-icon，ICO 单帧 32×32 转 PNG 原样 tencent-video.png
  // （915 B，蓝绿橙三色播放三角标）；优酷首页无 icon 声明，根
  // /favicon.ico 直链 200、9,662 B、image/vnd.microsoft.icon，ICO
  // 单帧 48×48 转 PNG 原样 youku.png（1,904 B，蓝底 YOUKU 优酷标，
  // 首页无声明、favicon 直链可用即落地，仿 C8 学习强国先例）。
  // 全库 383 站核对：'iqiyi.com' / 'youku.com' 各只命中一站；
  // 'v.qq.com' 用完整 hostname 建键（不建 'qq.com' 裸域键）：
  // so.qq.com（元宝搜索 yuanbao.png）、docs.qq.com（腾讯文档）、
  // weixin.qq.com（微信）各有精确键，不受影响。3 站均 <128 原样
  // 保留、绝不放大；均 ≤15 KB。优酷蓝底方块在浅/深主题下均显蓝底，
  // 不做单站补丁，留待统一处理轮。
  'iqiyi.com=iqiyip',
  'v.qq.com=tencent-videop',
  'youku.com=youkup',
  // 2026-11-20（C 类第 7 批 C7 补批 W2，视频组 2，3 站）：芒果TV /
  // 咪咕视频·短剧 / 央视频。3 站 icon 字段均为远端 …/favicon.ico，
  // 被 isRemoteRawFavicon 拦截，map 生效，navigation.json 不动。
  // 全库 383 站核对：3 个 map 键各只命中 1 站，无后缀串站。
  // 芒果TV：首页声明的 shortcut icon
  // static.hitv.com/pc/icons/icon_64x64.1b7ca7.png（64×64 PNG，
  // 3,383 B，md5 1871e528cd65055d306a2f20e945eb63），橙底圆角方块 +
  // 白色 M 标原样；根 /favicon.ico 另有 32×32 橙色描边 M 标
  // （4,286 B），本轮选用首页声明的 64×64 完整应用标（仿 C12
  // Imperva / Coolify“首页声明的最大尺寸 icon”先例），见 C7W2
  // 测试事实钉死。咪咕视频·短剧：以 href 域名 cmread.com 为准
  // （计划 §C7 备注：icon 字段域名 miguvideo.com 与 href 域名不
  // 一致，以 href 域名官网为准；'miguvideo.com' 键绝不加）；源为
  // cmread 声明的 favicon.png
  // https://www.cmread.com/wenxueinterface/images/favicon.png
  // （内容实为 ICO 32×32，4,286 B，解码落 PNG，1,181 B，md5
  // ceb642a6715d5d790f4d5ae07a731341），蓝色 #2E6DED 单色字标原样；
  // miguvideo.com/favicon.ico（48×48 红蓝 M 标）仅作交叉核对、未
  // 采用；同页另声明的 logo-mark.svg（19.16×28 竖版页眉 logo
  // mark）未采用——以 favicon 为准，见调查报告 §5 与 C7W2 测试
  // 事实钉死。央视频：首页为 177 B meta-refresh 跳转页、无 icon
  // 声明（link rel="icon" href="data:,"），根 /favicon.ico 直链
  // 200 可用（48×48 ICO，9,662 B，解码落 PNG，2,220 B，md5
  // b32d9387e7d784e1a317d6d41a9d53ab），红底 #D60010 + 白色央视
  // 花标原样；仿 C8 学习强国“首页无声明、favicon 直链可用即落地”
  // 先例。键用完整 hostname 'm.yangshipin.cn'（www 剥离不适用于
  // m. 子域；不建 'yangshipin.cn' 裸域键）。无底块：mgtv 不透明橙
  // 方块、yangshipin 全图不透明红底、cmread 蓝 #2E6DED 在浅/深主
  // 题下均可见，resolveLogoTile 均为 null，不做单站补丁。
  'mgtv.com=mgtvp',
  'cmread.com=cmreadp',
  'm.yangshipin.cn=yangshipinp',
  // 2026-11-20（C 类第 7 批 C7 补批 W3，2/2）：DramaBox / DramaWave。
  // 2 站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 全库 383 站核对：2 个 map 键各只命中 1 站，无后缀串站。
  // DramaBox 来源：首页声明的 /favicon.ico（200，1,393 B，32×32 ICO
  // 内含 PNG）与页眉官方标 logo.png（176×176）为同一粉红 D-play 标，
  // 取 176 源 LANCZOS 缩至 128×128 落盘（m-logo.png 362×80 为宽版
  // wordmark，不作 tile）。DramaWave 来源：首页 JS 默认 icon
  // '/dramawave.ico'（与 /favicon.ico md5 相同，200，4,286 B，32×32）
  // 与 apple-touch-icon '/Logo.png'（512×512）为同一品红渐变 D-play
  // 标（32px 小图初看易误读为 W，4 倍放大核对确为 D-play 标，与
  // Logo.png 一致），取 512 源 LANCZOS 缩至 128×128 落盘。
  // dramabox.png 15,595 B 略超光栅单站 ~15 KB 参考线（235 B），按原样
  // 接线、字节数钉死，见 C7W3 测试事实钉死（C12 chinatax/forestry
  // 超线原样先例）。两标均为不透明渐变底，深/浅主题均可辨，不进
  // LOGO_TILE_MAP。
  'dramaboxdb.com=dramaboxp',
  'mydramawave.com=dramawavep',
  // 2026-11-20（C 类第 7 批 C7 补批 W4，小说组 1，2/20）：起点中文网 /
  // 晋江文学城。C7 原“安全原因暂缓”经 2026-11-20 调查证实只是 W4 一份
  // 报告被安全系统移除，无任何一站涉及安全/侵权/版权/合规（见
  // icon-c7-defer-reason-2026-11-20.md §5）；两站官网/favicon 本轮实测
  // 均可取。两站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon
  // 拦截，map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键
  // 绝不加。全库 383 站核对：'qidian.com' / 'jjwxc.net' 各只命中一站，
  // 无后缀串站。起点：首页 202（209 B 反爬挑战页，不影响取标，仿 C8
  // 慕课网/可汗学院先例），favicon.ico 直链 200（4,286 B，image/x-icon，
  // 单帧 ICO 32×32 32bpp），Pillow 转 RGBA PNG 原样落盘 qidian.png
  // （1,547 B，红底白字“起点中文网”标，主红 #f02737/#e50517）。
  // 晋江：首页 200（71,944 B），favicon.ico 直链 200（2,038 B，
  // image/x-icon，ICO 双帧均为 16×16），Pillow 默认解码转 RGBA PNG 原样
  // 落盘 jjwxc.png（485 B，绿底白字“晋江文学城”标，主绿 #275f15）；
  // 16×16 原尺寸按规范 §1.1 原样保留、绝不放大（仿 C12 百合网/世纪佳缘
  // 16px 原样先例），卡片内显小是已知特性。两标浅/深主题均彩色可辨，
  // 无需底块（resolveLogoTile 为 null），不做单站补丁。
  'qidian.com=qidianp',
  'jjwxc.net=jjwxcp',
  // 2026-11-20（C 类第 7 批 C7 补批 W5，小说组 2：纵横中文网 / 飞卢小说网）。
  // C7 暂缓“安全原因”经调查只是 W4 报告被安全系统移除，无任何一站涉及
  // 安全/侵权/版权/合规（见 icon-c7-defer-reason-2026-11-20.md §5）。
  // 两站 icon 字段均为远端 …/favicon.ico，被 isRemoteRawFavicon 拦截，
  // map 生效，navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 全库 383 站核对：'zongheng.com' / 'faloo.com' 各只命中一站，无后缀串站。
  // 纵横：首页声明 rel="icon" href="/favicon.ico"，内容实为 PNG 16×16
  // （742 B，md5 5c2a43cd336a629e5852d2f9e8f21bde），按内容解码原样落盘
  // zongheng.png，红底白字纵横标；16px 原样不放大（C6 唯品会/速卖通/
  // 携程仅 16px 已接受原样，有先例），卡片内显小是已知特性。
  // 飞卢：首页声明 rel="shortcut icon" href="//s.faloo.com/novel/favicon.ico"，
  // 与根 /favicon.ico md5 相同（c4f3df9dec223473188a362ae250ba41），单帧
  // 48×48 32bpp ICO，Pillow 转 PNG 原样落盘 faloo.png（3,708 B），
  // 绿底白字“飞卢”书法标。两标均为官网在用标原样，无占位、无通用标冒充。
  'zongheng.com=zonghengp',
  'faloo.com=faloop',
  // 2026-11-20（C 类第 7 批 C7 补批 W7，影视评分组 2 站）：IMDb / Letterboxd。
  // C7 暂缓的“安全原因”经调查只是 W4 一份报告被安全系统移除，无任何一站
  // 涉及安全/侵权/版权/合规（见 icon-c7-defer-reason-2026-11-20.md）。
  // IMDb：首页 202、0 B（疑似反爬挑战页），favicon 直链 200，内容实为 PNG
  // 32×32（497 B，md5 a00f507810e886fe683c705a0582cdb2），黄底 #F5C518 +
  // 黑字 IMDb 标原样落盘 imdb.png。Letterboxd：首页 403 Cloudflare 验证墙
  // （Just a moment…），favicon 直链 200，3 帧 ICO（16/32/64，22,382 B），
  // 取最大 64×64 帧转 PNG 原样落盘 letterboxd.png（2,101 B，md5
  // 5d8c7b3af905a4b820b27c23fa30b57f；深 slate #445566 圆底 + 橙/绿/蓝三色
  // 圆标，四角透明）。两站 icon 字段均为远端 …/favicon.ico，被
  // isRemoteRawFavicon 拦截后走 map，navigation.json 不动。
  // 'github.com' / 'adobe.com' 键绝不加。全库 383 站核对：'imdb.com' /
  // 'letterboxd.com' 各只命中 1 站，无后缀串站、无子域站。两标在浅/深主题
  // 下均可辨识（IMDb 不透明黄底方块；Letterboxd 深 slate 底 + 亮色圆标），
  // 按统一规范 §9 不做单站底块补丁、不配 LOGO_TILE_MAP，留待统一处理轮。
  'imdb.com=imdbp',
  'letterboxd.com=letterboxdp',
  // 2026-11-20（C 类第 7 批 C7 补批，W8 单站）：Coursera。
  // 站 icon 字段为远端 https://coursera.org/favicon.ico，被
  // isRemoteRawFavicon 拦截（pathname '/favicon.ico'），map 生效，
  // navigation.json 不动。'github.com' / 'adobe.com' 键绝不加。
  // 全库 383 站核对：'coursera.org' 键只命中 Coursera 一站，无后缀串站、
  // 无子域站。落盘 coursera.png 为官网首页声明的最大尺寸 favicon
  // favicon-v2-194x194.png（15,476 B，md5
  // 7169eafb412bf2df21fd61a482a2c136，CloudFront 直链）经 Pillow
  // LANCZOS 只缩小至 128×128（9,529 B）；根 /favicon.ico 最大帧仅
  // 48×48 未用。蓝 #0056D2 主色 + 白字镂空、四角透明，浅/深两主题下
  // 均可见，无底块（resolveLogoTile 为 null），不做单站补丁，留待
  // 统一处理轮。
  'coursera.org=courserap',
  // 2026-11-20（C 类第 7 批 C7，worker W9，七猫中文网 1 站）。
  // 全库唯一既无 icon 字段又无映射的站（见 icon-c-plan §C7 备注）；
  // 导航条目省略 icon 字段，解析走 map，navigation.json 不动。
  // 来源：站点头部 Logo https://cdn-front.qimao.com/qimao/pc/img/header/logo.d026f02.png
  // （200、image/png、4,072 B、380×88，PNG 魔数已验；curl 空回复为反爬，
  // 浏览器直读正常；站根 /favicon.ico 仅 1×1 占位图，不可用）。
  // Logo 为 380×88 横版图文，按品牌图标惯例只取左侧猫剪影方标：
  // 品牌黄 #FCC800 圆角方块 x0–87 y0–87（88×88，黑猫“7”形剪影 +
  // 黄眼睛 + 胡须），文字“七猫中文网”不硬塞；88 < 128 按规范 §1.1
  // 原样保留、不放大，落盘 qimao.png（1,761 B，md5
  // 7807f1b332c4b34d80af2f6182d09c6f）。U-333“死链”判定应修正为
  // 不计死链（见 W9 测试事实钉死）。'github.com' / 'adobe.com' 键
  // 绝不加。全库 383 站核对：'qimao.com' 键只命中七猫中文网一站，
  // 无后缀串站、无子域站。黄底不透明、黑猫醒目，浅/深主题均可见，
  // 无需底块（resolveLogoTile 为 null），不做单站补丁。
  'qimao.com=qimaop',
  // 2026-11-20（C 类第 7 批 C7 补批 W10，猫眼电影 1 站）。
  // C7 暂缓的“安全原因”经调查只是 W4 一份报告被安全系统移除，无任何一站
  // 涉及安全/侵权/版权/合规（见 icon-c7-defer-reason-2026-11-20.md）。
  // m 站 favicon 直链 200，image/x-icon，67,646 B，单帧 128×128 32 位
  // DIB（ICO 魔数 00 00 01 00），转 RGBA PNG 原样落盘 maoyan.png
  // （9,080 B，md5 5789648065fa2e8d7f8a19892c1a03c8）；红圆底 #E5342A
  // + 白猫脸 #F5F5F5，四角透明，像素采样目视确认与官网标一致。
  // www.maoyan.com/favicon.ico 本身打不开（curl -L 50 次重定向未收敛），
  // 必须用 m 站地址；导航条目 icon 字段为远端 favicon.ico，被
  // isRemoteRawFavicon 拦截后走 map，navigation.json 不动。
  // 全库 383 站核对：'maoyan.com' 键只命中 猫眼电影 一站，无后缀串站。
  // 红圆底 + 白猫脸在浅/深主题下均可辨识（resolveLogoTile 为 null），
  // 不做单站补丁。
  'maoyan.com=maoyanp',
  // 2026-11-20（C 类第 7 批 C7，W11，1 站）：Udemy。
  // 来源（浏览器取材 + 独立复核）：官网 apple-touch-icon.png
  // https://frontends.udemycdn.com/frontends-homepage/staticx/udemy/images/v7/apple-touch-icon.png
  // （200、image/png、180×180、1,527 B，SHA-256
  // 1a2683b802a828f68b2014a624aaf3009969dcf75451e6d35c16eb7db40c82e8）。
  // 站根 /favicon.ico 404、v7 目录 favicon.ico / favicon-32x32.png /
  // favicon-144x144.png 均 404；rel="icon" 声明链接未直接读到（浏览器
  // 视图不暴露 head），以同源官方静态目录实测可加载的 apple-touch-icon.png
  // 为源，见 C7-W11 测试事实钉死。交叉核对：同源 logo-udemy.svg
  // （1,891 B）chevron #A435F0 与黑色小写 u 字标；调色板分析：白底
  // 不透明（29,004 px 白、无 tRNS）、黑 U（0,0,0）、chevron #A435F0
  // （164,53,240，878 px），与 SVG 的 #A435F0 一致。
  // 落盘：Pillow LANCZOS 180→128（≥128 源缩到 128），RGB PNG，
  // 2,579 B，md5 65c81a2ce9193371cc5f4106796d7635。白底不透明：
  // 浅/深主题下均显白底方块、黑 U 可见，无底块（resolveLogoTile 为
  // null），不做单站补丁，留待统一处理轮（仿 Midjourney 白底不透明先例）。
  // 站 icon 字段为远端 https://www.udemy.com/favicon.ico，被
  // isRemoteRawFavicon 拦截，map 生效，navigation.json 不动。
  // 'github.com' / 'adobe.com' 键绝不加。
  // 全库 383 站核对：'udemy.com' 键只命中 Udemy 一站，无后缀串站、无子域站。
  'udemy.com=udemyp',
  // 2026-11-22（进化轮 2222，C 线，4 站 AI 办公）。
  // 全库仅剩 4 站既无 icon 字段又无 map 键（B 线逐一核对 23 站空 icon
  // 清单，19 站有 map 键兜底，仅此 4 站无），卡片只能渲染渐变底 +
  // 首字母兜底徽章；4 站全在 AI 办公类目。navigation.json 不动。
  // 来源均经 curl 重新验证（200 + image MIME + 魔数 + 尺寸）：
  // - 千问办公：官网 apple-touch-icon 180×180
  //   https://img.alicdn.com/imgextra/i4/O1CN01HdCyPs1MZh3Szwmxo_!!6000000001449-2-tps-180-180.png
  //   （200、image/png、13,406 B，SHA-256
  //   0287e8361985920e2cb0ac7d941c0f11e622b33bbbfe12a3d44aa56f08cf06de；
  //   首页 head 另声明 32×32 / 48×48 同标，站根 /favicon.svg 404 未用）。
  //   黑圆角方块 + 亮绿 #52E890 字标，四角透明；Pillow LANCZOS
  //   180→128 落盘 qwenwork.png（10,112 B，md5
  //   d9ee7cd24b0f1b9eefe7526874ecb83b）。'qwen.svg' 是通义千问、不可复用；
  //   标题 '千问办公' 不含 'qwen'，不触发上方 qwen3 标题规则。
  // - WPS 灵犀：manifest
  //   https://qn.cache.wpscdn.cn/lingxi-app/web/manifest_v2.json 给出官方
  //   logo 三档，取 192×192
  //   https://qn.cache.wpscdn.cn/copilot-test/copilot-cdn/images/copilot/lingxi_logo_192_v1.png
  //   （200、image/png、19,806 B，SHA-256
  //   5e59eb231012f80de70f2bc7102f64c61337675a2d21fc71974cca0b367929f5；
  //   站根 /favicon.ico 实为 HTML 壳页未用）。青紫渐变圆角徽 + 白底黑字标，
  //   四角透明；LANCZOS 192→128 落盘 lingxi.png（15,659 B，md5
  //   2ce27498de252b0dc9e2dd1d2b23f1fb）。
  // - WorkBuddy：官网 logo.svg
  //   https://assets.workbuddy.cn/web/workbuddy/7b25e1f24385a28a7c133de175ff1dc2bc6b455e/assets/logo.svg
  //   （200、image/svg+xml、4,142 B，SHA-256
  //   10ccbc099e7bc3d5ff12c315c4edd7b21386aa7166c1ec19997b3d55010d5c7d；
  //   40×40 viewBox 渐变圆角方块），SVG 原样落盘 workbuddy.svg。
  // - 百度搭子：站方 favicon.png
  //   https://now.bdstatic.com/store/v2/d33e0f5/qianfan-desktop-h5/4d5dbbe/favicon.png
  //   （200、image/png、5,521 B，144×144，SHA-256
  //   02e8924440fddc11aff3574eeb6f74aec55a6a21d154b86d6fd81eb21a1dd3a2）。
  //   浅薰衣草圆角方块 + 深色字标，四角透明；LANCZOS 144→128 落盘
  //   dumate.png（11,969 B，md5 fd009359737bf1f7a76678bcce1e0722）。
  // 键的精确性：'lingxi.kdocs.cn' 必须用完整子域精确键——map 已有
  // 'kdocs.cn=kdocsj'（WPS 文档站），后缀匹配会让灵犀错指 kdocs.jpg；
  // 精确查找在后缀循环之前，精确键优先命中。'dumate.baidu.com' 同理
  // 用完整子域（map 无 'baidu.com' 裸域键，绝不加）。'qwenwork.cn' /
  // 'workbuddy.cn'（www 已去前缀）各只命中对应一站，无后缀串站、无子域站。
  // 浅/深主题：四标 ASCII 渲染均为真实品牌标；qwenwork 深色下黑方块与底色
  // 相融但亮绿字标仍醒目，lingxi 渐变徽边框定形、dumate 深色字标可读，
  // workbuddy 满幅渐变方块双主题均可见；按规范 §9 不做单站底块补丁、
  // 不配 LOGO_TILE_MAP（resolveLogoTile 为 null），留待统一处理轮。
  'qwenwork.cn=qwenworkp',
  'lingxi.kdocs.cn=lingxip',
  'workbuddy.cn=workbuddys',
  'dumate.baidu.com=dumatep',
  // 2026-11-25（剩余图标 W5 短剧组：ShortMax / GoodShort / NetShort /
  // FlexTV / MoboReels / Melolo，6 站新键；ReelShort 键 'reelshort.com'
  // 已在 2b 批建好，本批不重复建键，见下方 resolveSiteIcon 的直通绕过）。
  // 全部 curl 重新验证（200 + image MIME + 魔数 + 尺寸，见 W5 测试事实钉死）：
  // - ShortMax：首页声明 apple-touch-icon /images/logo.png（200、2,835 B、
  //   PNG 71×71，黑底白 S + 橙色 TV 带），与 /favicon.ico 32×32 同标（底行
  //   橙色占比一致），取较大的 71 版原样落盘 shortmax.png（71<128 不放大）。
  // - GoodShort：首页声明 /public/favicon.ico（200、1,286 B，内容实为 PNG
  //   40×40，白底红橙播放三角标），与根 /favicon.ico 逐字节相同，原样落盘
  //   goodshort.png（40<128 不放大）。
  // - NetShort：首页声明 apple-touch-icon /a2hs/apple-touch-icon.png（200、
  //   10,179 B，PNG 180×180，红橙渐变圆角方块 + 白色胶片标）；根 /favicon.ico
  //   内容实为 WebP 300×300 全幅渐变同标、未用（路径与内容类型不符）。
  //   Pillow LANCZOS 180→128 落盘 netshort.png（11,670 B）。
  // - FlexTV：首页声明 apple-touch-icon
  //   https://www.flextv.cc/apple-touch-icon.png（200、14,875 B，PNG 672×672，
  //   粉 #FB3867 圆角方块 + 白色电视播放标），与根 /favicon.ico 256×256 帧
  //   同标（64 档均值差异 3.70，仅重采样差）；根 ICO 270,398 B 未用。
  //   Pillow LANCZOS 672→128 落盘 flextv.png（2,976 B）。
  // - MoboReels：首页仅声明 /favicon.ico（200、4,286 B，ICO 32×32 单帧，
  //   粉红渐变方块 + 深红爱心，无白字——32px 下白电视描边已丢失的简化版）；
  //   站内页头/页脚同源站方 logo /_nuxt/img/logo.1733fb4.png（200、1,586 B，
  //   PNG 80×80，同品牌粉红渐变方块 + 白电视 + 白爱心完整标），原样落盘
  //   moboreels.png（80<128 不放大）。favicon 32 版为同标简化版未用，见
  //   EVIDENCE-w5.md（复审如改用 32 版只需换文件一行）。
  // - Melolo：首页声明 /favicon.ico?favicon.1jo7br0ifgqa8.ico（200、16,958 B，
  //   ICO 64×64 单帧，红 #B90004 圆角方块 + 白电视 M 标），与 /icon.png
  //   56×56 同标（64 档均值差异 3.92，仅重采样差）；声明的 /favicon.png
  //   200 回 HTML 壳页不可用。ICO 64 帧解码原样落盘 melolo.png（64<128 不放大）。
  // 键的精确性：6 键在 navigation.json 全库 388 站 href 中各只命中 1 站，
  // 无后缀串站、无子域站；navigation.json 不动。6 标均为不透明底或透明底
  // 真实品牌标，浅/深主题均可见，按规范 §9 不做单站底块补丁、不配
  // LOGO_TILE_MAP（resolveLogoTile 为 null），留待统一处理轮。
  'shorttv.live=shortmaxp',
  'goodshort.com=goodshortp',
  'netshort.com=netshortp',
  'flextv.cc=flextvp',
  'moboreels.com=moboreelsp',
  'melolo.com=melolop',
  // 2026-11-25（剩余图标补齐 W6 政务/考试组：国家公务员局 3 站）。
  // 3 站 icon 字段均为远端 http://www.scs.gov.cn/favicon.ico，被
  // isRemoteRawFavicon 拦截，map 生效，navigation.json 不动。
  // 来源（2026-11-25 11:2x CST 复测，Chrome UA）：
  // www.scs.gov.cn 首页/根/favicon.ico 均回机器人验证墙（HTTP 200 但
  // 体为 EO_Bot_Ssid 混淆 JS 挑战页，985/987/988 B，非图标）；https
  // 全站连接失败（仅 http 可达）；bm/subb 站根 /favicon.ico 与
  // /apple-touch-icon.png 均 404。真正的官方标志取自三站共用的
  // gkweb 平台静态 host dl.scs.gov.cn（无墙）：bm/subb 实页
  // /pp/gkweb/core/web/ui/business/home/gkhome.html 与 lxhome.html
  // 均无 rel=icon 声明，页头 logo-box 的 background 即
  // http://dl.scs.gov.cn/pp/gkweb/core/web/ui/images/common/logo.png
  // （200、image/png、16,233 B、80×84 RGBA，md5
  // bc05012735ab6609bdccd258de168d20；像素实测：红底圆徽 #D020 系 +
  // 金色 #E0B040 星穗、国徽造型，四角透明，ASCII 渲染确认圆形徽章
  // 完整）。三站同平台同标、同 favicon 源，故一标三键共用 scs.png。
  // 80×84 < 128 按规范 §1.1 原样不放大；16,233 B 略超 ~15 KB 参考线
  // （超 873 B），按 C7 W3 dramabox.png（15,595 B）先例原样接线、
  // 字节数测试钉死。'gov.cn' 裸域键绝不加（C12 裁决：后缀匹配会让
  // 全库 *.gov.cn 错指中国政府网）；'scs.gov.cn' 精确键 + 两子域
  // 完整 hostname 键，bm/subb 即便无精确键也会被后缀匹配兜底，
  // 此处三键明写防歧义。全库 388 站核对：三键只命中此 3 站
  // （www/bm/subb.scs.gov.cn），无后缀串站；公安部/中公教育/
  // 12377 本批阻塞未入，不建键。红底实色圆徽浅/深主题均可辨，
  // 按统一规范 §9 不做单站底块补丁、不配 LOGO_TILE_MAP。
  'scs.gov.cn=scsp',
  'bm.scs.gov.cn=scsp',
  'subb.scs.gov.cn=scsp',
  // 2026-11-25（剩余图标补齐 W7，学习成长组 6 站落地 + 1 站阻塞）。
  // 来源均经 curl（Chrome UA）逐站验证（200 + image MIME + 魔数 + 尺寸）：
  // - 廖雪峰教程：站根 /favicon.ico 不存在（返回首页 HTML 壳）；站方
  //   页眉 logo 即 /static/logo.svg（裸域 https://liaoxuefeng.com/static/logo.svg
  //   200、image/svg+xml、3,963 B，md5 ea8a12b461ebae6d69c6641bfa35ae61；
  //   www 域会 302 跳回首页，必须用裸域取；SVG 文件头自注出自 SVG Repo，
  //   但确为官网页眉在用的 logo 文件本身）。800×800 方形帆船标（深青
  //   #334D5C 圆底 + 橙帆 + 黄星），ImageMagick -background none 渲染
  //   128×128 落盘 liaoxuefeng.png（8,568 B，md5
  //   955d0d94b9b511a0e6e2f94a539b9157，四角透明）。
  // - The Odin Project：首页声明 apple-touch-icon 180×180
  //   https://www.theodinproject.com/apple-touch-icon.png（200、image/png、
  //   11,333 B，md5 b3f8ddff210b08bdb2eaa88c18071ba4）；根 favicon.ico
  //   最大帧仅 48×48 未用。金棕 #E2B167 奥丁标、四角透明；LANCZOS
  //   180→128 落盘 theodinproject.png（9,305 B，md5
  //   0b764bff8fb8beac7a98b1c3f13dd8d2）。
  // - 网易云课堂：站方 favicon 仅 16×16（1,150 B）不达标、绝不放大；
  //   官网首页唯一 logo 图为吉祥物
  //   https://s2.stu.126.net/res/images/common/logo/logo_mascot.png
  //   （200、image/png、204×137、7,009 B，md5
  //   b6e90fc0ed857b6f3210f16136a19bf3）；站点头衔“网易云课堂”为 HTML
  //   文字、无图片 logo。吉祥物全身等比缩至最长边 128 落盘 study-163.png
  //   （128×86、7,722 B，md5 e0dd4fb501129e08d22fc6a33ba3fe18，四角透明，
  //   不裁切）。16×16 红 favicon（#F8232B）未用。
  // - edX：首页只声明 /favicon.ico（sizes=16x16），/apple-touch-icon.png
  //   404；favicon.ico（200、image/x-icon、26,283 B，md5
  //   936bf0a6f8450c13df9e7cfff5c5c7db）为 4 帧 ICO（16/32/48/256），
  //   最大帧 256×256 为 PNG 帧（6,544 B，md5
  //   fc2fb5efbe3f7745a02c0dbf38b0c94a），即官方 edX 标（白字 edX +
  //   深青 #02262B 平行四边形底，bbox y56–200）。LANCZOS 256→128 整幅
  //   落盘 edx.png（8,779 B，md5 a1cd8289db569e983ecfba8958ab2e20，四角透明）。
  // - Internet Archive：新版首页声明 /offshoot_assets/apple-touch-icon.png
  //   （200、image/png、180×180、1,313 B，md5
  //   43a6e2892f24dbaab688293b607d0fd1）与 /offshoot_assets/favicon.ico
  //   （与根 /favicon.ico 同文件，md5 55ffa49961256cb4512e5c77ff6a1fd3，
  //   3 帧最大 32×32 未用）。灰阶圆柱廊柱标（底 #222222 + 白柱，四角
  //   不透明深灰）；LANCZOS 180→128 落盘 archive.png（灰阶 L、2,191 B，
  //   md5 0df9f9d7028ba8c00f231ace05530437）。
  // - Open Library：首页声明 apple-touch-icon
  //   /static/images/openlibrary-128x128.png（前两次取回 nginx 500、
  //   第三次 200、image/png、128×128、3,405 B，md5
  //   bf25e3b64ae4af435fc1df672d92ba80）；米底 #E2DCC5 + 蓝 #518ABE
  //   书标，原样落盘 openlibrary.png（3,405 B，同 md5）。根 favicon.ico
  //   仅 16×16 未用；宽版 wordmark SVG（openlibrary-logo-tighter.svg）
  //   非方形标未用。
  // - Project Gutenberg：阻塞（见 EVIDENCE-w7.md）：全站 503 维护页，
  //   首页/裸域/favicon 三路三次复测均为 503、913 B，本轮无官方图标可取，
  //   不造假、不接线。'github.com' / 'adobe.com' 键绝不加。
  // 全库 388 站核对：6 键各只命中 1 站，无后缀串站、无子域站（163.com
  //   另有天音站 tianyin.163.com，不命中 'study.163.com' 键）。
  // 6 标浅/深主题均可辨（archive 深灰底 + 白柱；edx 白字 + 深青底；
  //   其余透明底彩色标），按规范 §9 不做单站底块补丁、不配
  //   LOGO_TILE_MAP（resolveLogoTile 为 null），留待统一处理轮。
  // navigation.json 不动（7 站 icon 字段均为远端 …/favicon.ico，
  // 被 isRemoteRawFavicon 拦截后走 map；廖雪峰站 icon 字段同款远端
  // favicon.ico，站方实际无此文件，同样走 map）。
  'liaoxuefeng.com=liaoxuefengp',
  'theodinproject.com=theodinprojectp',
  'study.163.com=study-163p',
  'edx.org=edxp',
  'archive.org=archivep',
  'openlibrary.org=openlibraryp',
 ];

/**
 * 后缀 1 字符编码的解码表（2026-11-21 U-248 三压缩）：裸文件名末尾的
 * 扩展名只存 1 个字符（s=.svg、p=.png、j=.jpg），完整路径（以 '/' 或
 * 'http' 开头）不编码、原样使用；未知末字符时回落为原值，不抛错。
 */
const LOGO_EXT: Record<string, string> = { s: '.svg', p: '.png', j: '.jpg' }

/**
 * 由紧凑表展开成原来的 Record<string, string>：精确查找与后缀匹配、
 * 全部 iconbatch 测试断言的行为都不变（见下方 resolveSiteIcon）。
 */
export const LOCAL_LOGO_MAP: Record<string, string> = Object.fromEntries(
  LOCAL_LOGO_ENTRIES.map((entry): [string, string] => {
    const sep = entry.indexOf('=')
    const host = entry.slice(0, sep)
    const file = entry.slice(sep + 1)
    // CodeQL #140：`startsWith('http')` 会把 httpx:// 等非 http(s) 串误判为
    // 绝对 URL；改用 new URL() + 协议校验的 isAbsoluteHttpUrl。
    if (file.startsWith('/') || isAbsoluteHttpUrl(file)) return [host, file]
    const ext = LOGO_EXT[file.slice(-1)]
    const name = ext ? file.slice(0, -1) + ext : file
    return [host, '/brand-icons/' + name]
  }),
);

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
    // CodeQL #140：`startsWith('http')` 方案嗅探不完整（httpx:// 等会误判）；
    // 改用 parseSiteUrl（new URL + http(s) 协议校验，裸串补 https://）。
    const parsed = parseSiteUrl(url.trim())
    if (!parsed) return null
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
  // 2026-11-25（剩余图标 W5 短剧组）：ReelShort 的 navigation.json icon
  // 是站方自有 CDN（v-mps.crazymaplestudios.com，Crazy Maple Studios
  // 官方 CDN）直链——既非第三方图标服务、又非 /favicon.ico 盲猜路径，
  // 故 customIcon 优先分支会直接热链回传，LOCAL_LOGO_MAP 已有的
  // 'reelshort.com' 键永不可达（缺口清单误记 map_key 为 null 即源于此）。
  // 本批已把该官方图标重新下载本地化：源
  // https://v-mps.crazymaplestudios.com/images/211d3420-d721-11f0-84ad-6b5693b490dc.png
  // （200、image/png、14,425 B、PNG 204×204，红粉渐变圆角方块 + 白 R +
  // 播放三角标；首页 head 三处声明同源同文件），204→128 LANCZOS 与既有
  // reelshort.png 逐字节一致（md5 0cd48cd0ba550cf52a474cbb8db749bf，
  // 12,804 B），故不改文件、只修可达性：本站跳过 customIcon 直通、回落
  // map；navigation.json 本批不动，清空 icon 字段留待合流方按 R1 裁决处理。
  // 作用域：仅 reelshort.com 一站（www 归一后同键），其余站行为不变。
  let skipCustomIcon = false
  try {
    const siteHost = parseSiteUrl((url || '').trim())?.hostname.toLowerCase()
    skipCustomIcon = siteHost === 'reelshort.com' || siteHost === 'www.reelshort.com'
  } catch {
    skipCustomIcon = false
  }
  // 自定义 icon 优先，但第三方图标服务与远端盲猜 favicon 探测地址除外
  if (
    customIcon &&
    typeof customIcon === 'string' &&
    customIcon.trim().length > 0 &&
    !isThirdPartyIcon(customIcon.trim()) &&
    !isRemoteRawFavicon(customIcon.trim()) &&
    !skipCustomIcon
  ) {
    return customIcon.trim()
  }

  if (!url || typeof url !== 'string') {
    return ''
  }

  try {
    const rawUrl = url.trim()
    // CodeQL #140：同 resolveLogoTile，`startsWith('http')` 换 parseSiteUrl；
    // 非法/非 http(s) 输入返回 ''（与旧回落一致：走默认渐变字母徽标）。
    const parsed = parseSiteUrl(rawUrl)
    if (!parsed) return ''
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
    // 子串 'trending' 在 navigation.json 全库 383 站标题中仅命中 GitHub Trending
    // 一站，故走标题规则；本条必须放在下方 'github' 规则之前，否则 Trending
    // 会先被 'github' 规则命中、解析为 github.svg。落盘 github-trending.svg
    // 与既有 github.svg 逐字节相同（同为 GitHub 官方 favicon.svg），按任务要求
    // 单独落盘、未复用 github.svg。来源：github.githubassets.com/favicons/favicon.svg。
    if (lowerTitle.includes('trending')) return '/brand-icons/github-trending.svg'
    // 2026-11-18（C 类第 1 批 c1g2）：GitHub 主站。github.com 为 7 站共享域名（GitHub、GitHub Trending、Cline、Copilot、LangGraph、Qwen 3、vLLM），严禁加 'github.com' 域名映射键。
    // 子串 'github' 在 navigation.json 全库 383 站标题中仅命中 3 站：GitHub、GitHub Trending、GitHub Copilot；
    // 其中 Copilot 已由上方 'copilot' 规则（:515）先行命中，不受本条影响；GitHub Trending（C4）暂由本条命中、解析为 github.svg，
    // C4 为 Trending 加 'trending' 规则时必须放在本条之前。来源：官网首页 <link rel="icon"> 声明的 favicon.svg（github.githubassets.com），SVG 原样。
    if (lowerTitle.includes('github')) return '/brand-icons/github.svg'
    // 2026-11-19（C 类第 6 批 C6）：亚马逊。'amazon.com' 严禁进 map：
    // 后缀匹配会让 C11 的 AWS WAF（aws.amazon.com）串站解析为 amazon.png。
    // 子串 '亚马逊' 在 navigation.json 全库 383 站标题中仅命中亚马逊一站，
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
    //   在全库 383 站中各仅命中 1 站；'neea.edu.cn' / 'cet.neea.edu.cn'
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
    // 子串 'hugging face papers' 在 navigation.json 全库 383 站标题中
    // 仅命中 Hugging Face Papers 一站，故走标题规则，必须放在 map 精确
    // 查找之前。落盘 huggingface-papers.svg 为 huggingface.co 官方 HF 标
    // SVG 原样（width 95 height 88，viewBox 缺省），与 huggingface.png
    // 不同名、不同文件。
    if (lowerTitle.includes('hugging face papers')) return '/brand-icons/huggingface-papers.svg'
    // 2026-11-19（C 类第 12 批 C12）：中国政府网。'gov.cn' 键绝不加：
    // 后缀匹配会让全库 12 个 *.gov.cn 命中站全部解析为 gov.png，其中
    // 公安部（mps.gov.cn，本批阻塞未入）、国家公务员局 3 站（scs.gov.cn，
    // C9 阻塞未入）、生态环境部 2 站（mee.gov.cn，C11 未上 main）均无
    // 精确键兜底，会被错指为中国政府网国徽标。仿 C6 亚马逊 / C9 标题
    // 规则先例走标题规则，必须放在 map 精确查找之前。子串 '中国政府网'
    // 在 navigation.json 全库 383 站标题中仅命中中国政府网一站。
    // 来源：www.gov.cn 首页声明的 trs_favicon.ico（内容实为 PNG 16×16，
    // 按内容解码落盘 gov.png，原样不放大，见 C12 测试事实钉死）。
    if (lowerTitle.includes('中国政府网')) return '/brand-icons/gov.png'

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
    if (lowerTitle.includes('万相') || lowerTitle.includes('wan2')) return 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png'
    if (lowerTitle.includes('智文')) return 'https://zhiwen.xfyun.cn/favicon.png'
    if (lowerTitle.includes('roo code')) return 'https://github.com/RooVetGit.png?size=64'
    if (lowerTitle.includes('kimi')) return '/brand-icons/kimi-search.png'
    if (lowerTitle.includes('豆包')) return '/brand-icons/doubao.png'
    if (lowerTitle.includes('文心一言')) return '/brand-icons/wenxin.png'
    if (lowerTitle.includes('通义灵码')) return 'https://img.alicdn.com/imgextra/i1/O1CN01BN6Jtc1lCfJNviV7H_!!6000000004783-2-tps-134-133.png'
    if (lowerTitle.includes('runway')) return '/brand-icons/runway.png'
    if (lowerTitle.includes('deepseek')) return '/brand-icons/deepseek.png'
    if (lowerTitle.includes('gemini')) return '/brand-icons/gemini.svg'
    if (lowerTitle.includes('chatgpt') || lowerTitle.includes('openai')) return '/brand-icons/chatgpt.svg'
    if (lowerTitle.includes('claude')) return '/brand-icons/claude.svg'
    if (lowerTitle.includes('cloudflare')) return '/brand-icons/cloudflare.png'
    if (lowerTitle.includes('figma')) return '/brand-icons/figma.svg'
    if (lowerTitle.includes('tinypng')) return '/brand-icons/tinypng.png'
    if (lowerTitle.includes('unsplash')) return '/brand-icons/unsplash.png'
    if (lowerTitle.includes('vercel')) return '/brand-icons/vercel.png'

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
  const imgRef = React.useRef<HTMLImageElement | null>(null)

  // 1. 综合计算有效图标地址
  let effectiveIcon = resolveSiteIcon(url, title, icon)
  if (!effectiveIcon && url && (url.startsWith('http://') || url.startsWith('https://'))) {
    // 图标代理端点由中枢提供（apps/api/src/routes/assets.ts）
    // 通过 /api/hub 隧道代理，已在网关清单中登记为 public
    effectiveIcon = `/api/hub/assets/icon?url=${encodeURIComponent(url)}${title ? `&title=${encodeURIComponent(title)}` : ''}`
  }

  // 当有效图标地址变化时重置状态（不仅仅跟踪 icon，防止同位切换 url/title 时沿用旧的 imgLoaded）
  const prevEffectiveIconRef = React.useRef(effectiveIcon)
  if (prevEffectiveIconRef.current !== effectiveIcon) {
    prevEffectiveIconRef.current = effectiveIcon
    if (imgError) setImgError(false)
    if (imgLoaded) setImgLoaded(false)
  }

  // 特殊站点图标自愈：部分站点原生返回纯白/透明矢量图，在浅色底色下对比度不足（如 Cursor 官网透明白立方体）
  //
  // 2026-11-21 修 CodeQL #140：原判定是 url.toLowerCase().includes('cursor.com')，
  // 属**子串匹配**——https://evil.com/?cursor.com 与 https://cursor.com.evil.com/
  // 都会命中，等于让任意站点冒充 Cursor 拿到它的图标自愈逻辑（可被用来做
  // 视觉仿冒/钓鱼页的图标伪装）。改为标准 URL 解析 + hostname 严格比对。
  const isCursorSite = Boolean(
    (title && title.toLowerCase().includes('cursor')) ||
    (url && isAllowedHost(url, ['cursor.com']))
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
      {/* 底层（Layer 1）：图片未加载完成或加载失败时立即呈现确定性彩色首字母徽标，杜绝空白占位；真实图标就绪后卸载以防透明图透底 */}
      {(!shouldRenderImg || !imgLoaded) && (
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
      {/* 顶层（Layer 2）：真实站点图标，解码完成后平滑显现 */}
      {shouldRenderImg && (
        <img
          ref={handleImgRef}
          src={effectiveIcon}
          alt={title ? `${title} 图标` : '站点图标'}
          className={cn(
            'relative z-10 w-full h-full object-contain transition-opacity duration-150',
            imgLoaded ? 'opacity-100' : 'opacity-0',
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
                  // 同理：includes 会被 https://evil.com/?google.com/s2/favicons 骗过，
                  // 改为按 hostname 判断图标是否来自 Google favicon 服务。
                  isAllowedHost(effectiveIcon, ['google.com', 'gstatic.com'])))
            ) {
              markIconFailed(effectiveIcon)
              setImgError(true)
            } else if (e.currentTarget.naturalWidth > 1) {
              setImgLoaded(true)
            }
          }}
        />
      )}
    </div>
  )
}
