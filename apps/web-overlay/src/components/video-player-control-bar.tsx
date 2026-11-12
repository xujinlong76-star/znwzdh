'use client'

/**
 * 视频播放页的播放控制条（上一部/下一部、线路切换、B 站换源、稍后再看，
 * 以及章节/沙箱/笔记/各类学习工具的入口按钮）。
 *
 * 2026-11-09 A-2 第二步：从 video-player-page.tsx 原样搬出，纯搬家不改行为；
 * 只有展示与回调，状态与弹窗开关仍由父组件持有。
 */
import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  Award,
  Brain,
  BrainCircuit,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Code2,
  DownloadCloud,
  FileText,
  Flame,
  FolderArchive,
  FolderTree,
  GitCompare,
  HelpCircle,
  Languages,
  Layers,
  ListCollapse,
  Network,
  PenTool,
  RotateCw,
  ScanText,
  Scissors,
  Share2,
  Shuffle,
  SkipBack,
  SkipForward,
  Timer,
  Users,
  Webhook,
  Zap,
} from 'lucide-react'
import { Button } from "@/registry/new-york/ui/button"
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BILI_ENGINE_OPTIONS } from '@/lib/bili-engine-options'
import type { NavigationSubItem, VideoMirrorSource } from '@/types/navigation'
import type { VideoPlayerTab } from '@/components/video-player-side-panel'

/** 控制条上各工具入口的打开动作（父组件侧全是 setShowX(true)） */
export interface VideoPlayerToolOpeners {
  note: () => void
  poster: () => void
  /** 以下入口由父组件按「无数据不给入口」决定是否传入（2026-11-11 审计第二批）：
   *  flashcards 仅在真有卡片时；certificate / conceptGraph 仅对自带真实章节
   *  的视频；bilingual* 仅在有真实字幕稿时。未传入即不渲染按钮。
   *  频谱 / 神经降噪 / P2P 网格 / 分轨 / P2P 蜂群五个入口已整体下线（无真实
   *  数据管线），不再保留 opener 位。 */
  flashcards?: () => void
  certificate?: () => void
  ocr: () => void
  smartSpeed: () => void
  offline: () => void
  bilingualSubtitles?: () => void
  workspaceExport: () => void
  sessionReplay: () => void
  clipMaker: () => void
  pomodoro: () => void
  remedy: () => void
  autoHarvest: () => void
  autonomousHarvest: () => void
  webhook: () => void
  wasmOcr: () => void
  bilingualTts?: () => void
  conceptGraph?: () => void
  studyRoom: () => void
  quiz: () => void
}

interface VideoPlayerControlBarProps {
  currentIndex: number
  totalVideos: number
  onPrevVideo: () => void
  onNextVideo: () => void
  availableMirrors: VideoMirrorSource[]
  activeMirror: VideoMirrorSource | null
  onSwitchMirror: (mirrorId: string) => void
  biliEngine: string
  onBiliEngineChange: (engineId: string) => void
  inWatchLater: boolean
  onToggleWatchLater: () => void
  activeTab: VideoPlayerTab
  onTabChange: (tab: VideoPlayerTab) => void
  selectedVideo: NavigationSubItem | null
  chaptersCount: number
  codeMilestonesCount: number
  quizCount: number
  flashcardsCount: number
  showSandbox: boolean
  onToggleSandbox: () => void
  showTelestrator: boolean
  onToggleTelestrator: () => void
  smartSpeedEnabled: boolean
  /** 脑图是否有真实数据（父组件按真实章节派生）：无则不渲染知识脑图入口 */
  mindmapAvailable?: boolean
  /** 桌面伴学窗按钮渲染在控制条同一行（该组件静态 import 由首屏体积守卫锁定） */
  pipRenderer: ReactNode
  openers: VideoPlayerToolOpeners
}

export function VideoPlayerControlBar({
  currentIndex,
  totalVideos,
  onPrevVideo,
  onNextVideo,
  availableMirrors,
  activeMirror,
  onSwitchMirror,
  biliEngine,
  onBiliEngineChange,
  inWatchLater,
  onToggleWatchLater,
  activeTab,
  onTabChange,
  selectedVideo,
  chaptersCount,
  codeMilestonesCount,
  quizCount,
  flashcardsCount,
  showSandbox,
  onToggleSandbox,
  showTelestrator,
  onToggleTelestrator,
  smartSpeedEnabled,
  mindmapAvailable,
  pipRenderer,
  openers,
}: VideoPlayerControlBarProps) {
  const showBiliEngine = Boolean(
    selectedVideo && (selectedVideo.videoConfig?.type === 'bilibili' || selectedVideo.videoConfig?.bvid || selectedVideo.videoConfig?.aid)
  )

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/40">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={currentIndex <= 0}
          onClick={onPrevVideo}
          title="上一部视频 ( [ 键 )"
        >
          <SkipBack className="w-3.5 h-3.5" />
          上一部
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={currentIndex < 0 || currentIndex >= totalVideos - 1}
          onClick={onNextVideo}
          title="下一部视频 ( ] 键 )"
        >
          下一部
          <SkipForward className="w-3.5 h-3.5" />
        </Button>

        {/* 多线路镜像源切换 */}
        {availableMirrors.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Layers className="w-3.5 h-3.5 text-primary" />
                <span>{activeMirror?.label || '线路切换'}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 text-xs">
              {availableMirrors.map(m => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => onSwitchMirror(m.id)}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <span>{m.label}</span>
                  {activeMirror?.id === m.id && <Check className="w-3.5 h-3.5 text-primary ml-2 shrink-0" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* B 站 6 级备用解析引擎手动切换 */}
        {showBiliEngine && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs text-[#FB7299] border-[#FB7299]/30 hover:bg-[#FB7299]/10 cursor-pointer"
                title="手动选择 B 站备用解析接口"
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>B站换源: {BILI_ENGINE_OPTIONS.find(o => o.id === biliEngine)?.shortLabel || '自动优选'}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 text-xs">
              <div className="px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground border-b">
                B 站 6 级备用解析引擎（点击手动切换）
              </div>
              {BILI_ENGINE_OPTIONS.map(opt => (
                <DropdownMenuItem
                  key={opt.id}
                  onClick={() => onBiliEngineChange(opt.id)}
                  className="flex items-center justify-between py-1.5 cursor-pointer"
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="font-medium text-foreground">{opt.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate">{opt.desc}</span>
                  </div>
                  {(biliEngine === opt.id || (!biliEngine && opt.id === 'auto')) && (
                    <Check className="w-3.5 h-3.5 text-[#FB7299] shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 稍后再看 */}
        <Button
          variant={inWatchLater ? 'default' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onToggleWatchLater}
          title="加入/移出稍后再看"
        >
          {inWatchLater ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
          <span>{inWatchLater ? '已在稍后再看' : '稍后再看'}</span>
        </Button>

        {/* 章节大纲快捷入口 */}
        <Button
          variant={activeTab === 'chapters' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onTabChange('chapters')}
        >
          <ListCollapse className="w-3.5 h-3.5 text-primary" />
          <span>AI 章节 ({chaptersCount})</span>
        </Button>

        {/* 独立 SEO 收录落地页入口 */}
        {selectedVideo && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            asChild
            title="查看搜索引擎收录专用的结构化语义落地页 (/videos/v/[id])"
          >
            <Link href={`/videos/v/${encodeURIComponent(selectedVideo.id)}`}>
              <FileText className="w-3.5 h-3.5 text-emerald-500" />
              <span>SEO 收录页</span>
            </Link>
          </Button>
        )}

        {/* 演练沙箱入口 */}
        <Button
          variant={showSandbox ? 'default' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onToggleSandbox}
          title="代码演练沙箱"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>{showSandbox ? '收起沙箱' : '演练沙箱'}</span>
        </Button>

        {/* 学习笔记 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.note}
          title="记录时间戳笔记"
        >
          <Camera className="w-3.5 h-3.5 text-emerald-500" />
          <span>记笔记</span>
        </Button>

        {/* 代码演进 */}
        {codeMilestonesCount > 0 && (
          <Button
            variant={activeTab === 'diff' ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => onTabChange('diff')}
            title="代码演进与前后对比"
          >
            <GitCompare className="w-3.5 h-3.5 text-blue-500" />
            <span>代码演进 ({codeMilestonesCount})</span>
          </Button>
        )}

        {/* 知识脑图：仅在脑图有真实章节数据时出现 */}
        {mindmapAvailable && (
          <Button
            variant={activeTab === 'mindmap' ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => onTabChange('mindmap')}
            title="AI 知识图谱与脑图"
          >
            <FolderTree className="w-3.5 h-3.5 text-emerald-500" />
            <span>知识脑图</span>
          </Button>
        )}

        {/* 课后测验 */}
        {quizCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={openers.quiz}
            title="章节通关与课后自测"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-500" />
            <span>自测 ({quizCount}题)</span>
          </Button>
        )}

        {/* 分享海报 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.poster}
          title="生成精美时间戳分享卡片"
        >
          <Share2 className="w-3.5 h-3.5 text-pink-500" />
          <span>分享海报</span>
        </Button>

        {/* 艾宾浩斯抽认卡 */}
        {openers.flashcards && (
  <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={openers.flashcards}
            title="艾宾浩斯遗忘曲线抽认卡与复习日程"
          >
            <Brain className="w-3.5 h-3.5 text-indigo-500" />
            <span>抽认卡 ({flashcardsCount})</span>
          </Button>
        )}

        {/* 结业微证书 */}
        {openers.certificate && (
  <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={openers.certificate}
            title="全套课程通关与可验证结业微证书"
          >
            <Award className="w-3.5 h-3.5 text-yellow-500" />
            <span>结业证书</span>
          </Button>
        )}

        {/* 屏幕涂鸦白板 */}
        <Button
          variant={showTelestrator ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={onToggleTelestrator}
          title="同屏白板涂鸦与时间戳画笔"
        >
          <PenTool className="w-3.5 h-3.5 text-sky-400" />
          <span>{showTelestrator ? '收起涂鸦' : '屏幕涂鸦'}</span>
        </Button>

        {/* 画面代码提取 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.ocr}
          title="端侧提取当前画面中的代码与终端命令"
        >
          <ScanText className="w-3.5 h-3.5 text-emerald-400" />
          <span>画面提取</span>
        </Button>

        {/* 智能静音加速 */}
        <Button
          variant={smartSpeedEnabled ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.smartSpeed}
          title="自适应静音跳跃与倍速调节"
        >
          <Zap className={cn("w-3.5 h-3.5", smartSpeedEnabled ? "text-amber-500 fill-amber-500" : "text-amber-500")} />
          <span>智能加速</span>
        </Button>

        {/* 离线下载缓存 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.offline}
          title="PWA 本地加密缓存与断网播放"
        >
          <DownloadCloud className="w-3.5 h-3.5 text-blue-400" />
          <span>离线缓存</span>
        </Button>

        {/* 桌面画中画伴学悬浮窗 */}
        {pipRenderer}

        {/* 双语字幕 */}
        {openers.bilingualSubtitles && (
  <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={openers.bilingualSubtitles}
            title="双语字幕实时对齐与 SRT/WebVTT 导出"
          >
            <Languages className="w-3.5 h-3.5 text-indigo-400" />
            <span>双语字幕</span>
          </Button>
        )}

                {/* 工程导出 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.workspaceExport}
          title="一键打包生成完整 Git 工程与 Gist"
        >
          <FolderArchive className="w-3.5 h-3.5 text-amber-400" />
          <span>工程导出</span>
        </Button>

        {/* 时空漫游复盘 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.sessionReplay}
          title="学习会话时空漫游与认知负荷复盘"
        >
          <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
          <span>会话复盘</span>
        </Button>

                {/* 视频微知识点一键切片 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.clipMaker}
          title="精细微知识点切片与 WebM/GIF 动图导出"
        >
          <Scissors className="w-3.5 h-3.5 text-amber-400" />
          <span>微切片</span>
        </Button>

        {/* 深度沉浸番茄钟 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.pomodoro}
          title="深度沉浸学习番茄钟与粉红噪音白噪音"
        >
          <Timer className="w-3.5 h-3.5 text-rose-400" />
          <span>专注番茄</span>
        </Button>

                                {/* 贝叶斯自适应弱项诊断 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={openers.remedy}
          title="贝叶斯自适应知识追踪与薄弱点诊断"
        >
          <Brain className="w-3.5 h-3.5 text-purple-400" />
          <span>弱项诊断</span>
        </Button>

        {/* 全网热点自动采集 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
          onClick={openers.autoHarvest}
          title="一键启动全网多源开发者技术热点视频采集"
        >
          <Flame className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
          <span>热点采集</span>
        </Button>

        {/* AI 全程自主采集控制台 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10"
          onClick={openers.autonomousHarvest}
          title="启动 AI 全程无人值守视频采集与大模型审核流水线"
        >
          <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
          <span>AI自主采集</span>
        </Button>

        {/* 多源 Webhook 调度 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
          onClick={openers.webhook}
          title="多源数据流与 Webhook 自动化回调"
        >
          <Webhook className="w-3.5 h-3.5 text-emerald-400" />
          <span>Webhook</span>
        </Button>

        {/* 智能抽帧 OCR */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs border-indigo-500/40 text-indigo-400 hover:bg-indigo-500/10"
          onClick={openers.wasmOcr}
          title="Wasm 视频画面代码智能抽帧与 OCR 提取"
        >
          <ScanText className="w-3.5 h-3.5 text-indigo-400" />
          <span>智能抽帧</span>
        </Button>

        {/* 双语同传与 TTS */}
        {openers.bilingualTts && (
  <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10"
            onClick={openers.bilingualTts}
            title="AI 实时双语字幕与语音重译旁白"
          >
            <Languages className="w-3.5 h-3.5 text-cyan-400" />
            <span>双语TTS</span>
          </Button>
        )}

        {/* 概念图谱 */}
        {openers.conceptGraph && (
  <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            onClick={openers.conceptGraph}
            title="交互式全站概念拓扑图谱与 Dijkstra 最短学习路径"
          >
            <Network className="w-3.5 h-3.5 text-emerald-400" />
            <span>概念图谱</span>
          </Button>
        )}

        {/* 伴学自习室 */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs border-pink-500/40 text-pink-400 hover:bg-pink-500/10"
          onClick={openers.studyRoom}
          title="WebRTC / CRDT 伴学自习室与多人协同白板"
        >
          <Users className="w-3.5 h-3.5 text-pink-400" />
          <span>伴学自习室</span>
        </Button>
      </div>
      <span className="text-xs text-muted-foreground font-mono">
        {currentIndex >= 0 ? `${currentIndex + 1} / ${totalVideos}` : ''}
      </span>
    </div>
  )
}
