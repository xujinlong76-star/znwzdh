import type { SeedPluginDef } from "../types.ts";

export const codeSearchPack: SeedPluginDef = {
  "slug": "code-and-package-search-pack",
  "status": "published",
  "manifest": {
    "manifestVersion": 1,
    "kind": "search-pack",
    "name": "全栈代码生态与依赖仓库搜索引擎包",
    "description": "38 个全栈代码与依赖仓库检索源一次装齐：在主搜索框用 !grep、!sgcode、!ghcode、!smithery、!jsr、!crates、!cve、!snyk 等前缀一键直达全球代码语义搜索、MCP 工具市场、官方依赖库与安全漏洞数据库。",
    "icon": "📦",
    "author": "山羊胡官方",
    "license": "MIT",
    "version": "1.0.0",
    "tags": [
      "代码搜索",
      "依赖检索",
      "npm",
      "crates",
      "MCP",
      "CVE",
      "漏洞安全"
    ],
    "payload": {
      "engines": [
        {
          "name": "grep.app 正则代码",
          "prefix": "!codegrep",
          "searchUrl": "https://grep.app/search?q={q}",
          "icon": "🧵",
          "description": "跨数十万 GitHub 仓库进行秒级极速正则代码检索"
        },
        {
          "name": "Sourcegraph 全球代码",
          "prefix": "!sourcegraph",
          "searchUrl": "https://sourcegraph.com/search?q=context%3Aglobal+{q}",
          "icon": "🔎",
          "description": "全球公开开源代码语义化上下文精准检索"
        },
        {
          "name": "GitHub 代码搜索",
          "prefix": "!ghcode",
          "searchUrl": "https://github.com/search?type=code&q={q}",
          "icon": "🐙",
          "description": "GitHub 官方重构的黑客级代码树精准搜索"
        },
        {
          "name": "GitHub Issues",
          "prefix": "!ghissues",
          "searchUrl": "https://github.com/search?type=issues&q={q}",
          "icon": "🐛",
          "description": "全球开源项目报错问题与解决讨论检索"
        },
        {
          "name": "GitHub Pull Requests",
          "prefix": "!ghpr",
          "searchUrl": "https://github.com/search?type=pullrequests&q={q}",
          "icon": "🔀",
          "description": "开源项目代码补丁与功能实现 PR 检索"
        },
        {
          "name": "Smithery MCP 市场",
          "prefix": "!smithery",
          "searchUrl": "https://smithery.ai/search?q={q}",
          "icon": "🔌",
          "description": "全球最大 Model Context Protocol (MCP) 服务端市场"
        },
        {
          "name": "PulseMCP 工具发现",
          "prefix": "!pulsemcp",
          "searchUrl": "https://pulsemcp.com/?q={q}",
          "icon": "💓",
          "description": "实时监控 MCP 协议生态最新插件与客户端"
        },
        {
          "name": "mcp.so 目录",
          "prefix": "!mcpso",
          "searchUrl": "https://mcp.so/search?q={q}",
          "icon": "🧭",
          "description": "精选智能体 MCP 工具与一键安装指令检索"
        },
        {
          "name": "Devv.ai 程序员搜索",
          "prefix": "!devv",
          "searchUrl": "https://devv.ai/search?q={q}",
          "icon": "⚡",
          "description": "面向开发者的下一代智能代码与技术问答引擎"
        },
        {
          "name": "JSR 现代注册表",
          "prefix": "!jsr",
          "searchUrl": "https://jsr.io/packages?search={q}",
          "icon": "🦕",
          "description": "Deno 团队推出的面向 TypeScript 优先现代化包仓库"
        },
        {
          "name": "npm 官方仓库",
          "prefix": "!npmpkg",
          "searchUrl": "https://www.npmjs.com/search?q={q}",
          "icon": "📦",
          "description": "全球 JavaScript / TypeScript 核心包与版本依赖检索"
        },
        {
          "name": "npm trends 下载对比",
          "prefix": "!npmtrend",
          "searchUrl": "https://npmtrends.com/?q={q}",
          "icon": "📈",
          "description": "多库横向比对下载量走势与技术选型参考"
        },
        {
          "name": "Bundlephobia 体积",
          "prefix": "!bundlephobia",
          "searchUrl": "https://bundlephobia.com/package/{q}",
          "icon": "📏",
          "description": "前端依赖包打包后真实体积与 Gzip 开销测试"
        },
        {
          "name": "crates.io Rust 库",
          "prefix": "!crates",
          "searchUrl": "https://crates.io/search?q={q}",
          "icon": "🦀",
          "description": "Rust 编程语言官方 crate 包与文档索引检索"
        },
        {
          "name": "docs.rs 文档",
          "prefix": "!docsrs",
          "searchUrl": "https://docs.rs/releases/search?query={q}",
          "icon": "📖",
          "description": "Rust 生态所有已发布 crate 自动化 API 文档"
        },
        {
          "name": "PyPI Python 包",
          "prefix": "!pypipkg",
          "searchUrl": "https://pypi.org/search/?q={q}",
          "icon": "🐍",
          "description": "Python 官方软件包分发与安装包索引"
        },
        {
          "name": "pkg.go.dev",
          "prefix": "!pkggo",
          "searchUrl": "https://pkg.go.dev/search?q={q}",
          "icon": "🐹",
          "description": "Go 语言官方模块、函数文档与许可证检索"
        },
        {
          "name": "Maven Central",
          "prefix": "!mavencentral",
          "searchUrl": "https://central.sonatype.com/search?q={q}",
          "icon": "☕",
          "description": "Java / Kotlin 生态中央构件依赖仓库检索"
        },
        {
          "name": "NuGet .NET 仓库",
          "prefix": "!nugetpkg",
          "searchUrl": "https://www.nuget.org/packages?q={q}",
          "icon": "🟪",
          "description": ".NET / C# 官方类库与构建工具包仓库"
        },
        {
          "name": "Docker Hub 镜像",
          "prefix": "!dockerhub",
          "searchUrl": "https://hub.docker.com/search?q={q}",
          "icon": "🐳",
          "description": "容器镜像、官方基础镜像与架构版本检索"
        },
        {
          "name": "Artifact Hub K8s",
          "prefix": "!artifacthub",
          "searchUrl": "https://artifacthub.io/packages/search?ts_query_web={q}",
          "icon": "☸️",
          "description": "CNCF 旗下 Helm Charts、KubeArmor 与 Operator 仓库"
        },
        {
          "name": "Terraform Registry",
          "prefix": "!tfregistry",
          "searchUrl": "https://registry.terraform.io/search/providers?q={q}",
          "icon": "🏗️",
          "description": "云原生基础设施 Provider 与 Module 模块仓库"
        },
        {
          "name": "Libraries.io 依赖网络",
          "prefix": "!librariesio",
          "searchUrl": "https://libraries.io/search?q={q}",
          "icon": "📚",
          "description": "跨 32 个包管理器的开源软件依赖图谱与依赖健康度"
        },
        {
          "name": "Openbase 用户评价",
          "prefix": "!openbase",
          "searchUrl": "https://openbase.com/search?q={q}",
          "icon": "⭐",
          "description": "开源类库真实开发者打分、优缺点分析与对比"
        },
        {
          "name": "Best of JS 前端精选",
          "prefix": "!bestofjs",
          "searchUrl": "https://bestofjs.org/projects?query={q}",
          "icon": "🏅",
          "description": "按星标增长筛选全网最热门的优质 JavaScript 项目"
        },
        {
          "name": "Pkg Size 极速体积",
          "prefix": "!pkgsize",
          "searchUrl": "https://pkg-size.dev/{q}",
          "icon": "⚖️",
          "description": "极速查询任意 npm 依赖安装大小与导包开销"
        },
        {
          "name": "NVD 美国漏洞库",
          "prefix": "!nvdcve",
          "searchUrl": "https://nvd.nist.gov/vuln/search/results?form_type=Basic&results_type=overview&query={q}&search_type=all",
          "icon": "🛡️",
          "description": "美国国家漏洞数据库官方 CVE 详细评级与 CVSS 分数"
        },
        {
          "name": "CVE Mitre 权威库",
          "prefix": "!cvemitre",
          "searchUrl": "https://cve.mitre.org/cgi-bin/cvekey.cgi?keyword={q}",
          "icon": "🔒",
          "description": "通用漏洞披露与暴露 (CVE) 全球官方登记中心"
        },
        {
          "name": "Snyk 依赖漏洞库",
          "prefix": "!snykvuln",
          "searchUrl": "https://security.snyk.io/search?q={q}",
          "icon": "🐕",
          "description": "开源软件包安全漏洞扫描与修复建议指南"
        },
        {
          "name": "OSV 开放安全漏洞",
          "prefix": "!osvvuln",
          "searchUrl": "https://osv.dev/list?q={q}",
          "icon": "🌐",
          "description": "Google 主导的开源分布式精准依赖版本漏洞数据库"
        },
        {
          "name": "Exploit Database",
          "prefix": "!exploitdb",
          "searchUrl": "https://www.exploit-db.com/search?q={q}",
          "icon": "💥",
          "description": "面向白帽子与安全研究员的已知漏洞 POC 代码库"
        },
        {
          "name": "Shodan 物联网探测",
          "prefix": "!shodan",
          "searchUrl": "https://www.shodan.io/search?query={q}",
          "icon": "📡",
          "description": "扫描全球联网设备、端口与协议暴露的安全搜索引擎"
        },
        {
          "name": "GreyNoise 互联网噪声",
          "prefix": "!greynoise",
          "searchUrl": "https://viz.greynoise.io/cheat-sheet?q={q}",
          "icon": "📻",
          "description": "过滤良性网络扫描、定位真实恶意定向攻击的分析库"
        },
        {
          "name": "crt.sh SSL 证书透明度",
          "prefix": "!crtsh",
          "searchUrl": "https://crt.sh/?q={q}",
          "icon": "🔐",
          "description": "查询域名所有已签发 SSL 证书与历史子域名资产"
        },
        {
          "name": "DNSDumpster 资产测绘",
          "prefix": "!dnsdump",
          "searchUrl": "https://dnsdumpster.com/?q={q}",
          "icon": "🗺️",
          "description": "完全免费的域名 DNS 记录与网络资产拓扑测绘工具"
        },
        {
          "name": "IETF RFC 标准协议",
          "prefix": "!ietfrfc",
          "searchUrl": "https://www.rfc-editor.org/search/rfc_search_detail.php?title={q}",
          "icon": "📜",
          "description": "互联网工程任务组权威协议标准与 RFC 规范原文"
        },
        {
          "name": "MDN API 参考文档",
          "prefix": "!mdnapi",
          "searchUrl": "https://developer.mozilla.org/zh-CN/search?q={q}",
          "icon": "📘",
          "description": "Web 标准 HTML/CSS/JS API 权威文档检索"
        },
        {
          "name": "CppReference C++ 手册",
          "prefix": "!cppref",
          "searchUrl": "https://zh.cppreference.com/mwiki/index.php?search={q}",
          "icon": "⚙️",
          "description": "C and C++ 标准库与核心语言语法完整权威指南"
        }
      ]
    }
  }
};
