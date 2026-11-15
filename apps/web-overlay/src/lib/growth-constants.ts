/**
 * 首屏常量（零依赖）：首页「设为首页」引导条与页脚渲染文案用的两个常量。
 *
 * 存在理由（第 75 轮 growth 常量切割）：这两个常量之前住在
 * lib/growth.ts（2,340 行 / 102KB）里，页脚（footer.tsx）与首页横幅
 *（homepage-banner.tsx）只为用它们就把整个 growth.ts 静态拉进
 * /sites 等路由的首屏。移到这里后，首屏只留这两个常量，不再拖全模块。
 *
 * 铁律：本文件不得 import growth.ts（也不得 import 任何会再拉回
 * growth.ts 的模块），否则切割白做；值逐字照搬 growth.ts 原定义。
 * growth.ts 从这里 re-export 两名，旧调用点（homepage-guide、
 * growth-panel、growth-v2 / growth-rules 测试）零改动继续通过。
 */
export const HOMEPAGE_CLAIM_XP = 100
export const HOMEPAGE_BANNER_DISMISSED_KEY = 'navhub.growth.homepageBannerDismissed.v1'
