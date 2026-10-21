import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.ts";
import { createContext, type AppContext } from "../src/context.ts";
import { loadConfig } from "../src/config.ts";

describe("AI 自然语言插件生成与修饰端点 (POST /api/user/ai/plugin/generate)", () => {
  let dir: string;
  let ctx: AppContext;
  let app: Awaited<ReturnType<typeof buildServer>>;

  const URL_ENDPOINT = "/api/user/ai/plugin/generate";
  const H_USER = { "x-navhub-user-id": "developer-test-01" };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "navhub-test-plugin-gen-"));
    const config = loadConfig({
      mode: "lite",
      sqlitePath: join(dir, "api.db"),
      llm: {
        name: "Agnes 3.0 Flash",
        baseUrl: "http://93.184.216.34/v1",
        apiKey: "sk-test-key-12345",
        model: "agnes-3.0-flash",
        timeoutMs: 3000,
        allowPrivateNetwork: true,
      },
      corsOrigins: ["*"],
    });

    ctx = await createContext(config);
    app = await buildServer(ctx);
    await app.ready();

    // 预置一些分类与站点，验证知识库注入
    const cat = await ctx.repo.createCategory({
      title: "Web3 开发",
      slug: "web3-dev",
      description: "区块链与智能合约工具",
    });

    await ctx.repo.createSite({
      title: "Ethereum",
      url: "https://ethereum.org",
      description: "以太坊官方门户",
      categoryId: cat.id,
      tags: ["web3", "crypto"],
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    if (ctx) await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("参数不合法（缺少 prompt）时返回 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: URL_ENDPOINT,
      headers: H_USER,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("参数无效");
  });

  it("根据自然语言成功生成 site-pack 网址包清单并完成格式自愈", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          model: "agnes-3.0-flash",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  rationale: "为 Web3 开发者精选主流链上浏览器与开发框架",
                  manifest: {
                    manifestVersion: 1,
                    kind: "site-pack",
                    name: "Web3 极客工具箱",
                    description: "覆盖智能合约开发、测试网水龙头与链上分析的核心导航包",
                    icon: "⛓️",
                    version: "1.0.0",
                    author: "CryptoDev",
                    license: "MIT",
                    tags: ["web3", "solidity", "defi"],
                    payload: {
                      categories: [{ title: "链上浏览器" }, { title: "开发框架" }],
                      sites: [
                        {
                          title: "Etherscan",
                          url: "etherscan.io", // 故意无 https，测试自愈补全协议
                          description: "以太坊主流区块链浏览器",
                          category: "链上浏览器",
                          tags: ["explorer", "eth"],
                        },
                        {
                          title: "Foundry",
                          url: "https://book.getfoundry.sh",
                          description: "极速 Solidity 单元测试与部署框架",
                          category: "开发框架",
                          tags: ["smart-contracts", "rust"],
                        },
                      ],
                    },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 280, total_tokens: 400 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const res = await app.inject({
        method: "POST",
        url: URL_ENDPOINT,
        headers: H_USER,
        payload: {
          prompt: "帮我生成一个 Web3 智能合约极客工具包，包含区块链浏览器和开发框架",
          kind: "site-pack",
          thinking: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.manifest).toBeDefined();
      expect(data.manifest.name).toBe("Web3 极客工具箱");
      expect(data.manifest.kind).toBe("site-pack");
      expect(data.manifest.payload.sites).toHaveLength(2);
      expect(data.manifest.payload.sites[0].url).toBe("https://etherscan.io"); // 自愈为 https
      expect(data.summary).toBeDefined();
      expect(data.summary.siteCount).toBe(2);
      expect(data.rationale).toContain("Web3");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("支持 search-pack 并自动修补搜索引擎前缀 ! 与 {q} 占位符", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          model: "agnes-3.0-flash",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  rationale: "聚合学术论文与预印本搜索",
                  manifest: {
                    manifestVersion: 1,
                    kind: "search-pack",
                    name: "学术极速检索包",
                    description: "一键检索 arXiv 与 Google Scholar",
                    icon: "📚",
                    version: "1.0.0",
                    tags: ["学术", "论文"],
                    payload: {
                      engines: [
                        {
                          name: "arXiv",
                          prefix: "arxiv", // 故意无 !，测试自愈修补
                          searchUrl: "https://arxiv.org/search/?query={q}",
                          description: "物理与计算机预印本",
                        },
                        {
                          name: "Google Scholar",
                          prefix: "scholar",
                          searchUrl: "https://scholar.google.com/scholar", // 故意无 {q}，测试自愈追加 ?q={q}
                          description: "谷歌学术搜索",
                        },
                      ],
                    },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 90, completion_tokens: 180, total_tokens: 270 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const res = await app.inject({
        method: "POST",
        url: URL_ENDPOINT,
        headers: H_USER,
        payload: {
          prompt: "生成一套包含 arXiv 和谷歌学术的搜索包",
          kind: "search-pack",
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.manifest.kind).toBe("search-pack");
      const engines = data.manifest.payload.engines;
      expect(engines).toHaveLength(2);
      expect(engines[0].prefix).toBe("!arxiv");
      expect(engines[1].prefix).toBe("!scholar");
      expect(engines[1].searchUrl).toContain("{q}");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("支持多轮增量微调模式 (传入 existingManifest)", async () => {
    const originalFetch = globalThis.fetch;
    const baseManifest = {
      manifestVersion: 1,
      kind: "site-pack",
      name: "前端基础包",
      description: "前端入门必备",
      icon: "🌐",
      version: "1.0.0",
      author: "FE-Master",
      license: "MIT",
      tags: ["frontend"],
      payload: {
        sites: [
          {
            title: "MDN Web Docs",
            url: "https://developer.mozilla.org",
            description: "Web 开发者参考手册",
          },
        ],
      },
    };

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          model: "agnes-3.0-flash",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify({
                  rationale: "已在原有前端包基础上追加 GitHub 并升级版本号至 1.1.0",
                  manifest: {
                    ...baseManifest,
                    version: "1.1.0",
                    tags: ["frontend", "github"],
                    payload: {
                      sites: [
                        ...baseManifest.payload.sites,
                        {
                          title: "GitHub",
                          url: "https://github.com",
                          description: "代码托管与开源协作平台",
                          tags: ["git", "code"],
                        },
                      ],
                    },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 220, total_tokens: 370 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const res = await app.inject({
        method: "POST",
        url: URL_ENDPOINT,
        headers: H_USER,
        payload: {
          prompt: "帮我加上 GitHub，并且把版本号升到 1.1.0",
          existingManifest: baseManifest,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.manifest.version).toBe("1.1.0");
      expect(data.manifest.payload.sites).toHaveLength(2);
      expect(data.manifest.payload.sites[1].title).toBe("GitHub");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
