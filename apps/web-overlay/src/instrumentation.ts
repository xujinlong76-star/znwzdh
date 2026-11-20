/**
 * 生产启动 SEO 自检（2026-11-07）。
 *
 * NAVHUB_SITE_URL 是 canonical / sitemap / metadataBase / OG / JSON-LD 的唯一
 * 域名来源（lib/seo/origin.ts）。缺省或指向 localhost 时站点仍能跑，但索引
 * 基础设施整体降级：构建期 sitemap 为空、分享图不输出、canonical 落回请求头
 * 推导。这类降级不报错、不掉监控，只有部署者知道——所以在服务器启动时显式
 * 告警一次，把「忘了注入域名」从静默降级变成日志里可见的运维事件。
 *
 * 只告警不抛错：域名缺席有请求头兜底，站点可用性优先；格式非法的请求期失败
 * 由 origin.ts 在生产环境负责。构建阶段（NEXT_PHASE=phase-production-build）
 * 跳过：Docker 构建期刻意不注入该变量（运行时才给），构建日志不该刷假警报。
 */
export const runtime = 'nodejs'

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV !== 'production') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  // 视频健康巡检定时调度（默认每 6 小时一轮，按页扫完全库，断点续扫；
  // 环境变量见 lib/video-health-scheduler.ts；VIDEO_HEALTH_SWEEP_ENABLED=false 关闭）。
  // 放在 SEO 自检之后：调度只依赖进程内定时器，与域名配置无关。
  // Phase 2 批 E 日志噪声：巡检链 scheduler → sweep-service → video-library-store
  // → github → auth.ts 首行 import 了 node:crypto（Node-only）。顶层静态 import
  // 会把这条链拉进 Edge Instrumentation 编译，dev 日志每轮刷「Ecmascript file
  // had an error」（实测：只加 export const runtime = 'nodejs' 不够，Turbopack
  // 仍编 Edge 版）。register 只在 Node 跑，改函数内动态 import 后 Edge 编译时
  // 看不到这条链。
  try {
    const { startVideoHealthScheduler } = await import('./lib/video-health-scheduler')
    startVideoHealthScheduler()
  } catch (error) {
    console.error('[VideoHealthScheduler] 启动失败（巡检不会自动运行，手动入口仍可用）:', error)
  }

  // 事件循环阻塞看门狗（2026-11-20 服务器挂死定位用）：单线程 JS 空转会把
  // 事件循环堵死、HTTP 全灭，事后又拿不到 JS 栈（Windows 上 _debugProcess
  // 不可用）。哨兵只检测不上报以外的事：阻塞超阈值即把“堵了多久 + 开始时间
  // + 内存”写进日志，下次挂死按开始时间对请求日志定位触发点。
  // 与巡检调度同一口径：函数内动态 import，不进 Edge Instrumentation 编译。
  try {
    const { startEventLoopWatchdog } = await import('./lib/event-loop-watchdog')
    startEventLoopWatchdog()
  } catch (error) {
    console.error('[EventLoopWatchdog] 启动失败（阻塞不会上报，不影响服务）:', error)
  }

  const raw = process.env.NAVHUB_SITE_URL?.trim()
  if (!raw) {
    console.error(
      '[seo-check] NAVHUB_SITE_URL 未注入：sitemap 构建期快照为空，canonical/OG 缺 metadataBase（运行时仅请求头兜底，可被 Host 头影响）。请在部署时给 web 服务注入真实公网域名（https origin，不含路径）。',
    )
    return
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    console.error(`[seo-check] NAVHUB_SITE_URL 不是合法 URL（${raw}）：生产请求期将按 origin.ts 的策略直接失败，请立即修正。`)
    return
  }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(url.hostname)) {
    console.error(
      `[seo-check] NAVHUB_SITE_URL 指向本地地址 ${url.origin}：生产环境的 canonical/sitemap/OG 会全部指向 localhost，搜索引擎无法正确收录。请改成公网域名。`,
    )
    return
  }
  if (url.protocol !== 'https:') {
    console.warn(`[seo-check] NAVHUB_SITE_URL 非 https（${url.origin}）：确认这是有意为之，否则 sitemap 会产出 http 地址。`)
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username) {
    console.error(`[seo-check] NAVHUB_SITE_URL 必须是纯 origin（${url.origin}），当前值带路径/查询串/ userinfo，会被 origin.ts 判为非法。`)
  }
}