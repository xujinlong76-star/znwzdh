'use client'

import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useMyExams } from '@/hooks/useMyExams'
import {
  EXAM_NODE_STATUS_LABEL,
  examNodeDeadlineLabel,
  examNodeStatus,
  examStatus,
  hasActionableNodes,
  type ExamInfo,
} from '@/lib/exam-calendar'
import {
  checkedCount,
  isFollowed,
} from '@/lib/my-exams'
import { safeHref } from '@/lib/safe-url'

const NODE_DOT_CLASS: Record<string, string> = {
  done: 'bg-muted-foreground/40',
  today: 'bg-emerald-500',
  active: 'bg-emerald-500',
  upcoming: 'bg-sky-500/60',
  estimated: 'bg-amber-500/70',
}

/**
 * 「我的考试」关注 + 考前清单客户端岛（/exam 每场卡片内）。
 *
 * 模式照抄 ExamCountdown：挂载前渲染与服务端一致的未关注视图（只读
 * 时间轴 + 「关注」按钮），挂载后才读 localStorage——未登录时关注与勾选
 * 只存在本机，SSR 与水合结果不会打架；登录后走云端同步（U-379，见
 * useMyExams.syncMyExamsToCloud），换设备也不丢；存储不可用（满了或
 * 被禁）时静默放弃，不阻塞用户看时间轴。
 *
 * 状态走共享 hook useMyExams：十二场卡片与首页条带共用同一份模块级快照，
 * 写操作读共享现态、不读本实例闭包里的旧快照——交错点关注/勾选不再
 * 互相覆盖；存储读坏时 hook 拒写并把原因交回界面。
 */
/**
 * U-124：带 url 节点的链接文案按节点类型映射（只改文案，不改数据/URL）。
 *
 * 默认是准考证打印类（13 处）；10 处例外按 node.label 映射：京考「报名」
 * 是报名系统入口、京考「缴费」是缴费入口（U-395）、京考「公共科目笔试」挂的是首都之窗公告页（非办事入口）、
 * 「江西成绩复核」走报名系统申请、「成绩查询」走广东自考成绩查询系统
 *（江苏自考同名节点无 url、不渲染链接，误伤不到）。C4（2026-11-23）：
 * 广东自考·1月五节点同理映射——「新生预报名」「正式报名」走报名系统、
 * 「考生报考」走报考系统、「网上缴费」走缴费入口、「考试」挂自考系统只作
 * 查看入口（五节点 url 均为 GUANGDONG_ZIKAO_SCORE_URL，不挂默认的打印文案）。
 * ExamNode 无类型字段，映射键只能是 label；
 * 映射只在 node.url 分支内调用，国考/省考同名「公共科目笔试」节点无 url、
 * 不渲染链接，误伤不到。可见文案与 aria-label 同构，只换中间的动作词。
 */
function nodeLinkCopy(label: string): { text: string; ariaAction: string } {
  if (label === '报名') return { text: '去官网报名', ariaAction: '官方报名' }
  if (label === '公共科目笔试') return { text: '查看官方公告', ariaAction: '官方公告' }
  if (label === '江西成绩复核') return { text: '去报名系统申请复核', ariaAction: '报名系统申请复核' }
  if (label === '成绩查询') return { text: '去系统查成绩', ariaAction: '系统查询成绩' }
  if (label === '缴费') return { text: '去官网缴费', ariaAction: '官方缴费' }
  if (label === '新生预报名') return { text: '去官网报名', ariaAction: '官方报名' }
  if (label === '正式报名') return { text: '去官网报名', ariaAction: '官方报名' }
  if (label === '考生报考') return { text: '去官网报考', ariaAction: '官方报考' }
  if (label === '网上缴费') return { text: '去官网缴费', ariaAction: '官方缴费' }
  if (label === '考试') return { text: '去官网查看', ariaAction: '官方查看' }
  return { text: '去官网打印准考证', ariaAction: '官方打印' }
}

export function MyExamTracker({ exam }: { exam: ExamInfo }) {
  const { state, storageBlocked, toggleFollow, toggleNodeCheck } = useMyExams()

  // U-235：60 秒 tick——常驻 /exam 过 18:00 不翻「已截止」是旧 bug；每分钟
  // 按绝对截止时刻重算行文案（examNodeDeadlineLabel），非累减倒计时。
  // 禁用口径不动（U-106 未定：18:00 后复选框是否随之禁用无定论，仍按日期口径）。
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const followed = state !== null && isFollowed(state, exam.id)
  const ended = examStatus(exam, now) === 'ended'
  // R1（2026-11-17）：统考已过但节点仍可办时（成考 11-18 的成绩查询），
  // 卡片行文不写裸「已结束」，改按统考 scoped 文案并指向下方节点；
  // 节点全过后（11-30 起）仍是「本场考试已结束」，行为不变。
  // U-106：禁用口径与纯规则层一致——统考已过但节点仍可办
  // 时未关注用户仍可关注、已关注可继续勾选：按钮 disabled 是 ended &&
  // !hasPendingNodes && !followed（已关注者恒可取消关注），复选框是
  // ended && !hasPendingNodes；节点全过后恢复禁用。
  const hasPendingNodes = ended && hasActionableNodes(exam, now)
  const done = state === null ? 0 : checkedCount(state, exam)
  const checkedLabels = state === null ? [] : (state.checked[exam.id] ?? [])

  function handleFollow() {
    if (state === null) return
    toggleFollow(exam.id)
  }

  function handleCheck(nodeLabel: string) {
    if (state === null) return
    toggleNodeCheck(exam.id, nodeLabel)
  }

  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {followed
            ? `我的考试 · 已完成 ${done} / ${exam.nodes.length}`
            : ended
              ? hasPendingNodes
                ? '统考已结束，下方节点仍可办理'
                : '本场考试已结束'
              : '关注后可逐项勾选考前清单'}
        </p>
        <button
          type="button"
          onClick={handleFollow}
          disabled={storageBlocked !== null || (ended && !hasPendingNodes && !followed)}
          aria-pressed={followed}
          aria-label={followed ? `取消关注${exam.shortName}` : ended && !hasPendingNodes ? `${exam.shortName}已结束` : `关注${exam.shortName}`}
          className="inline-flex min-h-11 items-center rounded-full border border-sky-500/25 bg-sky-500/5 px-3 py-1 text-sm font-medium text-sky-700 dark:text-sky-400"
        >
          {followed ? '已关注' : ended && !hasPendingNodes ? '已结束' : '关注这场考试'}
        </button>
      </div>
      {storageBlocked ? (
        <p role="alert" className="mt-2 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
          {storageBlocked}
        </p>
      ) : null}
      <ol className="mt-3 space-y-2.5">
        {exam.nodes.map((node) => {
          const status = examNodeStatus(node, now)
          // 圆点与徽标同一口径：PEAK 时刻已过（徽标「已截止」）时圆点置灰，
          // 否则沿用日期口径的 NODE_DOT_CLASS；状态机与禁用逻辑不动
          // （门控仍按日期口径，午夜才翻 done；U-106 未定）。
          const deadlineLabel = examNodeDeadlineLabel(exam, node, now)
          const dotClass =
            deadlineLabel === '已截止' ? NODE_DOT_CLASS.done : NODE_DOT_CLASS[status]
          const checked = followed && checkedLabels.includes(node.label)
          const linkCopy = nodeLinkCopy(node.label)
          // U-237：行文本（label + detail）与复选框槽位共用一个 span；已关注态
          // 它被 <label> 包着（点行文字即勾选），未关注态它与圆点槽位并列。
          const text = (
            <span className="min-w-0 flex-1">
              <span
                className={`font-medium ${checked ? 'text-muted-foreground line-through' : 'text-foreground'}`}
              >
                {node.label}
              </span>
              <span className="text-muted-foreground"> · {node.detail}</span>
            </span>
          )
          return (
            <li key={node.label} className="flex items-start gap-2.5 text-sm">
              {followed ? (
                // U-237：<label> 包复选框 + 行文本，点行文字即勾选；行内外链
                // 移出 label（label 内不嵌交互元素），仍是同行兄弟节点。
                // 复选框视觉保持 20px，::after 隐形扩区到 44×44（站内 U-27 同款）。
                <label
                  className={`flex min-w-0 flex-1 items-start gap-2.5 ${ended && !hasPendingNodes ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center after:absolute after:-inset-3 after:content-['']">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleCheck(node.label)}
                      aria-label={checked ? `${node.label}已完成` : `将${node.label}标记为已完成`}
                      disabled={ended && !hasPendingNodes}
                      className="h-5 w-5 shrink-0"
                    />
                  </span>
                  {text}
                </label>
              ) : (
                <>
                  {/* U-237：未关注态圆点与复选框同一 20px 槽位（mt-0.5 + 居中），
                      切换关注时行首标记不跳变。 */}
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                    <span
                      aria-hidden
                      className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`}
                    />
                  </span>
                  {text}
                </>
              )}
              {/* 带官方入口的节点（如四六级准考证打印）挂直达链接：入口
                  在 exam-calendar 常量里，岛内不写死域名；外链过 safeHref。
                  U-237：链接在 label 外，与行文本并列、可点、不误触发勾选。 */}
              {node.url ? (
                <a
                  href={safeHref(node.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${node.label}${linkCopy.ariaAction}入口（新窗口打开）`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-0.5 whitespace-nowrap text-sm font-medium text-sky-700 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400"
                >
                  {linkCopy.text}
                  <ArrowUpRight className="h-4 w-4" aria-hidden />
                </a>
              ) : null}
              {node.portalUrl ? (
                <a
                  href={safeHref(node.portalUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${node.label}专题网站门户入口（新窗口打开）`}
                  className="inline-flex min-h-11 shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-medium text-sky-700 underline decoration-sky-700/40 underline-offset-2 hover:decoration-sky-700 dark:text-sky-400"
                >
                  专题网站门户
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : null}
              <span className="shrink-0 text-xs text-muted-foreground">
                {/* 峰值日包 W10：11-18 七项目标时刻已过时文案读「已截止」
                    （examNodeDeadlineLabel，渲染层时刻口径）；其余节点
                    沿用日期口径的状态文案。只改文案与圆点，不改状态、
                    关注/勾选禁用逻辑（门控仍按日期口径，午夜才翻）；
                    时刻已过时圆点与文案同口径置灰（见上方 dotClass）。 */}
                {deadlineLabel ?? EXAM_NODE_STATUS_LABEL[status]}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
