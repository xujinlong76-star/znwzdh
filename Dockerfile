# ==========================================
# [DEPRECATED] 历史单镜像草案（仅供本地快速试验参考）
# 生产与标准容器化部署请使用 `docker/Dockerfile.api`、`docker/Dockerfile.web`
# 以及 `docker/docker-compose.yml`（支持 lite / web / standard / mcp 四个 profile）。
# ==========================================
#
# DEPRECATED（已废弃）：根 Dockerfile / docker-compose.yml 为历史简版入口，
# 新部署请使用 docker/Dockerfile.api + docker/Dockerfile.web 与
# docker/docker-compose.yml（详见 docs/wiki/08-extensions-scripts-docker.md）。
# 本文件仅保留兼容，不再演进；CI 不再引用它。

FROM node:24-bookworm-slim AS base
WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ ca-certificates curl wget && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.7.0 --registry=https://registry.npmmirror.com

# 依赖阶段
FROM base AS dependencies
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* .npmrc tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/store/package.json ./packages/store/
COPY packages/ai/package.json ./packages/ai/
COPY packages/mcp/package.json ./packages/mcp/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# 构建阶段
FROM dependencies AS builder
COPY . .
RUN pnpm -r --filter './packages/**' build
RUN node scripts/run.mjs --filter navsphere build

# 生产运行阶段
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app /app

EXPOSE 3000
EXPOSE 8787

# ⚠️ 本文件已 DEPRECATED（见文件头），且这条 CMD 以 dev 模式作生产入口，属误用陷阱。
# 2026-11-06 深度扫描：改为显式阻断——误用此镜像时立即失败并指向正确部署文件，
# 而不是静默起一个开发服务器当成生产环境。
# 正确入口：docker/docker-compose.yml + docker/Dockerfile.api + docker/Dockerfile.web
CMD ["node", "-e", "console.error('[DEPRECATED] 根 Dockerfile 已废弃，请勿使用。生产部署请用 docker/docker-compose.yml 与 docker/Dockerfile.api / docker/Dockerfile.web（见 README 与 docs/wiki/08）。'); process.exit(1)"]
