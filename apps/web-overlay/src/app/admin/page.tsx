import { Metadata } from 'next'
import { AdminDashboardClient } from './AdminDashboardClient'

export const metadata: Metadata = {
  title: '控制台 - NavSphere Admin',
  description: 'NavSphere 管理后台控制台',
}

export default function AdminDashboardPage() {
  return <AdminDashboardClient />
}