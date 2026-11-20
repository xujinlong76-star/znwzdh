'use client'

/**
 * 国考准考证打印前清单（U-285）的本地勾选 hook。
 *
 * 模式照抄 hooks/useMyExams.ts 的纪律，单键简化（本页只有一个清单岛，
 * 不需要模块级多卡片共享快照）：
 *  - 挂载前 checked 为 null（哨兵，与服务端渲染一致的未勾选视图），挂载后
 *    才读 localStorage——勾选只存在本机，SSR 与水合结果不会打架。
 *  - 读不出来（JSON 损坏、存储被禁）时拒绝覆盖并把原因交回界面
 *    （storageBlocked），绝不把坏数据伪装成空清单后照写。
 *  - 写操作读本实例现态派生；跨 tab 靠 storage 事件刷新。
 * 只保存在本机，不上传、不跨设备同步；新键
 * navhub.guokao-admission-checklist.v1，旧键 navhub.my-exams.v1 不动。
 */

import { useCallback, useEffect, useState } from 'react'
import {
  GUOKAO_CHECKLIST_STORAGE_KEY,
  parseGuokaoChecklist,
  toggleGuokaoChecklist,
} from '@/lib/guokao-checklist-state'

const KEY = GUOKAO_CHECKLIST_STORAGE_KEY

export interface GuokaoChecklistApi {
  /** null = 还没读过本机存储（挂载前哨兵，与服务端渲染一致的未勾选视图） */
  checked: string[] | null
  /** 非 null = 本地存储读不出来：写入被拒，界面必须把原因显示出来 */
  storageBlocked: string | null
  /** 勾选 / 取消勾选一项；未知 id 或存储被拒时 no-op 返回 false */
  toggle: (id: string) => boolean
}

export function loadGuokaoChecklistLocal(): {
  checked: string[]
  blocked: string | null
} {
  if (typeof window === 'undefined') return { checked: [], blocked: null }
  let raw: string | null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch {
    return {
      checked: [],
      blocked: '浏览器不允许读写本地存储（隐私模式或权限被拒），本次清单勾选改动无法保存。',
    }
  }
  if (raw === null) return { checked: [], blocked: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      checked: [],
      blocked:
        '本地清单勾选读不出来（可能写入中断，或被其他程序改写）。为避免覆盖掉原数据，已暂停保存清单勾选改动 —— 原数据仍在浏览器里。',
    }
  }
  return { checked: parseGuokaoChecklist(parsed), blocked: null }
}

export function saveGuokaoChecklistLocal(checked: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(checked))
  } catch {
    // 存储满 / 隐私模式：内存态仍然有效，刷新丢失
  }
}

export function useGuokaoChecklist(): GuokaoChecklistApi {
  const [checked, setChecked] = useState<string[] | null>(null)
  const [storageBlocked, setStorageBlocked] = useState<string | null>(null)

  useEffect(() => {
    const { checked: loaded, blocked } = loadGuokaoChecklistLocal()
    setChecked(loaded)
    setStorageBlocked(blocked)
    const refresh = () => {
      const next = loadGuokaoChecklistLocal()
      setChecked(next.checked)
      setStorageBlocked(next.blocked)
    }
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])

  const toggle = useCallback(
    (id: string) => {
      if (checked === null || storageBlocked !== null) return false
      const next = toggleGuokaoChecklist(checked, id)
      if (next === checked) return false
      setChecked(next)
      saveGuokaoChecklistLocal(next)
      return true
    },
    [checked, storageBlocked],
  )

  return { checked, storageBlocked, toggle }
}
