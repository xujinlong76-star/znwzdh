/**
 * 「设为首页」引导的浏览器识别与步骤文案。
 *
 * 诚实前提：现代浏览器不允许网页程序化修改主页设置，能做的只有
 * 按浏览器给出一步步图文说明 + 一键复制网址；移动端等价物是
 * 「添加到主屏幕」（支持 beforeinstallprompt 的走 PWA 安装提示）。
 * 本模块只负责识别与文案，纯函数可测；安装提示的捕获在组件侧。
 */

export type BrowserKind = 'edge' | 'chrome' | 'firefox' | 'safari' | 'ios' | 'android' | 'unknown'

export function detectBrowser(ua: string): BrowserKind {
  const s = ua.toLowerCase()
  if (/iphone|ipad|ipod/.test(s)) return 'ios'
  if (s.includes('edg/') || s.includes('edgios') || s.includes('edga')) return 'edge'
  if (s.includes('firefox') || s.includes('fxios')) return 'firefox'
  if (s.includes('android')) return s.includes('chrome') ? 'android' : 'unknown'
  if (s.includes('chrome') || s.includes('crios')) return 'chrome'
  if (s.includes('safari')) return 'safari'
  return 'unknown'
}

export const BROWSER_LABEL: Record<BrowserKind, string> = {
  edge: 'Edge 浏览器',
  chrome: 'Chrome 浏览器',
  firefox: 'Firefox 浏览器',
  safari: 'Safari 浏览器',
  ios: 'iPhone / iPad',
  android: 'Android 手机',
  unknown: '你的浏览器',
}

/** 每种浏览器把本站设为首页（或添加到主屏幕）的真实操作步骤 */
export function homepageSteps(kind: BrowserKind): string[] {
  switch (kind) {
    case 'chrome':
      return [
        '点浏览器右上角 ⋮ →「设置」',
        '左侧选「启动时」→ 选「打开特定网页或一组网页」',
        '点「添加新网页」，把本站网址粘贴进去（下方可一键复制）',
        '下次打开 Chrome 就会直接来到本站啦',
      ]
    case 'edge':
      return [
        '点浏览器右上角 … →「设置」',
        '左侧选「开始、主页和新建选项卡页」',
        '在「打开这些页面」处点「添加新页面」，粘贴本站网址',
        '也可以在「主页按钮」里把网址填进去，点主页图标就能回来',
      ]
    case 'firefox':
      return [
        '先把本站网址复制好（下方有一键复制）',
        '点右上角 ☰ →「设置」→ 左侧「主页」',
        '在「主页和新窗口」里选「自定义网址」，粘贴本站网址',
        '下次打开 Firefox 就会直接来到本站啦',
      ]
    case 'safari':
      return [
        '点顶部菜单「Safari 浏览器」→「设置」→「通用」',
        '把「打开新窗口时」设为「主页」',
        '在「主页」一栏粘贴本站网址（下方可一键复制）',
        '下次打开 Safari 就会直接来到本站啦',
      ]
    case 'ios':
      return [
        '点 Safari 底部的「分享」按钮（方框向上箭头）',
        '在菜单里选「添加到主屏幕」',
        '点右上角「添加」，桌面上就会出现本站图标',
        '以后点桌面图标就能一键回到本站',
      ]
    case 'android':
      return [
        '如果页面上方弹出了「安装应用 / 添加到主屏幕」，直接点它最省事',
        '没弹的话：点浏览器右上角 ⋮ →「添加到主屏幕」',
        '确认添加后，桌面上会出现本站图标',
        '以后点桌面图标就能一键回到本站',
      ]
    default:
      return [
        '把本站网址复制好（下方有一键复制）',
        '打开浏览器的「设置」，找到「启动时 / 主页」一栏',
        '选择「打开特定网页」，把本站网址粘贴进去',
        '下次打开浏览器就会直接来到本站啦',
      ]
  }
}
