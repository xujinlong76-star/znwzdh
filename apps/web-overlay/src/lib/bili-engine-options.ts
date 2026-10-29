// B 站备用解析引擎清单：从 video-bilibili-hd-player 拆出的零依赖模块（不要在这里加 import）。
// 播放器页的换源下拉框无条件用到这份常量，而播放器本体只在 platform === 'bilibili' 时才挂载；
// 两者留在同一个模块里，那条静态 import 就会把整个播放器（含其依赖图）算进 /videos/player 首屏。
export interface BiliEngineOption {
  id: string
  name: string
  shortLabel: string
  tag: string
  tagColor: string
  desc: string
  quality: string
}

export const BILI_ENGINE_OPTIONS: BiliEngineOption[] = [
  {
    id: 'auto',
    name: '自动最优（多源容灾）',
    shortLabel: '自动优选',
    tag: '智能推荐',
    tagColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    desc: '按可用性自动在 6 个解析引擎间毫秒级故障转移',
    quality: '720P / 1080P+',
  },
  {
    id: 'xingzhige',
    name: '星之阁 API（首选源）',
    shortLabel: '星之阁 HD',
    tag: '主通道',
    tagColor: 'bg-[#FB7299]/20 text-[#FB7299] border-[#FB7299]/30',
    desc: '免登录 720P / 填入 access_key 可解锁大会员 1080P+',
    quality: '720P ~ 1080P+',
  },
  {
    id: 'mir6',
    name: '米人 API（备用源 1）',
    shortLabel: '米人 API',
    tag: '备用 1',
    tagColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    desc: '免登录 720P MP4 直链高速解析通道',
    quality: '720P',
  },
  {
    id: 'bilibili_wbi',
    name: '官方 WBI 签名（备用源 2）',
    shortLabel: '官方 WBI',
    tag: '备用 2',
    tagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    desc: '基于官方 mixinKey 算法动态算签 playurl 接口',
    quality: '720P',
  },
  {
    id: 'bilibili_html5',
    name: '官方 HTML5 直连（备用源 3）',
    shortLabel: 'HTML5 直连',
    tag: '备用 3',
    tagColor: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
    desc: '官方 Web HTML5 高可用 CDN 直连通道',
    quality: '720P',
  },
  {
    id: 'bilibili_pc',
    name: '官方 PC 兼容源（备用源 4）',
    shortLabel: 'PC 兼容源',
    tag: '备用 4',
    tagColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    desc: 'B 站 PC 端 UPOS 节点分流直连',
    quality: '720P/480P',
  },
  {
    id: 'bilibili_android',
    name: '官方 Android 分流（备用源 5）',
    shortLabel: '移动端源',
    tag: '备用 5',
    tagColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    desc: 'B 站 Android 移动客户端容灾分流节点',
    quality: '720P/480P',
  },
  {
    id: 'iframe',
    name: 'B 站官方内嵌播放器（保底）',
    shortLabel: '官方内嵌',
    tag: '保底模式',
    tagColor: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30',
    desc: '官方 iframe 原版播放器，保留完整官方弹幕与交互',
    quality: '自动',
  },
]
