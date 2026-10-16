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
  // 因此与 eslint 一样不在构建期做类型门禁。
  // 自研的 packages/* 与 apps/api 仍由 tsc --noEmit 严格检查。
  typescript: { ignoreBuildErrors: true },

  // 不在构建期跑 ESLint（upstream 设定，保留）。
  // 门禁没有因此缺失：CI 的 test-web job 会单独执行 `next lint`，本地 `pnpm lint` 同样可用。
  // 历史故障：本机 pnpm 链接层断裂导致 eslint-config-next 及其依赖未链入 apps/web，
  // `next lint` 直接报 couldn't find the config "next/core-web-vitals"（2026-10-17 修复：
  // 重建 .pnpm 实例内的包链接）。若再次出现，先跑一次干净的 `pnpm install` 再重试。
  eslint: { ignoreDuringBuilds: true },

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
    ];
    // HSTS：http-only 的自托管一旦下发就会被浏览器强制升级，因此只在明确 https 时开启。
    const hsts = process.env.NAVHUB_HSTS === "1" || (process.env.NAVHUB_PUBLIC_URL || "").startsWith("https://");
    if (hsts) {
      hosts.push({ key: "Strict-Transport-Security", value: "max-age=15552000" });
    }
    // CSP：Next 依赖内联脚本/样式，收紧需要逐页验证，故默认关闭，用 NAVHUB_CSP=1 开启。
    if (process.env.NAVHUB_CSP === "1") {
      hosts.push({
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: https:",
          "font-src 'self' data:",
          "connect-src 'self' https: wss:",
          "frame-src https:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
        ].join("; "),
      });
    }
    return [{ source: "/:path*", headers: hosts }];
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
  webpack: (config, { dev }) => {
    if (dev) {
      // 避免 Windows 环境下 webpack filesystem cache 发生 pack.gz 重命名锁竞争与 ENOENT 损坏
      config.cache = { type: "memory" };
    }
    return config;
  },
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost", "newkit.site"],
    },
    optimizePackageImports: ["lucide-react", "date-fns", "lodash"],
  },
};

module.exports = nextConfig;
