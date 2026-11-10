/**
 * IndexNow key 文件（固定路径形态）：`GET /indexnow-key.txt` 返回 key 本身。
 *
 * IndexNow 的校验有两种找 key 的方式：默认去站点根找 `/{key}.txt`（该路径
 * 由 next.config.js 的 rewrites 在**构建期**读 NAVHUB_INDEXNOW_KEY 生成，
 * Docker 部署需把 key 作为 build-arg 注入）；或按提交时声明的 `keyLocation`
 * 来找——本路由就是给 keyLocation 用的**运行时**形态，不依赖重新构建，
 * 改 env 重启即生效。提交脚本 scripts/indexnow-submit.mjs 恒带 keyLocation
 * 指向这里。
 *
 * 未配置或格式非法时返回 404，绝不输出假 key：拿着假 key 去提交只会让
 * 引擎把整站标记为校验失败。key 的格式按 IndexNow 规范：8–128 位
 * 十六进制或字母数字与连字符。
 */
export const dynamic = 'force-dynamic'

const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/

export function readIndexNowKey(): string | null {
  const key = process.env.NAVHUB_INDEXNOW_KEY?.trim()
  return key && KEY_PATTERN.test(key) ? key : null
}

export async function GET() {
  const key = readIndexNowKey()
  if (!key) {
    return new Response('indexnow key not configured', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }
  return new Response(key, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
