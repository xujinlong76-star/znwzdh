/**
 * 用户数据清单（Data Inventory）。
 *
 * 解决的问题：导出与注销此前是两份**手写 SQL 清单**，新增一张用户表时
 * 很容易只改其中一处，或者两处都忘。历史事故已经发生过两次：
 *   - CRDT 编辑日志（`crdt:<id>`）既不在导出包里、也不在注销删除清单里；
 *   - 工作区明文迁出后，vault 里的历史残留没有被清。
 *
 * 现在把「哪些表属于某个用户、以哪一列归属、注销时怎么处理」集中到这张表：
 *   - `delete`     ：按 owner 列精确删除（通用路径，由 deleteUserData 循环执行）
 *   - `nullify`    ：保留聚合价值，抹掉身份（llm_usage）
 *   - `key-prefix` ：以 `前缀 + identity` 存储的 KV 行（vault / workspace）
 *   - `custom`     ：有额外副作用（计数器、别名双列、users 行），单独实现
 *
 * 守护测试（packages/store/test/data-inventory.test.ts）会遍历真实库的
 * `sqlite_master`：任何带用户归属列、却既没登记也没豁免的表，测试直接红。
 * 这样「新增用户表」不再依赖人记得改注销逻辑。
 */

export type UserDataDisposition = "delete" | "nullify" | "key-prefix" | "custom";

export interface UserDataDomain {
  /** 稳定标识，同时用作 UserDataDeletionCounts 的键（没有对应计数时为空） */
  id: string;
  table: string;
  /** 归属列；custom 域可能有多列（如 identity_aliases 的 alias/canonical） */
  ownerColumns: readonly string[];
  disposition: UserDataDisposition;
  /** 导出包里的字段名；为空表示该域不导出（密文/机器数据） */
  exportField?: string;
  /** 为什么这样处理——留给下一个改这张表的人 */
  note: string;
}

export const USER_DATA_DOMAINS: readonly UserDataDomain[] = [
  {
    id: "favorites",
    table: "favorites",
    ownerColumns: ["user_id"],
    disposition: "delete",
    exportField: "favorites",
    note: "收藏条目；同时被 purgeSite 按 site_id 清理",
  },
  {
    id: "favoriteFolders",
    table: "favorite_folders",
    ownerColumns: ["user_id"],
    disposition: "delete",
    exportField: "favoriteFolders",
    note: "收藏夹",
  },
  {
    id: "searchHistory",
    table: "search_history",
    ownerColumns: ["user_id"],
    disposition: "delete",
    exportField: "searchHistory",
    note: "搜索历史；保留期任务按用户显式设置清理",
  },
  {
    id: "events",
    table: "events",
    ownerColumns: ["identity"],
    disposition: "delete",
    exportField: "eventsSummary",
    note: "行为事件；导出只给按 kind 的聚合，不给逐条明细",
  },
  {
    id: "profile",
    table: "user_profiles",
    ownerColumns: ["user_id"],
    disposition: "delete",
    exportField: "profile",
    note: "画像",
  },
  {
    id: "llmConfig",
    table: "user_llm_configs",
    ownerColumns: ["identity"],
    disposition: "delete",
    exportField: "llmConfig",
    note: "导出只保留非敏感字段，apiKeyEnc 不导出",
  },
  {
    id: "settings",
    table: "user_settings",
    ownerColumns: ["identity"],
    disposition: "delete",
    exportField: "settings",
    note: "个性化设置与保留期偏好",
  },
  {
    id: "pluginReviews",
    table: "plugin_reviews",
    ownerColumns: ["identity"],
    disposition: "delete",
    exportField: "pluginReviews",
    note: "评价正文属于用户内容，注销后不得继续公开可见",
  },
  {
    id: "sessions",
    table: "sessions",
    ownerColumns: ["user_id"],
    disposition: "delete",
    note: "会话令牌哈希；不导出",
  },
  {
    id: "notifications",
    table: "notifications",
    ownerColumns: ["identity"],
    disposition: "delete",
    note: "站内通知",
  },
  {
    id: "apiTokens",
    table: "api_tokens",
    ownerColumns: ["owner_identity"],
    disposition: "delete",
    note: "个人令牌；注销后必须立刻失效，不能留到过期",
  },
  {
    id: "llmUsage",
    table: "llm_usage",
    ownerColumns: ["identity"],
    disposition: "nullify",
    note: "保留用量聚合价值，抹掉身份（可逆性为零，等同匿名化）",
  },
  {
    id: "pluginInstalls",
    table: "plugin_installs",
    ownerColumns: ["identity"],
    disposition: "custom",
    exportField: "pluginInstalls",
    note: "删除前要扣减 plugins.install_count",
  },
  {
    id: "pluginStars",
    table: "plugin_stars",
    ownerColumns: ["identity"],
    disposition: "custom",
    exportField: "pluginStars",
    note: "删除前要扣减 plugins.star_count",
  },
  {
    id: "vault",
    table: "user_vault_sync",
    ownerColumns: ["user_id"],
    disposition: "custom",
    exportField: "vault",
    note: "默认金库 + `crdt:<id>` 行 + `workspaces:` 残留，三组分别删",
  },
  {
    id: "workspaces",
    table: "user_workspace_blobs",
    ownerColumns: ["user_id"],
    disposition: "key-prefix",
    exportField: "workspaces",
    note: "workspaces:<id> 与 ws_members:<id>:* 两类键",
  },
  {
    id: "identityAliases",
    table: "identity_aliases",
    ownerColumns: ["alias", "canonical"],
    disposition: "custom",
    note: "双列归属：任一侧命中都要删",
  },
  {
    id: "identityMerges",
    table: "identity_merges",
    ownerColumns: ["source", "target"],
    disposition: "custom",
    note: "双列归属：合并记录任一侧命中都要删",
  },
  {
    id: "userRow",
    table: "users",
    ownerColumns: ["id"],
    disposition: "custom",
    exportField: "user",
    note: "只删 canonical 形态（含 ':'），内置管理员 id 不含 ':'",
  },
];

/**
 * 明确**不属于**单个用户的数据表：全局目录、机器遥测、治理日志等。
 * 放进白名单要写理由——否则「豁免」会变成默认选项。
 */
export const USER_DATA_EXEMPT_TABLES: readonly string[] = [
  "sites",
  "categories",
  "tags",
  "tag_aliases",
  "site_tags",
  "site_facets",
  "site_relations",
  "site_archives",
  "collections",
  "collection_items",
  "health_checks",
  "audit_logs",
  "jobs",
  "idempotency",
  "embeddings",
  "system_states",
  "taxonomy_proposals",
  "plugins",
  "plugin_versions",
  "plugin_reports",
  "plugin_events",
  "short_links",
  "schema_migrations",
  "sqlite_sequence",
];

/** 注销时走通用精确删除的表（custom/key-prefix/nullify 由 deleteUserData 单独处理） */
export function genericDeleteDomains(): readonly UserDataDomain[] {
  return USER_DATA_DOMAINS.filter((d) => d.disposition === "delete" && d.ownerColumns.length === 1);
}

export function isRegisteredUserTable(table: string): boolean {
  return (
    USER_DATA_DOMAINS.some((d) => d.table === table) ||
    USER_DATA_EXEMPT_TABLES.includes(table)
  );
}
