import { Metadata } from 'next'
import { AdminDashboardClient } from './AdminDashboardClient'

export const metadata: Metadata = {
  title: '控制台',
  description: '管理后台概览：站点统计、运行状态与快捷入口',
}

export default function AdminDashboardPage() {
  return <AdminDashboardClient />
}