import type { Metadata } from 'next'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  CalendarDays,
  GraduationCap,
  Landmark,
  Languages,
  type LucideIcon,
} from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { SiteFavicon } from '@/components/site-favicon'
import { getFileContent } from '@/lib/github'
import { getProcessedData } from '@/lib/data-loader'
import { safeHref } from '@/lib/safe-url'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { absUrl } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import {
  EXAMS,
  EXAM_DATA_NOTE,
  EXAM_PREP_CATEGORY_ID,
  EXAM_PREP_SUB_ID,
  EXAM_REMINDERS,
  EXAM_NODE_STATUS_LABEL,
  examNodeStatus,
  nearestExam,
} from '@/lib/exam-calendar'
import { ExamCountdown } from './exam-countdown'
import type { NavigationSubItem } from '@/types/navigation'

/**
 * 考试日历页（/exam，服务端渲染 + 倒计时客户端岛）。
 *
 * 存在理由：2026 年 11 月考试季四场大考 16 天连发（国考 11-29、四六级
 * 12-12、省考 12-06、考研 12-19–20），站内只有分散的报名入口，没有
 * 一处能同时看到倒计时与关键节点；三家大导航同期也没有像样的考试
 * 专题或倒计时（360 只有一个内容过期到 2024/2025 的财会考试日历）。
 * 第一轮只做最小静态页：倒计时卡 + 四场时间轴 + 撞期与双考提醒 +
 * 备考站点区；「我的考试」关注与考前清单待办是下一轮候选。
 *
 * 日期全部据官方公告核实（见 src/lib/exam-calendar.ts 文件头），
 * 备考站点区直接读站内「考试备考」分类，不硬编码链接。
 */

export const revalidate = 3600

const CANONICAL = '/exam'
const INDEX_TITLE = '考试日历 - 国考、四六级、省考、考研倒计时'
const DESCRIPTION =
  '2027 国考、四六级、省考、考研初试的倒计时与关键节点：准考证打印、笔试时间一次看全，附官方报名与备考入口。'
const NAVIGATION_PATH = 'src/navsphere/content/navigation.json'
const SITE_PATH = 'src/navsphere/content/site.json'

const EXAM_ICONS: Record<string, LucideIcon> = {
  guokao: Briefcase,
  cet: Languages,
  shengkao: Landmark,
  kaoyan: GraduationCap,
}

const NODE_DOT_CLASS: Record<string, string> = {
  done: 'bg-muted-foreground/40',
  today: 'bg-emerald-500',
  active: 'bg-emerald-500',
  upcoming: 'bg-sky-500/60',
  estimated: 'bg-amber-500/70',
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: INDEX_TITLE,
    description: DESCRIPTION,
    // 与 /graph 同款写法：canonical 写字面量，canonical-coverage 守卫直接锁字面量
    alternates: { canonical: '/exam' },
    ...(await pageShareMetadata({ url: CANONICAL, title: INDEX_TITLE, description: DESCRIPTION })),
  }
}

/** 备考站点区：读站内「学习成长 / 考试备考」分类（12 站），失败时返回空数组降级 */
async function loadExamPrepSites(): Promise<NavigationSubItem[]> {
  try {
    const [navigationRaw, siteRaw] = await Promise.all([
      getFileContent(NAVIGATION_PATH),
      getFileContent(SITE_PATH),
    ])
    const { navigationData } = getProcessedData(navigationRaw as never, siteRaw as never)
    const category = navigationData.navigationItems.find((c) => c.id === EXAM_PREP_CATEGORY_ID)
    const sub = category?.subCategories?.find((s) => s.id === EXAM_PREP_SUB_ID)
    return sub?.items ?? []
  } catch {
    return []
  }
}

export default async function ExamPage() {
  const prepSites = await loadExamPrepSites()
  const origin = configuredSiteOrigin()
  const nearest = nearestExam()

  return (
    <Container as="main" id="main-content">
      <div className="space-y-8 py-4 sm:space-y-10 sm:py-8">
        <Breadcrumbs
          jsonLd
          items={[
            { label: '首页', path: '/' },
            { label: '考试日历', path: CANONICAL },
          ]}
        />
        {origin ? (
          <JsonLd
            data={{
              '@context': 'https://schema.org',
              '@type': 'ItemList',
              name: '考试日历',
              itemListElement: EXAMS.map((exam, i) => ({
                '@type': 'ListItem',
                position: i + 1,
                name: exam.name,
                url: absUrl(origin, CANONICAL),
              })),
            }}
          />
        ) : null}

        {/* 展板（对齐 /offline 的 market-hero 语言） */}
        <div className="relative overflow-hidden rounded-2xl border border-border/70 glass-surface market-hero subtle-mesh p-6 sm:p-8 shadow-xs">
          <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 w-56 h-56 bg-sky-400/10 rounded-full blur-3xl" />
          <div aria-hidden className="pointer-events-none absolute -left-20 bottom-0 w-44 h-44 bg-emerald-400/10 rounded-full blur-3xl" />
          <CalendarDays
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
              <span className="text-xs text-muted-foreground">考试季</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20 shadow-xs">
                <CalendarDays className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <span>考试日历</span>
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
              国考、四六级、省考、考研——四场大考的倒计时与关键节点，一个页面看全。
            </p>
            <div className="mt-4 pt-3.5 border-t border-border/50 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-sky-500/25 bg-sky-500/5 text-xs text-sky-700 dark:text-sky-400">
                <CalendarDays className="w-3 h-3" />
                {nearest
                  ? `最近一场：${nearest.shortName} · ${nearest.examDateLabel}`
                  : '本轮四场考试均已结束'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                倒计时实时更新 · 日期以官方公告为准
              </span>
            </div>
          </div>
        </div>

        {/* 倒计时卡 + 时间轴 */}
        <section aria-labelledby="exam-countdown-heading">
          <h2 id="exam-countdown-heading" className="text-lg font-bold text-foreground">
            四场大考倒计时
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {EXAMS.map((exam) => {
              const Icon = EXAM_ICONS[exam.id] ?? CalendarDays
              return (
                <article
                  key={exam.id}
                  className="rounded-2xl border border-border bg-card p-5"
                  aria-label={exam.name}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-500/20">
                      <Icon className="w-5 h-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-foreground">{exam.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {exam.tagline} · {exam.examDateLabel}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <ExamCountdown exam={exam} />
                  </div>
                  <ol className="mt-4 space-y-2.5 border-t border-border/60 pt-4">
                    {exam.nodes.map((node) => {
                      const status = examNodeStatus(node)
                      return (
                        <li key={node.label} className="flex items-start gap-2.5 text-sm">
                          <span
                            aria-hidden
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${NODE_DOT_CLASS[status]}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-foreground">{node.label}</span>
                            <span className="text-muted-foreground"> · {node.detail}</span>
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {EXAM_NODE_STATUS_LABEL[status]}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                  {exam.note ? (
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{exam.note}</p>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>

        {/* 撞期与双考提醒 */}
        <section aria-labelledby="exam-reminders-heading">
          <h2 id="exam-reminders-heading" className="text-lg font-bold text-foreground">
            撞期与双考提醒
          </h2>
          <ul className="mt-4 space-y-3">
            {EXAM_REMINDERS.map((reminder) => (
              <li
                key={reminder.title}
                className="flex gap-3 rounded-2xl border border-border bg-card p-4"
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden
                />
                <div>
                  <p className="text-sm font-semibold text-foreground">{reminder.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {reminder.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 备考站点区 */}
        <section aria-labelledby="exam-prep-heading">
          <h2 id="exam-prep-heading" className="text-lg font-bold text-foreground">
            备考官方入口
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            来自站内「考试备考」分类的官方报名与备考平台，按分类原顺序排列。
          </p>
          {prepSites.length > 0 ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {prepSites.map((site) => (
                <li key={site.id} className="rounded-xl border border-border bg-card">
                  <a
                    href={safeHref(site.href)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl p-3.5 transition-colors hover:bg-accent/40"
                  >
                    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg">
                      <SiteFavicon title={site.title} url={site.href} icon={site.icon} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {site.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {site.description}
                      </span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5">
              <p className="text-base font-medium text-foreground">备考站点暂时加载不出来</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                站内数据服务暂时不可用，官方入口清单没能取到。倒计时与关键节点不受影响。
              </p>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{EXAM_DATA_NOTE}</p>
        </section>
      </div>
      <Footer />
    </Container>
  )
}
