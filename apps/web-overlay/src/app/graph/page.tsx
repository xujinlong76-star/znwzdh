import { Metadata } from 'next'
import { EcosystemGraph } from '@/components/ecosystem-graph'
import { Breadcrumbs } from '@/components/breadcrumbs'
import { Container } from '@/components/ui/container'
import { pageShareMetadata } from '@/lib/seo/metadata'

/**
 * 标题只写页面名：站点名由根 layout 的 title.template 统一追加。
 * 这里再拼一次品牌名会渲染成「技术生态与平替拓扑图谱 - NavHub - NavHub」。
 */
export async function generateMetadata(): Promise<Metadata> {
  const title = '技术生态与平替拓扑图谱'
  const description = '全景交互式探索前端、AI、全栈开发与设计工具链生态，发现开源与高性价比替代方案。'
  return {
    title,
    description,
    alternates: { canonical: '/graph' },
    ...(await pageShareMetadata({ url: '/graph', title, description })),
  }
}

export default function GraphPage() {
  // 面包屑末级与页面标题同名（与 metadata.title 一致）。
  // 可见 DOM 与 JSON-LD 由 Breadcrumbs 同源渲染，不再手写 JsonLd 块。
  return (
    <>
      <Breadcrumbs
        items={[
          { label: '首页', path: '/' },
          { label: '技术生态与平替拓扑图谱', path: '/graph' },
        ]}
      />
      <EcosystemGraph />
      {/* 静态说明：图谱本身是 SVG 与交互控件，没有可读正文；
          这里用真实存在的功能补齐文本内容，也是页面参与收录的依据。 */}
      <section aria-labelledby="graph-guide-title" className="border-t border-border/60 bg-muted/20 py-10">
        <Container>
          <h2 id="graph-guide-title" className="text-lg font-semibold tracking-tight">
            如何读这张图谱
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            图谱把工具按开发、设计、AI、效率四类场景铺开：每个节点是一个工具或站点，连线表示它们之间的关系。
            这里不做排行榜、不给工具打分，只呈现可核对的分类、标签与替代关系；具体取舍请以各工具官网为准。
          </p>
          <dl className="mt-6 grid gap-x-8 gap-y-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="font-medium">粉色虚线：平替候选</dt>
              <dd className="mt-1 leading-relaxed text-muted-foreground">
                用途相近、可互相替代的工具，例如 Cursor 与 Continue.dev。部分连线由共享标签自动推导，详情里会标注共同标签。
              </dd>
            </div>
            <div>
              <dt className="font-medium">靛蓝实线：生态链路</dt>
              <dd className="mt-1 leading-relaxed text-muted-foreground">
                同分类工具之间的关联，用来发现同一条工作流里的上下游与同域生态项目。
              </dd>
            </div>
            <div>
              <dt className="font-medium">绿色圆点：开源项目</dt>
              <dd className="mt-1 leading-relaxed text-muted-foreground">
                标记源码开放或可自托管的选择，便于优先评估开源方案。
              </dd>
            </div>
            <div>
              <dt className="font-medium">搜索与筛选</dt>
              <dd className="mt-1 leading-relaxed text-muted-foreground">
                顶部搜索框按名称过滤节点；场景按钮在全部、开发、设计、AI、效率之间切换。
              </dd>
            </div>
            <div>
              <dt className="font-medium">视图操作</dt>
              <dd className="mt-1 leading-relaxed text-muted-foreground">
                点击节点打开详情抽屉，可直达官网并查看关联拓扑；放大、缩小按钮调整比例，重置视图恢复初始位置，按住画布拖拽可平移。
              </dd>
            </div>
            <div>
              <dt className="font-medium">键盘漫游</dt>
              <dd className="mt-1 leading-relaxed text-muted-foreground">
                用 Tab 聚焦节点后，方向键按画面方位移动到相邻节点，回车打开详情。
              </dd>
            </div>
          </dl>
        </Container>
      </section>
    </>
  )
}
