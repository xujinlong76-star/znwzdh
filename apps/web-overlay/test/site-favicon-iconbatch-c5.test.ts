import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveLogoTile, resolveSiteIcon } from '../src/components/site-favicon'

/**
 * 图标修复 C 类第 5 批（2026-11-19）。
 *
 * 20 站：Bun / Node.js / Python / Rust / Go / Java / Drizzle ORM /
 * MySQL / PostgreSQL / Redis / MongoDB / Fastify / Express / NestJS /
 * Laravel / Django / Docker Hub / Podman / Compose / Terraform。
 *
 * 本批 CASES 必须传三参数（url, title, customIcon）：navigation.json 的
 * icon 字段（customIcon）在 resolveSiteIcon 里优先级最高，不传就复现不了
 * 真实解析链。20 站的 href / 标题 / customIcon 均按当前 main 的
 * navigation.json 逐个核对，不可猜；20 站 customIcon 均为远端
 * …/favicon.ico，均被 isRemoteRawFavicon 拦截后回落 map。
 *
 * 来源要点（设计证据 ~/workspace/icon-full/staging/c5/EVIDENCE.md）：
 * - Bun：bun.sh/logo.svg 原样（viewBox 0 0 80 70，<title>Bun Logo</title>）。
 * - Node.js：nodejs.org 首页引用的官方六边形标 224×256 缩至 112×128；
 *   宽版 logo.svg（深色顶栏白字 wordmark）已弃用。
 * - Python：python.org apple-touch-icon 144×144 缩至 128。
 * - Rust：rust-lang.org 首页 favicon.svg 原样（viewBox 0 0 32 32）。
 * - Go：go.dev 首页 favicon-gopher.svg 原样（32×32 viewBox）。
 * - Java：java.com 唯一官方 favicon.ico，单帧 16×16 转 PNG 原样；
 *   apple-touch-icon / favicon-32x32 均为 404；见事实钉死（未决点）。
 * - Drizzle ORM：orm.drizzle.team favicon.ico 单帧 32×32 转 PNG 原样。
 * - MySQL：mysql.com favicon.ico 最大帧 48×48 转 PNG 原样；首页曾 403，
 *   favicon 直链 200，海豚标已验证。
 * - PostgreSQL：官网 press kit 大象标 540×557 缩至 124×128，调色板
 *   重压 ≤ ~15 KB；旧式 48×48 16 色 favicon.ico 已弃用。
 * - Redis：redis.io icon.png 1028×1028 缩至 128。
 * - MongoDB：mongodb.com favicon.ico 最大帧 64×64 转 PNG 原样。
 * - Fastify：fastify.dev favicon.svg 原样（viewBox 0 0 200 200，
 *   自带 #0a0b0d 黑底方块）。
 * - Express：expressjs.com favicon.svg 原样（1000×1000，
 *   自带 #1a1a1a 黑底方块）。
 * - NestJS：nestjs.com favicon.svg 原样（viewBox 0 -4.497915 264.58333
 *   264.58333；设计证据作 0 -4.5 264.6 264.6 的约数，测试以文件实测为准）。
 * - Laravel：laravel.com apple-touch-icon.png 180×180 缩至 128；
 *   单色黑 safari-pinned-tab.svg 已弃用。
 * - Django：static.djangoproject.com icon-touch 192×192 缩至 128；
 *   32×32 favicon.ico 同标小版已弃用。
 * - Docker Hub：hub.docker.com favicon.ico 实为 PNG 65×65，按内容
 *   解码原样落盘 .png，无 .ico 残留。
 * - Podman：podman.io favicon.ico 最大帧 48×48 转 PNG 原样；
 *   首页 webp 三枚徽章拼图已弃用。
 * - Compose：官方 docker/compose 仓库根目录 logo.png 200×219 缩至
 *   117×128，调色板重压；docs.docker.com 的 favicon 是通用 Docker
 *   鲸鱼、与 Docker Hub 雷同，已弃用。
 * - Terraform：developer.hashicorp.com favicon.svg 原样
 *   （viewBox 0 0 96 96）；见事实钉死（纯黑标）。
 *
 * 事实钉死（只记、不加底块、不改组件、不擅自换图）：
 * - java.png 为 16×16 咖啡杯原样（java.com 唯一官方图标）；备选 Duke
 *   48px（dev.java favicon.ico，Oracle 品牌指南称 Duke 为开源推荐品牌
 *   形象）与咖啡杯不是同一图形，是否改用 Duke 或接受 16px，待用户裁决；
 *   设计轮与接线轮均未擅自替换。
 * - rust.svg（黑齿轮 R）与 terraform.svg（黑 HashiCorp 标）深色主题下
 *   对比度弱；2026-11-24 深色复核 W7 已删两站 SVG 内 @media
 *   (prefers-color-scheme: dark) 翻转（93a8d1eed）、W8 合流各配 'light'
 *   浅色底块（复核清单 §7 #23/#24），resolveLogoTile 对两站现返回 'light'。
 * - express.svg / fastify.svg 自带黑底方块（#1a1a1a / #0a0b0d），
 *   双主题均可见，无问题。
 * - compose.png 取自官方 docker/compose 仓库 logo.png，非
 *   docs.docker.com favicon；'docs.docker.com' 键只命中 Compose 一站。
 * - docker-hub.png 为 PNG 65×65（源 .ico 实为 PNG，按内容解码）。
 * - 小尺寸原样站（源 <128 不放大）：16×16（Java）、32×32（Drizzle）、
 *   48×48（MySQL / Podman）、64×64（MongoDB）、65×65（Docker Hub）。
 * - 非方标等比缩略：nodejs.png 112×128、postgresql.png 124×128、
 *   compose.png 117×128。
 * - 光栅单站落盘均 ≤ ~15 KB（postgresql / compose 两站经调色板重压）。
 * - SVG 7 站原样落盘，不受光栅单站 ≤ ~15 KB 规则约束（go.svg 17,826 B
 *   为 SVG 文本）。
 */

const CASES: Array<{ url: string; title: string; customIcon?: string; expected: string }> = [
  // Bun / Node.js / Python / Rust / Go 的 customIcon 均含 favicon
  { url: 'https://bun.sh', title: 'Bun', customIcon: 'https://bun.sh/favicon.ico', expected: '/brand-icons/bun.svg' },
  { url: 'https://nodejs.org/', title: 'Node.js', customIcon: 'https://nodejs.org/favicon.ico', expected: '/brand-icons/nodejs.png' },
  { url: 'https://www.python.org/', title: 'Python', customIcon: 'https://www.python.org/favicon.ico', expected: '/brand-icons/python.png' },
  { url: 'https://www.rust-lang.org/', title: 'Rust', customIcon: 'https://www.rust-lang.org/favicon.ico', expected: '/brand-icons/rust.svg' },
  { url: 'https://go.dev/', title: 'Go', customIcon: 'https://go.dev/favicon.ico', expected: '/brand-icons/go.svg' },
  // Java / Drizzle ORM / MySQL / PostgreSQL / Redis 的 customIcon 均含 favicon
  { url: 'https://www.java.com/', title: 'Java', customIcon: 'https://www.java.com/favicon.ico', expected: '/brand-icons/java.png' },
  { url: 'https://orm.drizzle.team', title: 'Drizzle ORM', customIcon: 'https://orm.drizzle.team/favicon.ico', expected: '/brand-icons/drizzle.png' },
  { url: 'https://www.mysql.com/', title: 'MySQL', customIcon: 'https://www.mysql.com/favicon.ico', expected: '/brand-icons/mysql.png' },
  { url: 'https://www.postgresql.org/', title: 'PostgreSQL', customIcon: 'https://www.postgresql.org/favicon.ico', expected: '/brand-icons/postgresql.png' },
  { url: 'https://redis.io/', title: 'Redis', customIcon: 'https://redis.io/favicon.ico', expected: '/brand-icons/redis.png' },
  // MongoDB / Fastify / Express / NestJS / Laravel 的 customIcon 均含 favicon
  { url: 'https://www.mongodb.com/', title: 'MongoDB', customIcon: 'https://www.mongodb.com/favicon.ico', expected: '/brand-icons/mongodb.png' },
  { url: 'https://fastify.dev', title: 'Fastify', customIcon: 'https://fastify.dev/favicon.ico', expected: '/brand-icons/fastify.svg' },
  { url: 'https://expressjs.com/', title: 'Express', customIcon: 'https://expressjs.com/favicon.ico', expected: '/brand-icons/express.svg' },
  { url: 'https://nestjs.com/', title: 'NestJS', customIcon: 'https://nestjs.com/favicon.ico', expected: '/brand-icons/nestjs.svg' },
  { url: 'https://laravel.com/', title: 'Laravel', customIcon: 'https://laravel.com/favicon.ico', expected: '/brand-icons/laravel.png' },
  // Django / Docker Hub / Podman / Compose / Terraform 的 customIcon 均含 favicon
  { url: 'https://www.djangoproject.com/', title: 'Django', customIcon: 'https://www.djangoproject.com/favicon.ico', expected: '/brand-icons/django.png' },
  { url: 'https://hub.docker.com', title: 'Docker Hub', customIcon: 'https://hub.docker.com/favicon.ico', expected: '/brand-icons/docker-hub.png' },
  { url: 'https://podman.io/', title: 'Podman', customIcon: 'https://podman.io/favicon.ico', expected: '/brand-icons/podman.png' },
  { url: 'https://docs.docker.com/compose/', title: 'Compose', customIcon: 'https://docs.docker.com/favicon.ico', expected: '/brand-icons/compose.png' },
  { url: 'https://developer.hashicorp.com/terraform', title: 'Terraform', customIcon: 'https://developer.hashicorp.com/favicon.ico', expected: '/brand-icons/terraform.svg' },
]

const LOCAL_ASSETS: Array<{ name: string; width: number; height: number }> = [
  // SVG 原样（无 PNG 尺寸钉死，见下方 SVG 断言）
  { name: 'bun.svg', width: 0, height: 0 },
  { name: 'rust.svg', width: 0, height: 0 },
  { name: 'go.svg', width: 0, height: 0 },
  { name: 'fastify.svg', width: 0, height: 0 },
  { name: 'express.svg', width: 0, height: 0 },
  { name: 'nestjs.svg', width: 0, height: 0 },
  { name: 'terraform.svg', width: 0, height: 0 },
  // PNG：≥128 源缩到 128，<128 源原样不放大；非方标等比缩略
  { name: 'nodejs.png', width: 112, height: 128 },
  { name: 'python.png', width: 128, height: 128 },
  { name: 'java.png', width: 16, height: 16 },
  { name: 'drizzle.png', width: 32, height: 32 },
  { name: 'mysql.png', width: 48, height: 48 },
  { name: 'postgresql.png', width: 124, height: 128 },
  { name: 'redis.png', width: 128, height: 128 },
  { name: 'mongodb.png', width: 64, height: 64 },
  { name: 'laravel.png', width: 128, height: 128 },
  { name: 'django.png', width: 128, height: 128 },
  { name: 'docker-hub.png', width: 65, height: 65 },
  { name: 'podman.png', width: 48, height: 48 },
  { name: 'compose.png', width: 117, height: 128 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG 魔数 8 字节 + IHDR：宽（offset 16，BE u32）、高（offset 20，BE u32）
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('resolveSiteIcon（图标修复 C 类第 5 批）', () => {
  it.each(CASES)(' $title 解析到 $expected', ({ url, title, customIcon, expected }) => {
    expect(resolveSiteIcon(url, title, customIcon)).toBe(expected)
  })

  it('本地品牌资产在 served 树的 public/brand-icons/ 落盘（20 文件）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(LOCAL_ASSETS).toHaveLength(20)
    for (const { name } of LOCAL_ASSETS) {
      expect(existsSync(`${dir}${name}`), name).toBe(true)
    }
  })

  it('尺寸钉死：PNG 13 站按表，SVG 7 站只验存在与文本', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name, width, height } of LOCAL_ASSETS) {
      const buf = readFileSync(`${dir}${name}`)
      if (name.endsWith('.png')) {
        const dims = readPngDimensions(buf)
        expect(dims, name).toEqual({ width, height })
      } else {
        expect(buf.toString('utf8').includes('<svg'), name).toBe(true)
      }
    }
  })

  it('光栅单站落盘 ≤ ~15KB（SVG 文本除外）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    for (const { name } of LOCAL_ASSETS) {
      if (name.endsWith('.png')) {
        expect(statSync(`${dir}${name}`).size, name).toBeLessThanOrEqual(15 * 1024)
      }
    }
  })

  it('事实钉死：java.png 为 16×16 咖啡杯原样（Duke 48px 未采用，待裁决）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}java.png`)
    const dims = readPngDimensions(buf)
    expect(dims).toEqual({ width: 16, height: 16 })
    expect(statSync(`${dir}java.png`).size).toBe(650)
    // java.com 唯一官方图标就是 16×16 favicon；备选 Duke 48px（dev.java）
    // 与咖啡杯不是同一图形，未擅自替换，待用户裁决
    expect(resolveSiteIcon('https://www.java.com/', 'Java', 'https://www.java.com/favicon.ico')).toBe('/brand-icons/java.png')
  })

  it('事实钉死：rust.svg / terraform.svg 纯黑标、已进 LOGO_TILE_MAP（W8 合流浅色底块）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const rust = readFileSync(`${dir}rust.svg`, 'utf8')
    expect(rust.includes('viewBox="0 0 32 32"')).toBe(true)
    const terraform = readFileSync(`${dir}terraform.svg`, 'utf8')
    expect(terraform.includes('viewBox="0 0 96 96"')).toBe(true)
    // W7 已删 @media 翻转（93a8d1eed）：此处原断言 toBe(true) 在 HEAD 已过期，
    // 随本批 tile 更新一并修正为不存在；三 path 仍保留 fill="black"
    expect(terraform.includes('@media (prefers-color-scheme: dark)')).toBe(false)
    expect(terraform.includes('fill="black"')).toBe(true)
    // 纯黑标深色主题对比度弱，W8 合流配浅色底块（复核清单 §7 #23/#24）
    expect(resolveLogoTile('https://www.rust-lang.org/')).toBe('light')
    expect(resolveLogoTile('https://developer.hashicorp.com/terraform')).toBe('light')
  })

  it('事实钉死：express.svg / fastify.svg 自带黑底方块，双主题可见', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const express = readFileSync(`${dir}express.svg`, 'utf8')
    expect(express.includes('fill="#1a1a1a"')).toBe(true)
    const fastify = readFileSync(`${dir}fastify.svg`, 'utf8')
    expect(fastify.includes('fill="#0a0b0d"')).toBe(true)
    expect(resolveLogoTile('https://expressjs.com/')).toBeNull()
    expect(resolveLogoTile('https://fastify.dev')).toBeNull()
  })

  it('事实钉死：compose.png 取自官方 docker/compose 仓库（非 docs.docker.com 鲸鱼标）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}compose.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 117, height: 128 })
    expect(statSync(`${dir}compose.png`).size).toBeLessThanOrEqual(15 * 1024)
    // docs.docker.com 的 favicon 是通用 Docker 鲸鱼（与 Docker Hub 雷同），
    // Compose 专属标取自官方仓库 logo.png；'docs.docker.com' 键只命中 Compose
    expect(resolveSiteIcon('https://docs.docker.com/compose/', 'Compose', 'https://docs.docker.com/favicon.ico')).toBe('/brand-icons/compose.png')
    expect(resolveSiteIcon('https://hub.docker.com', 'Docker Hub', 'https://hub.docker.com/favicon.ico')).toBe('/brand-icons/docker-hub.png')
  })

  it('事实钉死：docker-hub.png 为 PNG 65×65（源 .ico 实为 PNG，按内容解码）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const buf = readFileSync(`${dir}docker-hub.png`)
    expect(readPngDimensions(buf)).toEqual({ width: 65, height: 65 })
    expect(statSync(`${dir}docker-hub.png`).size).toBe(1358)
  })

  it('事实钉死：bun.svg 为 Bun 官方 SVG、go.svg / nestjs.svg 原样', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    const bun = readFileSync(`${dir}bun.svg`, 'utf8')
    expect(bun.includes('<title>Bun Logo</title>')).toBe(true)
    expect(bun.includes('viewBox="0 0 80 70"')).toBe(true)
    const nestjs = readFileSync(`${dir}nestjs.svg`, 'utf8')
    expect(nestjs.includes('viewBox="0 -4.497915 264.58333 264.58333"')).toBe(true)
  })

  it('事实钉死：非方标等比缩略（nodejs / postgresql / compose）', () => {
    const dir = fileURLToPath(new URL('../public/brand-icons/', import.meta.url))
    expect(readPngDimensions(readFileSync(`${dir}nodejs.png`))).toEqual({ width: 112, height: 128 })
    expect(readPngDimensions(readFileSync(`${dir}postgresql.png`))).toEqual({ width: 124, height: 128 })
    expect(readPngDimensions(readFileSync(`${dir}compose.png`))).toEqual({ width: 117, height: 128 })
  })
})
