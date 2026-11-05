/**
 * 桌面伴学窗（Document Picture-in-Picture）的 DOM 构建。
 *
 * 单独成模块只为一件事：这段代码是「外部文本进 DOM」的出口，必须能被测试钉住。
 * 三个字段全部来自外部数据链路——videoTitle 是视频标题（B 站/YouTube 抓取与投稿），
 * currentSubtitle 是字幕文本，lastCodeCommand 是从代码里程碑切出来的那一行。
 *
 * 原实现把三者拼进一段 innerHTML 模板字符串，等于把它们交给 HTML 解析器：
 * 标题写成 `<img src=x onerror=...>` 就会在 PiP 窗口里真的执行，而 documentPictureInPicture
 * 开的是**同源**窗口，脚本能直接拿到父文档。这里全程 createElement + textContent：
 * 文本节点没有「解析标签」这一步，注入面从源头关闭。
 */

import { copyText } from '@/lib/clipboard'

export interface VideoPipContentData {
  videoTitle: string
  currentSubtitle?: string
  lastCodeCommand?: string
}

/** PiP 窗口里没有 Tailwind 运行时，样式沿用原来的内联写法（观感逐字不变） */
const TITLE_STYLE = 'font-family: system-ui; font-size: 12px; font-weight: 600; color: #38bdf8; margin-bottom: 8px;'
const SUBTITLE_BOX_STYLE = 'background: #18181b; padding: 8px; border-radius: 6px; border: 1px solid #27272a; margin-bottom: 8px;'
const SUBTITLE_LABEL_STYLE = 'font-size: 10px; color: #a1a1aa; margin-bottom: 4px;'
const SUBTITLE_TEXT_STYLE = 'font-size: 11px; color: #f4f4f5; line-height: 1.4;'
const CODE_BOX_STYLE =
  'background: #09090b; padding: 6px 8px; border-radius: 4px; font-family: monospace; font-size: 10px; color: #34d399; margin-bottom: 8px; border: 1px solid #27272a;'
const FOOTER_STYLE = 'display: flex; justify-content: space-between; align-items: center;'
const FOOTER_HINT_STYLE = 'font-size: 10px; color: #71717a;'
const COPY_BUTTON_STYLE =
  'background: #38bdf8; color: #000; border: none; padding: 4px 10px; border-radius: 4px; font-size: 10px; font-weight: 600; cursor: pointer;'

/**
 * 唯一的建节点入口：文本只走 textContent。
 * 所有样式都来自上面这组常量，不接受任何外部字符串。
 */
function textElement(doc: Document, tag: 'div' | 'span' | 'button', style: string, text: string): HTMLElement {
  const el = doc.createElement(tag)
  el.setAttribute('style', style)
  el.textContent = text
  return el
}

/** 构建伴学窗内容，返回尚未挂载的根节点（由调用方决定挂到哪个 body） */
export function buildVideoPipContent(doc: Document, data: VideoPipContentData): HTMLElement {
  const root = doc.createElement('div')
  root.setAttribute('class', 'flex flex-col h-full justify-between p-3 select-none')

  root.appendChild(textElement(doc, 'div', TITLE_STYLE, data.videoTitle))

  const subtitleBox = doc.createElement('div')
  subtitleBox.setAttribute('style', SUBTITLE_BOX_STYLE)
  subtitleBox.appendChild(textElement(doc, 'div', SUBTITLE_LABEL_STYLE, '实时字幕跟随'))
  subtitleBox.appendChild(
    textElement(doc, 'div', SUBTITLE_TEXT_STYLE, data.currentSubtitle || '正在播放讲解内容...'),
  )
  root.appendChild(subtitleBox)

  if (data.lastCodeCommand) {
    root.appendChild(textElement(doc, 'div', CODE_BOX_STYLE, `$ ${data.lastCodeCommand}`))
  }

  const footer = doc.createElement('div')
  footer.setAttribute('style', FOOTER_STYLE)
  footer.appendChild(textElement(doc, 'span', FOOTER_HINT_STYLE, '伴学悬浮窗置顶中'))

  const copyBtn = textElement(doc, 'button', COPY_BUTTON_STYLE, '复制代码')
  copyBtn.setAttribute('id', 'pip-copy-btn')
  copyBtn.addEventListener('click', () => {
    if (!data.lastCodeCommand) return
    // documentPictureInPicture 是同源窗口，仍可用父文档的封装层；
    // 原实现写完立刻改文案，失败时用户看到的「已复制!」是假的
    void copyText(data.lastCodeCommand).then((result) => {
      if (!result.ok) return
      copyBtn.textContent = '已复制!'
      setTimeout(() => {
        copyBtn.textContent = '复制代码'
      }, 1500)
    })
  })
  footer.appendChild(copyBtn)

  root.appendChild(footer)
  return root
}
