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

  // Dont fail build on ESLint warnings (upstream 设定)
  eslint: { ignoreDuringBuilds: true },

  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
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
