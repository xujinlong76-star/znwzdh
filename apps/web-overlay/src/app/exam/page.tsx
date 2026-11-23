import type { Metadata } from 'next'
import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  GraduationCap,
  Landmark,
  Languages,
  Shield,
  type LucideIcon,
} from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Footer } from '@/components/footer'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { JsonLd } from '@/components/json-ld'
import { SiteFavicon } from '@/components/site-favicon'
import { loadExamPrepSites } from '@/lib/exam-prep-sites'
import { safeHref } from '@/lib/safe-url'
import { configuredSiteOrigin } from '@/lib/seo/origin'
import { absUrl } from '@/lib/seo/json-ld'
import { pageShareMetadata } from '@/lib/seo/metadata'
import {
  EXAMS,
  EXAM_DATA_NOTE,
  activeExamReminders,
  isGuokaoAdmissionClosed,
  nearestExam,
} from '@/lib/exam-calendar'
import { ExamCountdown } from './exam-countdown'
import { GuokaoAdmissionReminderIsland } from '@/components/guokao-admission-reminder'
import { MyExamTracker } from './my-exam-tracker'

/**
 * 考试日历页（/exam，服务端渲染 + 倒计时客户端岛）。
 *
 * 存在理由：2026 年考试季十二场大考（见 EXAMS，不再此处枚举场次与日期，
 * 注释枚举与数据不同步正是本次漂移的根因），站内只有分散的报名入口，没有
 * 一处能同时看到倒计时与关键节点；三家大导航同期也没有像样的考试
 * 专题或倒计时（360 只有一个内容过期到 2024/2025 的财会考试日历）。
 * 第一轮只做最小静态页：倒计时卡 + 十二场时间轴 + 撞期与双考提醒 +
 * 备考站点区；第二轮已落地「我的考试」关注 + 考前清单待办（未登录存
 * 本机 localStorage，登录后走云端同步、换设备也不丢，见 src/lib/my-exams.ts）。
 *
 * 日期全部据官方公告核实（见 src/lib/exam-calendar.ts 文件头），
 * 备考站点区直接读站内「考试备考」分类，不硬编码链接。
 */

export const revalidate = 3600

const CANONICAL = '/exam'
const INDEX_TITLE = `考试日历 - ${EXAMS.map((e) => e.shortName).join('、')}倒计时`
const DESCRIPTION = `${EXAMS.map((e) => e.shortName).join('、')}的倒计时与关键节点：准考证打印、笔试时间、成绩查询一次看全，附报名与备考入口。`
const EMPTY_TITLE = `考试日历 - ${EXAMS.map((e) => e.shortName).join('、')}`
const EMPTY_DESCRIPTION = `本轮${EXAMS.length}场考试已结束，时间与关键节点备查；新日程以官方公告为准。`

const EXAM_ICONS: Record<string, LucideIcon> = {
  guokao: Briefcase,
  cet: Languages,
  shengkao: Landmark,
  jingkao: Building2,
  kaoyan: GraduationCap,
  'jiaoshi-mianshi': BookOpen,
  'jundui-wenzhi': Shield,
}

export async function generateMetadata(): Promise<Metadata> {
  const nearest = nearestExam()
  const title = nearest ? INDEX_TITLE : EMPTY_TITLE
  const description = nearest ? DESCRIPTION : EMPTY_DESCRIPTION
  return {
    title,
    description,
    // 与 /graph 同款写法：canonical 写字面量，canonical-coverage 守卫直接锁字面量
    alternates: { canonical: '/exam' },
    ...(await pageShareMetadata({ url: CANONICAL, title, description })),
  }
}

/** 备考站点区重试（U-238）：服务端重新取数，不新造取数链路。 */
async function retryExamPrepSites() {
  'use server'
  revalidatePath('/exam')
}

export default async function ExamPage() {
  const prepSites = await loadExamPrepSites()
  const origin = configuredSiteOrigin()
  const nearest = nearestExam()
  // 国考准考证打印是否已截止（2026-11-23 15:22 轮 W3 R1）：只读
  // isGuokaoAdmissionClosed()（与 guokaoAdmissionPhase() 同一门控、
  // 同一截止常量），清单入口文案截止后改过去时。服务端直出随
  // revalidate 3600 翻态、最多迟 1 小时，与本页提醒岛（60 秒 tick）
  // 的翻态速度不同，属已知滞后，不另造客户端岛只为一行文案。
  const guokaoClosed = isGuokaoAdmissionClosed(Date.now())
  // 撞期提醒只读数据层派生（activeExamReminders，过期自动隐藏）：
  // 12-07 起省考两条下线、12-20 起三条全下线，不读 EXAM_REMINDERS 原数组。
  const reminders = activeExamReminders()

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
              {nearest
                ? `${EXAMS.map((e) => e.shortName).join('、')}——${EXAMS.length}场大考的倒计时与关键节点，一个页面看全。`
                : `${EXAMS.map((e) => e.shortName).join('、')}——${EXAMS.length}场大考的时间与关键节点，一个页面看全。`}
            </p>
            <div className="mt-4 pt-3.5 border-t border-border/50 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-sky-500/25 bg-sky-500/5 text-xs text-sky-700 dark:text-sky-400">
                <CalendarDays className="w-3 h-3" />
                {nearest
                  ? `最近一场：${nearest.shortName} · ${nearest.examDateLabel}`
                  : `本轮${EXAMS.length}场考试均已结束`}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/60 bg-background/60 text-xs text-muted-foreground">
                {nearest ? '倒计时实时更新 · 日期以官方公告为准' : '日期以官方公告为准'}
              </span>
            </div>
          </div>
        </div>

        {/* 倒计时卡 + 时间轴 */}
        <section aria-labelledby="exam-countdown-heading">
          <h2 id="exam-countdown-heading" className="text-lg font-bold text-foreground">
            {nearest ? `${EXAMS.length}场大考倒计时` : `${EXAMS.length}场大考`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            关注考试后可逐项勾选考前清单；登录后关注与勾选跟账号走，换设备也不丢，未登录只保存在本机浏览器。
          </p>
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
                  <MyExamTracker exam={exam} />
                  {/* 国考准考证打印提醒岛：只在国考卡片、只在 11-22–11-29 15:00
                      渲染提醒块；挂载前渲染 null，15:00 边界 60 秒 tick 重算、
                      最长迟 1 分钟下线（服务端页 revalidate 1 小时，直出会迟到
                      1 小时，故走客户端岛）。
                      官方链接在 exam-calendar 常量里，不在页面写死域名。 */}
                  {exam.id === 'guokao' ? <GuokaoAdmissionReminderIsland exam={exam} /> : null}
                  {/* U-285 D 步：国考卡片内清单页入口一行（提醒岛之后、note 之前）。
                      常驻显示，不随门控隐藏——清单页 11-23 前即可访问；内部
                      路由用 Next Link，不写死域名、不挂外链。
                      R1（2026-11-23 15:22 轮 W3）：11-29 15:00 截止后文案改
                      过去时「准考证打印已截止 · 清单回顾」，不留进行时误导。 */}
                  {exam.id === 'guokao' ? (
                    <p className="mt-3">
                      <Link
                        href="/exam/guokao-checklist"
                        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-sky-700 hover:underline dark:text-sky-400"
                      >
                        {guokaoClosed
                          ? '准考证打印已截止 · 清单回顾 →'
                          : '打印前清单：三件事先勾好 →'}
                      </Link>
                    </p>
                  ) : null}
                  {exam.note ? (
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{exam.note}</p>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>

        {/* 撞期与双考提醒：三条全过期时整区隐藏，不留空壳 */}
        {nearest && reminders.length > 0 ? (
          <section aria-labelledby="exam-reminders-heading">
            <h2 id="exam-reminders-heading" className="text-lg font-bold text-foreground">
              撞期与双考提醒
            </h2>
            <ul className="mt-4 space-y-3">
              {reminders.map((reminder) => (
                <li
                  key={reminder.title}
                  className="flex gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  <AlertTriangle
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400"
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
        ) : null}

        {/* 备考站点区 */}
        <section aria-labelledby="exam-prep-heading">
          <h2 id="exam-prep-heading" className="text-lg font-bold text-foreground">
            备考入口
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            来自站内「考试备考」分类的报名与备考平台，按分类原顺序排列。
          </p>
          {/* U-238：三态空态——失败给重试（服务端 revalidatePath 重新取数），
              分类空指往 /sites；失败不再被说成「分类为空」，分类空不再被
              说成「服务不可用」。revalidate 3600 下服务恢复后重试即取新数。 */}
          {prepSites.status === 'ok' ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {prepSites.sites.map((site) => (
                <li key={site.id} className="min-w-0 rounded-xl border border-border bg-card">
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
          ) : prepSites.status === 'error' ? (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5">
              <p className="text-base font-medium text-foreground">备考站点暂时加载不出来</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                站内数据服务暂时不可用，备考入口清单没能取到。考试时间与关键节点不受影响。
              </p>
              <form action={retryExamPrepSites} className="mt-3">
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 dark:text-sky-400"
                >
                  重试
                </button>
              </form>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-border bg-card p-5">
              <p className="text-base font-medium text-foreground">备考分类暂无站点</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                「考试备考」分类下暂时没有站点，考试时间与关键节点不受影响。可以去全部站点里找备考入口。
              </p>
              <Link
                href="/sites"
                className="mt-3 inline-flex min-h-11 items-center rounded-full border border-sky-500/25 bg-sky-500/5 px-3.5 text-sm font-medium text-sky-700 dark:text-sky-400"
              >
                去全部站点找备考入口
              </Link>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{EXAM_DATA_NOTE}</p>
        </section>
      </div>
      <Footer />
    </Container>
  )
}
