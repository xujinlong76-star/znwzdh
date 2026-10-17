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
