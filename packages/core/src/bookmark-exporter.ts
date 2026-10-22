/**
 * 数据主权与全量灾备引擎 (Data Sovereignty & Cold Disaster Recovery Engine)
 * 纯算法跨环境实现，零依赖，跨 Node.js 与 Web 端通用。
 *
 * 核心功能：
 * 1. Netscape Bookmark HTML 规范导出 (Chrome, Safari, Firefox, Edge 标准互通)
 * 2. NavHub 全量冷备规格 (.nhbak.json) 打包与校验
 */

import type { Category, Site } from "./types.ts";

export interface NavHubColdBackup {
  version: "1.0";
  generator: "NavHub 2026 Sovereign Backup Engine";
  exportedAt: number;
  categories: Array<{
    id: string;
    title: string;
    slug?: string;
    description?: string | null;
    sort?: number;
  }>;
  sites: Array<{
    id: string;
    title: string;
    url: string;
    description?: string | null;
    categoryId?: string | null;
    tags?: string[];
    icon?: string | null;
    enabled?: boolean;
    createdAt?: number;
  }>;
  stats: {
    categoryCount: number;
    siteCount: number;
  };
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 将 NavHub 分类与站点导出为标准的 Netscape Bookmarks HTML 格式
 */
export function exportNetscapeBookmarks(categories: Category[], sites: Site[]): string {
  const catMap = new Map<string, { category: Category; sites: Site[] }>();
  const uncategorized: Site[] = [];

  for (const cat of categories) {
    catMap.set(cat.id, { category: cat, sites: [] });
  }

  for (const site of sites) {
    if (site.categoryId && catMap.has(site.categoryId)) {
      catMap.get(site.categoryId)!.sites.push(site);
    } else {
      uncategorized.push(site);
    }
  }

  const lines: string[] = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
  ];

  for (const { category, sites: catSites } of catMap.values()) {
    if (catSites.length === 0) continue;
    const addDate = Math.floor((category.createdAt || Date.now()) / 1000);
    const lastModified = Math.floor((category.updatedAt || Date.now()) / 1000);
    lines.push(`    <DT><H3 ADD_DATE="${addDate}" LAST_MODIFIED="${lastModified}">${escapeHtml(category.title)}</H3>`);
    lines.push("    <DL><p>");

    for (const site of catSites) {
      if (!site.url || !/^https?:\/\//i.test(site.url)) continue;
      const siteAddDate = Math.floor((site.createdAt || Date.now()) / 1000);
      const siteIcon = (site as any).icon || site.iconKey || "";
      const iconAttr = siteIcon ? ` ICON="${escapeHtml(siteIcon)}"` : "";
      const tagsAttr = site.tags && site.tags.length > 0 ? ` TAGS="${escapeHtml(site.tags.join(","))}"` : "";
      lines.push(`        <DT><A HREF="${escapeHtml(site.url)}" ADD_DATE="${siteAddDate}"${iconAttr}${tagsAttr}>${escapeHtml(site.title)}</A>`);
      if (site.description) {
        lines.push(`        <DD>${escapeHtml(site.description)}`);
      }
    }

    lines.push("    </DL><p>");
  }

  if (uncategorized.length > 0) {
    lines.push(`    <DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">未分类书签</H3>`);
    lines.push("    <DL><p>");
    for (const site of uncategorized) {
      if (!site.url || !/^https?:\/\//i.test(site.url)) continue;
      const siteAddDate = Math.floor((site.createdAt || Date.now()) / 1000);
      const siteIcon = (site as any).icon || site.iconKey || "";
      const iconAttr = siteIcon ? ` ICON="${escapeHtml(siteIcon)}"` : "";
      const tagsAttr = site.tags && site.tags.length > 0 ? ` TAGS="${escapeHtml(site.tags.join(","))}"` : "";
      lines.push(`        <DT><A HREF="${escapeHtml(site.url)}" ADD_DATE="${siteAddDate}"${iconAttr}${tagsAttr}>${escapeHtml(site.title)}</A>`);
      if (site.description) {
        lines.push(`        <DD>${escapeHtml(site.description)}`);
      }
    }
    lines.push("    </DL><p>");
  }

  lines.push("</DL><p>");
  return lines.join("\n");
}

/**
 * 打包 NavHub 全量冷备 JSON 字符串
 */
export function exportNavHubBackup(categories: Category[], sites: Site[]): string {
  const backup: NavHubColdBackup = {
    version: "1.0",
    generator: "NavHub 2026 Sovereign Backup Engine",
    exportedAt: Date.now(),
    categories: categories.map((c) => ({
      id: c.id,
      title: c.title,
      slug: (c as any).slug || c.id,
      description: c.description,
      sort: c.sort,
    })),
    sites: sites.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      description: s.description,
      categoryId: s.categoryId,
      tags: s.tags,
      icon: (s as any).icon || s.iconKey || null,
      enabled: s.enabled,
      createdAt: s.createdAt,
    })),
    stats: {
      categoryCount: categories.length,
      siteCount: sites.length,
    },
  };

  return JSON.stringify(backup, null, 2);
}

/**
 * 校验冷备文件并返回解析结果
 */
export function validateNavHubBackup(jsonStr: string): {
  valid: boolean;
  backup?: NavHubColdBackup;
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object") {
      return { valid: false, error: "无效的 JSON 数据" };
    }
    if (parsed.version !== "1.0") {
      return { valid: false, error: `不支持的备份版本: ${parsed.version}` };
    }
    if (!Array.isArray(parsed.categories) || !Array.isArray(parsed.sites)) {
      return { valid: false, error: "缺少 categories 或 sites 数组" };
    }
    return {
      valid: true,
      backup: parsed as NavHubColdBackup,
    };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : "JSON 解析失败" };
  }
}
