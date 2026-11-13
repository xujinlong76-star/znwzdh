import { nearestExam, nextExamNode } from '@/lib/exam-calendar'
import { HomeExamStripView } from './home-exam-strip-view'

/**
 * 首页「考试季」运营条（服务端外壳）。
 *
 * 服务端只做一件事：按事实源挑全局最近一场，四场全结束时整条不渲染。
 * 关注个性化不在服务端做——关注状态只存在浏览器 localStorage，服务端
 * 读不到；挂载后的优先显示由客户端视图 HomeExamStripView 接手（挂载前
 * 渲染与服务端直出完全一致，防 SSR/水合 mismatch）。
 * 入口唯一链接指向 /exam；结构仿 HomeBriefStrip，无数据不渲染。
 */
export function HomeExamStrip() {
  const nearest = nearestExam()
  if (!nearest) return null
  return <HomeExamStripView exam={nearest} nextNode={nextExamNode(nearest)} />
}
