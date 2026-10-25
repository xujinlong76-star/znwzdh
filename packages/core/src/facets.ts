/**
 * 分面体系 (Faceted Taxonomy - Phase 2)
 *
 * 为 NavHub 提供正交、受控的多维筛选属性体系。
 * 遵循 W3C SKOS 与分面分类学原则：
 * 1. 正交性：各分面维度彼此独立（付费模式、平台、产品形态、语言支持、应用场景）；
 * 2. 受控词表：封闭候选值集合，杜绝随意输入导致分类爆炸；
 * 3. 渐进式披露：支持与主分类树 (Categories) 及领域标签 (Tags) 自由交叉叠加。
 */

export type BuiltinFacetKey = "pricing" | "platform" | "form" | "language" | "scene";
export type FacetKey = BuiltinFacetKey | (string & {});

export interface FacetOption {
  value: string;
  label: string;
  labelEn?: string;
  description?: string;
}

export interface FacetDefinition {
  key: FacetKey;
  label: string;
  labelEn?: string;
  description?: string;
  multiselect?: boolean;
  options: FacetOption[];
}

export interface FacetOptionCount {
  value: string;
  label: string;
  labelEn?: string;
  count: number;
}

export interface FacetGroupSummary {
  key: string;
  label: string;
  labelEn?: string;
  description?: string;
  options: FacetOptionCount[];
}

/**
 * 官方标准受控分面定义（Controlled Facet Vocabulary）
 */
export const CONTROLLED_FACETS: FacetDefinition[] = [
  {
    key: "pricing",
    label: "付费模式",
    labelEn: "Pricing Model",
    description: "产品的收费形式与许可方式",
    multiselect: false,
    options: [
      { value: "free", label: "完全免费", labelEn: "100% Free", description: "无需付费，无功能截留" },
      { value: "freemium", label: "免费增值", labelEn: "Freemium", description: "基础功能免费，高级特性或配额收费" },
      { value: "paid", label: "商业付费", labelEn: "Paid / Commercial", description: "需付费购买或按月订阅" },
      { value: "open_source", label: "开源免费", labelEn: "Open Source", description: "遵循开源协议发布且完全可用" },
    ],
  },
  {
    key: "platform",
    label: "运行平台",
    labelEn: "Platform",
    description: "支持的设备终端与客户端环境",
    multiselect: true,
    options: [
      { value: "web", label: "Web 网页端", labelEn: "Web Browser", description: "浏览器在线即开即用" },
      { value: "ios", label: "iOS / iPadOS", labelEn: "iOS / iPad", description: "Apple 移动端设备" },
      { value: "android", label: "Android", labelEn: "Android", description: "安卓手机与平板应用" },
      { value: "macos", label: "macOS", labelEn: "macOS", description: "Apple 桌面客户端" },
      { value: "windows", label: "Windows", labelEn: "Windows", description: "Windows 桌面应用" },
      { value: "linux", label: "Linux", labelEn: "Linux", description: "Linux 桌面发行版" },
      { value: "extension", label: "浏览器插件", labelEn: "Browser Extension", description: "Chrome / Firefox / Edge 扩展" },
    ],
  },
  {
    key: "form",
    label: "产品形态",
    labelEn: "Delivery Form",
    description: "服务的交付与交付物形式",
    multiselect: true,
    options: [
      { value: "saas", label: "在线 SaaS", labelEn: "SaaS", description: "云端托管的即用型软件" },
      { value: "self_hosted", label: "自托管 / 私有部署", labelEn: "Self-Hosted", description: "可 Docker 或本地独立部署" },
      { value: "cli", label: "命令行工具", labelEn: "CLI Tool", description: "终端命令行与自动化脚本工具" },
      { value: "api", label: "开发者 API / SDK", labelEn: "API & SDK", description: "面向程序调用的接口与库" },
      { value: "desktop", label: "独立桌面软件", labelEn: "Desktop App", description: "Native 或 Electron 桌面端" },
      { value: "library", label: "代码库 / 框架", labelEn: "Library / Framework", description: "集成到工程中的组件或框架" },
    ],
  },
  {
    key: "language",
    label: "语言支持",
    labelEn: "Language Support",
    description: "用户界面与交互所支持的语言",
    multiselect: true,
    options: [
      { value: "zh", label: "中文友好", labelEn: "Chinese", description: "具备原生或完整中文界面与文档" },
      { value: "en", label: "英文", labelEn: "English", description: "主要界面或社区为英文" },
      { value: "multilingual", label: "多国语言", labelEn: "Multilingual", description: "支持包括中文、英文在内的多语言切换" },
    ],
  },
  {
    key: "scene",
    label: "应用场景",
    labelEn: "Application Scene",
    description: "适用的业务场景与工作流（与历史 workspaces 字段语义一致）",
    multiselect: true,
    options: [
      { value: "dev", label: "开发编程", labelEn: "Development", description: "代码编写、调试、测试与部署" },
      { value: "design", label: "设计创意", labelEn: "Design", description: "UI/UX、图形、配色与原型" },
      { value: "ai", label: "AI 与智能", labelEn: "AI & Agents", description: "大模型、生图、提示词与智能体" },
      { value: "content", label: "内容创作", labelEn: "Content", description: "写作、自媒体、笔记与排版" },
      { value: "productivity", label: "效率办公", labelEn: "Productivity", description: "协作、日程、文档与自动化" },
      { value: "ops", label: "运维与云原生", labelEn: "DevOps & Cloud", description: "容器、监控、网络与安全" },
    ],
  },
];

/**
 * 快速查找分面定义
 */
export function getFacetDefinition(key: string): FacetDefinition | undefined {
  const norm = key.trim().toLowerCase();
  return CONTROLLED_FACETS.find((f) => f.key === norm);
}

/**
 * 获取分面项的人类可读中文标签
 */
export function getFacetOptionLabel(key: string, value: string): string {
  const def = getFacetDefinition(key);
  if (!def) return value;
  const opt = def.options.find((o) => o.value === value.trim().toLowerCase());
  return opt?.label ?? value;
}

/**
 * 归一化输入分面对象：
 * - 键与值一律小写、去首尾空白
 * - 过滤空值与非法类型
 * - 去重
 */
export function normalizeFacets(
  raw: unknown,
  fallbackWorkspaces?: string[] | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = k.trim().toLowerCase();
      if (!key) continue;
      let values: string[] = [];
      if (Array.isArray(v)) {
        values = v.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
      } else if (typeof v === "string" && v.trim()) {
        values = [v.trim().toLowerCase()];
      }
      if (values.length > 0) {
        out[key] = [...new Set(values)];
      }
    }
  }

  // 兼容老数据：如果 scene 未显式传入，但存在 fallbackWorkspaces，则平滑注入
  if (!out.scene && Array.isArray(fallbackWorkspaces) && fallbackWorkspaces.length > 0) {
    const ws = fallbackWorkspaces
      .map((w) => String(w).trim().toLowerCase())
      .filter(Boolean);
    if (ws.length > 0) {
      out.scene = [...new Set(ws)];
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * 分面条件预算（存储写入与查询过滤共用一份）
 * ------------------------------------------------------------------ */

/**
 * 同一份预算同时约束「写进 site_facets 的内容」与「查询时提交的条件」。
 * 分开定两份的后果实测过：存储允许 50 个维度、过滤只认 16 个，
 * 于是同一份条件在 /api/sites 通过、在 /api/search 却 400。
 */
export const FACET_MAX_KEYS = 20;
export const FACET_MAX_VALUES_PER_KEY = 200;
export const FACET_MAX_KEY_LENGTH = 50;
export const FACET_MAX_VALUE_LENGTH = 100;
/**
 * facets 以 JSON 字符串形态提交时的整体长度上限。
 *
 * 必须大于「合法内容的理论上限」，否则字符串形态会比对象形态更严：
 * 20 键 × 200 值 × 100 字符 ≈ 413KB，取 500KB 只拦病态大小。
 * 定这个上限的目的不是限制内容，而是在 `JSON.parse` 之前挡住超大输入
 * （解析分配发生在校验之前，见 CVE-2026-77354 的同类放大）。
 */
export const FACET_MAX_JSON_LENGTH = 500_000;

export interface FacetFilterResult {
  facets?: Record<string, string[]>;
  error?: string;
}

/**
 * 归一化并校验 `facets` 条件（HTTP query/body 与 MCP 工具共用这一份实现）。
 *
 * 为什么必须统一在契约层：
 *  - 存储侧的 `filterSiteIdsByFacets` 按「键数」发查询、按「每键值数」拼 IN；
 *    没有预算时一条查询串就能放大成上千个绑定参数（同类攻击见 OpenAPI deepObject
 *    稀疏索引导致内存放大的 CVE-2026-77354）。
 *  - 语义必须显式：以前「键存在但取值全为空串」被静默折叠成「没传过滤」，
 *    客户端以为在筛选、实际拿到未过滤的全量；非法 JSON 同样被吞掉。
 *    这两种都回 error，由调用方转 400 / 工具错误，不能回错数据。
 *
 * 接受三种形态并归一化：
 *  - `{ pricing: ["free", "freemium"] }`（body / MCP）
 *  - `{ pricing: "free,freemium" }`（query string 常见写法，逗号分隔）
 *  - `'{"pricing":["free"]}'`（整段 JSON 字符串；Fastify 默认 query parser
 *    不解析 `facets[pricing]` 这种方括号嵌套，JSON 串是可移植的写法）
 */
export function clampFacetFilter(input: unknown): FacetFilterResult {
  if (input === undefined || input === null) return {};
  let source: unknown = input;
  if (typeof source === "string") {
    const trimmed = source.trim();
    if (!trimmed) return {};
    if (trimmed.length > FACET_MAX_JSON_LENGTH) {
      return { error: `facets 长度超过上限 (${FACET_MAX_JSON_LENGTH} 字符)` };
    }
    try {
      source = JSON.parse(trimmed);
    } catch {
      return { error: "facets 必须是合法的 JSON 对象" };
    }
  }
  if (Array.isArray(source) || typeof source !== "object" || source === null) {
    return { error: "facets 必须是 { 键: 值或值数组 } 形态的对象" };
  }
  const entries = Object.entries(source as Record<string, unknown>);
  if (entries.length > FACET_MAX_KEYS) {
    return { error: `facets 最多 ${FACET_MAX_KEYS} 个键，收到 ${entries.length} 个` };
  }
  const facets: Record<string, string[]> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.trim();
    if (!key) continue;
    if (key.length > FACET_MAX_KEY_LENGTH) {
      return { error: `facet 键名过长（最多 ${FACET_MAX_KEY_LENGTH} 字符）：${key.slice(0, 12)}…` };
    }
    const rawValues = Array.isArray(rawValue)
      ? rawValue
      : typeof rawValue === "string"
        ? rawValue.split(",")
        : [rawValue];
    const values: string[] = [];
    for (const v of rawValues) {
      // 只接受纯量：`String(null)`/`String({})` 会拼出 'null'、'[object Object]'
      // 一起绑进 SQL。静默丢弃同样糟——客户端以为条件生效，其实已经消失。
      if (typeof v !== "string" && typeof v !== "number") {
        return { error: `facets.${key} 的值必须是字符串或数字` };
      }
      const normalized = String(v).trim().toLowerCase();
      if (!normalized) continue;
      if (normalized.length > FACET_MAX_VALUE_LENGTH) {
        return { error: `facets.${key} 的取值过长（最多 ${FACET_MAX_VALUE_LENGTH} 字符）` };
      }
      values.push(normalized);
    }
    if (values.length === 0) {
      return { error: `facets.${key} 没有有效取值（空字符串不算过滤条件）` };
    }
    if (values.length > FACET_MAX_VALUES_PER_KEY) {
      return { error: `facets.${key} 最多 ${FACET_MAX_VALUES_PER_KEY} 个值，收到 ${values.length} 个` };
    }
    facets[key.toLowerCase()] = [...new Set(values)];
  }
  return { facets };
}
