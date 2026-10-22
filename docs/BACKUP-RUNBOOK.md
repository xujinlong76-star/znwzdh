# 备份与恢复 Runbook（SQLite）

> 脚本：`scripts/backup.mjs`；演练守卫：`scripts/backup-drill.test.ts`（2026-10-20 加入，CI 可重复执行）。
> 原则：**备份文件必须自包含、可打开、integrity_check=ok，并且真的能恢复出数据**；只看「备份文件生成了」不算备份成功。

## 1. 备份

```bash
# 默认：data/navhub.db → data/backups/navhub-YYYY-MM-DD_HH-mm-ss.db，保留 35 份
# （35 份按日备份覆盖 purge_trash 的 30 天回收站窗口：误删后一个月内仍能找回删除前快照）
pnpm backup

# 指定库与输出目录，保留 14 份
node scripts/backup.mjs --db /srv/navhub/data/navhub.db --out /srv/navhub/backups --keep 14

# 只备份、不轮换（演练/人工留档）
node scripts/backup.mjs --db ./data/navhub.db --out ./data/backups --no-rotate
```

- 路径解析：`--db` > `NAVHUB_SQLITE_PATH` > `NAVHUB_DB_PATH` > `data/navhub.db`。
- 在线热备：走 better-sqlite3 的 `backup()`（SQLite Online Backup API），**不需要停服务**，WAL 中已提交事务会一并进入备份。
- 只读打开源库（最小权限），不会写生产库。
- 备份完成后执行 `PRAGMA integrity_check`，失败退出码 1。
- 自动删除备份的 `-wal` / `-shm`，保证每个 `.db` 是自包含单文件。
- 轮换只匹配 `navhub-YYYY-MM-DD_HH-mm-ss.db`，不会误删其他文件。

### 定时任务（示例）

```cron
# 每天 03:17 备份，保留 35 份（覆盖 30 天回收站窗口）
17 3 * * * cd /srv/navhub && /usr/bin/node scripts/backup.mjs --keep 35 >> /var/log/navhub-backup.log 2>&1
```

建议再加一条「备份文件数量/最新文件时间」告警，避免 cron 静默失败。

## 2. 恢复

恢复是破坏性操作，先确认要恢复的时间点。

```bash
# 1) 停 API（避免恢复过程中仍有写入）
systemctl stop navhub-api

# 2) 保留现场（不要直接覆盖）
mv data/navhub.db data/navhub.db.before-restore
rm -f data/navhub.db-wal data/navhub.db-shm

# 3) 放入备份（确认同目录没有残留 -wal/-shm）
cp data/backups/navhub-2026-10-20_03-17-00.db data/navhub.db

# 4) 恢复前先自检
node -e "const D=require('better-sqlite3');const d=new D('data/navhub.db',{readonly:true});console.log(d.pragma('integrity_check',{simple:true}));d.close()"

# 5) 启动并验证
systemctl start navhub-api
curl -fsS http://localhost:8787/api/health
```

验证数据（按业务选择）：

```bash
sqlite3 data/navhub.db "select count(*) from sites;"
sqlite3 data/navhub.db "select count(*) from categories;"
sqlite3 data/navhub.db "pragma integrity_check;"
```

恢复后建议立刻再跑一次 `pnpm backup`，把「恢复后的状态」留一份新备份。

## 3. 演练记录

### 2026-10-20（本地，临时库）

- 场景：WAL 模式、写入 50 行后**不关闭连接**（最新提交仍在 WAL，模拟在线服务）。
- 命令：`node scripts/backup.mjs --db <tmp>/navhub.db --out <tmp>/backups --no-rotate`
- 结果：
  - 备份成功，输出含 `integrity_check=ok`；
  - 备份目录仅 1 个 `.db`，无 `-wal` / `-shm`；
  - 以只读方式打开备份，`integrity_check=ok`，`select count(*)` = **50**（WAL 数据完整）；
- 自动化守卫：`pnpm exec vitest run scripts/backup-drill.test.ts` → 2 条测试通过（热备完整性 + 源库缺失退出码 1）。

### 待演练（需要预发/生产环境）

- [ ] 真实数据量下的备份耗时与磁盘占用
- [ ] 完整恢复流程（停服 → 替换 → 启动 → 核心接口验证）
- [ ] 备份文件异地/对象存储传输后的可恢复性
- [ ] cron 失败告警

## 4. 退出码

| 退出码 | 含义 | 处理 |
| :--- | :--- | :--- |
| 0 | 备份 + 完整性校验成功 | 正常 |
| 1 | 源库不存在 / 无法加载 better-sqlite3 / 备份失败 / 校验失败 | 看日志；不要删除旧备份 |
