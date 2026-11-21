# CodeQL 警报全景盘点 — xujinlong76-star/znwzdh

- 盘点时间：2026/11/21 10:09:25 CST
- 认证来源：git credential store（本机细粒度 PAT）
- 数据来源：GitHub REST API `GET /repos/xujinlong76-star/znwzdh/code-scanning/alerts?state=open`

## ⚠️ 本次未取到真实警报数据（权限缺口，非 0 条）

- API 返回：HTTP 403（forbidden）
- 报错原文：`Resource not accessible by personal access token`
- 含义：本机令牌没有读 CodeQL 警报的权限，**不是警报已清零**。

### 补权限后重跑

1. 细粒度 PAT（推荐，仓库级最小权限）：GitHub → Settings → Developer settings →
   Personal access tokens → Fine-grained tokens → 选中本机 PAT → Repository permissions →
   **Code scanning alerts: Read-only**（Dependabot 另需 **Dependabot alerts: Read-only**）→ Save。
2. 或经典 PAT：建 token 时勾选 scope **`security_events: read`**。
3. 重跑：`node scripts/codeql-triage.mjs --out docs/security/codeql-triage-report-YYYY-MM-DD.md`

> 以下分组统计为空是因为本次未取到数据，**不是真实数字**。补权限后重跑，本节会被真实统计替换。

## 严重程度分布

（未取到数据）

## 规则 ID Top 重复项

（未取到数据）

## 文件归属分类

（未取到数据）

## Dependabot 警报

（未取到：HTTP 403，Resource not accessible by personal access token）

---

脚本：`scripts/codeql-triage.mjs`（零第三方依赖，Node >= 18）。