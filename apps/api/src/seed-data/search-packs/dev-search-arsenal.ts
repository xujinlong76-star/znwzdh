/**
 * 种子插件：极客开发者搜索引擎包
 *
 * 由 seed-plugins.ts 迁移而来（2026-10-20 内容升级批次），原文内容一字未改，
 * 目的是把主文件拆成「一条插件一个文件」，便于后续加深与评审。
 */
import type { SeedPluginDef } from "../types.ts";

export const devSearchArsenal: SeedPluginDef = {
  slug: "dev-search-arsenal",
  status: "published",
    manifest: {
    manifestVersion: 1,
    kind: "search-pack",
    name: "极客开发者搜索引擎包",
    description:
      "40 个高频技术检索源一次装齐：在主搜索框用 !gh、!npm、!mdn、!so、!rs、!k8s、!tf、!nuget、!cve 等前缀即可跨代码托管、包仓库、官方文档、社区问答与漏洞数据库直达检索，覆盖前端、后端、云原生、安全与 AI 生态。",
    icon: "🔍",
    author: "山羊胡官方",
    license: "MIT",
    version: "2.1.0",
    tags: ["搜索", "极客", "GitHub", "npm", "MDN", "云原生", "工具"],
    payload: {
      engines: [
        { name: "GitHub", prefix: "!gh", searchUrl: "https://github.com/search?q={q}", icon: "🐙", description: "全球最大代码托管平台：开源项目、代码片段与 Issue 检索" },
        { name: "npm", prefix: "!npm", searchUrl: "https://www.npmjs.com/search?q={q}", icon: "📦", description: "JavaScript / TypeScript 依赖包与版本信息检索" },
        { name: "MDN Web Docs", prefix: "!mdn", searchUrl: "https://developer.mozilla.org/zh-CN/search?q={q}", icon: "📘", description: "Web 标准权威文档：HTML / CSS / JS API 中文参考" },
        { name: "Stack Overflow", prefix: "!so", searchUrl: "https://stackoverflow.com/search?q={q}", icon: "💬", description: "全球程序员问答社区，报错与疑难方案的第一检索现场" },
        { name: "DevDocs", prefix: "!dd", searchUrl: "https://devdocs.io/#q={q}", icon: "📚", description: "全栈 API 一站式速查手册，支持离线使用" },
        { name: "Can I use", prefix: "!caniuse", searchUrl: "https://caniuse.com/?search={q}", icon: "✅", description: "浏览器特性与 HTML/CSS/JS 兼容性速查" },
        { name: "Google", prefix: "!g", searchUrl: "https://www.google.com/search?q={q}", icon: "🔍", description: "通用全网检索，技术问题的兜底入口" },
        { name: "Bing", prefix: "!b", searchUrl: "https://www.bing.com/search?q={q}", icon: "🅱️", description: "微软全网搜索引擎，英文技术资料覆盖好" },
        { name: "DuckDuckGo", prefix: "!ddg", searchUrl: "https://duckduckgo.com/?q={q}", icon: "🦆", description: "注重隐私的搜索引擎，无个性化追踪" },
        { name: "百度", prefix: "!bd", searchUrl: "https://www.baidu.com/s?wd={q}", icon: "🐻", description: "中文全网检索，国内资料与服务商文档入口" },
        { name: "知乎", prefix: "!zh", searchUrl: "https://www.zhihu.com/search?type=content&q={q}", icon: "💡", description: "中文技术问答与经验沉淀社区" },
        { name: "掘金", prefix: "!juejin", searchUrl: "https://juejin.cn/search?query={q}", icon: "⛏️", description: "国内主流前端与全栈技术社区文章检索" },
        { name: "哔哩哔哩", prefix: "!bili", searchUrl: "https://search.bilibili.com/all?keyword={q}", icon: "📺", description: "技术视频课程与大会演讲实录检索" },
        { name: "PyPI", prefix: "!pypi", searchUrl: "https://pypi.org/search/?q={q}", icon: "🐍", description: "Python 官方包仓库检索" },
        { name: "docs.rs（Rust crate 文档）", prefix: "!rs", searchUrl: "https://docs.rs/releases/search?query={q}", icon: "🦀", description: "Rust 生态 crate 文档与版本检索，覆盖全部已发布库" },
        { name: "pkg.go.dev", prefix: "!go", searchUrl: "https://pkg.go.dev/search?q={q}", icon: "🐹", description: "Go 官方模块与文档检索" },
        { name: "Maven Central", prefix: "!mvn", searchUrl: "https://central.sonatype.com/search?q={q}", icon: "☕", description: "Java / Kotlin 生态构件与依赖检索" },
        { name: "Docker Hub", prefix: "!docker", searchUrl: "https://hub.docker.com/search?q={q}", icon: "🐳", description: "容器镜像与官方基础镜像仓库检索" },
        { name: "Kubernetes 文档", prefix: "!k8s", searchUrl: "https://kubernetes.io/search/?q={q}", icon: "☸️", description: "K8s 官方概念、API 与运维文档检索" },
        { name: "Terraform Registry", prefix: "!tf", searchUrl: "https://registry.terraform.io/search/providers?q={q}", icon: "🏗️", description: "基础设施即代码的 Provider/Module 检索" },
        { name: "bundlephobia", prefix: "!bp", searchUrl: "https://bundlephobia.com/package/{q}", icon: "📏", description: "前端依赖体积分析：安装体积、Gzip 大小与依赖树" },
        { name: "npm trends", prefix: "!trend", searchUrl: "https://npmtrends.com/?q={q}", icon: "📈", description: "npm 包下载量趋势对比，选型参考" },
        { name: "grep.app", prefix: "!grep", searchUrl: "https://grep.app/search?q={q}", icon: "🧵", description: "跨 GitHub 开源仓库的代码片段正则检索" },
        { name: "Sourcegraph", prefix: "!sg", searchUrl: "https://sourcegraph.com/search?q=context%3Aglobal+{q}&patternType=standard", icon: "🔎", description: "全球公开代码语义化搜索与交叉引用" },
        { name: "Rust 标准库文档", prefix: "!rustdoc", searchUrl: "https://doc.rust-lang.org/std/?search={q}", icon: "🦀", description: "Rust 标准库 API 官方文档检索" },
        { name: "MDN 英文原版", prefix: "!mdnen", searchUrl: "https://developer.mozilla.org/en-US/search?q={q}", icon: "🌐", description: "MDN 英文原版，译名有歧义时查原始定义" },
        { name: "Python 官方文档", prefix: "!pydoc", searchUrl: "https://docs.python.org/zh-cn/3/search.html?q={q}", icon: "🐍", description: "Python 3 官方手册中文版检索" },
        { name: "Cloudflare 文档", prefix: "!cf", searchUrl: "https://developers.cloudflare.com/search/?q={q}", icon: "☁️", description: "Cloudflare Workers / Pages / 边缘计算文档检索" },
        { name: "AWS 文档", prefix: "!aws", searchUrl: "https://docs.aws.amazon.com/search/doc-search.html?searchPath=all&searchQuery={q}", icon: "🅰️", description: "亚马逊云服务官方产品与 API 文档检索" },
        { name: "Hugging Face", prefix: "!hf", searchUrl: "https://huggingface.co/search/full-text?q={q}", icon: "🤗", description: "模型、数据集与 AI 开源生态检索" },
        { name: "NuGet", prefix: "!nuget", searchUrl: "https://www.nuget.org/packages?q={q}", icon: "🟪", description: ".NET 生态官方包仓库，类库与工具包检索" },
        { name: "Packagist", prefix: "!packagist", searchUrl: "https://packagist.org/search/?q={q}", icon: "🐘", description: "PHP / Composer 依赖包仓库检索" },
        { name: "RubyGems", prefix: "!gem", searchUrl: "https://rubygems.org/search?query={q}", icon: "💎", description: "Ruby 生态 gem 包与版本检索" },
        { name: "Hex.pm", prefix: "!hex", searchUrl: "https://hex.pm/packages?search={q}", icon: "🔷", description: "Elixir / Erlang 生态包仓库检索" },
        { name: "Gradle Plugin Portal", prefix: "!gradle", searchUrl: "https://plugins.gradle.org/search?term={q}", icon: "⚙️", description: "Gradle 构建插件检索，找构建期扩展与集成" },
        { name: "Google Cloud 文档", prefix: "!gcp", searchUrl: "https://cloud.google.com/s/results?q={q}", icon: "☁️", description: "GCP 产品、服务与 API 官方文档检索" },
        { name: "Azure 文档", prefix: "!azure", searchUrl: "https://learn.microsoft.com/en-us/search/?terms={q}", icon: "🟦", description: "微软 Azure 与 .NET 官方技术文档检索" },
        { name: "OSV 漏洞库", prefix: "!osv", searchUrl: "https://osv.dev/list?q={q}", icon: "🛡️", description: "开源软件漏洞数据库，依赖安全风险检索" },
        { name: "NVD CVE 数据库", prefix: "!cve", searchUrl: "https://nvd.nist.gov/vuln/search/results?query={q}", icon: "🚨", description: "美国国家漏洞库，CVE 编号与漏洞详情检索" },
        { name: "Hacker News", prefix: "!hn", searchUrl: "https://hn.algolia.com/?q={q}", icon: "📰", description: "Hacker News 技术讨论与链接全文检索" },
      ],
    },
  },
};
