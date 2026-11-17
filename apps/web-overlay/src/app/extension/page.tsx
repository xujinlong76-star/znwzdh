import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, Chrome, Compass, Download, MousePointerClick, Search, Star } from "lucide-react"

export const metadata: Metadata = {
  title: "浏览器扩展",
  description: "安装浏览器扩展：每次打开新标签页就是本站轻量首页，地址栏 nh 秒搜，一键收录当前网页。",
}

export default function ExtensionGuidePage() {
  return (
    <main id="main-content" className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:py-10">
      <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-6 sm:p-8 shadow-xs">
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-56 h-56 bg-indigo-400/10 rounded-full blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-44 h-44 bg-emerald-400/10 rounded-full blur-3xl" />
        <Chrome
          aria-hidden
          strokeWidth={1}
          className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
        />
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回主页</span>
            </Link>
            <span className="text-border">/</span>
            <span className="text-xs text-muted-foreground">Chrome / Edge 扩展</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 shadow-xs">
              <Compass className="w-5 h-5 sm:w-6 h-6" />
            </div>
            <span>浏览器扩展</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
            每次打开新标签页，就是山羊胡轻量首页：搜索框、今日一件事、常用站。离线时显示上次缓存的样子，不白屏。
          </p>
          <div className="mt-4 pt-3.5 border-t border-border/50 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/25 bg-amber-500/5 text-xs text-amber-700 dark:text-amber-400">
              <Download className="w-3 h-3" />
              Chrome 应用商店：正在准备上架审核，链接待上架后公布
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
              今日一件事只存本机 · 不进云端
            </span>
          </div>
        </div>
      </div>

      <section aria-label="扩展能做什么" className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
          <Search className="w-5 h-5 text-indigo-500" aria-hidden />
          <h2 className="mt-2 text-sm font-bold">新标签页轻量首页</h2>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            搜索框直达站内搜索，常用站先画缓存秒开、后台再拉最新替换，离线不停在白屏。
          </p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
          <MousePointerClick className="w-5 h-5 text-indigo-500" aria-hidden />
          <h2 className="mt-2 text-sm font-bold">地址栏 nh 秒搜</h2>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            地址栏输入 nh + Tab，在线混合检索实时出建议，回车直达。
          </p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/60 p-4">
          <Star className="w-5 h-5 text-indigo-500" aria-hidden />
          <h2 className="mt-2 text-sm font-bold">一键收录与收藏</h2>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            点扩展图标或右键，把当前网页收录进站库、收藏到自己的账号。
          </p>
        </div>
      </section>

      <section aria-label="安装方法" className="mt-6 rounded-2xl border border-border/70 bg-background/60 p-6">
        <h2 className="text-base font-bold">安装方法</h2>
        <h3 className="mt-4 text-sm font-bold">方式一：Chrome 应用商店（待上架）</h3>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground leading-relaxed">
          商店上架需走 Chrome Web Store 开发者账号提交与审核，正在准备中；上架后本页会直接给出安装链接。
        </p>
        <h3 className="mt-5 text-sm font-bold">方式二：开发者模式手动加载（现在就能用）</h3>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-xs sm:text-sm text-muted-foreground leading-relaxed">
          <li>打开浏览器扩展管理页：Chrome 进 chrome://extensions/，Edge 进 edge://extensions/</li>
          <li>开启右上角的「开发者模式」开关</li>
          <li>点「加载已解压的扩展程序」，选择仓库里的 extensions/chrome-extension 目录</li>
          <li>打开一个新标签页，轻量首页即出现；地址栏输入 nh + 空格，体验极速搜索</li>
        </ol>
        <p className="mt-5 text-xs text-muted-foreground leading-relaxed">
          想恢复浏览器默认新标签页：停用或卸载本扩展即可，不留任何修改。
        </p>
      </section>
    </main>
  )
}
