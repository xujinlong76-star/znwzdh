import { VideoContent } from '@/components/video-content'
import { Metadata } from 'next/types'
import { ScrollToTop } from '@/components/ScrollToTop'
import { getProcessedData } from '@/lib/data-loader'
import { getFileContent } from '@/lib/github'
import { pageShareMetadata } from '@/lib/seo/metadata'

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
    title: '视频中心',
    // 点击行为是站内弹窗播放或无播放配置时直达原站，不是「进入站内播放页」
    description: '按分类浏览收录的视频与教程，支持站内弹窗播放或直达原站',
    alternates: { canonical: '/videos' },
    // 视频库仍是占位内容：先不参与收录（follow 保留内链权重），
    // 同时已从 sitemap 移除；内容补齐后再放开。
    robots: { index: false, follow: true },
    ...(await pageShareMetadata({ url: '/videos' })),
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
