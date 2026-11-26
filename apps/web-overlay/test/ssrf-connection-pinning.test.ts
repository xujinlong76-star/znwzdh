import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GUARD,
  guardedFetch,
  isAlwaysBlockedIp,
  pinnedLookup,
  resolveAndCheck,
  safeFetch,
  SsrfBlockedError,
} from '../src/lib/ssrf-guard'

const execFileAsync = promisify(execFile)
const dns = vi.hoisted(() => ({
  byHost: new Map<string, Array<{ address: string; family: number }>>(),
  rebindCalls: 0,
}))

vi.mock('node:dns/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns/promises')>()
  return {
    ...actual,
    lookup: async (hostname: string, options?: unknown) => {
      const fixed = dns.byHost.get(hostname)
      if (fixed) return fixed
      if (hostname === 'rebind.local.test') {
        dns.rebindCalls++
        // 第一次校验得到环回测试服务器；若旧 HTTPS 实现复查 DNS，第二次会变成元数据地址。
        return dns.rebindCalls === 1
          ? [{ address: '127.0.0.1', family: 4 }]
          : [{ address: '169.254.169.254', family: 4 }]
      }
      return actual.lookup(hostname, options as never)
    },
  }
})

const RESOLVE_OPTS = { ...DEFAULT_GUARD, timeoutMs: 1_000 }

beforeEach(() => {
  dns.byHost.clear()
  dns.rebindCalls = 0
  dns.byHost.set('localhost', [
    { address: '127.0.0.1', family: 4 },
    { address: '::1', family: 6 },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  dns.byHost.clear()
  vi.resetModules()
})

async function listen(server: http.Server | https.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return (server.address() as AddressInfo).port
}

async function closeServer(server: http.Server | https.Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
    server.closeAllConnections()
  })
}

function echoRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const chunks: Buffer[] = []
  req.on('data', (chunk: Buffer) => chunks.push(chunk))
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      method: req.method,
      body: Buffer.concat(chunks).toString('utf8'),
      host: req.headers.host,
      authorization: req.headers.authorization ?? null,
      cookie: req.headers.cookie ?? null,
      proxyAuthorization: req.headers['proxy-authorization'] ?? null,
      remoteAddress: req.socket.remoteAddress,
      remotePort: req.socket.remotePort,
      url: req.url,
    }))
  })
}

describe('overlay SSRF 连接级 pinning', () => {
  it('pinnedLookup 同时兼容单地址和 Node 24 all:true 回调', () => {
    const lookup = pinnedLookup({ address: '127.0.0.1', family: 4 })
    let single: unknown
    let singleFamily: number | undefined
    lookup('ignored.example', {}, (error, address, family) => {
      expect(error).toBeNull()
      single = address
      singleFamily = family
    })
    expect(single).toBe('127.0.0.1')
    expect(singleFamily).toBe(4)

    let all: unknown
    lookup('ignored.example', { all: true, autoSelectFamily: true } as never, (error, address, family) => {
      expect(error).toBeNull()
      all = address
      expect(family).toBeUndefined()
    })
    expect(all).toEqual([{ address: '127.0.0.1', family: 4 }])
  })

  it.each(['safeFetch', 'guardedFetch'] as const)('%s 用真实 node:http 固定 IP、保留 Host 并返回 Response 兼容结构', async (kind) => {
    const server = http.createServer(echoRequest)
    const port = await listen(server)
    const originalRequest = http.request
    let seenOptions: http.RequestOptions | undefined
    vi.spyOn(http, 'request').mockImplementation(((options: http.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
      seenOptions = options
      return originalRequest(options, callback)
    }) as typeof http.request)

    try {
      const url = `http://localhost:${port}/echo?x=1`
      if (kind === 'safeFetch') {
        const result = await safeFetch(url, {
          allowPrivateNetworks: true,
          allowedPorts: [port],
          timeoutMs: 2_000,
        })
        const echo = JSON.parse(new TextDecoder().decode(result.body))
        expect(result.status).toBe(200)
        expect(result.pinnedIp).toBe('127.0.0.1')
        expect(echo).toMatchObject({ host: `localhost:${port}`, remoteAddress: '127.0.0.1', url: '/echo?x=1' })
      } else {
        const result = await guardedFetch(url, { allowPrivateNetworks: true, timeoutMs: 2_000 })
        const echo = await result.response.json()
        expect(result.response).toBeInstanceOf(Response)
        expect(result.response.url).toBe(url)
        expect(result.finalUrl).toBe(url)
        expect(echo).toMatchObject({ host: `localhost:${port}`, remoteAddress: '127.0.0.1', url: '/echo?x=1' })
      }
      expect(seenOptions).toMatchObject({ hostname: 'localhost', port, agent: false })
      expect(typeof seenOptions?.lookup).toBe('function')
    } finally {
      await closeServer(server)
    }
  })

  it.each(['safeFetch', 'guardedFetch'] as const)('%s 连续请求不复用 socket', async (kind) => {
    const sockets = new Set<number>()
    const server = http.createServer((req, res) => {
      sockets.add(req.socket.remotePort ?? -1)
      res.end('ok')
    })
    const port = await listen(server)
    try {
      for (let i = 0; i < 2; i++) {
        if (kind === 'safeFetch') {
          await safeFetch(`http://127.0.0.1:${port}/${i}`, {
            allowPrivateNetworks: true,
            allowedPorts: [port],
            timeoutMs: 2_000,
          })
        } else {
          const { response } = await guardedFetch(`http://127.0.0.1:${port}/${i}`, {
            allowPrivateNetworks: true,
            timeoutMs: 2_000,
          })
          await response.text()
        }
      }
      expect(sockets.size).toBe(2)
    } finally {
      await closeServer(server)
    }
  })

  it.each(['safeFetch', 'guardedFetch'] as const)('%s 只解析一次，DNS 重绑定不会改变实际连接目标', async (kind) => {
    const server = http.createServer((_req, res) => res.end('pinned-ok'))
    const port = await listen(server)
    try {
      const result = kind === 'safeFetch'
        ? await safeFetch(`http://rebind.local.test:${port}/`, {
            allowPrivateNetworks: true,
            allowedPorts: [port],
            timeoutMs: 2_000,
          })
        : await guardedFetch(`http://rebind.local.test:${port}/`, {
            allowPrivateNetworks: true,
            timeoutMs: 2_000,
          })
      const status = 'status' in result ? result.status : result.response.status
      expect(status).toBe(200)
      expect(dns.rebindCalls).toBe(1)
    } finally {
      await closeServer(server)
    }
  })
})

describe('overlay SSRF 私网与永久阻断地址', () => {
  it('allowPrivateNetworks=true 仍解析并放行普通私网 DNS', async () => {
    dns.byHost.set('private.local.test', [{ address: '127.0.0.1', family: 4 }])
    await expect(resolveAndCheck(new URL('http://private.local.test/'), {
      ...RESOLVE_OPTS,
      allowPrivateNetworks: true,
    })).resolves.toBeUndefined()
    await expect(resolveAndCheck(new URL('http://private.local.test/'), RESOLVE_OPTS)).rejects.toThrow(/受保护/)
  })

  it('allowPrivateNetworks=true 对混合 DNS 结果 fail-closed', async () => {
    dns.byHost.set('mixed.local.test', [
      { address: '127.0.0.1', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ])
    await expect(resolveAndCheck(new URL('http://mixed.local.test/'), {
      ...RESOLVE_OPTS,
      allowPrivateNetworks: true,
    })).rejects.toThrow(/受保护/)
  })

  it.each([
    '169.254.169.254',
    '100.100.100.200',
    'fd00:ec2::254',
    'fd00:0ec2:0000:0000:0000:0000:0000:0254',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    'fe80::1',
  ])('永久阻断 %s，即使显式放行私网', async (address) => {
    expect(isAlwaysBlockedIp(address)).toBe(true)
    const host = address.includes(':') ? `[${address}]` : address
    await expect(resolveAndCheck(new URL(`http://${host}/`), {
      ...RESOLVE_OPTS,
      allowPrivateNetworks: true,
    })).rejects.toBeInstanceOf(SsrfBlockedError)
  })

  it('域名解析到 IPv6 云元数据时也拒绝', async () => {
    dns.byHost.set('metadata.local.test', [{ address: 'fd00:ec2::254', family: 6 }])
    await expect(resolveAndCheck(new URL('http://metadata.local.test/'), {
      ...RESOLVE_OPTS,
      allowPrivateNetworks: true,
    })).rejects.toThrow(/受保护/)
  })
})

describe('overlay SSRF 手动重定向', () => {
  it.each(['safeFetch', 'guardedFetch'] as const)('%s 同源 307 保留方法/body/敏感头，跨源 302 剥离并降级为 GET', async (kind) => {
    const second = http.createServer(echoRequest)
    const secondPort = await listen(second)
    const first = http.createServer((req, res) => {
      if (req.url === '/same-307') {
        res.writeHead(307, { location: '/echo' })
        res.end()
        return
      }
      if (req.url === '/cross-302') {
        res.writeHead(302, { location: `http://localhost:${secondPort}/echo` })
        res.end()
        return
      }
      echoRequest(req, res)
    })
    const firstPort = await listen(first)
    const headers = {
      authorization: 'Bearer secret',
      cookie: 'session=secret',
      'proxy-authorization': 'Basic secret',
      'content-type': 'text/plain',
    }

    try {
      const sameUrl = `http://localhost:${firstPort}/same-307`
      const same = kind === 'safeFetch'
        ? await (async () => {
            const result = await safeFetch(sameUrl, {
              method: 'POST', body: 'payload', headers,
              allowPrivateNetworks: true, allowedPorts: [firstPort], timeoutMs: 2_000,
            })
            return { data: JSON.parse(new TextDecoder().decode(result.body)), finalUrl: result.finalUrl, redirects: result.redirects }
          })()
        : await (async () => {
            const result = await guardedFetch(sameUrl, { allowPrivateNetworks: true, timeoutMs: 2_000 }, {
              method: 'POST', body: 'payload', headers,
            })
            return { data: await result.response.json(), finalUrl: result.finalUrl, redirects: [] }
          })()
      expect(same.data).toMatchObject({
        method: 'POST', body: 'payload', authorization: 'Bearer secret',
        cookie: 'session=secret', proxyAuthorization: 'Basic secret',
      })
      expect(same.finalUrl).toBe(`http://localhost:${firstPort}/echo`)
      if (kind === 'safeFetch') expect(same.redirects).toEqual([sameUrl])

      const crossUrl = `http://localhost:${firstPort}/cross-302`
      const cross = kind === 'safeFetch'
        ? await (async () => {
            const result = await safeFetch(crossUrl, {
              method: 'POST', body: 'payload', headers,
              allowPrivateNetworks: true, allowedPorts: [firstPort, secondPort], timeoutMs: 2_000,
            })
            return { data: JSON.parse(new TextDecoder().decode(result.body)), finalUrl: result.finalUrl }
          })()
        : await (async () => {
            const result = await guardedFetch(crossUrl, { allowPrivateNetworks: true, timeoutMs: 2_000 }, {
              method: 'POST', body: 'payload', headers,
            })
            return { data: await result.response.json(), finalUrl: result.finalUrl }
          })()
      expect(cross.data).toMatchObject({
        method: 'GET', body: '', authorization: null, cookie: null, proxyAuthorization: null,
      })
      expect(cross.finalUrl).toBe(`http://localhost:${secondPort}/echo`)
    } finally {
      await closeServer(first)
      await closeServer(second)
    }
  })

  it('safeFetch 每跳重验域名白名单、协议、端口与 DNS', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: 'file:///etc/passwd' })
      res.end()
    })
    const port = await listen(server)
    try {
      await expect(safeFetch(`http://localhost:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port], allowedHosts: ['localhost'],
      })).rejects.toThrow(/协议不允许/)

      server.removeAllListeners('request')
      server.on('request', (_req, res) => {
        res.writeHead(302, { location: 'http://localhost:22/' })
        res.end()
      })
      await expect(safeFetch(`http://localhost:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port], allowedHosts: ['localhost'],
      })).rejects.toThrow(/端口/)

      server.removeAllListeners('request')
      server.on('request', (_req, res) => {
        res.writeHead(302, { location: 'http://other.local.test/' })
        res.end()
      })
      await expect(safeFetch(`http://localhost:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port, 80], allowedHosts: ['localhost'],
      })).rejects.toThrow(/白名单/)

      dns.byHost.set('metadata.local.test', [{ address: '169.254.169.254', family: 4 }])
      server.removeAllListeners('request')
      server.on('request', (_req, res) => {
        res.writeHead(302, { location: 'http://metadata.local.test/' })
        res.end()
      })
      await expect(safeFetch(`http://localhost:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port, 80], timeoutMs: 2_000,
      })).rejects.toThrow(/受保护/)
    } finally {
      await closeServer(server)
    }
  })

  it('guardedFetch 每跳重验协议/端口，并限制重定向次数', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/protocol') {
        res.writeHead(302, { location: 'file:///etc/passwd' })
      } else if (req.url === '/port') {
        res.writeHead(302, { location: 'http://localhost:22/' })
      } else {
        res.writeHead(302, { location: '/loop' })
      }
      res.end()
    })
    const port = await listen(server)
    try {
      await expect(guardedFetch(`http://localhost:${port}/protocol`, { allowPrivateNetworks: true })).rejects.toThrow(/协议不允许/)
      await expect(guardedFetch(`http://localhost:${port}/port`, { allowPrivateNetworks: true })).rejects.toThrow(/端口/)
      await expect(guardedFetch(`http://localhost:${port}/loop`, {
        allowPrivateNetworks: true, maxRedirects: 1,
      })).rejects.toThrow(/重定向次数/)
    } finally {
      await closeServer(server)
    }
  })
})

describe('overlay SSRF 响应限制与超时', () => {
  it('safeFetch 与 guardedFetch 都拒绝 chunked 超限', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'transfer-encoding': 'chunked' })
      res.end('x'.repeat(100))
    })
    const port = await listen(server)
    try {
      await expect(safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port], maxBytes: 10,
      })).rejects.toThrow(/响应体过大/)
      const { response } = await guardedFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, maxBytes: 10,
      })
      await expect(response.text()).rejects.toThrow(/响应体过大/)
    } finally {
      await closeServer(server)
    }
  })

  it.each([
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
    ['zstd', zstdCompressSync],
  ] as const)('safeFetch 与 guardedFetch 都解压 %s 响应并移除实体编码头', async (encoding, compress) => {
    const server = http.createServer((_req, res) => {
      const body = compress(Buffer.from('compressed-ok'))
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': encoding,
        'content-length': String(body.byteLength),
      })
      res.end(body)
    })
    const port = await listen(server)
    try {
      const safe = await safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port], maxBytes: 1024,
      })
      expect(new TextDecoder().decode(safe.body)).toBe('compressed-ok')
      expect(safe.headers.get('content-encoding')).toBeNull()
      expect(safe.headers.get('content-length')).toBeNull()

      const { response } = await guardedFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, maxBytes: 1024,
      })
      expect(await response.text()).toBe('compressed-ok')
      expect(response.headers.get('content-encoding')).toBeNull()
      expect(response.headers.get('content-length')).toBeNull()
    } finally {
      await closeServer(server)
    }
  })

  it('多 Content-Encoding 按相反顺序解码', async () => {
    const server = http.createServer((_req, res) => {
      const body = brotliCompressSync(gzipSync(Buffer.from('stacked-ok')))
      res.writeHead(200, { 'content-encoding': 'gzip, br', 'content-length': String(body.byteLength) })
      res.end(body)
    })
    const port = await listen(server)
    try {
      const safe = await safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port], maxBytes: 1024,
      })
      expect(new TextDecoder().decode(safe.body)).toBe('stacked-ok')
      const { response } = await guardedFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, maxBytes: 1024,
      })
      expect(await response.text()).toBe('stacked-ok')
    } finally {
      await closeServer(server)
    }
  })

  it('未知 Content-Encoding 保留原始字节和响应头', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-encoding': 'future-codec', 'content-length': '6' })
      res.end('opaque')
    })
    const port = await listen(server)
    try {
      const safe = await safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port], maxBytes: 1024,
      })
      expect(new TextDecoder().decode(safe.body)).toBe('opaque')
      expect(safe.headers.get('content-encoding')).toBe('future-codec')
      const { response } = await guardedFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, maxBytes: 1024,
      })
      expect(await response.text()).toBe('opaque')
      expect(response.headers.get('content-encoding')).toBe('future-codec')
    } finally {
      await closeServer(server)
    }
  })

  it('压缩响应按解压后字节执行上限，挡住压缩炸弹', async () => {
    const server = http.createServer((_req, res) => {
      const body = gzipSync(Buffer.from('x'.repeat(100)))
      res.writeHead(200, { 'content-encoding': 'gzip', 'content-length': String(body.byteLength) })
      res.end(body)
    })
    const port = await listen(server)
    try {
      await expect(safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port], maxBytes: 50,
      })).rejects.toThrow(/响应体过大/)
      const { response } = await guardedFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, maxBytes: 50,
      })
      await expect(response.text()).rejects.toThrow(/响应体过大/)
    } finally {
      await closeServer(server)
    }
  })

  it('Content-Length 超限在读取前拒绝', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-length': '100' })
      res.end('x'.repeat(100))
    })
    const port = await listen(server)
    try {
      await expect(safeFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, allowedPorts: [port], maxBytes: 10,
      })).rejects.toThrow(/响应体过大/)
      await expect(guardedFetch(`http://127.0.0.1:${port}/`, {
        allowPrivateNetworks: true, maxBytes: 10,
      })).rejects.toThrow(/响应体过大/)
    } finally {
      await closeServer(server)
    }
  })

  it.each(['safeFetch', 'guardedFetch'] as const)('%s 的总超时不会被持续分包重置', async (kind) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('x')
      const interval = setInterval(() => res.write('x'), 20)
      res.once('close', () => clearInterval(interval))
    })
    const port = await listen(server)
    try {
      const started = Date.now()
      const pending = kind === 'safeFetch'
        ? safeFetch(`http://127.0.0.1:${port}/`, {
            allowPrivateNetworks: true, allowedPorts: [port], timeoutMs: 120, maxBytes: 1_024,
          })
        : guardedFetch(`http://127.0.0.1:${port}/`, {
            allowPrivateNetworks: true, timeoutMs: 120, maxBytes: 1_024,
          }).then(({ response }) => response.text())
      await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
      expect(Date.now() - started).toBeLessThan(1_500)
    } finally {
      await closeServer(server)
    }
  })
})

describe('overlay SSRF 真实 HTTPS', () => {
  let certDir: string | undefined
  let cert: Buffer | undefined

  beforeAll(async () => {
    certDir = await mkdtemp(join(tmpdir(), 'navhub-overlay-ssrf-tls-'))
    const keyPath = join(certDir, 'key.pem')
    const certPath = join(certDir, 'cert.pem')
    await execFileAsync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=rebind.local.test',
      '-addext', 'subjectAltName=DNS:localhost,DNS:rebind.local.test,IP:127.0.0.1',
      '-keyout', keyPath,
      '-out', certPath,
    ], { timeout: 15_000 })
    cert = await readFile(certPath)
  }, 20_000)

  afterAll(async () => {
    if (certDir) await rm(certDir, { recursive: true, force: true })
  })

  it.each(['safeFetch', 'guardedFetch'] as const)('%s 固定首次校验 IP、保留 SNI，且不放宽证书校验', async (kind) => {
    if (!cert) throw new Error('测试证书未生成')
    let servername: string | undefined
    const server = https.createServer({ key: await readFile(join(certDir!, 'key.pem')), cert }, (_req, res) => {
      res.end('tls-ok')
    })
    server.on('secureConnection', (socket) => { servername = socket.servername || undefined })
    const port = await listen(server)
    const originalRequest = https.request
    let seenOptions: https.RequestOptions | undefined
    const caSpy = vi.spyOn(https, 'request').mockImplementation(((options: https.RequestOptions, callback?: (res: http.IncomingMessage) => void) => {
      seenOptions = options
      return originalRequest({ ...options, ca: cert }, callback)
    }) as typeof https.request)

    const fetchLocal = () => kind === 'safeFetch'
      ? safeFetch(`https://rebind.local.test:${port}/`, {
          allowPrivateNetworks: true, allowedPorts: [port], timeoutMs: 2_000,
        })
      : guardedFetch(`https://rebind.local.test:${port}/`, {
          allowPrivateNetworks: true, timeoutMs: 2_000,
        })

    try {
      dns.rebindCalls = 0
      const result = await fetchLocal()
      const status = 'status' in result ? result.status : result.response.status
      expect(status).toBe(200)
      expect(dns.rebindCalls).toBe(1)
      expect(servername).toBe('rebind.local.test')
      expect(seenOptions).toMatchObject({ hostname: 'rebind.local.test', servername: 'rebind.local.test', agent: false })
      expect(typeof seenOptions?.lookup).toBe('function')

      // 撤掉仅用于测试的受信 CA 后，真实 node:https 必须因自签名证书失败。
      caSpy.mockRestore()
      dns.rebindCalls = 0
      await expect(fetchLocal()).rejects.toThrow(/certificate/i)
    } finally {
      await closeServer(server)
    }
  })
})
