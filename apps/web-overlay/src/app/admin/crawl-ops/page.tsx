'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw, ShieldCheck, ClipboardCheck, Globe2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hubGet, hubSend } from '@/lib/navhub-api'
import { safeHref } from '@/lib/safe-url'

type Overview = {
  ok:boolean; generatedAt:number;
  tasks:Record<string,number|null>;
  sources:{enabled:number;disabled:number};
  candidates:Record<string,number>;
  last24Hours:Record<string,number>;
  busiestHosts:Array<{host:string;tasks:number}>
}
type Candidate = {
  id:string;url:string;title:string|null;description:string|null;source:string;status:string;
  discoveredAt:number;lastSeenAt:number;
  duplicateEvidence:{exact:boolean;near:number};
  quality:{score:number;reasons:string[]}
}
type CandidatePage = {ok:boolean;items:Candidate[];total:number;limit:number;offset:number}

function Stat({label,value,detail}:{label:string;value:string|number;detail?:string}) {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl tabular-nums">{value}</CardTitle></CardHeader>{detail&&<CardContent className="pt-0 text-xs text-muted-foreground">{detail}</CardContent>}</Card>
}
function time(value:number){return new Date(value).toLocaleString('zh-CN',{hour12:false})}

export default function CrawlOperationsPage(){
  const [overview,setOverview]=useState<Overview|null>(null)
  const [page,setPage]=useState<CandidatePage|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [reasons,setReasons]=useState<Record<string,string>>({})
  const load=useCallback(async()=>{
    setLoading(true);setError(null)
    try{
      const [stats,queue]=await Promise.all([
        hubGet<Overview>('/api/hub/admin/crawl/overview'),
        hubGet<CandidatePage>('/api/hub/admin/crawl/candidates?status=pending&limit=50&offset=0')
      ])
      setOverview(stats);setPage(queue)
    }catch(e){setError(e instanceof Error?e.message:'采集运营数据加载失败')}
    finally{setLoading(false)}
  },[])
  useEffect(()=>{void load()},[load])
  const review=async(item:Candidate,decision:'approve'|'reject')=>{
    if(busy)return
    const reason=(reasons[item.id]??'').trim()
    if(decision==='reject'&&!reason){setError('驳回候选必须填写原因');return}
    setBusy(item.id);setError(null)
    try{
      await hubSend('/api/hub/admin/crawl/candidates/'+encodeURIComponent(item.id)+'/review','POST',
        {decision,...(decision==='reject'?{reason}:{})})
      await load()
    }catch(e){setError(e instanceof Error?e.message:'审核操作失败')}
    finally{setBusy(null)}
  }
  const tasks=overview?.tasks??{}
  return <div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><Activity className="h-6 w-6"/>采集运营中心</h1>
        <p className="mt-1 text-sm text-muted-foreground">统一查看采集队列、来源运行、质量线索与人工审核。评分只用于辅助决策，不会自动发布或删除站点。</p></div>
      <Button variant="outline" size="sm" onClick={()=>void load()} disabled={loading}><RefreshCw className={'mr-2 h-4 w-4 '+(loading?'animate-spin':'')}/>刷新数据</Button>
    </div>
    {error&&<Card className="border-destructive/50"><CardContent className="flex items-center gap-2 py-4 text-sm text-destructive"><AlertTriangle className="h-4 w-4"/>{error}</CardContent></Card>}
    {loading&&!overview?<p className="py-12 text-center text-sm text-muted-foreground">正在读取运营数据…</p>:<>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="采集任务总量" value={tasks.total??0} detail={`待处理 ${tasks.queued??0} · 重试 ${tasks.retry??0} · 执行中 ${tasks.leased??0}`}/>
        <Stat label="已完成任务" value={tasks.done??0} detail={`死信 ${tasks.dead_letter??0} · 人工挂起 ${tasks.hold_for_review??0}`}/>
        <Stat label="完成率" value={tasks.successRate===null||tasks.successRate===undefined?'—':tasks.successRate+'%'} detail="已结束任务中的成功占比"/>
        <Stat label="启用采集来源" value={overview?.sources.enabled??0} detail={`暂停来源 ${overview?.sources.disabled??0}`}/>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="待审核候选" value={overview?.candidates.pending??0}/>
        <Stat label="已通过候选" value={overview?.candidates.approved??0}/>
        <Stat label="已驳回候选" value={overview?.candidates.rejected??0}/>
        <Stat label="近 24 小时处理" value={Object.values(overview?.last24Hours??{}).reduce((a,b)=>a+b,0)}/>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-4 w-4"/>活跃域名分布</CardTitle><CardDescription>按采集任务主机名统计；此处不将相似域名误判为同一企业或产品生态。</CardDescription></CardHeader>
          <CardContent className="space-y-3">{(overview?.busiestHosts??[]).length?overview!.busiestHosts.map(item=><div key={item.host} className="flex items-center justify-between gap-3 text-sm"><span className="min-w-0 truncate">{item.host}</span><span className="tabular-nums text-muted-foreground">{item.tasks} 项任务</span></div>):<p className="text-sm text-muted-foreground">暂无域名数据</p>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4"/>队列运行概况</CardTitle><CardDescription>实时统计来自数据库快照，近 24 小时按任务更新时间计算。</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">{Object.entries(overview?.last24Hours??{}).map(([key,value])=><div key={key} className="rounded-lg bg-muted/50 p-3"><div className="text-muted-foreground">{key}</div><div className="mt-1 text-xl font-semibold tabular-nums">{value}</div></div>)}</CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4"/>待审核网站</CardTitle><CardDescription>按透明规则给出 0–100 初筛分数；重复证据和低分用于提示人工复核，不作为自动封禁条件。</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {!page?.items.length?<p className="py-8 text-center text-sm text-muted-foreground">当前没有待审核候选</p>:page.items.map(item=><div key={item.id} className="space-y-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">{item.title||'未命名网站'}</h3><a href={safeHref(item.url)} target="_blank" rel="noopener noreferrer" className="break-all text-sm text-muted-foreground underline">{item.url}</a></div><div className="rounded-lg bg-muted px-3 py-2 text-center"><div className="text-xl font-bold tabular-nums">{item.quality.score}</div><div className="text-[11px] text-muted-foreground">质量参考分</div></div></div>
            {item.description&&<p className="text-sm text-muted-foreground">{item.description}</p>}
            <div className="flex flex-wrap gap-2 text-xs"><span className="rounded bg-muted px-2 py-1">来源：{item.source}</span><span className="rounded bg-muted px-2 py-1">完全重复：{item.duplicateEvidence.exact?'是':'否'}</span><span className="rounded bg-muted px-2 py-1">近重复候选：{item.duplicateEvidence.near}</span><span className="rounded bg-muted px-2 py-1">发现：{time(item.discoveredAt)}</span></div>
            <ul className="list-disc pl-5 text-xs text-muted-foreground">{item.quality.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>
            <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row"><Button size="sm" disabled={busy!==null} onClick={()=>void review(item,'approve')}><CheckCircle2 className="mr-1.5 h-4 w-4"/>{busy===item.id?'处理中…':'标记通过'}</Button><input value={reasons[item.id]??''} onChange={e=>setReasons(old=>({...old,[item.id]:e.target.value}))} placeholder="驳回原因（必填）" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"/><Button size="sm" variant="outline" disabled={busy!==null} onClick={()=>void review(item,'reject')}><XCircle className="mr-1.5 h-4 w-4"/>驳回</Button></div>
          </div>)}
          {page&&page.total>page.items.length&&<p className="text-center text-xs text-muted-foreground">当前展示前 {page.items.length} 条，共 {page.total} 条。可通过接口分页继续查看。</p>}
        </CardContent></Card>
      <p className="text-xs text-muted-foreground">数据快照时间：{overview?time(overview.generatedAt):'—'}。批准候选仅改变审核状态；当前接口不会自动将候选写入正式站点目录。</p>
    </>}
  </div>
}
