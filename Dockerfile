# ==========================================
# NavHub 生产级多阶段容器镜像
# ==========================================

FROM node:22-bookworm-slim AS base
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

RUN pnpm install --no-frozen-lockfile

# 构建阶段
FROM dependencies AS builder
COPY . .
RUN pnpm -r --filter './packages/**' build || true
RUN node scripts/run.mjs --filter navsphere build

# 生产运行阶段
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /app /app

EXPOSE 3000
EXPOSE 8787

# 默认启动 API 与 Web 服务
CMD ["node", "scripts/run.mjs", "dev"]
