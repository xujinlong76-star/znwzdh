# 2026-11-24 04:22 轮 W5：提交 `1ea8a57d` 独立复审

- 轮次：2026-11-24 04:22 轮，W5（独立复审，第一优先）
- 复审对象：`1ea8a57d` — `fix(overlay): Codeup 改链至阿里云公开介绍页（旧址落地登录页）`
- 基线：工作克隆 `~/workspace/znwzdh-evolve`，分支 main
- 复审时间：2026-11-24 04:29 CST（提交本身 03:36 CST，即 03:27 重启后 9 分钟）
- **结论：通过**（非阻塞小注 3 项，见 §7，仅注释文字，不需重审）

本笔记同时以相同内容提交于工作克隆 `docs/evolution-round-2026-11-24-0422-w5.md`
（本轮惯例：各 worker 笔记以 `docs(evolution)` 单独提交，不 push）。

## 1. diff 逐行复核（6 文件，+46/−6）

| 文件 | 改动 | 复核 |
|---|---|---|
| `apps/web-overlay/src/navsphere/content/navigation.json` | Codeup `href` `https://codeup.aliyun.com` → `https://www.aliyun.com/product/yunxiao/codeup`，1 行 | ✓。`apps/web/` 份是未跟踪镜像（`git ls-files` 无此路径），盘上已同步：双份均为新 href 1 处、旧 href 0 处（`python3 json` 实测）。`icon` 字段仍为 `https://codeup.aliyun.com/favicon.ico`——有意保留，见 §6 |
| `packages/core/src/pricing-overrides.json` | 键 `codeup.aliyun.com` → `aliyun.com/product/yunxiao/codeup`，`pricing: freemium` / evidence / title 原样 | ✓。新键符合“去 www 的 host + path”派生规则；全库 44 个 path 式键为先例（如 `klingai.com/app`）。键总数 394，旧键已不存在 |
| `apps/web-overlay/src/components/site-favicon.tsx` | 删 map 死键 `'codeup.aliyun.com=codeupp'`；新增标题规则 `lowerTitle.includes('codeup')` → `/brand-icons/codeup.png` | ✓。规则插在其他标题规则之后、`LOCAL_LOGO_MAP[hostname]` 精确查找之前；之前无任何可拦截 `www.aliyun.com` 的分支。`'aliyun.com=aliyunp'` 键仍在，Alibaba Cloud 仍落到它 |
| `apps/web-overlay/test/site-favicon-iconbatch-c4.test.ts` | CASES 中 Codeup 一行 URL 改新址 | ✓ |
| `apps/web-overlay/test/site-favicon-iconbatch-c12.test.ts` | 不串站断言中 Codeup 一行改新址 + 标题规则，并更新用例名 | ✓ |
| `apps/web-overlay/test/docs-truth.test.ts` | 新增 “Codeup 搬家” describe（双份导航 href + 覆盖表键） | ✓。断言按 `href` 字段而非裸子串——正确，因为 icon 字段仍含旧域；仿可灵 AI 先例 |

逐行核对的事实断言：

- 标题子串 `'codeup'` 在双份 `navigation.json` 的 title 字段中**仅命中 Codeup 一站**（walk 实测；全文件不区分大小写 3 处 = title + href path + icon URL）。
- `aliyun.com` 共享域确为 **4 站**：通义千问、Tongyi Lingma、Alibaba Cloud、Codeup。
- C4 批 map 键 19→18：diff 显示数组仅删 `'codeup.aliyun.com=codeupp'` 一行，注释所称“现为 18 个”属实。
- `apps/web/` 镜像的 `site-favicon.tsx` 与 `navigation.json` 均已同步新内容（grep 行号一致）。

## 2. 定向测试独立复跑（c4 / c12 / docs-truth / core pricing）

按 `vitest.config.ts` 注释，vitest 只收集 `apps/web/test/**`（overlay 的 `test/` 是源、经 mirror 同步后运行）；复跑前先核对三份测试在双份目录**逐字节同步**（`diff -q` 均为 SYNCED）。

命令（仓根）：

```text
npx vitest run apps/web/test/site-favicon-iconbatch-c4.test.ts \
  apps/web/test/site-favicon-iconbatch-c12.test.ts \
  apps/web/test/docs-truth.test.ts \
  packages/core/test/pricing.test.ts
```

结果：**4 文件全部通过，88/88**（c4 29、c12 26、docs-truth 19、core pricing 14），
与提交 Selftest 行数字**逐项一致**。耗时 4.57s。

插曲：第一次复跑误加 `--reporter=basic`，vitest 在加载 reporter 处报错退出——
是我传参错误（该版本无此 reporter 名），不是仓库问题；去掉该 flag 后一次通过。
另：`tsc -p packages/core --noEmit` 独立复跑 **0 错，exit 0**。

## 3. §4.2 footer 核查（`docs/CODE-REVIEW.md` §4.2，三行强制）

提交信息三行齐全，逐项核对：

- `Skip-Precommit: NAVHUB_SKIP_PRECOMMIT=1` ✓（声明“跳了”）。
- `Skip-Precommit-Red: apps/web-overlay/test/secure-random.test.ts（tsc 4 错，HEAD 已有、非本次引入；本次 6 个文件 0 错）` ✓
  - 该文件**不在**本次 6 文件 diff 内；且它只 import `vitest` 与 `@/lib/secure-random`（均未被本次改动），故“非本次引入”由 diff + import 图直接成立。
  - 独立复跑 `npx tsc --noEmit -p apps/web-overlay/tsconfig.json`：exit 1，**恰好 4 错，全部在 `secure-random.test.ts:80/101`**（TS2322 ×2、TS2769 ×2，泛型 `ArrayBufferView` 类型问题），6 个改动文件 **0 错**——Red 行数字与归属均属实。
- `Skip-Precommit-Selftest: vitest 4 文件 88/88 通过（c4 29、c12 26、docs-truth 19、core pricing 14）；tsc -p packages/core 0 错；curl 实测新址 200 无登录跳转` ✓
  - 三项均已独立复验，数字与事实一致（见 §2、§6）。
- §4.2 硬性要求“Red 必须指向**不属于本 PR** 的文件”——满足。

## 4. 红线核查

- 17K小说网 / 书旗小说：`git show 1ea8a57d` 全文 grep，**0 命中**。
- 新依赖：diff 不含任何 `package.json` / lock 改动，**无新增依赖**。
- 新增 `/api` 调用：无新增文件、无 `fetch(`、无 `/api/` 引用，**0 新增**。
- 未 push：截至复审时，`1ea8a57d` 仅在本地 main（03:22 轮 W3 笔记亦记“未 push，待用户本人放行”）。

## 5. 提交树完整性确认（03:27 重启发生在 W3 工作期间）

- HEAD 链完整：`1ea8a57d`（2026-11-23 19:36:18 UTC = 03:36 CST）← 父 `7d858cad`（18:31 UTC）。提交在 03:27 重启**后 9 分钟**；两份 navigation.json 的 mtime 为 03:32/03:33 CST，亦在重启后。
- `git fsck --strict`：exit 0，**无错误、无缺失对象**；仅有 dangling 对象（属正常）。
- 工作区：6 个改动文件与 HEAD **逐项干净**（`git status --porcelain -- <6 文件>` 为空）；全仓仅有未跟踪的 `apps/web-overlay/node_modules`。
- 对象存在：commit `1ea8a57d` 与 tree `e5b8acd1` 均可 `cat-file`；`git ls-tree -r` 共 3764 条目。
- 悬空提交 `6e24ac6f`（`W3-baseline-temp`，2026-11-23 11:37 CST，W2 挂载改动）**不是**本轮丢失的工作：其 `navigation-content.tsx` 改动与当前 HEAD 的 diff 为空，即内容已在 main 内；stash 列表为空，该悬空对象无待恢复内容。

结论：**提交树完整，重启未造成丢失或损坏。**

## 6. 附加独立实测（提交信息中的 curl 事实）

| 断言 | 独立复测结果 |
|---|---|
| 新址 200、无跳转 | `https://www.aliyun.com/product/yunxiao/codeup` → **200**，最终 URL 不变，1.93s；`<title>云效代码管理 Codeup_代码托管_企业级代码管理平台-阿里云</title>`，与提交所述标题**逐字一致** |
| 旧址落地登录页 | `https://codeup.aliyun.com` → **302** 至 `https://account-devops.aliyun.com/logout?relogin=true&next_url=…`（登录/重新登录页），提交所述属实 |
| icon 字段仍可用 | `https://codeup.aliyun.com/favicon.ico` → **301** 至 `img.alicdn.com` 的 ICO 文件，仍可取用；且渲染走本地 `/brand-icons/codeup.png`（盘上存在），icon 字段不影响显示 |

## 7. 非阻塞小注（仅注释文字，不拦通过）

1. **三处注释称 Codeup“各有精确键”已失实**（机制改了，结论仍对）：`site-favicon.tsx:456`（子域键示例列仍含 `'codeup.aliyun.com'`）、`site-favicon.tsx:735–736`（“3 个子域站…各有精确键先行命中”）、`c12.test.ts` 文件头注释约 70–74 行（同样措辞）。Codeup 现走标题规则、已无精确键；但因标题规则在 map 查找之前触发，“只剩 Alibaba Cloud 一站落到 `aliyun.com` 键”的结论仍成立。建议后续顺手改这三处措辞，不需重审。
2. **提交信息“双份 navigation.json：href 改新址”表述略欠精确**：实际提交只含 overlay 份（tracked）；web 份是未跟踪镜像，靠 `pnpm mirror:web` 同步。盘上双份状态正确且 docs-truth 守卫双份，结果无误，仅措辞可收紧。
3. **icon 字段仍指旧域**（有意保留）：该 favicon URL 实测仍可取用（301 至 alicdn），且渲染用本地图标，无功能影响。

## 8. 未验证项

- 全量预提交未跑：与提交者理由一致——本机 1.5 核跑全量会停滞；定向验证（§2、§3、§6）已覆盖本次改动的全部 6 个文件与全部事实断言。
- `:3000`/`:3100` 均为旧构建，本轮未用其验证任何新代码（也无新代码可验）；上轮 W5 结论（`7d858cad` 已复审通过）不受本次复核影响。
- 本轮其他 worker 的提交（复审期间 HEAD 已先后推进至 `569ca3a0`、`7dfd9645`、`1906abf4`）**不在**本次复审范围内。
