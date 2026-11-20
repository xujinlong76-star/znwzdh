import type { Metadata } from 'next'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ClipboardCheck,
  Printer,
} from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { safeHref } from '@/lib/safe-url'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { absUrl } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import {
  EXAMS,
  GUOKAO_ADMISSION_URL,
  GUOKAO_PORTAL_URL,
} from '@/lib/exam-calendar'
import {
  GUOKAO_CHECKLIST_ADMISSION_RULES_LINE,
  GUOKAO_CHECKLIST_DEADLINE_WARNING,
  GUOKAO_CHECKLIST_FIRST_DAY_LINE,
  GUOKAO_CHECKLIST_GROUPS,
  GUOKAO_CHECKLIST_SOURCE_NOTE,
} from '@/lib/guokao-checklist'

/**
 * 国考准考证「打印前清单」页（U-285，B 步：新静态路由 + 服务端静态页）。
 *
 * 骨架照抄 `/exam/page.tsx`：展板（market-hero 语言）、面包屑、
 * `generateMetadata`（canonical 写新路径字面量）、JsonLd、`revalidate = 3600`。
 * 内容定稿见 `@/lib/guokao-checklist`（Spec §2 的 14 项逐项落稿，
 * 全部关键口径转载级措辞）；时间对照表直接读 `exam-calendar.ts`
 * 的国考节点（唯一事实源，不另造时刻源）。
 *
 * 不动 `exam-calendar.ts`、不新增 PEAK 表项、不改 `my-exams.ts` 旧键。
 * 以下两处留给后续步骤（本页先以静态内容完整呈现，不留空壳）：
 *  - C 步（W3）：下方静态清单由勾选岛替换（文案与 id 见 guokao-checklist，
 *    新存储键如 `navhub.guokao-admission-checklist.v1`，旧键不动）；
 *  - D 步（W4）：阶段横幅（复用 `guokaoAdmissionPhase`）与 /exam 国考卡片
 *    内入口链接一行；390px 真实渲染须 live browser 复核。
 */

export const revalidate = 3600

const CANONICAL = '/exam/guokao-checklist'
const TITLE = '国考准考证打印前清单'
const DESCRIPTION =
  '2027 年国考准考证 11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止：报名序号、身份证号、账号登录三项打印前先勾好，打印后逐项核对考点、考场与考试时间。内容据官方公告转载整理，以官方最新公告为准。'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${TITLE} - 2027 年国考`,
    description: DESCRIPTION,
    // 与 /exam 同款写法：canonical 写字面量，canonical-coverage 守卫直接锁字面量
    alternates: { canonical: '/exam/guokao-checklist' },
    ...(await pageShareMetadata({ url: CANONICAL, title: TITLE, description: DESCRIPTION })),
  }
}

export default async function GuokaoChecklistPage() {
  const origin = configuredSiteOrigin()
  // 时间对照表只读事实源：国考三个节点（准考证打印 / 专业科目笔试 /
  // 公共科目笔试）的 detail 原文，不另写时间值。
  const guokao = EXAMS.find((exam) => exam.id === 'guokao')
  const timeRows = guokao?.nodes ?? []

  return (
    <Container as="main" id="main-content">
      <div className="space-y-8 py-4 sm:space-y-10 sm:py-8">
        <Breadcrumbs
          jsonLd
          items={[
            { label: '首页', path: '/' },
            { label: '考试日历', path: '/exam' },
            { label: TITLE, path: CANONICAL },
          ]}
        />
        {origin ? (
          <JsonLd
            data={{
              '@context': 'https://schema.org',
              '@type': 'WebPage',
              name: TITLE,
              url: absUrl(origin, CANONICAL),
            }}
          />
        ) : null}

        {/* 展板（对齐 /exam 的 market-hero 语言） */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-6 sm:p-8 shadow-xs">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-56 h-56 bg-sky-400/10 rounded-full blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-44 h-44 bg-emerald-400/10 rounded-full blur-3xl" />
          <ClipboardCheck
            aria-hidden
            strokeWidth={1}
            className="pointer-events-none absolute right-5 top-5 hidden sm:block w-16 h-16 text-border/70"
          />
          <div className="relative z-10 space-y-3">
            <div className="flex items-center gap-2">
              <Link
                href="/exam"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-md bg-background/60 hover:bg-background border border-border/60"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>返回考试日历</span>
              </Link>
              <span className="text-border">/</span>
              <span className="text-xs text-muted-foreground">2027 年国考</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20 shadow-xs">
                <ClipboardCheck className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span>{TITLE}</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
              2027 年国考 · 11 月 23 日 0:00 开放打印，11 月 29 日 15:00 截止。
              {GUOKAO_CHECKLIST_FIRST_DAY_LINE}
            </p>
            <div className="mt-4 pt-3.5 border-t border-border/50 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-sky-500/25 bg-sky-500/5 text-xs text-sky-700 dark:text-sky-400">
                <CalendarDays className="w-3 h-3" />
                打印窗口：11 月 23 日 0:00 至 11 月 29 日 15:00
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                内容据官方公告转载整理，以官方最新公告为准
              </span>
            </div>
          </div>
        </div>

        {/* 截止醒目标注（照抄提醒岛红框色档，常驻首屏，不随阶段消失） */}
        <div
          role="alert"
          className="rounded-xl border border-red-500/25 bg-red-500/5 p-3.5"
        >
          <p className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            截止醒目
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">
            {GUOKAO_CHECKLIST_DEADLINE_WARNING}
          </p>
        </div>

        {/* 清单区：A/B/C 三组静态呈现。C 步（W3）将此处替换为勾选岛
            （label 包裹、44px 点击区、已勾 line-through、新存储键），
            文案与 id 一律复用 @/lib/guokao-checklist，不另编清单项。 */}
        <section aria-labelledby="guokao-checklist-heading">
          <h2 id="guokao-checklist-heading" className="text-lg font-bold text-foreground">
            打印前清单
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            三件事先备好再进打印系统；打印后逐项核对考点、考场与考试时间。
            {/* C 步（W3）勾选岛落地后，此处补一句“勾选只保存在本机浏览器，不登录、不跨设备同步”。 */}
          </p>
          <div className="mt-4 space-y-4">
            {GUOKAO_CHECKLIST_GROUPS.map((group) => (
              <div
                key={group.id}
                data-checklist-group={group.id}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <h3 className="text-base font-bold text-foreground">{group.title}</h3>
                <ul className="mt-3 space-y-2.5">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      data-checklist-item={item.id}
                      className="flex items-start gap-2.5 text-sm"
                    >
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border bg-background text-xs text-muted-foreground"
                      >
                        □
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium text-foreground">{item.label}</span>
                        {item.note ? (
                          <span className="text-muted-foreground"> · {item.note}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                {group.footnote ? (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {group.footnote}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {GUOKAO_CHECKLIST_SOURCE_NOTE}
          </p>
        </section>

        {/* 入口区：主按钮只挂打印系统直链（读常量，不写死域名）；
            门户只作文字链，不作主按钮目标；两链接均写 http。 */}
        <section aria-labelledby="guokao-checklist-entry-heading">
          <h2 id="guokao-checklist-entry-heading" className="text-lg font-bold text-foreground">
            去打印准考证
          </h2>
          <div className="mt-4 rounded-2xl border border-border bg-card p-5">
            <a
              href={safeHref(GUOKAO_ADMISSION_URL)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
            >
              <Printer className="h-4 w-4" aria-hidden />
              去打印准考证
              <ArrowUpRight className="h-4 w-4" aria-hidden />
            </a>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              报名/审查走专题网站门户
              {' '}
              <a
                href={safeHref(GUOKAO_PORTAL_URL)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-sky-700 hover:underline dark:text-sky-400"
              >
                bm.scs.gov.cn/kl2027
              </a>
              ，选「考生考务入口」进入打印系统（直达 gwy.cpta.com.cn）。
            </p>
          </div>
        </section>

        {/* 时间对照表（读国考节点原文）+ 入场新规 */}
        <section aria-labelledby="guokao-checklist-time-heading">
          <h2 id="guokao-checklist-time-heading" className="text-lg font-bold text-foreground">
            时间对照
          </h2>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-2.5 font-medium">事项</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {timeRows.map((node) => (
                  <tr key={node.label} className="border-b border-border/60 last:border-b-0">
                    <th scope="row" className="px-4 py-2.5 font-medium text-foreground text-left">
                      {node.label}
                    </th>
                    <td className="px-4 py-2.5 text-muted-foreground">{node.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {GUOKAO_CHECKLIST_ADMISSION_RULES_LINE}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {GUOKAO_CHECKLIST_SOURCE_NOTE}
            报名序号找回等细节未核实，不展开写；以官方最新公告与报名系统《准考证打印须知》为准。
          </p>
          <p className="mt-4">
            <Link
              href="/exam"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 dark:text-sky-400"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
              返回考试日历
            </Link>
          </p>
        </section>
      </div>
      <Footer />
    </Container>
  )
}
