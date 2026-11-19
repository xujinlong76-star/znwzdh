'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { ExamCorrectionNote, LatestExamVerificationRef } from '@/lib/exam-verification'

/**
 * /exam 核验取数上下文（R1 更正闭环）。
 *
 * 服务端（page.tsx）用 loadExamVerificationLookup() 取最新核查行与更正行后，
 * 经本 Provider 传给 ExamCountdown 客户端岛；岛内用 useExamVerificationLookup()
 * 取数，不直连库、不另设取数链路。Provider 缺省值为空表（无核查行时准入闸
 * 只按节点 5 字段判定、无更正注），故首页条带等未包 Provider 的调用点行为不变。
 *
 * 用 Context 而不用 props：page.tsx 有源码守卫锁死字面量
 * `<ExamCountdown exam={exam} />`（apps/web/test/exam-page.test.ts
 * “倒计时走客户端岛，服务端 JSX 里不直出天数”），props 会破坏该字面量。
 */
export interface ExamVerificationLookupValue {
  latestByKey: Readonly<Record<string, LatestExamVerificationRef>>
  correctionsByKey: Readonly<Record<string, readonly ExamCorrectionNote[]>>
}

const EMPTY_LOOKUP: ExamVerificationLookupValue = { latestByKey: {}, correctionsByKey: {} }

const ExamVerificationContext = createContext<ExamVerificationLookupValue>(EMPTY_LOOKUP)

export function ExamVerificationProvider({
  value,
  children,
}: {
  value: ExamVerificationLookupValue
  children: ReactNode
}) {
  return (
    <ExamVerificationContext.Provider value={value}>{children}</ExamVerificationContext.Provider>
  )
}

export function useExamVerificationLookup(): ExamVerificationLookupValue {
  return useContext(ExamVerificationContext)
}
