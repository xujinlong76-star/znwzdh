import { useState, useEffect } from "react";
import {
  List,
  ActionPanel,
  Action,
  Icon,
  Color,
  getPreferenceValues,
  showToast,
  Toast,
  getStorage,
  setStorage,
} from "@raycast/api";
import { randomUUID } from "node:crypto";

/**
 * 安装/评价用的「本机匿名身份」：首次运行生成一个随机串存进 Raycast 本地存储。
 *
 * 之前硬编码 `?anonId=raycast-user`——所有装了本扩展的人共用同一个身份：
 * 安装量被合并计数，`/api/plugins/mine` 会把别人装的包显示成自己装的。
 * 走 Header 而不是 query：身份串会留在中枢访问日志与浏览器历史里。
 */
const ANON_ID_KEY = "navhub-anon-id";
/** 中枢把身份串截到 64 字符（identityOf），签名对象也是截断后的值 → 主动留在预算内 */
const ANON_ID_MAX_LEN = 64;

async function localAnonId(): Promise<string> {
  const stored = await getStorage<string>(ANON_ID_KEY);
  if (typeof stored === "string" && stored.length > 0 && stored.length <= ANON_ID_MAX_LEN) return stored;
  const fresh = `raycast-${randomUUID()}`.slice(0, ANON_ID_MAX_LEN);
  await setStorage(ANON_ID_KEY, fresh);
  return fresh;
}

interface HubPlugin {
  id: string;
  slug: string;
  kind: "site-pack" | "workspace-preset" | "theme";
  name: string;
  description: string;
  icon?: string | null;
  version: string;
  author?: string | null;
  installCount: number;
  starCount: number;
  tags?: string[];
  manifest: any;
  summary?: {
    siteCount?: number;
    categoryCount?: number;
    boardCount?: number;
    widgetCount?: number;
    themeTokenCount?: number;
    accent?: string;
  };
}

interface Preferences {
  apiUrl?: string;
  apiToken?: string;
  webUrl?: string;
}

export default function BrowsePlugins() {
  const preferences = getPreferenceValues<Preferences>();
  const apiBase = (preferences.apiUrl || "http://127.0.0.1:8787").replace(/\/$/, "");
  const webBase = (preferences.webUrl || "http://localhost:3000").replace(/\/$/, "");

  const [plugins, setPlugins] = useState<HubPlugin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedKind, setSelectedKind] = useState<string>("all");
  const [searchText, setSearchText] = useState("");

  const loadPlugins = async () => {
    setIsLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (preferences.apiToken) {
        headers["Authorization"] = `Bearer ${preferences.apiToken.trim()}`;
      }
      // manifest=1：列表默认只回精简字段（site-pack 清单约 34KB/条，一页就是 730KB）。
      // 本扩展的「复制插件 JSON 清单」需要完整清单，因此显式请求全量。
      const res = await fetch(`${apiBase}/api/plugins?limit=100&sort=popular&manifest=1`, { headers });
      if (!res.ok) throw new Error("获取插件列表失败");
      const data = (await res.json()) as { items?: HubPlugin[] };
      setPlugins(data.items || []);
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法连接 山羊胡插件市场",
        message: err instanceof Error ? err.message : String(err),
      });
      setPlugins([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPlugins();
  }, [apiBase]);

  const handleInstall = async (plugin: HubPlugin) => {
    try {
      const toast = await showToast({
        style: Toast.Style.Animated,
        title: `正在安装「${plugin.name}」...`,
      });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (preferences.apiToken) {
        headers["Authorization"] = `Bearer ${preferences.apiToken.trim()}`;
      }
      headers["x-navhub-anon-id"] = await localAnonId();
      const res = await fetch(`${apiBase}/api/plugins/${encodeURIComponent(plugin.slug)}/install`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || errorData.message || "安装失败");
      }
      const data = await res.json();
      toast.style = Toast.Style.Success;
      toast.title = data.alreadyInstalled ? `「${plugin.name}」已安装` : `成功安装「${plugin.name}」！`;
      if (plugin.kind === "site-pack" && data.applied) {
        toast.message = `新增 ${data.applied.sitesAdded} 个站点，${data.applied.categoriesCreated} 个分类`;
      }
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "安装失败",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const filtered = plugins.filter((p) => {
    if (selectedKind !== "all" && p.kind !== selectedKind) return false;
    if (!searchText.trim()) return true;
    const q = searchText.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description || "").toLowerCase().includes(q) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  });

  const getKindIcon = (kind: string) => {
    switch (kind) {
      case "site-pack":
        return { source: Icon.Globe, tintColor: Color.Blue };
      case "workspace-preset":
        return { source: Icon.AppWindowGrid3x3, tintColor: Color.Green };
      case "theme":
        return { source: Icon.Brush, tintColor: Color.Purple };
      default:
        return { source: Icon.Box, tintColor: Color.SecondaryText };
    }
  };

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="搜索插件、主题或网址包名称与标签..."
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <List.Dropdown tooltip="筛选插件类型" onChange={setSelectedKind} storeValue>
          <List.Dropdown.Item title="全部类型" value="all" />
          <List.Dropdown.Item title="🌐 网址包 (Site Pack)" value="site-pack" />
          <List.Dropdown.Item title="🧩 工作台预设 (Preset)" value="workspace-preset" />
          <List.Dropdown.Item title="🎨 视觉主题 (Theme)" value="theme" />
        </List.Dropdown>
      }
    >
      <List.Section title={`插件市场 (${filtered.length})`}>
        {filtered.map((item) => {
          const kindIcon = getKindIcon(item.kind);
          const detailUrl = `${webBase}/marketplace/${encodeURIComponent(item.slug)}`;
          const summaryText =
            item.kind === "site-pack"
              ? `${item.summary?.siteCount ?? 0} 个站点`
              : item.kind === "workspace-preset"
                ? `${item.summary?.widgetCount ?? 0} 个组件`
                : `${item.summary?.themeTokenCount ?? 0} 个色彩变量`;

          return (
            <List.Item
              key={item.slug}
              icon={kindIcon}
              title={item.name}
              subtitle={item.description}
              accessories={[
                { text: `v${item.version}` },
                { text: summaryText },
                { text: `⭐ ${item.starCount}` },
                { text: `📥 ${item.installCount}` },
              ]}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser url={detailUrl} title="在浏览器打开详情" />
                  <Action
                    title="一键安装到本地 山羊胡"
                    icon={Icon.Download}
                    onAction={() => handleInstall(item)}
                  />
                  <Action.CopyToClipboard
                    content={JSON.stringify(item.manifest, null, 2)}
                    title="复制插件 JSON 清单"
                    shortcut={{ modifiers: ["cmd"], key: "c" }}
                  />
                  <Action.OpenInBrowser
                    url={`${webBase}/marketplace`}
                    title="打开插件市场主页"
                    icon={Icon.Compass}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}
