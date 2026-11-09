'use client'

/**
 * 视频内嵌播放器的「点击后加载」门面（click-to-load facade）。
 *
 * ## 为什么需要（2026-11-08 隐私面整改）
 *
 * 原实现在 /videos/v/[id] 独立 SEO 落地页**直接渲染** B 站官方 iframe。
 * 实测一次访问会连带请求 **11 个第三方域名**：
 *   player.bilibili.com / s1.hdslb.com / data.bilibili.com / api.bilibili.com /
 *   upos-sz-*.bilivideo.com / i0~i2.hdslb.com / bvc.bilivideo.com / *.smtcdns.com …
 * 其中 `data.bilibili.com/log/web` 是播放器内部的**行为埋点信标**——
 * 访客只是打开一个收录页，观看/停留行为就已经被发给第三方，
 * 且本仓库的隐私面此前没有任何一处告知过这件事。
 *
 * 这不属于「代码 bug」，但属于**默认即外发数据**的产品决策。
 * 自主决定改为「点击才加载」：
 *   - 首屏不再与任何 B 站域名建连（爬虫、只读访客、误点进来的人完全不受影响）；
 *   - 用户主动点「播放」才创建 iframe，行为与意愿一致；
 *   - 门面上明确写出「加载后会与 B 站建立连接」，把选择权交回给用户；
 *   - 保留「前往 B 站原站观看」链接（不依赖 iframe 也能到达内容）。
 *
 * ## SEO 不受影响
 *
 * 这是 Server Component 页面里的一个 Client 叶子节点：
 * `<script type="application/ld+json">` 的 VideoObject（含 embedUrl / thumbnail /
 * Clip 章节）仍由服务端直出，**不经过本组件**。Google/Bing 拿到的结构化数据与
 * 改动前逐字节相同；`<h1>`、简介、章节时间戳目录、相关课程内链也全在服务端 HTML 里。
 *
 * ## 与既有播放器的分工
 *
 * 「沉浸式演播室」(`/videos/player`) 有完整的**原生 HTML5 <video> 直连**链路
 * （见 video-bilibili-hd-player.tsx 的 direct → proxy → iframe 三级容灾），
 * 那条路径本就不依赖 B 站 iframe 埋点。这里只处理「静态收录页的默认预览」。
 */
import { useState } from 'react'
import { Play, ExternalLink } from 'lucide-react'

export interface VideoEmbedFacadeProps {
  /** 已通过 safeSrc 白名单校验的内嵌地址 */
  embedUrl: string
  title: string
  /** 封面图（站点 icon）；无则退化为纯色底 + 播放按钮 */
  poster?: string | null
  /** 平台显示名，用于提示文案 */
  platformName?: string
}

export function VideoEmbedFacade({ embedUrl, title, poster, platformName = 'B 站' }: VideoEmbedFacadeProps) {
  const [loaded, setLoaded] = useState(false)

  if (loaded) {
    return (
      <iframe
        src={embedUrl}
        title={title}
        className="w-full h-full border-0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      className="group absolute inset-0 flex flex-col items-center justify-center gap-3 w-full h-full text-center cursor-pointer"
      aria-label={`播放「${title}」——点击后加载 ${platformName} 播放器`}
    >
      {/* 封面图：装饰性，alt 留空避免与按钮的无障碍名重复 */}
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-50 transition-opacity"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-slate-950 shadow-xl transition-transform group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-amber-400">
        <Play className="w-7 h-7 ml-0.5" fill="currentColor" />
      </span>
      <span className="relative text-sm sm:text-base font-semibold text-white drop-shadow">
        点击加载 {platformName} 播放器
      </span>
      <span className="relative text-[11px] text-slate-300 max-w-xs px-4 leading-relaxed">
        加载后将与 {platformName} 建立连接（含其播放统计）。
        不愿外发数据可改用右上角的「前往原站观看」，
        或进入沉浸式演播室走本站直连播放。
      </span>
    </button>
  )
}
