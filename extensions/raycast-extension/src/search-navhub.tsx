import { useState, useEffect } from "react";
import { List, ActionPanel, Action, Icon, getPreferenceValues } from "@raycast/api";

interface SearchHit {
  /** 中枢允许返回 null：命中来自向量/标签层而站点已进回收站（软删不删向量） */
  site: {
    id: string;
    title: string;
    url: string;
    description?: string;
    tags?: string[];
  } | null;
  channels?: string[];
  score: number;
}

interface Preferences {
  apiUrl?: string;
  apiToken?: string;
  webUrl?: string;
}

export default function SearchNavHub() {
  const preferences = getPreferenceValues<Preferences>();
  const apiBase = (preferences.apiUrl || "http://127.0.0.1:8787").replace(/\/$/, "");

  const [searchText, setSearchText] = useState("");
  const [items, setItems] = useState<SearchHit[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!searchText.trim()) {
      setItems([]);
      // 清空输入时上一发的请求还在飞：cleanup 把 active 置 false，
      // 它的 finally 不会再复位 isLoading，转圈会一直挂着。
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const headers: Record<string, string> = {};
        if (preferences.apiToken) {
          headers["Authorization"] = `Bearer ${preferences.apiToken.trim()}`;
        }
        const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(searchText.trim())}&limit=12`, { headers });
        if (!res.ok) throw new Error("Search failed");
        const data = (await res.json()) as { hits?: SearchHit[]; items?: SearchHit[] };
        if (active) {
          setItems(data.hits || data.items || []);
        }
      } catch (err) {
        if (active) setItems([]);
      } finally {
        if (active) setIsLoading(false);
      }
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchText, apiBase]);

  // site 为 null 的命中不能进渲染：一条就抛错，整个搜索视图直接变成错误页
  const visible = items.filter((hit) => hit.site);

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="输入自然语言、拼音或英文搜索 NavHub 网址..."
      throttle
    >
      <List.Section title={searchText ? `搜索结果 (${visible.length})` : "输入关键词开始检索"}>
        {visible.map((hit) => {
          const site = hit.site!;
          const channelsStr = (hit.channels || []).join("+");
          return (
            <List.Item
              key={site.id}
              icon={Icon.Globe}
              title={site.title}
              subtitle={site.description || site.url}
              accessories={[
                { text: channelsStr ? `[${channelsStr}]` : undefined },
                { text: (site.tags || []).slice(0, 2).join(", ") },
              ]}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser url={site.url} title="在浏览器打开" />
                  <Action.CopyToClipboard content={site.url} title="复制网址" />
                  <Action.CopyToClipboard content={`[${site.title}](${site.url})`} title="复制 Markdown 超链接" />
                  <Action.OpenInBrowser
                    url={preferences.webUrl || "http://localhost:3000"}
                    title="打开 NavHub 完整站"
                    icon={Icon.Compass}
                  />
                  <Action.OpenInBrowser
                    url={`${(preferences.webUrl || "http://localhost:3000").replace(/\/$/, "")}/marketplace`}
                    title="浏览插件市场"
                    icon={Icon.Star}
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
