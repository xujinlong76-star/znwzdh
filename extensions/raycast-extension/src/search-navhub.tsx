import { useState, useEffect } from "react";
import { List, ActionPanel, Action, Icon, getPreferenceValues } from "@raycast/api";

interface SearchHit {
  site: {
    id: string;
    title: string;
    url: string;
    description?: string;
    tags?: string[];
  };
  channels?: string[];
  score: number;
}

interface Preferences {
  apiUrl?: string;
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
      return;
    }

    setIsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${apiBase}/api/search?q=${encodeURIComponent(searchText.trim())}&limit=12`);
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

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="输入自然语言、拼音或英文搜索 NavHub 网址..."
      throttle
    >
      <List.Section title={searchText ? `搜索结果 (${items.length})` : "输入关键词开始检索"}>
        {items.map((hit) => {
          const site = hit.site;
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
                  <Action.OpenInBrowser
                    url="http://localhost:3000"
                    title="打开 NavHub 完整站"
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
