'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/registry/new-york/ui/dialog'
import { Button } from '@/registry/new-york/ui/button'
import { Users, Radio, PenTool, Eraser, Send, MessageSquare, Play, Pause, Sparkles } from 'lucide-react'
import {
  StudyRoomCRDTState,
  type WhiteboardStroke,
} from '@/lib/video-study-room-crdt'

interface VideoCrdtStudyRoomDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentVideoTitle?: string
}

export function VideoCrdtStudyRoomDialog({
  open,
  onOpenChange,
  currentVideoTitle = '当前视频课程',
}: VideoCrdtStudyRoomDialogProps) {
  const [crdt] = useState(() => new StudyRoomCRDTState('room-deepseek-2026', 'peer-me-888', true))
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [color, setColor] = useState<string>('#38bdf8')
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([])
  const [chatInput, setChatInput] = useState<string>('')
  const [messages, setMessages] = useState<Array<{ sender: string; text: string; time: number }>>([
    { sender: '伴学助教-001', text: '欢迎加入自习室！支持画笔同步标注与避坑打卡。', time: Date.now() },
  ])

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const isDrawing = useRef<boolean>(false)
  const currentPath = useRef<Array<{ x: number; y: number }>>([])

  // Redraw canvas whenever strokes change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    strokes.forEach(s => {
      if (s.points.length < 2) return
      ctx.beginPath()
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.moveTo(s.points[0].x, s.points[0].y)
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x, s.points[i].y)
      }
      ctx.stroke()
    })
  }, [strokes])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawing.current = true
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    currentPath.current = [{ x, y }]
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    currentPath.current.push({ x, y })

    // Quick draw feedback
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    const pts = currentPath.current
    if (pts.length > 1) {
      ctx.beginPath()
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y)
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
      ctx.stroke()
    }
  }

  const handleMouseUp = () => {
    if (!isDrawing.current) return
    isDrawing.current = false
    if (currentPath.current.length > 1) {
      const newStroke: WhiteboardStroke = {
        id: `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        authorId: crdt.getLocalPeerId(),
        color,
        width: 2,
        points: [...currentPath.current],
        createdAt: Date.now(),
      }
      crdt.addStroke(newStroke)
      setStrokes(crdt.getStrokes())
    }
    currentPath.current = []
  }

  const handleClearCanvas = () => {
    crdt.clearCanvas()
    setStrokes([])
  }

  const handleTogglePlayback = () => {
    const nextState = !isPlaying
    setIsPlaying(nextState)
    crdt.updatePlayback({ isPlaying: nextState })
  }

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return
    crdt.addChatMessage('我', chatInput.trim())
    setMessages(crdt.getMessages())
    setChatInput('')
  }

  const peers = crdt.getPeers()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="shrink-0 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center justify-between text-base font-bold">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <span>WebRTC / CRDT 伴学自习室与音画协同白板</span>
                <p className="text-[11px] font-normal text-muted-foreground mt-0.5">
                  亚秒级时钟漂移补偿 · 多人画笔同屏协同 · 实时答疑交流
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="flex items-center gap-1 text-emerald-400">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>房间在线: {peers.length + 2} 人</span>
              </span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pt-2 text-xs">
          {/* Synchronized Playback Sync Bar */}
          <div className="flex items-center justify-between p-2.5 rounded-lg border border-border/60 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground truncate max-w-xs">{currentVideoTitle}</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary font-mono">
                同步对齐
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleTogglePlayback}
                className="h-7 px-3 text-xs gap-1.5"
              >
                {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />}
                <span>{isPlaying ? '自习室暂停' : '自习室同步播放'}</span>
              </Button>
            </div>
          </div>

          {/* Collaborative Whiteboard Canvas */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
              <div className="flex items-center gap-2">
                <PenTool className="w-3.5 h-3.5 text-primary" />
                <span>多人协同画笔与代码重点勾画</span>
                <div className="flex items-center gap-1.5 ml-2">
                  {['#38bdf8', '#34d399', '#f43f5e', '#fbbf24'].map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-4 h-4 rounded-full border ${color === c ? 'scale-125 border-foreground shadow-sm' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearCanvas}
                className="h-6 px-2 text-[10px] gap-1"
              >
                <Eraser className="w-3 h-3" />
                <span>清空画板</span>
              </Button>
            </div>

            <div className="w-full h-44 rounded-lg border border-border/70 bg-zinc-950 relative overflow-hidden shadow-inner">
              <canvas
                ref={canvasRef}
                width={600}
                height={176}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                className="w-full h-full cursor-crosshair"
              />
              <div className="absolute bottom-2 right-2 text-[10px] text-zinc-600 font-mono pointer-events-none select-none">
                CRDT Vector Canvas (LWW-Clock)
              </div>
            </div>
          </div>

          {/* Chat room messages */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <MessageSquare className="w-3.5 h-3.5 text-primary" />
              <span>自习室交流</span>
            </div>
            <div className="h-28 p-2.5 rounded-lg border border-border/60 bg-muted/20 overflow-y-auto space-y-1.5 font-sans">
              {messages.map((m, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="font-semibold text-primary shrink-0">{m.sender}:</span>
                  <span className="text-foreground">{m.text}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendMessage} className="flex items-center gap-2">
              <input aria-label="学习房间聊天输入"
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="发送伴学讨论消息..."
                className="flex-1 h-8 px-2.5 rounded-md bg-background border border-border text-xs"
              />
              <Button size="sm" type="submit" className="h-8 px-3 text-xs gap-1">
                <Send className="w-3 h-3" />
                <span>发送</span>
              </Button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
