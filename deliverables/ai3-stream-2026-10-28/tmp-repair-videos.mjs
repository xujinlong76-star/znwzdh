/**
 * 一次性局部修复（仅供本机浏览器实测，用完必须还原）：
 * apps/web/src 是被 .gitignore 的镜像，中枢读的是 overlay 那份；
 * 这里同时修两份，才让 next dev 编译得过。原始字节先落到 .cache。
 */
import fs from 'node:fs'

const TARGETS = [
  'apps/web/src/navsphere/content/videos.json',
  'apps/web-overlay/src/navsphere/content/videos.json',
]
const BACKUPS = ['.cache/videos.json.web.orig', '.cache/videos.json.overlay.orig']
const needle = Buffer.from('\\ud83d"', 'latin1')
const replacement = Buffer.from('"', 'latin1')

if (process.argv[2] === '--restore') {
  TARGETS.forEach((t, i) => {
    const raw = fs.readFileSync(BACKUPS[i])
    fs.writeFileSync(t, raw)
    const now = fs.readFileSync(t)
    console.log('restored', t, 'bytes=', now.length, 'identical=', Buffer.compare(now, raw) === 0)
  })
  process.exit(0)
}

TARGETS.forEach((t, i) => {
  const buf = fs.readFileSync(t)
  fs.writeFileSync(BACKUPS[i], buf)
  const text = buf.toString('latin1')
  const n = text.split(needle.toString('latin1')).length - 1
  const fixed = Buffer.from(text.split(needle.toString('latin1')).join('"'), 'latin1')
  fs.writeFileSync(t, fixed)
  console.log(t, 'replaced=', n, 'bytes', buf.length, '->', fixed.length)
})
