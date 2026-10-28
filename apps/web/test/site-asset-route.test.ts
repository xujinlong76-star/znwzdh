import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { readStorageFresh } = vi.hoisted(() => ({ readStorageFresh: vi.fn() }))
vi.mock('@/lib/github', () => ({ readStorageFresh }))
import { GET } from '../src/app/api/site/asset/[name]/route'

beforeEach(() => { readStorageFresh.mockReset() })
afterAll(() => { vi.resetModules() })

const request = (name: string) => GET(new Request('http://localhost/api/site/asset/' + name), { params: Promise.resolve({ name }) })

describe('品牌图片实时读取', () => {
  it('拒绝路径穿越与SVG，不读取存储', async () => {
    for (const name of ['../site.json', 'logo-0123456789.svg', 'other-0123456789.png']) {
      expect((await request(name)).status).toBe(400)
    }
    expect(readStorageFresh).not.toHaveBeenCalled()
  })

  it.each(['logo', 'ogImage', 'appleTouchIcon', 'pwaIcon192', 'pwaIcon512', 'pwaMaskable512'])('可读取%s，删除后重新访问为404', async (kind) => {
    readStorageFresh.mockResolvedValueOnce({ mime: 'image/png', data: Buffer.from('image').toString('base64') }).mockResolvedValueOnce(null)
    const name = kind + '-0123456789.png'
    const found = await request(name)
    expect(found.status).toBe(200)
    expect(await found.text()).toBe('image')
    const deleted = await request(name)
    expect(deleted.status).toBe(404)
    expect(deleted.headers.get('cache-control')).toBe('no-store')
    expect(readStorageFresh).toHaveBeenCalledTimes(2)
  })

  it('存储故障返回503，而不是可缓存的不存在', async () => {
    readStorageFresh.mockRejectedValue(new Error('offline'))
    const result = await request('logo-0123456789.png')
    expect(result.status).toBe(503)
    expect(result.headers.get('cache-control')).toBe('no-store')
  })

  it('存储中不可信MIME不会变为同源HTML响应', async () => {
    readStorageFresh.mockResolvedValue({ mime: 'text/html', data: Buffer.from('<script>1</script>').toString('base64') })
    expect((await request('logo-0123456789.png')).status).toBe(415)
  })
})
