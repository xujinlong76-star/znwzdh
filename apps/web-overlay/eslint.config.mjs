import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * vendor-only 文件（2026-11-06 实测登记，升级方案三.六）：
 *
 * 这些文件存在于 apps/web（vendor 重建产物）但 **不存在于 apps/web-overlay**
 * —— 即它们不是本仓库维护的源码，vendor-web 下次重建时会原样再生成。
 * 此前 `eslint .` 把它们一并扫进来，制造了门禁里的上游噪音（68 条告警），
 * 而修它们既无意义也不会在下次 vendor 重建后保留。
 *
 * 清单来源：全量 lint 结果按「overlay 是否存在同名文件」二分实测。
 * ⚠️ 方括号目录必须转义：minimatch 里 [id] 是字符类（匹配 i/d 单字符），
 * 不转义的模式会静默失配——2026-11-06 实测踩过（首轮排除全部空转）。
 * 2026-11-12 补 1 条（src/components/ui/json-editor.tsx）：同法二分实测为上游残留。
 */
const VENDOR_ONLY_FILES = [
  "src/app/admin/data/page.tsx",
  "src/app/admin/navigation/\\[id\\]/categories/\\[categoryId\\]/items/page.tsx",
  "src/app/admin/navigation/\\[id\\]/categories/page.tsx",
  "src/app/admin/navigation/\\[id\\]/items/page.tsx",
  "src/app/admin/navigation/\\[id\\]/page.tsx",
  "src/app/admin/navigation/\\[id\\]/subcategory/\\[subId\\]/page.tsx",
  "src/app/admin/navigation/components/IconPicker.tsx",
  "src/app/admin/navigation/components/IconUploader.tsx",
  "src/app/admin/navigation/components/NavigationCard.tsx",
  "src/app/admin/submissions/page.tsx",
  "src/app/api/auth/\\[...nextauth\\]/config.ts",
  "src/app/api/favicon-im/route.ts",
  "src/app/components/ThemeToggle.tsx",
  "src/components/NavigationSidebar.tsx",
  "src/components/ThemeToggle.tsx",
  "src/components/ui/icon-picker.tsx",
  "src/components/ui/json-editor.tsx",
  "src/components/ui/use-toast.ts",
  "src/registry/new-york/hooks/use-mobile.tsx",
  "src/registry/new-york/hooks/use-toast.ts",
  "src/registry/new-york/ui/carousel.tsx",
];

export default defineConfig([
  {
    // 静态资源与构建产物不参与 lint：vendored 的 bootstrap / TweenMax 等第三方压缩脚本
    // 会命中 TS 规则（no-this-alias / no-require-imports），但它们不是本仓库维护的源码。
    // VENDOR_ONLY_FILES 同理：apps/web 里存在而 overlay 没有的上游残留（见上方清单注释）。
    ignores: [
      "public/**",
      ".next/**",
      ".next*/**",
      "node_modules/**",
      "next-env.d.ts",
      ...VENDOR_ONLY_FILES,
    ],
  },
  {
    extends: [...nextCoreWebVitals, ...nextTypescript],

    rules: {
        // ── 台账化降级（2026-11-06，升级方案三.六）───────────────────────────
        // 以下规则族当前无法在「零告警门禁」下保持开启，原因与规模如下（全量实测
        // 910 告警，其中 vendor 噪音 68、unused 407、any 289、hooks-v6 族 136）；
        // 每一条都是**显式登记的重构 epic**，分批清零后按原阈值重新启用：
        //
        // 1. no-explicit-any（~289 处）：API 层（navhub-api.ts 等）与模块化布局的
        //    类型债。修复 = 逐调用点补真实类型，属独立类型工程。
        //    2026-11-09 起不再「只降级不设防」：规则保持 off（避免 289 条存量噪音淹没
        //    其它告警），改由 scripts/check-no-explicit-any.mjs 的按文件基线棘轮接管——
        //    pre-commit 用 --staged，CI 的 test-web / web-no-explicit-any 用全量口径，
        //    新增文件或已有文件回增即红；逐批清零后下调 baseline 即可收紧。
        "@typescript-eslint/no-explicit-any": "off",

        // 2. React Compiler / hooks v6 诊断族（~136 处）：set-state-in-effect 占大头，
        //    修复 = 逐个 effect 重构（派生状态改 memo、同步初始化改 lazy useState），
        //    每批必须过视觉回归。命中点几乎全在自研管理页与大型客户端组件。
        "react-hooks/set-state-in-effect": "off",
        "react-hooks/immutability": "off",
        "react-hooks/refs": "off",
        "react-hooks/purity": "off",
        "react-hooks/incompatible-library": "off",
        // exhaustive-deps（~18 处）：补依赖会引入循环拉取，需要逐处重构取数链。
        "react-hooks/exhaustive-deps": "off",
        // preserve-manual-memoization（video-player-page ×2，error 级）：React Compiler
        // 无法保留既有手写 memo，需改写该组件的 memo 形态。
        "react-hooks/preserve-manual-memoization": "off",

        // 3. no-unused-vars 保持 warn：unused-codemod epic（约 58 处 assigned-but-unused
        //    + import 层约 320 处）待独占仓库窗口执行后按原阈值恢复。
        //    caughtErrors:"none"——typescript-eslint v8 默认上报未用 catch 参数
        //    （caughtErrors:"all"），`catch (error) { toast(...) }` 这类兜底吞掉是
        //    本仓大量存在的合法形态，varsIgnorePattern 在 v8 不作用于 catch 参数。
        "@typescript-eslint/no-unused-vars": ["warn", {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrors: "none",
        }],

        "@next/next/no-img-element": "off",
    },
  },
  {
    // 构建配置用 CJS require() 装配插件，属常规写法
    files: ["tailwind.config.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);
