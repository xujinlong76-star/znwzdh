'use client'

import React, { useState } from 'react'
import {
  HelpCircle,
  CheckCircle2,
  XCircle,
  Award,
  ArrowRight,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/registry/new-york/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import {
  type VideoQuizQuestion,
  gradeQuizAnswers,
  quizCorrectIndex,
} from '@/lib/video-quiz-generator'

interface VideoQuizDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  questions: VideoQuizQuestion[]
  videoTitle?: string
}

export function VideoQuizDialog({
  open,
  onOpenChange,
  questions,
  videoTitle = '技术视频',
}: VideoQuizDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({})
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({})
  const [isFinished, setIsFinished] = useState(false)

  if (!questions || questions.length === 0) return null

  const currentQ = questions[currentIndex]
  const currentAnswer = selectedAnswers[currentQ?.id]
  const isCurrentSubmitted = submitted[currentQ?.id]

  const handleSelectOption = (index: number) => {
    if (isCurrentSubmitted) return
    setSelectedAnswers(prev => ({ ...prev, [currentQ.id]: index }))
  }

  const handleSubmitCurrent = () => {
    if (typeof currentAnswer !== 'number') return
    setSubmitted(prev => ({ ...prev, [currentQ.id]: true }))
  }

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1)
    } else {
      setIsFinished(true)
    }
  }

  const handleRestart = () => {
    setCurrentIndex(0)
    setSelectedAnswers({})
    setSubmitted({})
    setIsFinished(false)
  }

  const scorecard = gradeQuizAnswers(questions, selectedAnswers)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-zinc-950 border-zinc-800 text-zinc-100 p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-zinc-100">
            <Sparkles className="w-5 h-5 text-primary" />
            <span>随堂技术评测与知识断点检验</span>
          </DialogTitle>
        </DialogHeader>

        {!isFinished && currentQ ? (
          <div className="space-y-4 pt-2 text-xs">
            {/* Progress indicator */}
            <div className="flex items-center justify-between text-zinc-400 font-mono text-[11px]">
              <span>
                题目 {currentIndex + 1} / {questions.length}
              </span>
              {currentQ.chapterTitle && (
                <span className="text-primary truncate max-w-[200px]">
                  📌 {currentQ.chapterTitle}
                </span>
              )}
            </div>

            {/* Question Text */}
            <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 font-medium text-sm leading-relaxed text-zinc-200">
              {currentQ.question}
            </div>

            {/* Options List */}
            <div className="space-y-2">
              {currentQ.options.map((option, idx) => {
                const isSelected = currentAnswer === idx
                // 两套字段并存（correctIndex / correctAnswerIndex），必须走统一读取口径。
                // 直接写 `idx === currentQ.correctIndex` 时，AI 生成的题永远判错。
                const isCorrect = idx === quizCorrectIndex(currentQ)

                let btnStyle = 'border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-300'
                if (isCurrentSubmitted) {
                  if (isCorrect) {
                    btnStyle = 'border-emerald-600/80 bg-emerald-950/40 text-emerald-300'
                  } else if (isSelected && !isCorrect) {
                    btnStyle = 'border-red-600/80 bg-red-950/40 text-red-300'
                  }
                } else if (isSelected) {
                  btnStyle = 'border-primary bg-primary/10 text-primary'
                }

                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectOption(idx)}
                    className={`w-full text-left p-3 rounded-lg border transition-all text-xs flex items-center justify-between ${btnStyle}`}
                  >
                    <span>{option}</span>
                    {isCurrentSubmitted && isCorrect && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 ml-2" />
                    )}
                    {isCurrentSubmitted && isSelected && !isCorrect && (
                      <XCircle className="w-4 h-4 text-red-400 shrink-0 ml-2" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Explanation */}
            {isCurrentSubmitted && (
              <div className="p-3 rounded-lg bg-zinc-900/90 border border-zinc-800 text-zinc-300 text-[11px] leading-relaxed animate-in fade-in">
                <span className="font-semibold text-primary block mb-1">
                  💡 知识点解析:
                </span>
                {currentQ.explanation}
              </div>
            )}

            {/* Action Bar */}
            <div className="flex items-center justify-between pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-xs text-zinc-400"
              >
                稍后再测
              </Button>

              {!isCurrentSubmitted ? (
                <Button
                  size="sm"
                  onClick={handleSubmitCurrent}
                  disabled={typeof currentAnswer !== 'number'}
                  className="text-xs"
                >
                  确认答案
                </Button>
              ) : (
                <Button size="sm" onClick={handleNext} className="text-xs gap-1">
                  <span>
                    {currentIndex < questions.length - 1 ? '下一题' : '查看结果'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* Finished Scorecard */
          <div className="py-6 text-center space-y-4 text-xs">
            <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mx-auto text-primary">
              <Award className="w-8 h-8" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-zinc-100">随堂评测完成！</h3>
              <p className="text-zinc-400 text-xs mt-1">{videoTitle}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto py-2">
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block">答对题数</span>
                <span className="text-base font-bold text-emerald-400 font-mono">
                  {scorecard.correctCount}/{scorecard.totalQuestions}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block">得分</span>
                <span className="text-base font-bold text-primary font-mono">
                  {scorecard.score}
                </span>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block">掌握等级</span>
                <span className="text-xs font-bold text-zinc-200 uppercase mt-0.5 block">
                  {scorecard.masteryLevel}
                </span>
              </div>
            </div>

            <div className="flex justify-center gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={handleRestart} className="text-xs gap-1">
                <RotateCcw className="w-3.5 h-3.5" /> 再测一次
              </Button>
              <Button size="sm" onClick={() => onOpenChange(false)} className="text-xs">
                完成并继续观看
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
