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
 *
 * 29cb8f8e（fix(web-budget)）：危险区 + 删除后确认区从 page.tsx 抽成独立组件
 * MeDataDangerZone（src/components/user-center/me-data-danger-zone.tsx），由
 * 页面 next/dynamic ssr:false 按需加载——首屏不再含这部分代码。本文件原先在
 * page.tsx 里找的断言（handleDelete / signOut / 确认区 / toast 口径）全部跟
 * 随新位置改读该组件文件，页面只保留接线断言（挂载组件 + onDeleted 置
 * deleted 态）；断言本身一条没删，意图不变。先例：同批 favorites-undo.test.ts
 * 的 B1 接线守卫也是这样跟随新位置的。
 */

const ROOT = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
/** 29cb8f8e 起：删除逻辑与确认区住在这里，不再住在 page.tsx。 */
const DANGER_ZONE = 'src/components/user-center/me-data-danger-zone.tsx'

/** toast 与确认区必须共用的账号口径（U-277 定稿）。 */
const ACCOUNT_DELETED_COPY = '登录账号已一并删除，邮箱与密码不再可用'

function handleDeleteBody(src: string): string {
  const start = src.indexOf('const handleDelete = useCallback')
  const end = src.indexOf('}, [confirmText, favorites, onDeleted, onError, toast])', start)
  if (start < 0 || end < 0) throw new Error('handleDelete 未找到')
  return src.slice(start, end)
}

function deletedSection(src: string): string {
  // 29cb8f8e 起确认区是组件内的 `if (deleted)` 提前返回，不再是页面里的
  // `{state === 'deleted' && (` 内联块；切到危险区标题前即为确认区全文。
  const start = src.indexOf('if (deleted) {')
  const end = src.indexOf('删除全部云端数据', start)
  if (start < 0 || end < 0) throw new Error('deleted 确认区未找到')
  return src.slice(start, end)
}

describe('U-278：删除成功后停留在确认态，不立即登出跳首页', () => {
  it('handleDelete 成功分支通知页面置 deleted 态，不调用 signOut', () => {
    const zone = read(DANGER_ZONE)
    const body = handleDeleteBody(zone)
    // 组件内不再直接 setState：成功后调 onDeleted() 通知页面，页面接线
    // `onDeleted={() => setState('deleted')}` 把状态置为 deleted。
    expect(body).toContain('onDeleted()')
    expect(body).not.toContain('signOut')
    const page = read('src/app/me/data/page.tsx')
    expect(page).toContain("onDeleted={() => setState('deleted')}")
  })

  it('signOut 只在危险区：import 与确认区返回处理器各一处，页面不再直接登出', () => {
    const zone = read(DANGER_ZONE)
    expect(zone).toContain("import { signOut } from 'next-auth/react'")
    expect(zone.match(/await signOut\(/g)?.length).toBe(1)
    expect(zone).not.toContain("signOut({ callbackUrl: '/' })")
    const page = read('src/app/me/data/page.tsx')
    expect(page).not.toContain("from 'next-auth/react'")
    expect(page).not.toContain('signOut({')
  })

  it('确认区按钮点后登出回 /me（匿名态），不是回首页', () => {
    const zone = read(DANGER_ZONE)
    const section = deletedSection(zone)
    expect(section).toContain('退出并返回用户中心')
    expect(section).toContain('handleDeletedReturn')
    expect(zone).toContain("await signOut({ callbackUrl: '/me' })")
    // 不再是直链回 /me：直链不登出，会把已删账号的残留会话带回用户中心。
    expect(section).not.toContain('<Link')
    expect(section).not.toContain('href="/me"')
    // 页面在 deleted 态仍挂载危险区组件，确认区才渲染得到。
    const page = read('src/app/me/data/page.tsx')
    expect(page).toContain("{state === 'deleted' && (")
    expect(page).toContain('MeDataDangerZone deleted')
  })
})

describe('U-277：toast、确认区、数据说明三处账号口径一致', () => {
  it('toast 与确认区都写“账号已一并删除”，不再出现“账号本身保留”', () => {
    const zone = read(DANGER_ZONE)
    expect(zone).toContain(`description: '${ACCOUNT_DELETED_COPY}`)
    expect(deletedSection(zone)).toContain(ACCOUNT_DELETED_COPY)
    expect(zone).not.toContain('登录账号本身保留')
    expect(read('src/app/me/data/page.tsx')).not.toContain('登录账号本身保留')
  })

  it('数据说明仍与成功区同口径：真删账号，旧密码无法再登录', () => {
    const src = read('src/app/me/data/page.tsx')
    expect(src).toContain('登录账号真删：邮箱账号与密码哈希一并删除，旧密码无法再登录；重新注册是全新的空账号。')
  })
})
