import { VideoPlayerPage } from '@/components/video-player-page'
import { Metadata } from 'next/types'
import { getProcessedData } from '@/lib/data-loader'
import { getFileContent } from '@/lib/github'

/**
 * NavHub 改动：同 /videos —— 数据改为从中枢异步读取，不可用时回退到构建期基线。
 *（原为 import 构建期静态 JSON）
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
        title: '视频播放器',
        description: '视频播放中心',
        keywords: 'Bilibili, YouTube, Videos, Player',
        icons: {
            icon: siteData.appearance.favicon,
        },
    }
}

export default async function VideoPlayerRoute() {
    const { navigationData, siteData } = await getData()

    return (
        <main id="main-content">
            <VideoPlayerPage navigationData={navigationData} siteData={siteData} />
        </main>
    )
}
