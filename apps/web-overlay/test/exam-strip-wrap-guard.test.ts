/**
 * 首页考试条文案块窄屏竖排守卫（2026-11-15 05:22 轮，国考倒计时修复）。
 *
 * 根因：条带行容器是 flex flex-wrap，文案块是行内唯一可伸缩项
 * （min-w-0 flex-1，flex-basis 0）。360px 下行内宽 302px，徽章
 * 111.6 + 倒计时 146.7 + 间距 32 = 290.3，换行判定按 basis 0 认为
 * 「三项能放同一行」不换行，事后文案块只分到 11.7px——比一个汉字
 * （14px）还窄，标题 21 行、副行 20 行逐字竖排，条带被撑到 832px；
 * 且水合后倒计时岛从占位 69px 涨到 146.7px，条带 236px → 832px
 * 一次巨大 CLS 跳变。390px（452px）、414px（308px）同样不合格，
 * 1280px 正常（文案块 785.7px 单行）。
 *
 * 修法：文案块加 basis-full sm:basis-0——<640px 时假定宽占满整行，
 * 换行判定直接把它分到独立一行（得整行 302px，标题/副行各 ≤2 行，
 * 条带 ≤160px）；≥640px 恢复 basis-0，桌面端 82px 单行不变。
 * 正常条带（home-exam-strip-view.tsx）与空态条带
 * （home-exam-strip.tsx，2026-12-21 后启用，无倒计时岛，文案块
 * 原分到约 52px、标题约 4 行）同批修。
 *
 * 详见 ~/workspace/goals/efficiency-goal/hidden_files/
 * gaokao-countdown-360px-2026-11-15-0422.md（含三档实测与量测脚本）。
 *
 * 路径用仓库根相对定位：本文件经 mirror:web 在 apps/web 与
 * apps/web-overlay 双份存放，两边跑同一份断言。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')
const WEB_ROOT = resolve(REPO_ROOT, 'apps', 'web')
const OVERLAY_ROOT = resolve(REPO_ROOT, 'apps', 'web-overlay')

/** 文案块：窄屏独占整行，sm 以上恢复 basis-0（桌面单行不变） */
const TEXT_BLOCK = '<div className="min-w-0 flex-1 basis-full sm:basis-0">'
/** 旧写法：basis 0，换行判定「假装」不占宽，窄屏只分到 11.7px */
const TEXT_BLOCK_OLD = '<div className="min-w-0 flex-1">'

describe('考试条文案块：窄屏独占整行不竖排，桌面单行不变', () => {
  for (const [name, root, rel] of [
    ['apps/web', WEB_ROOT, 'src/components/home-exam-strip-view.tsx'],
    ['apps/web-overlay', OVERLAY_ROOT, 'src/components/home-exam-strip-view.tsx'],
    ['apps/web', WEB_ROOT, 'src/components/home-exam-strip.tsx'],
    ['apps/web-overlay', OVERLAY_ROOT, 'src/components/home-exam-strip.tsx'],
  ] as const) {
    it(`${name} ${rel}：文案块 basis-full sm:basis-0`, () => {
      const src = readFileSync(resolve(root, rel), 'utf8')
      expect(src).toContain(TEXT_BLOCK)
      expect(src).not.toContain(TEXT_BLOCK_OLD)
    })
  }
})
