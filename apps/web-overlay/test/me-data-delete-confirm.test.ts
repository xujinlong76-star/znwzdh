import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * U-277 + U-278：/me/data 删除账号的确认态与文案口径守卫。
 *
 * 历史缺陷（两者同批修，拆开修会留中间态）：
 *  - U-278：handleDelete 成功后立即 signOut 跳首页，`state === 'deleted'` 的
 *    确认区是死代码——用户删完账号不知道删没删成，只能凭一闪而过的 toast 猜。
 *  - U-277：确认区文案写“登录账号本身保留”，与服务端真删账号（DELETE /api/me
 *    先 revokeAllSessions 再删 users 行）矛盾；toast 与数据说明的口径才是对的。
 *    U-278 修好让确认区可见后，这句错文案会直接推到用户面前，所以必须同批改。
 *
 * 修复（方案 A）：删除成功后先停在确认态，登出改由确认区「退出并返回用户中心」
 * 按钮触发（signOut 回 /me，此时已是匿名态）。推迟登出无风险：服务端在 DELETE
 * 返回前已吊销全部会话并删了账号行，残留本地会话已无实际权限。
 *
 * 为什么用源码守卫：vitest 跑 node 环境，无法渲染依赖 next-auth 会话的页面；
 * 同页既有守卫（me-degrade-states.test.ts）也是这个写法，渲染断言在 E2E。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

/** toast 与确认区必须共用的账号口径（U-277 定稿）。 */
const ACCOUNT_DELETED_COPY = '登录账号已一并删除，邮箱与密码不再可用'

function handleDeleteBody(src: string): string {
  const start = src.indexOf('const handleDelete = useCallback')
  const end = src.indexOf('}, [confirmText, favorites, toast])', start)
  if (start < 0 || end < 0) throw new Error('handleDelete 未找到')
  return src.slice(start, end)
}

function deletedSection(src: string): string {
  const start = src.indexOf("{state === 'deleted' && (")
  const end = src.indexOf("{state === 'ready' && (", start)
  if (start < 0 || end < 0) throw new Error('deleted 确认区未找到')
  return src.slice(start, end)
}

describe('U-278：删除成功后停留在确认态，不立即登出跳首页', () => {
  it('handleDelete 成功分支只置 deleted 态，不调用 signOut', () => {
    const src = read('src/app/me/data/page.tsx')
    const body = handleDeleteBody(src)
    expect(body).toContain("setState('deleted')")
    expect(body).not.toContain('signOut')
  })

  it('全文件 signOut 只剩两处：import 与确认区返回处理器', () => {
    const src = read('src/app/me/data/page.tsx')
    expect(src.match(/signOut/g)?.length).toBe(2)
    expect(src).not.toContain("signOut({ callbackUrl: '/' })")
  })

  it('确认区按钮点后登出回 /me（匿名态），不是回首页', () => {
    const src = read('src/app/me/data/page.tsx')
    const section = deletedSection(src)
    expect(section).toContain('退出并返回用户中心')
    expect(section).toContain('handleDeletedReturn')
    expect(src).toContain("await signOut({ callbackUrl: '/me' })")
    // 不再是直链回 /me：直链不登出，会把已删账号的残留会话带回用户中心。
    expect(section).not.toContain('<Link')
    expect(section).not.toContain('href="/me"')
  })
})

describe('U-277：toast、确认区、数据说明三处账号口径一致', () => {
  it('toast 与确认区都写“账号已一并删除”，不再出现“账号本身保留”', () => {
    const src = read('src/app/me/data/page.tsx')
    expect(src).toContain(`description: '${ACCOUNT_DELETED_COPY}`)
    expect(deletedSection(src)).toContain(ACCOUNT_DELETED_COPY)
    expect(src).not.toContain('登录账号本身保留')
  })

  it('数据说明仍与成功区同口径：真删账号，旧密码无法再登录', () => {
    const src = read('src/app/me/data/page.tsx')
    expect(src).toContain('登录账号真删：邮箱账号与密码哈希一并删除，旧密码无法再登录；重新注册是全新的空账号。')
  })
})
