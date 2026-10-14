import { Metadata } from 'next'
import { BookmarkImporter } from '@/components/bookmark-importer'
import { Footer } from '@/components/footer'

export const metadata: Metadata = {
  title: '浏览器书签一键导入 - NavHub',
  description: '快速将 Chrome、Edge、Safari 或 Firefox 导出的 HTML 书签导入到 NavHub，支持 AI 智能自动归类。',
}

export default function ImportPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex-1">
        <BookmarkImporter />
      </div>
      <Footer />
    </div>
  )
}
