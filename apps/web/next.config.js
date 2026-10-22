/**
 * CSP 策略唯一事实源：enforce 与 report-only 必须逐字一致，
 * 否则「观察到的」与「实际拦截的」不是同一套策略。新增源只改这里。
 */
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // 投机算式已改为纯递归下降求值（apps/web-overlay/src/lib/arithmetic.ts），
  // 生产 CSP 不再需要 'unsafe-eval'；保留 'unsafe-inline' 是 Next 内联样式/脚本的边界。
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** @type {import("next").NextConfig} */
const nextConfig = {
  // 构建输出目录可用 NEXT_DIST_DIR 覆盖（默认 .next）。
  // 用途：CI / 验证构建不想动现有产物时指定独立目录。
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // standalone 产物用于自包含部署（Docker / Cloudflare），它需要在构建期创建符号链接。
  // Windows 上若未开启"开发者模式"，创建符号链接会 EPERM 失败，
  // 因此改为**按需开启**：设置 NAVHUB_WEB_STANDALONE=1 时才生成 standalone 产物。
  // 本仓库的 Docker 部署走普通 next start，不需要 standalone。
  ...(process.env.NAVHUB_WEB_STANDALONE === "1" ? { output: "standalone" } : {}),

  // Vendored 上游（NavSphere）的表单组件与本仓库的严格类型配置不兼容
  // （@hookform/resolvers@3.9.1 + zod 的 zodResolver 泛型不匹配，属上游依赖组合问题），
  // 因此不在构建期做类型门禁（ESLint 同样不进构建期，见下）。
  // 自研的 packages/* 与 apps/api 仍由 tsc --noEmit 严格检查。
  typescript: { ignoreBuildErrors: true },

  // 不在构建期跑 ESLint。Next 16 起 next build 不再内置 lint，`next lint`
  // 命令与 next.config 的 eslint 键都被移除——门禁没有因此缺失：
  // CI 的 test-web job 单独执行 `eslint .`（ESLint CLI + eslint-config-next@16
  // 扁平配置），本地 `pnpm lint` 同样可用。
  // 历史故障：本机 pnpm 链接层断裂导致 eslint-config-next 及其依赖未链入 apps/web，
  // `eslint .` 直接报 couldn't find the config "next/core-web-vitals"（2026-10-17 修复：
  // 重建 .pnpm 实例内的包链接）。若再次出现，先跑一次干净的 `pnpm install` 再重试。

  images: {
    // 导航站要展示任意站点的 favicon / 截图，域名天然不可枚举，
    // 因此默认保持 https 通配；需要收紧的部署可用 NAVHUB_IMAGE_HOSTS
    // 指定白名单（逗号分隔，如 "cdn.example.com,img.example.com"）。
    remotePatterns: (process.env.NAVHUB_IMAGE_HOSTS || "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean)
      .map((hostname) => ({ protocol: "https", hostname }))
      .concat([{ protocol: "https", hostname: "**" }].filter(() => !process.env.NAVHUB_IMAGE_HOSTS)),
  },
  // 安全响应头：Docker 自托管走 `next start`，vercel.json 里的头在那种形态下不生效，
  // 因此把头下沉到应用本身，任何部署形态都一致。
  // 破坏性较强的两项（HSTS / CSP）默认关闭或按需开启，避免一上线就把站点打挂。
  async headers() {
    const hosts = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=()" },
      // COOP：same-origin-allow-popups 兼顾 OAuth 弹窗登录（GitHub）。
      // 裸 same-origin 会切断 opener 关系，弹窗回跳后前端收不到登录结果。
      { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
      // CORP：本站资源（favicon / 预取快照）只准被同站点页面引用，
      // 挡住其它站点把我们的接口当图像端点白蹭。
      { key: "Cross-Origin-Resource-Policy", value: "same-site" },
    ];
    // HSTS：http-only 的自托管一旦下发就会被浏览器强制升级，因此只在明确 https 时开启。
    const hsts = process.env.NAVHUB_HSTS === "1" || (process.env.NAVHUB_PUBLIC_URL || "").startsWith("https://");
    if (hsts) {
      hosts.push({ key: "Strict-Transport-Security", value: "max-age=15552000" });
    }
    // CSP：Next 依赖内联脚本/样式，收紧需要逐页验证，故默认关闭，用 NAVHUB_CSP=1 开启。
    // 注意：Next 的 headers() 在 `next build` 时求值并写入 routes-manifest，
    // 因此 CSP 开关是**构建期**环境变量；运行时改 env 不会生效（Docker 用 --build-arg 传入）。
    // 两种档位共用 CSP_DIRECTIVES（唯一事实源），避免「观察策略」与「拦截策略」漂移；
    // NAVHUB_CSP_REPORT_URI 在两种档位都会追加 report-uri，enforce 后仍可持续收集违规。
    const cspValue = process.env.NAVHUB_CSP_REPORT_URI
      ? `${CSP_DIRECTIVES}; report-uri ${process.env.NAVHUB_CSP_REPORT_URI}`
      : CSP_DIRECTIVES;
    if (process.env.NAVHUB_CSP === "1") {
      hosts.push({ key: "Content-Security-Policy", value: cspValue });
    }
    // CSP report-only（P2-4 第一步）：与 enforce 完全同源的策略，但只收集违规
    // 不拦截。理由见下方 enforce 分支的注释——直接 enforce 会把需要内联脚本的
    // 页面打挂，必须先跑一周收集真实违规再决定收哪些源。
    // 用法：NAVHUB_CSP_REPORT_ONLY=1 开启；可选 NAVHUB_CSP_REPORT_URI 指定上报地址。
    // 两个开关同时打开时 enforce 优先：只下发 enforce，避免同源策略双份报告。
    if (process.env.NAVHUB_CSP_REPORT_ONLY === "1" && process.env.NAVHUB_CSP !== "1") {
      hosts.push({ key: "Content-Security-Policy-Report-Only", value: cspValue });
    }
    return [{ source: "/:path*", headers: hosts }];
  },
  async redirects() {
    // 两条都是「分页/预览从 query 迁到路径段」的兜底，动机相同：
    // 这些路由带 revalidate + generateStaticParams，页面签名一读 searchParams
    // 就会在按需生成阶段抛 DYNAMIC_SERVER_USAGE（生产构建实测 500），
    // 所以查询参数形态只能由配置层接住，不能进页面代码。
    return [
      {
        // 插件预览 `?preview=1` → `/marketplace/{slug}/preview`。
        // 非永久跳转：预览是内部通道，留回退余地。
        source: "/marketplace/:slug",
        has: [{ type: "query", key: "preview", value: "1" }],
        destination: "/marketplace/:slug/preview",
        permanent: false,
      },
      {
        // 分类分页 `?page=N`（N≥2）→ `/category/{slug}/p/{n}`。
        // 永久：旧形态是已收录 URL，要把权重一次性交给新形态。
        // `:slug` 只匹配一段，不会吃掉 `/category/x/p/2` 自身，不构成环。
        // `?page=1` 不拦：裸 URL 忽略多余 query，canonical 自指会自行归一。
        source: "/category/:slug",
        has: [{ type: "query", key: "page", value: "(?<n>[2-9]|[1-9][0-9]+)" }],
        destination: "/category/:slug/p/:n",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    // /api/hub/* 不走 rewrite：改用 src/app/api/hub/[...path]/route.ts 运行时转发
    // （rewrite 目标在构建期固化，改中枢地址要重新构建；路由在运行时读环境变量）。
    return [
      { source: "/api/auth/:path*", destination: "/api/auth/:path*" },
      { source: "/auth/:path*", destination: "/auth/:path*" },
    ];
  },
  devIndicators: false,
  // 拖拽库懒加载：管理端几个上游列表页直接 import '@hello-pangea/dnd'，
  // 把 ~92 KB 拖进首屏。别名把裸包名指向我们的代理组件（src/lib/lazy-dnd.tsx），
  // 代理内部再用深路径直指包内 ESM 产物以绕开别名自递归。
  // 详见 apps/web-overlay/src/lib/lazy-dnd.tsx 顶部的说明。
  turbopack: {
    resolveAlias: {
      "@hello-pangea/dnd": "./src/lib/lazy-dnd.tsx",
    },
  },
  // 原 webpack 函数（dev 时把 filesystem cache 切成 memory，规避 Windows 上
  // pack.gz 重命名锁竞争与 ENOENT 损坏）已移除：Next 16 起 Turbopack 是
  // dev/build 的默认打包器，且 next.config 里残留 webpack 函数会直接导致
  // next build 失败。Turbopack 的缓存机制不同，不存在该 Windows 问题，
  // 故整体移除而非迁移到 turbopack 配置项。
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost", "newkit.site"],
    },
    optimizePackageImports: ["lucide-react", "date-fns", "lodash"],
  },
};

module.exports = nextConfig;
