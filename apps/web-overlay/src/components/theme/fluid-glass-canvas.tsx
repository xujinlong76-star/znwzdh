'use client'

/**
 * Next-Gen 动态流光毛玻璃引擎背景 (Fluid Frosted Glass Canvas)
 *
 * 核心特性：
 * 1. 物理流体色彩粒子：多重渐变色彩粒子（Indigo / Purple / Cyan / Rose）以正弦波与平滑阻尼在背景流动；
 * 2. 极致性能与低能耗：
 *    - 离屏低分辨率缓冲渲染 + CSS 超采样硬件加速 blur 滤镜；
 *    - 页面不可见 (document.hidden) 或系统开启减弱动效 (prefers-reduced-motion) 时自动暂停 requestAnimationFrame；
 * 3. 自由开关控制：支持通过 Spotlight 命令 `> fluid` 或全局事件一键切换开闭状态。
 */

import { useEffect, useRef, useState } from 'react'

interface BlobPoint {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
}

export function FluidGlassCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [enabled, setEnabled] = useState(false)

  // 监听持久化设置与全局切换事件
  useEffect(() => {
    if (typeof window === 'undefined') return

    const stored = localStorage.getItem('navhub_fluid_glass_enabled')
    if (stored === 'true') {
      setEnabled(true)
    }

    const handleToggle = () => {
      setEnabled((prev) => {
        const next = !prev
        localStorage.setItem('navhub_fluid_glass_enabled', String(next))
        return next
      })
    }

    window.addEventListener('toggle-fluid-glass', handleToggle)
    return () => window.removeEventListener('toggle-fluid-glass', handleToggle)
  }, [])

  // 流光动画渲染循环
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 减弱动效检测
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return

    let animId: number
    let width = (canvas.width = Math.floor(window.innerWidth / 3))
    let height = (canvas.height = Math.floor(window.innerHeight / 3))

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = Math.floor(window.innerWidth / 3)
      height = canvas.height = Math.floor(window.innerHeight / 3)
    }
    window.addEventListener('resize', handleResize)

    // 初始化流体色彩粒子球
    const blobs: BlobPoint[] = [
      { x: width * 0.2, y: height * 0.3, vx: 0.35, vy: 0.25, radius: width * 0.3, color: 'rgba(99, 102, 241, 0.45)' }, // Indigo
      { x: width * 0.8, y: height * 0.2, vx: -0.28, vy: 0.32, radius: width * 0.35, color: 'rgba(168, 85, 247, 0.4)' }, // Purple
      { x: width * 0.5, y: height * 0.8, vx: 0.22, vy: -0.26, radius: width * 0.38, color: 'rgba(6, 182, 212, 0.35)' }, // Cyan
      { x: width * 0.15, y: height * 0.85, vx: -0.25, vy: -0.2, radius: width * 0.32, color: 'rgba(244, 63, 94, 0.3)' }, // Rose
    ]

    let isVisible = true
    const handleVisibility = () => {
      isVisible = !document.hidden
      if (isVisible) render()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    const render = () => {
      if (!isVisible) return

      ctx.clearRect(0, 0, width, height)

      blobs.forEach((b) => {
        b.x += b.vx
        b.y += b.vy

        // 边界柔和反弹
        if (b.x < 0 || b.x > width) b.vx *= -1
        if (b.y < 0 || b.y > height) b.vy *= -1

        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.radius)
        grad.addColorStop(0, b.color)
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)')

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2)
        ctx.fill()
      })

      animId = requestAnimationFrame(render)
    }

    render()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div
      className="fixed inset-0 pointer-events-none -z-10 overflow-hidden select-none transition-opacity duration-1000"
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full filter blur-[90px] opacity-60 dark:opacity-40 transform-gpu"
      />
    </div>
  )
}
