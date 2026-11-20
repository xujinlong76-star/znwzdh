'use client'

import { useGuokaoChecklist } from '@/hooks/useGuokaoChecklist'
import {
  GUOKAO_CHECKLIST_GROUPS,
  GUOKAO_CHECKLIST_SOURCE_NOTE,
} from '@/lib/guokao-checklist'
import {
  GUOKAO_CHECKLIST_ITEMS,
  groupCheckedCount,
} from '@/lib/guokao-checklist-state'

/**
 * 国考准考证打印前清单勾选岛（U-285，Spec §4.2 C）。
 *
 * 交互照抄 U-237（app/exam/my-exam-tracker.tsx）：
 *  - <label> 包复选框 + 行文本，点行文字即勾选；行内无外链，不嵌交互元素。
 *  - 复选框视觉保持 20px，::after 隐形扩区到 44×44（站内 U-27 同款
 *    after:-inset-3），手机端整行可点。
 *  - 已勾行 line-through，未勾行不打。
 *  - 挂载前渲染与服务端一致的未勾选视图（checked 为 null 时按空数组渲染），
 *    挂载后才读 localStorage——勾选只存在本机，SSR 与水合结果不会打架。
 *
 * 清单项 id 与文案一律复用 W2 内容定稿（@/lib/guokao-checklist），不另编项；
 * 组卡片样式与 B 步静态版逐字一致（rounded-2xl 边框卡片 + 组 footnote）。
 * 与 U-237 的区别（R8）：清单项不是 exam-calendar 节点，绝不复用
 * toggleNodeCheck（未知 label 会静默 no-op）；勾选走新键
 * navhub.guokao-admission-checklist.v1，与「我的考试」关注解耦——
 * 清单页不要求先关注国考，A 组打印开启前就能勾（Spec G3）。
 */
export function GuokaoChecklistIsland() {
  const { checked, storageBlocked, toggle } = useGuokaoChecklist()

  // 挂载前哨兵：按未勾选渲染，与服务端直出一致。
  const done = new Set(checked ?? [])
  const totalDone = GUOKAO_CHECKLIST_ITEMS.filter((i) => done.has(i.id)).length

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {`已完成 ${totalDone} / ${GUOKAO_CHECKLIST_ITEMS.length}`}
        {' · 勾选只保存在本机浏览器，不登录、不跨设备同步'}
      </p>
      {storageBlocked ? (
        <p role="alert" className="mt-2 text-sm leading-relaxed text-amber-700 dark:text-amber-400">
          {storageBlocked}
        </p>
      ) : null}
      <div className="mt-4 space-y-4">
        {GUOKAO_CHECKLIST_GROUPS.map((group) => {
          const groupDone = groupCheckedCount([...done], group)
          return (
            <div
              key={group.id}
              data-checklist-group={group.id}
              className="rounded-2xl border border-border bg-card p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-bold text-foreground">{group.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {`已完成 ${groupDone} / ${group.items.length}`}
                </p>
              </div>
              <ul className="mt-3 space-y-2.5">
                {group.items.map((item) => {
                  const isChecked = done.has(item.id)
                  return (
                    <li
                      key={item.id}
                      data-checklist-item={item.id}
                      className="flex items-start gap-2.5 text-sm"
                    >
                      {/* U-237 同款：<label> 包复选框 + 行文本，点行文字即勾选；
                          复选框视觉 20px，::after 隐形扩区到 44×44。 */}
                      <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                        <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center after:absolute after:-inset-3 after:content-['']">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggle(item.id)}
                            aria-label={
                              isChecked ? `${item.label}已完成` : `将${item.label}标记为已完成`
                            }
                            className="h-5 w-5 shrink-0"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`font-medium ${isChecked ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                          >
                            {item.label}
                          </span>
                          {item.note ? (
                            <span className="text-muted-foreground"> · {item.note}</span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              {group.footnote ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {group.footnote}
                </p>
              ) : null}
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {GUOKAO_CHECKLIST_SOURCE_NOTE}
      </p>
    </div>
  )
}
