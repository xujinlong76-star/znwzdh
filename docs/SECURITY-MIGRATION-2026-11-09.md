# 安全性升级迁移说明（2026-11-09：S-1 / S-2）

本文面向**已经在运行**的 NavHub 部署，说明本次两个破坏性变更、升级前必须准备的环境变量、
以及升级后如何自检。新部署按 `.env.example` 配置即可，不需要读本文的迁移部分。

## 变更摘要

| 编号 | 变更 | 会不会导致升级后起不来 |
| --- | --- | --- |
| S-1 | `NAVHUB_SESSION_SECRET` 不再被接受为管理面 Bearer；生产环境必须配置 `NAVHUB_ADMIN_TOKEN`（或临时的 `NAVHUB_BOOTSTRAP_TOKEN`） | **会**：`NODE_ENV=production` 且两者都缺失时启动即失败 |
| S-2 | `NAVHUB_AUTH_REQUIRED` 默认跟随 `NODE_ENV`（生产默认 `true`）；生产开放模式必须回环 `NAVHUB_PUBLIC_URL` + 显式 `NAVHUB_ALLOW_INSECURE_LOCALHOST=1` | 取决于现状：生产原本靠「未开鉴权 + localhost」跑起来的部署会启动失败 |

`docker/docker-compose.yml` 中的默认值已同步为 `NAVHUB_AUTH_REQUIRED=${NAVHUB_AUTH_REQUIRED:-1}`。

## 升级前：判断自己属于哪种部署

```bash
# 1) 现在的鉴权模式
docker compose exec api printenv NAVHUB_AUTH_REQUIRED NAVHUB_PUBLIC_URL NAVHUB_ADMIN_TOKEN NAVHUB_BOOTSTRAP_TOKEN

# 2) 是否有脚本/CI 用 SESSION_SECRET 直接调管理面（升级后会 401）
grep -rn "NAVHUB_SESSION_SECRET" --include='*.sh' --include='*.yml' --include='*.yaml' --include='*.mjs' . \
  | grep -v node_modules
```

第 2 步命中「拿 SESSION_SECRET 当 Authorization Bearer」的位置，都要改成使用 `NAVHUB_ADMIN_TOKEN`
或由 `/api/tokens` 签发的正式 token。

## 升级步骤

1. **生成管理面凭据**（≥32 字符随机串，不要复用 `NAVHUB_SESSION_SECRET`）：

   ```bash
   openssl rand -hex 32
   ```

2. **写进部署环境**（`.env` / compose `environment` / systemd `Environment=`）：

   ```dotenv
   NAVHUB_ADMIN_TOKEN=<上一步的随机串>
   # 公网部署：
   NAVHUB_AUTH_REQUIRED=1
   NAVHUB_IDENTITY_SECRET=<另一条 ≥32 字符随机串>
   NAVHUB_PUBLIC_URL=https://your-domain
   ```

   仅本机/NAS 且**确实**要开放模式的：

   ```dotenv
   NAVHUB_AUTH_REQUIRED=0
   NAVHUB_PUBLIC_URL=http://localhost:8787   # 必须是回环/内网地址
   NAVHUB_ALLOW_INSECURE_LOCALHOST=1         # 显式承认，缺这一条启动即失败
   ```

   `NAVHUB_ALLOW_INSECURE_PUBLIC` 已失效，不再能把公网 + 开放模式降级成警告。

3. **重启并确认启动成功**：

   ```bash
   docker compose up -d api web && docker compose logs --tail=50 api
   curl -fsS http://localhost:8787/api/ready
   ```

4. **验证管理面凭据真的可用**：

   ```bash
   curl -fsS -H "Authorization: Bearer $NAVHUB_ADMIN_TOKEN" http://localhost:8787/api/tokens
   # 旧方式必须已经 401（预期 401，若返回 200 说明还在跑旧镜像）
   curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $NAVHUB_SESSION_SECRET" \
     http://localhost:8787/api/tokens
   ```

5. **首次引导（可选）**：如果不想长期保管 admin token，可临时用 `NAVHUB_BOOTSTRAP_TOKEN`
   调 `/api/tokens` 签发正式 token，然后**删除该变量并重启**（生产环境启动时会打印告警提醒）。

## 启动失败时的报错对照

| 报错关键字 | 含义 | 处置 |
| --- | --- | --- |
| `NAVHUB_ADMIN_TOKEN` | 生产缺少管理面凭据（S-1） | 按升级步骤 1–2 配置 |
| `NAVHUB_SESSION_SECRET` | 生产密钥缺失/过短/在黑名单（既有规则） | 配置 ≥32 字符随机串 |
| `NAVHUB_PUBLIC_URL` | 显式关闭鉴权后必须声明 publicUrl | 补 `NAVHUB_PUBLIC_URL` |
| `NAVHUB_ALLOW_INSECURE_LOCALHOST` | 生产开放模式未显式承认（S-2） | 置 `1`（仅回环部署）或改回 `AUTH_REQUIRED=1` |
| `公网部署必须开启鉴权` | `AUTH_REQUIRED=0` + 公网 publicUrl（S-2） | 改为 `AUTH_REQUIRED=1` |

## 回滚

本次变更不涉及数据库结构，回滚只需退镜像版本与环境变量：

```bash
docker compose down
# 把 image tag 改回升级前的版本，并把 .env 恢复为升级前备份
docker compose up -d
```

注意：回滚后 `NAVHUB_SESSION_SECRET` 会重新成为管理面 Bearer，等于把会话签名密钥的泄露面
重新扩大到最高权限。若发生过 `NAVHUB_SESSION_SECRET` 外泄，回滚前先轮换该密钥。
