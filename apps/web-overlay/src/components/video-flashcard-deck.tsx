'use client'

import React, { useState } from 'react'
import {
  type FlashcardItem,
  calculateNextSM2Schedule,
} from '@/lib/video-spaced-repetition'
import { Button } from '@/registry/new-york/ui/button'
import { Check, BrainCircuit } from 'lucide-react'

/**
 * 抽认卡面板：AI 学习中心（video-ai-learning-dialog）里「抽认卡」tab 的内容。
 * 只合入口：SM-2 间隔复习逻辑原样保留；独立 Dialog 外壳已随入口合并删除，
 * 弹窗外壳与关闭由 AI 学习中心统一提供。
 */
interface VideoFlashcardPanelProps {
  cards: FlashcardItem[]
  videoTitle: string
}

export function VideoFlashcardPanel({
  cards: initialCards,
}: VideoFlashcardPanelProps) {
  const [deck, setDeck] = useState<FlashcardItem[]>(initialCards)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)

  if (deck.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground space-y-2">
        <p>暂无待复习闪卡。记笔记即可自动生成记忆卡片！</p>
      </div>
    )
  }

  const currentCard = deck[currentIndex] || deck[0]
  const isFinished = currentIndex >= deck.length

  const handleRate = (grade: number) => {
    const updated = calculateNextSM2Schedule(currentCard, grade)
    setDeck(prev => {
      const copy = [...prev]
      copy[currentIndex] = updated
      return copy
    })
    setCompletedCount(prev => prev + 1)
    setShowAnswer(false)
    setCurrentIndex(prev => prev + 1)
  }

  return (
    <div className="space-y-4 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm">智能抽认卡 (SM-2 间隔复习)</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground">
          {Math.min(currentIndex + 1, deck.length)} / {deck.length}
        </span>
      </div>

      {isFinished ? (
        <div className="py-8 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto flex items-center justify-center">
            <Check className="w-6 h-6" />
          </div>
          <h3 className="font-semibold text-sm">今日复习任务已完成！</h3>
          <p className="text-xs text-muted-foreground">
            共完成 {completedCount} 张记忆闪卡。基于遗忘曲线，系统已为您自动安排下一次强化复习日程。
          </p>
        </div>
      ) : (
        <div className="space-y-4 pt-2 text-xs">
          {/* Flashcard Box */}
          <div
            role="button"
            tabIndex={0}
            aria-pressed={showAnswer}
            aria-label={showAnswer ? '收起答案' : '翻转卡片查看答案'}
            onClick={() => setShowAnswer(prev => !prev)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setShowAnswer(prev => !prev)
              }
            }}
            className="p-5 rounded-xl border border-border bg-card hover:border-primary/50 transition-all cursor-pointer min-h-[160px] flex flex-col justify-between shadow-lg"
          >
            <div className="space-y-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                {showAnswer ? '💡 解答与解析' : '❓ 核心问题'}
              </span>
              <p className="text-sm font-semibold text-foreground leading-relaxed">
                {currentCard.question}
              </p>
              {showAnswer && (
                <div className="pt-2 border-t border-border/40 text-xs text-emerald-400 dark:text-emerald-300 leading-relaxed animate-in fade-in">
                  {currentCard.answer}
                  {currentCard.explanation && (
                    <p className="text-[11px] text-muted-foreground pt-1.5 font-normal">
                      {currentCard.explanation}
                    </p>
                  )}
                </div>
              )}
            </div>

            {!showAnswer && (
              <div className="text-center text-[11px] text-muted-foreground pt-2">
                (点击卡片翻看答案)
              </div>
            )}
          </div>

          {/* SM-2 Rating Buttons */}
          {showAnswer && (
            <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
              <div className="text-[11px] text-center text-muted-foreground font-medium">
                请评估记忆掌握程度以调度下一次复习间隔：
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-xs font-mono">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-col py-0.5 text-red-400 hover:text-red-300"
                  onClick={() => handleRate(1)}
                >
                  <span>重来</span>
                  <span className="text-[9px] text-muted-foreground">1天</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-col py-0.5 text-amber-400 hover:text-amber-300"
                  onClick={() => handleRate(2)}
                >
                  <span>困难</span>
                  <span className="text-[9px] text-muted-foreground">1天</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-col py-0.5 text-blue-400 hover:text-blue-300"
                  onClick={() => handleRate(3)}
                >
                  <span>良好</span>
                  <span className="text-[9px] text-muted-foreground">6天</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 flex-col py-0.5 text-emerald-400 hover:text-emerald-300 font-bold"
                  onClick={() => handleRate(5)}
                >
                  <span>简单</span>
                  <span className="text-[9px] text-muted-foreground">10天+</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
