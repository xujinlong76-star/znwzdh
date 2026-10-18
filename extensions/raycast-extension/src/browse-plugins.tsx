import { useState, useEffect } from "react";
import { List, ActionPanel, Action, Icon, Color, getPreferenceValues, showToast, Toast } from "@raycast/api";

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
      const res = await fetch(`${apiBase}/api/plugins?limit=100&sort=popular`, { headers });
      if (!res.ok) throw new Error("获取插件列表失败");
      const data = (await res.json()) as { items?: HubPlugin[] };
      setPlugins(data.items || []);
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "无法连接 NavHub 插件市场",
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
      const res = await fetch(`${apiBase}/api/plugins/${encodeURIComponent(plugin.slug)}/install?anonId=raycast-user`, {
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
                    title="一键安装到本地 NavHub"
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
