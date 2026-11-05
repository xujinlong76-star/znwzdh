/**
 * 桌面伴学窗（Document PiP）：外部文本一律不进 HTML 解析器。
 *
 * 这里守的是一个已经真实存在的存储型 XSS 出口，不是假想风险：
 * `VideoPipWindowRenderer` 的三个入参全部来自外部数据链路——
 *   - videoTitle：视频标题（B 站/YouTube 抓取 + 用户投稿）
 *   - currentSubtitle：字幕文本
 *   - lastCodeCommand：从代码里程碑切出来的第一行
 * 旧实现把这三者插进一段 innerHTML 模板字符串，标题写成 `<img src=x onerror=…>`
 * 就会在 PiP 窗口里真的执行；而 documentPictureInPicture 开的是**同源**窗口，
 * 那段脚本能直接拿到父文档。所以现在的内容构建收在 lib/video-pip-content.ts，
 * 全程 createElement + textContent。
 *
 * 四条判据各自会静默失效，所以分别钉住：
 *   1. 行为：喂恶意载荷，构建器一棵「解析出来的」树都造不出（DOM 桩把 HTML 写入
 *      当场抛错并记名——想退回 innerHTML 会立刻红，不是靠人眼 diff 发现）；
 *   2. 结构：载荷只以纯文本存在，树里不出现 img/script/svg，也不出现任何 on* 属性；
 *   3. 复制按钮的诚实性没被搬坏：失败不改文案，成功才改，1500ms 后复原；
 *   4. 扫描机没瞎：全仓 src 的 HTML 字符串写入点为 0，且构建器确实被组件调用。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn() }))

import { copyText } from '@/lib/clipboard'
import { buildVideoPipContent } from '@/lib/video-pip-content'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 定位 overlay 根目录（镜像副本 apps/web/test 不会被误当成源） */
function overlayRoot(): string {
  const candidates = [resolve(HERE, ".."), resolve(HERE, "..", "..", "web-overlay")]
  const isOverlayDir = (p: string) => {
    const s = p.replace(/\\/g, "/")
    return s.includes("/web-overlay/") || s.endsWith("/web-overlay")
  }
  const hit = candidates.find((p) => isOverlayDir(p) && existsSync(p))
  if (!hit) throw new Error("无法定位 web-overlay 根目录（候选：" + candidates.join(" | ") + "）")
  return hit
}

const ROOT = overlayRoot()

/* ----------------------------- 只记录、不解析的 DOM 桩 ----------------------------- */

/**
 * 关键设计：三个「让字符串进 HTML 解析器」的入口在这里既记名又抛错。
 * 于是行为测试拦的不是「这次没出事」，而是「有人把出口重新打开」。
 */
class StubElement {
  readonly attrs = new Map<string, string>()
  readonly children: StubElement[] = []
  readonly listeners = new Map<string, Array<() => void>>()
  text = ""

  constructor(
    readonly tag: string,
    private readonly doc: StubDocument,
  ) {}

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null
  }

  appendChild(child: StubElement): StubElement {
    this.children.push(child)
    return child
  }

  addEventListener(type: string, fn: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }

  /** 触发事件，返回是否真有监听者 */
  fire(type: string): boolean {
    const fns = this.listeners.get(type) ?? []
    fns.forEach((fn) => fn())
    return fns.length > 0
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("")
  }

  set textContent(value: string) {
    this.children.length = 0
    this.text = value
  }

  private forbid(how: string, value: string): never {
    this.doc.htmlWrites.push(`${how} <- ${value.slice(0, 40)}`)
    throw new Error(`伴学窗内容构建禁用 ${how}：外部文本不得进 HTML 解析器`)
  }

  set innerHTML(value: string) {
    this.forbid("innerHTML", value)
  }

  set outerHTML(value: string) {
    this.forbid("outerHTML", value)
  }

  insertAdjacentHTML(position: string, value: string): never {
    return this.forbid(`insertAdjacentHTML(${position})`, value)
  }
}

class StubDocument {
  readonly created: string[] = []
  readonly htmlWrites: string[] = []
  readonly body: StubElement

  constructor() {
    this.body = new StubElement("body", this)
  }

  createElement(tag: string): StubElement {
    this.created.push(tag)
    return new StubElement(tag, this)
  }

  write(...parts: string[]): never {
    this.htmlWrites.push(`document.write <- ${parts.join("").slice(0, 40)}`)
    throw new Error("伴学窗内容构建禁用 document.write")
  }
}

function asDocument(doc: StubDocument): Document {
  return doc as unknown as Document
}

/** 整棵树（含根）拉平成数组，便于逐节点断言 */
function walk(el: StubElement): StubElement[] {
  return [el, ...el.children.flatMap(walk)]
}

const XSS_TITLE = "<img src=x onerror=alert(1)>"
const XSS_SUBTITLE = "<script>alert(2)</script>"
const XSS_COMMAND = 'echo "<svg onload=alert(3)>"'

function build(data: { videoTitle: string; currentSubtitle?: string; lastCodeCommand?: string }) {
  const doc = new StubDocument()
  const built = buildVideoPipContent(asDocument(doc), data)
  return { doc, root: built as unknown as StubElement }
}

describe("行为：恶意载荷进不了 HTML 解析器", () => {
  it("构建全程没有任何一次 HTML 写入（桩会当场抛错并记名）", () => {
    const { doc } = build({
      videoTitle: XSS_TITLE,
      currentSubtitle: XSS_SUBTITLE,
      lastCodeCommand: XSS_COMMAND,
    })
    expect(doc.htmlWrites, "内容构建重新打开了 HTML 解析入口").toEqual([])
  })

  it("载荷只以纯文本存在：没有解析出的标签，也没有 on* 属性", () => {
    const { root } = build({
      videoTitle: XSS_TITLE,
      currentSubtitle: XSS_SUBTITLE,
      lastCodeCommand: XSS_COMMAND,
    })
    const nodes = walk(root)
    const tags = new Set(nodes.map((n) => n.tag))
    // 构建器只可能自己造这三种标签；出现 img/script/svg 就说明字符串被解析过了
    expect([...tags].sort()).toEqual(["button", "div", "span"])
    const eventAttrs = nodes.flatMap((n) => [...n.attrs.keys()]).filter((a) => /^on/i.test(a))
    expect(eventAttrs, "外部文本被写成了事件属性").toEqual([])
    // 内容没被悄悄丢掉：三段载荷都原样作为文本在树里
    const texts = nodes.map((n) => n.text)
    expect(texts).toContain(XSS_TITLE)
    expect(texts).toContain(XSS_SUBTITLE)
    expect(texts).toContain(`$ ${XSS_COMMAND}`)
  })

  it("没有代码命令时不渲染代码块（少一个可选节点，不是少整块）", () => {
    const { root } = build({ videoTitle: "只有标题", currentSubtitle: "字幕" })
    expect(root.children.map((c) => c.tag)).toEqual(["div", "div", "div"])
    expect(root.textContent).toContain("只有标题")
    expect(root.textContent).toContain("字幕")
  })

  it("字幕缺省时仍有兜底文案，标题为空也不报错", () => {
    const { root } = build({ videoTitle: "" })
    expect(root.textContent).toContain("正在播放讲解内容...")
  })
})

describe("复制按钮：搬到新模块后诚实性不变", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(copyText).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function copyButton(command?: string): StubElement {
    const { root } = build({ videoTitle: "标题", currentSubtitle: "字幕", lastCodeCommand: command })
    const btn = walk(root).find((n) => n.getAttribute("id") === "pip-copy-btn")
    if (!btn) throw new Error("找不到 #pip-copy-btn：按钮没有建立，或 id 变了")
    return btn
  }

  it("剪贴板被拒时不改文案（原来会无条件显示「已复制!」）", async () => {
    vi.mocked(copyText).mockResolvedValue({ ok: false, reason: "浏览器拒绝了这次剪贴板写入" })
    const btn = copyButton("pnpm test")
    expect(btn.fire("click")).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(copyText).toHaveBeenCalledWith("pnpm test")
    expect(btn.textContent).toBe("复制代码")
  })

  it("真复制成功才改文案，1500ms 后复原", async () => {
    vi.mocked(copyText).mockResolvedValue({ ok: true })
    const btn = copyButton("pnpm test")
    btn.fire("click")
    await vi.advanceTimersByTimeAsync(0)
    expect(btn.textContent).toBe("已复制!")
    await vi.advanceTimersByTimeAsync(1500)
    expect(btn.textContent).toBe("复制代码")
  })

  it("没有命令时点击不触碰剪贴板", () => {
    const btn = copyButton(undefined)
    btn.fire("click")
    expect(copyText).not.toHaveBeenCalled()
  })
})

describe("源码级：全仓不许有 HTML 字符串写入点", () => {
  function listSources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) listSources(full, out)
      else if (/\.(tsx|ts)$/.test(entry.name)) out.push(relative(ROOT, full).replace(/\\/g, "/"))
    }
    return out
  }

  /** 真正的「写入」形状：声明、注释里的说明文字不算 */
  const HTML_WRITE = String.raw`(?:\.(?:inner|outer)HTML\s*=[^=]|\.insertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\()`

  it("overlay src 里 .innerHTML / outerHTML / insertAdjacentHTML / document.write 的写入点为 0", () => {
    const offenders: string[] = []
    for (const file of listSources(join(ROOT, "src"))) {
      const text = readFileSync(join(ROOT, file), "utf8")
      text.split("\n").forEach((line, i) => {
        if (new RegExp(HTML_WRITE).test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`)
      })
    }
    expect(offenders, "这些行把字符串交给 HTML 解析器：\n" + offenders.join("\n")).toEqual([])
  })

  it("扫描机没瞎：确实能抓到被禁的写法", () => {
    expect(new RegExp(HTML_WRITE).test("root.innerHTML = `<div>${title}</div>`")).toBe(true)
    expect(new RegExp(HTML_WRITE).test("el.insertAdjacentHTML('beforeend', html)")).toBe(true)
    expect(new RegExp(HTML_WRITE).test("document.write(payload)")).toBe(true)
    // 而注释/比较不算写入
    expect(new RegExp(HTML_WRITE).test("// 旧实现把三者插进一段 innerHTML 模板")).toBe(false)
    expect(new RegExp(HTML_WRITE).test("if (el.innerHTML == other) return")).toBe(false)
  })

  it("伴学窗组件不再自己拼 DOM，改为调用构建器", () => {
    const component = readFileSync(join(ROOT, "src/components/video-pip-window-renderer.tsx"), "utf8")
    expect(component).toContain("buildVideoPipContent(pipDoc, { videoTitle, currentSubtitle, lastCodeCommand })")
    expect(component).toContain("pipDoc.body.appendChild")
  })

  it("构建器把外部文本只交给 textContent（三处入参各有其位）", () => {
    const lib = readFileSync(join(ROOT, "src/lib/video-pip-content.ts"), "utf8")
    for (const needle of [
      "el.textContent = text",
      "data.videoTitle",
      "data.currentSubtitle || '正在播放讲解内容...'",
      "`$ ${data.lastCodeCommand}`",
    ]) {
      expect(lib, `构建器缺少：${needle}`).toContain(needle)
    }
  })
})
