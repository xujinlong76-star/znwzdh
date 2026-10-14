import { VideoContent } from '@/components/video-content'
import { Metadata } from 'next/types'
import { ScrollToTop } from '@/components/ScrollToTop'
import { Container } from '@/components/ui/container'
import { getProcessedData } from '@/lib/data-loader'
import { getFileContent } from '@/lib/github'

/**
 * NavHub 改动：数据改为从中枢异步读取（原为 import 构建期静态 JSON），
 * 使视频导航内容与站点配置都来自数据库；中枢不可用时回退到构建期基线。
 * force-dynamic 是必需的 —— 否则元信息会被固化在构建产物里（首页踩过这个坑）。
 */
export const dynamic = 'force-dynamic'

const VIDEOS_PATH = 'src/navsphere/content/videos.json'
const SITE_PATH = 'src/navsphere/content/site.json'

async function getData() {
  const [videosRaw, siteRaw] = await Promise.all([
    getFileContent(VIDEOS_PATH),
    getFileContent(SITE_PATH),
  ])
  return getProcessedData(videosRaw as never, siteRaw as never)
}

export async function generateMetadata(): Promise<Metadata> {
  const { siteData } = await getData()

  return {
    // 只写页面名：根 layout 的 title.template 会统一追加站点名
    title: 'Videos',
    description: 'Video Navigation',
    keywords: 'Bilibili, YouTube, Videos',
    icons: {
      icon: siteData.appearance.favicon,
    },
  }
}

export default async function VideosPage() {
  const { navigationData, siteData } = await getData()

  return (
    <>
      <VideoContent navigationData={navigationData} siteData={siteData} />
      <ScrollToTop />
    </>
  )
}
