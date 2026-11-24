'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, RefreshCw, ShieldCheck, ClipboardCheck, Globe2, AlertTriangle, CheckCircle2, XCircle, Plus, Pause, Play, Trash2 } from 'lucide-react'
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
  busiestHosts:Array<{host:string;tasks:number}>;
  aiModeration:{windowHours:number;sampleSize:number;completed:number;errors:number;quotaBlocked:number;verdicts:Record<string,number>;ledger24h?:Record<string,number>;humanOverturns30d?:number}
}
type Candidate = {
  id:string;url:string;title:string|null;description:string|null;source:string;status:string;
  discoveredAt:number;lastSeenAt:number;
  duplicateEvidence:{exact:boolean;near:number};
  quality:{score:number;reasons:string[]};
  aiModeration?:{mode:string;status:string;verdict:string|null;confidence:number|null;qualityScore:number|null;risks:string[];reasons:string[];model:string|null;policyVersion:string|null;reviewedAt:number|null}|null
}
type CandidatePage = {ok:boolean;items:Candidate[];total:number;limit:number;offset:number}
type Source = {id:string;url:string;kind:'sitemap'|'rss'|'page';enabled:boolean;priority:number;intervalMs:number;nextRunAt:number;lastRunAt:number|null;lastStatus:string|null;lastError:string|null}
type ModerationPolicy = {enabled:boolean;mode:'shadow';autoApproveConfidence:number;rejectConfidence:number;minQualityScore:number;maxExcerptChars:number;maxAiReviewsPerRun:number;requireHttps:boolean}
type ModelAnalytics = {ok:boolean;days:number;models:Array<{model:string;total:number;completed:number;errors:number;quotaBlocked:number;successRate:number|null;averageConfidence:number|null;verdicts:{autoApprove:number;reject:number;manualReview:number}}>}
type GoldCase = {id:string;sourceFingerprint:string;title:string|null;description:string|null;category:string|null;sanitizedExcerpt:string|null;status:'pending'|'annotating'|'needs_adjudication'|'gold_ready';annotationCount:number;finalLabel:string|null;finalRisk:boolean|null;createdAt:number;updatedAt:number}
type GoldAnnotation = {id:string;annotatorId:string;label:'approve'|'reject'|'review';risk:boolean;evidence:string;createdAt:number}
const DEFAULT_POLICY:ModerationPolicy={enabled:false,mode:'shadow',autoApproveConfidence:0.93,rejectConfidence:0.97,minQualityScore:70,maxExcerptChars:6000,maxAiReviewsPerRun:5,requireHttps:false}

function Stat({label,value,detail}:{label:string;value:string|number;detail?:string}) {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl tabular-nums">{value}</CardTitle></CardHeader>{detail&&<CardContent className="pt-0 text-xs text-muted-foreground">{detail}</CardContent>}</Card>
}
function time(value:number){return new Date(value).toLocaleString('zh-CN',{hour12:false})}

export default function CrawlOperationsPage(){
  const [overview,setOverview]=useState<Overview|null>(null)
  const [page,setPage]=useState<CandidatePage|null>(null)
  const [sources,setSources]=useState<Source[]>([])
  const [policy,setPolicy]=useState<ModerationPolicy>(DEFAULT_POLICY)
  const [decisionHistory,setDecisionHistory]=useState<Array<{id:string;candidateId:string;decisionSource:string;verdict:string|null;status:string;createdAt:number;actor:string|null}>>([])
  const [modelAnalytics,setModelAnalytics]=useState<ModelAnalytics|null>(null)
  const [goldCases,setGoldCases]=useState<GoldCase[]>([])
  const [activeGoldId,setActiveGoldId]=useState<string|null>(null)
  const [goldAnnotations,setGoldAnnotations]=useState<GoldAnnotation[]>([])
  const [goldBusy,setGoldBusy]=useState(false)
  const [goldMessage,setGoldMessage]=useState<string|null>(null)
  const [goldTitle,setGoldTitle]=useState('')
  const [goldDescription,setGoldDescription]=useState('')
  const [goldCategory,setGoldCategory]=useState('')
  const [goldExcerpt,setGoldExcerpt]=useState('')
  const [goldLabel,setGoldLabel]=useState<'approve'|'reject'|'review'>('review')
  const [goldRisk,setGoldRisk]=useState(false)
  const [goldEvidence,setGoldEvidence]=useState('')
  const [adjudicateLabel,setAdjudicateLabel]=useState<'approve'|'reject'|'review'>('review')
  const [adjudicateRisk,setAdjudicateRisk]=useState(false)
  const [adjudicateReason,setAdjudicateReason]=useState('')
  const [policyBusy,setPolicyBusy]=useState(false)
  const [sourceUrl,setSourceUrl]=useState('')
  const [sourceKind,setSourceKind]=useState<Source['kind']>('sitemap')
  const [sourceBusy,setSourceBusy]=useState<string|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)
  const [reasons,setReasons]=useState<Record<string,string>>({})
  const load=useCallback(async()=>{
    setLoading(true);setError(null)
    try{
      const [stats,queue,registry,moderation,history,analytics,goldQueue]=await Promise.all([
        hubGet<Overview>('/api/hub/admin/crawl/overview'),
        hubGet<CandidatePage>('/api/hub/admin/crawl/candidates?status=pending&limit=50&offset=0'),
        hubGet<{ok:boolean;items:Source[]}>('/api/hub/admin/crawl-sources?limit=100'),
        hubGet<{ok:boolean;policy:ModerationPolicy}>('/api/hub/admin/crawl-moderation/policy'),
        hubGet<{ok:boolean;items:Array<{id:string;candidateId:string;decisionSource:string;verdict:string|null;status:string;createdAt:number;actor:string|null}>}>('/api/hub/admin/crawl/moderation-decisions?limit=10'),
        hubGet<ModelAnalytics>('/api/hub/admin/crawl/moderation-analytics?days=30'),
        hubGet<{ok:boolean;items:GoldCase[]}>('/api/hub/admin/crawl/moderation-gold-cases?limit=100&offset=0')
      ])
      setOverview(stats);setPage(queue);setSources(registry.items);setPolicy(moderation.policy);setDecisionHistory(history.items);setModelAnalytics(analytics);setGoldCases(goldQueue.items)
    }catch(e){setError(e instanceof Error?e.message:'采集运营数据加载失败')}
    finally{setLoading(false)}
  },[])
  useEffect(()=>{void load()},[load])
  const addSource=async()=>{
    const url=sourceUrl.trim();if(!url||sourceBusy)return
    setSourceBusy('new');setError(null)
    try{await hubSend('/api/hub/admin/crawl-sources','POST',{url,kind:sourceKind});setSourceUrl('');await load()}
    catch(e){setError(e instanceof Error?e.message:'添加采集来源失败')}finally{setSourceBusy(null)}
  }
  const updateSource=async(source:Source,patch:Partial<Source>)=>{
    if(sourceBusy)return;setSourceBusy(source.id);setError(null)
    try{await hubSend('/api/hub/admin/crawl-sources/'+encodeURIComponent(source.id),'PATCH',patch);await load()}
    catch(e){setError(e instanceof Error?e.message:'更新采集来源失败')}finally{setSourceBusy(null)}
  }
  const removeSource=async(source:Source)=>{
    if(sourceBusy||!window.confirm('确定删除这个采集来源？'))return
    setSourceBusy(source.id);setError(null)
    try{await hubSend('/api/hub/admin/crawl-sources/'+encodeURIComponent(source.id),'DELETE',{});await load()}
    catch(e){setError(e instanceof Error?e.message:'删除采集来源失败')}finally{setSourceBusy(null)}
  }
  const savePolicy=async()=>{
    if(policyBusy)return;setPolicyBusy(true);setError(null)
    try{const result=await hubSend<{ok:boolean;policy:ModerationPolicy}>('/api/hub/admin/crawl-moderation/policy','PUT',policy);setPolicy(result.policy)}
    catch(e){setError(e instanceof Error?e.message:'保存 AI 审核规则失败')}finally{setPolicyBusy(false)}
  }
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

  const activeGoldCase=goldCases.find(item=>item.id===activeGoldId)??null
  const openGoldCase=async(item:GoldCase)=>{
    setActiveGoldId(item.id);setGoldMessage(null);setGoldAnnotations([])
    try{const result=await hubGet<{ok:boolean;items:GoldAnnotation[]}>('/api/hub/admin/crawl/moderation-gold-cases/'+encodeURIComponent(item.id)+'/annotations');setGoldAnnotations(result.items)}
    catch(e){setGoldMessage(e instanceof Error?e.message:'读取标注记录失败')}
  }
  const createGoldCase=async()=>{
    if(goldBusy)return
    if(!goldTitle.trim()&&!goldDescription.trim()&&!goldExcerpt.trim()){setGoldMessage('请至少填写标题、描述或脱敏摘要');return}
    setGoldBusy(true);setGoldMessage(null)
    try{
      const canonical=[goldTitle.trim(),goldDescription.trim(),goldCategory.trim(),goldExcerpt.trim()].join('\n')
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical))
      const sourceFingerprint=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')
      await hubSend('/api/hub/admin/crawl/moderation-gold-cases','POST',{
        sourceFingerprint,title:goldTitle.trim()||undefined,description:goldDescription.trim()||undefined,
        category:goldCategory.trim()||undefined,sanitizedExcerpt:goldExcerpt.trim()||undefined
      })
      setGoldTitle('');setGoldDescription('');setGoldCategory('');setGoldExcerpt('')
      setGoldMessage('脱敏样本已加入双人标注队列');await load()
    }catch(e){setGoldMessage(e instanceof Error?e.message:'创建金标样本失败')}
    finally{setGoldBusy(false)}
  }
  const submitGoldAnnotation=async()=>{
    if(!activeGoldCase||goldBusy)return
    setGoldBusy(true);setGoldMessage(null)
    try{
      await hubSend('/api/hub/admin/crawl/moderation-gold-cases/'+encodeURIComponent(activeGoldCase.id)+'/annotations','POST',
        {label:goldLabel,risk:goldRisk,evidence:goldEvidence.trim()})
      setGoldEvidence('');setGoldMessage('人工标注已提交');await load()
      const updated=goldCases.find(item=>item.id===activeGoldCase.id)
      if(updated)await openGoldCase({...updated,annotationCount:updated.annotationCount+1})
      else {const latest=await hubGet<{ok:boolean;items:GoldCase[]}>('/api/hub/admin/crawl/moderation-gold-cases?limit=100&offset=0');const item=latest.items.find(x=>x.id===activeGoldCase.id);if(item)await openGoldCase(item)}
    }catch(e){setGoldMessage(e instanceof Error?e.message:'提交标注失败')}
    finally{setGoldBusy(false)}
  }
  const adjudicateGoldCase=async()=>{
    if(!activeGoldCase||goldBusy)return
    setGoldBusy(true);setGoldMessage(null)
    try{
      await hubSend('/api/hub/admin/crawl/moderation-gold-cases/'+encodeURIComponent(activeGoldCase.id)+'/adjudicate','POST',
        {label:adjudicateLabel,risk:adjudicateRisk,reason:adjudicateReason.trim()})
      setAdjudicateReason('');setGoldMessage('仲裁完成，样本已进入正式金标数据集');await load()
      const latest=await hubGet<{ok:boolean;items:GoldCase[]}>('/api/hub/admin/crawl/moderation-gold-cases?limit=100&offset=0')
      const item=latest.items.find(x=>x.id===activeGoldCase.id);if(item)await openGoldCase(item)
    }catch(e){setGoldMessage(e instanceof Error?e.message:'仲裁失败')}
    finally{setGoldBusy(false)}
  }
  const exportGoldSet=async()=>{
    if(goldBusy)return
    setGoldBusy(true);setGoldMessage(null)
    try{
      const result=await hubGet<{ok:boolean;datasetVersion:string;generatedAt:number;count:number;truncated:boolean;items:unknown[]}>('/api/hub/admin/crawl/moderation-gold-export?limit=5000')
      const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json;charset=utf-8'})
      const url=URL.createObjectURL(blob);const anchor=document.createElement('a')
      anchor.href=url;anchor.download='moderation-gold-set-'+new Date().toISOString().slice(0,10)+'.json'
      document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url)
      setGoldMessage('已导出 '+result.count+' 条正式金标样本'+(result.truncated?'；达到单次导出上限，请分批导出':''))
    }catch(e){setGoldMessage(e instanceof Error?e.message:'导出金标数据失败')}
    finally{setGoldBusy(false)}
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
        <Stat label="近 24 小时 AI 审核" value={overview?.aiModeration.completed??0} detail={`错误 ${overview?.aiModeration.errors??0} · 额度跳过 ${overview?.aiModeration.quotaBlocked??0} · 样本上限 1000`}/>
        <Stat label="近 24 小时审核留档" value={Object.values(overview?.aiModeration.ledger24h??{}).reduce((a,b)=>a+b,0)} detail={`AI ${overview?.aiModeration.ledger24h?.ai??0} · 人工 ${overview?.aiModeration.ledger24h?.human??0}`}/>
        <Stat label="近 30 天人工推翻" value={overview?.aiModeration.humanOverturns30d??0} detail="AI 建议与后续人工结论不一致的次数"/>
      </div>
      <Card><CardHeader><CardTitle className="text-base">最近审核决策历史</CardTitle><CardDescription>AI 判断与人工最终决定分别追加留档；历史记录不可被新结果覆盖。</CardDescription></CardHeader><CardContent className="space-y-2">{decisionHistory.length?decisionHistory.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><div><span className="font-medium">{item.decisionSource==='ai'?'AI 判断':'人工决定'}</span><span className="ml-2 text-muted-foreground">{item.verdict||item.status}</span><div className="text-xs text-muted-foreground">候选 {item.candidateId} · {item.actor||'系统模型'}</div></div><span className="text-xs text-muted-foreground">{time(item.createdAt)}</span></div>):<p className="text-sm text-muted-foreground">暂无审核历史记录</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">模型审核质量分析（近 {modelAnalytics?.days??30} 天）</CardTitle><CardDescription>按模型统计实际留档结果；成功率是模型完成审核的比例，不代表判断准确率。样本不足时不要据此启用自动审核。</CardDescription></CardHeader><CardContent>
        {!modelAnalytics?.models.length?<p className="text-sm text-muted-foreground">当前时间范围内暂无 AI 审核样本。</p>:<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="p-2">模型</th><th className="p-2">样本</th><th className="p-2">完成</th><th className="p-2">成功率</th><th className="p-2">平均置信度</th><th className="p-2">建议通过</th><th className="p-2">建议驳回</th><th className="p-2">人工复核</th><th className="p-2">错误/额度跳过</th></tr></thead><tbody>{modelAnalytics.models.map(item=><tr key={item.model} className="border-b last:border-0"><td className="p-2 font-medium">{item.model}</td><td className="p-2 tabular-nums">{item.total}</td><td className="p-2 tabular-nums">{item.completed}</td><td className="p-2 tabular-nums">{item.successRate===null?'—':item.successRate+'%'}</td><td className="p-2 tabular-nums">{item.averageConfidence===null?'—':Math.round(item.averageConfidence*100)+'%'}</td><td className="p-2 tabular-nums">{item.verdicts.autoApprove}</td><td className="p-2 tabular-nums">{item.verdicts.reject}</td><td className="p-2 tabular-nums">{item.verdicts.manualReview}</td><td className="p-2 tabular-nums">{item.errors}/{item.quotaBlocked}</td></tr>)}</tbody></table></div>}
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4"/>人工金标标注工作台</CardTitle><CardDescription>先提交完成脱敏的样本，再由两位不同管理员独立标注；结论不一致时交给第三位管理员仲裁。AI 输出不参与生成金标。</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">样本标题</span><input value={goldTitle} onChange={e=>setGoldTitle(e.target.value)} maxLength={200} className="h-9 w-full rounded-md border bg-background px-3"/></label>
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">所属类别</span><input value={goldCategory} onChange={e=>setGoldCategory(e.target.value)} maxLength={80} className="h-9 w-full rounded-md border bg-background px-3"/></label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-muted-foreground">网站描述（先脱敏）</span><textarea value={goldDescription} onChange={e=>setGoldDescription(e.target.value)} maxLength={1000} rows={2} className="w-full rounded-md border bg-background p-3 text-sm"/></label>
            <label className="space-y-1 text-sm md:col-span-2"><span className="text-muted-foreground">脱敏内容摘要（不得包含 URL、邮箱、电话或个人信息）</span><textarea value={goldExcerpt} onChange={e=>setGoldExcerpt(e.target.value)} maxLength={3000} rows={3} className="w-full rounded-md border bg-background p-3 text-sm"/></label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">系统会根据已填写的脱敏内容生成 SHA-256 样本指纹。</p><Button size="sm" onClick={()=>void createGoldCase()} disabled={goldBusy}>加入双人标注队列</Button></div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4"><div><h3 className="font-medium">金标样本队列</h3><p className="text-xs text-muted-foreground">待标注 {goldCases.filter(x=>x.status==='pending'||x.status==='annotating').length} · 待仲裁 {goldCases.filter(x=>x.status==='needs_adjudication').length} · 已形成金标 {goldCases.filter(x=>x.status==='gold_ready').length}</p></div><Button size="sm" variant="outline" onClick={()=>void exportGoldSet()} disabled={goldBusy}>导出正式金标 JSON</Button></div>
          {!goldCases.length?<p className="rounded-lg border p-5 text-center text-sm text-muted-foreground">暂无金标样本。请先添加完成脱敏的真实网站样本。</p>:<div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="max-h-[520px] space-y-2 overflow-y-auto">{goldCases.map(item=><button type="button" key={item.id} onClick={()=>void openGoldCase(item)} className={'w-full rounded-lg border p-3 text-left transition-colors '+(activeGoldId===item.id?'border-primary bg-primary/5':'hover:bg-muted/50')}>
              <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{item.title||item.id}</span><span className="shrink-0 rounded bg-muted px-2 py-1 text-[11px]">{item.status==='pending'?'待标注':item.status==='annotating'?'标注中':item.status==='needs_adjudication'?'待仲裁':'已形成金标'}</span></div>
              <div className="mt-1 text-xs text-muted-foreground">标注 {item.annotationCount}/2 · {item.category||'未分类'}{item.finalLabel?' · '+item.finalLabel:''}</div>
            </button>)}</div>
            <div className="min-w-0 space-y-3 rounded-lg border p-3">
              {!activeGoldCase?<p className="py-8 text-center text-sm text-muted-foreground">选择左侧样本开始标注或仲裁。</p>:<>
                <div><h3 className="font-semibold">{activeGoldCase.title||'未命名样本'}</h3>{activeGoldCase.description&&<p className="mt-1 text-sm text-muted-foreground">{activeGoldCase.description}</p>}{activeGoldCase.sanitizedExcerpt&&<p className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-3 text-sm">{activeGoldCase.sanitizedExcerpt}</p>}</div>
                <div className="space-y-2 border-t pt-3"><h4 className="text-sm font-medium">独立人工标注记录</h4>{goldAnnotations.length?goldAnnotations.map(item=><div key={item.id} className="rounded-lg bg-muted/50 p-3 text-xs"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{item.label} · {item.risk?'存在风险':'未标记风险'}</span><span className="text-muted-foreground">{item.annotatorId} · {time(item.createdAt)}</span></div><p className="mt-1 whitespace-pre-wrap">{item.evidence}</p></div>):<p className="text-xs text-muted-foreground">尚无标注记录</p>}</div>
                {activeGoldCase.status==='pending'||activeGoldCase.status==='annotating'?<div className="space-y-2 border-t pt-3"><h4 className="text-sm font-medium">提交我的独立判断</h4><div className="grid gap-2 sm:grid-cols-2"><select value={goldLabel} onChange={e=>setGoldLabel(e.target.value as 'approve'|'reject'|'review')} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="approve">适合收录</option><option value="reject">不适合收录</option><option value="review">证据不足/需复核</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={goldRisk} onChange={e=>setGoldRisk(e.target.checked)}/>存在明确风险</label></div><textarea value={goldEvidence} onChange={e=>setGoldEvidence(e.target.value)} rows={3} maxLength={2000} placeholder="填写判断依据（至少 10 个字符）" className="w-full rounded-md border bg-background p-3 text-sm"/><Button size="sm" onClick={()=>void submitGoldAnnotation()} disabled={goldBusy||goldEvidence.trim().length<10}>提交独立标注</Button></div>:null}
                {activeGoldCase.status==='needs_adjudication'?<div className="space-y-2 border-t pt-3"><h4 className="text-sm font-medium">分歧仲裁（必须由未参与本样本标注的管理员执行）</h4><div className="grid gap-2 sm:grid-cols-2"><select value={adjudicateLabel} onChange={e=>setAdjudicateLabel(e.target.value as 'approve'|'reject'|'review')} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="approve">仲裁：适合收录</option><option value="reject">仲裁：不适合收录</option><option value="review">仲裁：证据不足</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={adjudicateRisk} onChange={e=>setAdjudicateRisk(e.target.checked)}/>最终判定存在风险</label></div><textarea value={adjudicateReason} onChange={e=>setAdjudicateReason(e.target.value)} rows={3} maxLength={2000} placeholder="填写仲裁理由（至少 10 个字符）" className="w-full rounded-md border bg-background p-3 text-sm"/><Button size="sm" onClick={()=>void adjudicateGoldCase()} disabled={goldBusy||adjudicateReason.trim().length<10}>提交仲裁</Button></div>:null}
                {activeGoldCase.status==='gold_ready'?<div className="rounded-lg border border-green-600/30 bg-green-600/5 p-3 text-sm"><strong>正式金标：</strong>{activeGoldCase.finalLabel} · {activeGoldCase.finalRisk?'存在风险':'未标记风险'}</div>:null}
              </>}
            </div>
          </div>}
          {goldMessage&&<p className="rounded-md bg-muted p-3 text-sm">{goldMessage}</p>}
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-base">采集来源管理</CardTitle><CardDescription>维护 Sitemap、RSS/Atom 和普通网页来源；来源仍受 robots.txt 与 SSRF 安全策略约束。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={sourceUrl} onChange={e=>setSourceUrl(e.target.value)} placeholder="https://example.com/sitemap.xml" aria-label="采集来源 URL" className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"/>
            <select value={sourceKind} onChange={e=>setSourceKind(e.target.value as Source['kind'])} aria-label="采集来源类型" className="h-10 rounded-md border bg-background px-3 text-sm"><option value="sitemap">Sitemap</option><option value="rss">RSS / Atom</option><option value="page">普通网页</option></select>
            <Button onClick={()=>void addSource()} disabled={!sourceUrl.trim()||sourceBusy!==null}><Plus className="mr-1.5 h-4 w-4"/>添加来源</Button>
          </div>
          {!sources.length?<p className="text-sm text-muted-foreground">尚未登记数据库采集来源。</p>:<div className="divide-y rounded-lg border">{sources.map(source=><div key={source.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0 flex-1"><div className="break-all text-sm font-medium">{source.url}</div><div className="mt-1 text-xs text-muted-foreground">{source.kind.toUpperCase()} · 优先级 {source.priority} · 间隔 {Math.round(source.intervalMs/60000)} 分钟 · {source.lastStatus||'尚未调度'}</div>{source.lastError&&<div className="mt-1 break-all text-xs text-destructive">{source.lastError}</div>}</div>
            <div className="flex gap-2"><Button size="sm" variant="outline" disabled={sourceBusy!==null} onClick={()=>void updateSource(source,{enabled:!source.enabled})}>{source.enabled?<><Pause className="mr-1 h-3.5 w-3.5"/>暂停</>:<><Play className="mr-1 h-3.5 w-3.5"/>启用</>}</Button><Button size="sm" variant="ghost" disabled={sourceBusy!==null} onClick={()=>void removeSource(source)} aria-label="删除来源"><Trash2 className="h-4 w-4"/></Button></div>
          </div>)}</div>}
        </CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4"/>AI 自动审核规则</CardTitle><CardDescription>使用全局已配置的大模型。当前只允许影子模式：模型生成审核建议并记录证据，不会自动批准、驳回或发布网站。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={policy.enabled} onChange={e=>setPolicy(p=>({...p,enabled:e.target.checked}))}/>启用 AI 影子审核</label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">自动通过建议置信度</span><input type="number" min="0.5" max="1" step="0.01" value={policy.autoApproveConfidence} onChange={e=>setPolicy(p=>({...p,autoApproveConfidence:Number(e.target.value)}))} className="h-9 w-full rounded-md border bg-background px-3"/></label>
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">高风险拒绝建议置信度</span><input type="number" min="0.5" max="1" step="0.01" value={policy.rejectConfidence} onChange={e=>setPolicy(p=>({...p,rejectConfidence:Number(e.target.value)}))} className="h-9 w-full rounded-md border bg-background px-3"/></label>
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">最低质量分</span><input type="number" min="0" max="100" step="1" value={policy.minQualityScore} onChange={e=>setPolicy(p=>({...p,minQualityScore:Number(e.target.value)}))} className="h-9 w-full rounded-md border bg-background px-3"/></label>
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">每轮最多审核数</span><input type="number" min="1" max="25" step="1" value={policy.maxAiReviewsPerRun} onChange={e=>setPolicy(p=>({...p,maxAiReviewsPerRun:Number(e.target.value)}))} className="h-9 w-full rounded-md border bg-background px-3"/></label>
            <label className="space-y-1 text-sm"><span className="text-muted-foreground">正文截断字符数</span><input type="number" min="200" max="12000" step="100" value={policy.maxExcerptChars} onChange={e=>setPolicy(p=>({...p,maxExcerptChars:Number(e.target.value)}))} className="h-9 w-full rounded-md border bg-background px-3"/></label>
            <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={policy.requireHttps} onChange={e=>setPolicy(p=>({...p,requireHttps:e.target.checked}))}/>审核建议要求 HTTPS</label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="text-xs text-muted-foreground">当前模式：Shadow · 单日调用仍受系统 LLM 配额保护；每轮审核数可限制批量成本。</p><Button size="sm" onClick={()=>void savePolicy()} disabled={policyBusy}>{policyBusy?'保存中…':'保存审核规则'}</Button></div>
        </CardContent></Card>
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
            {item.aiModeration?.status==='completed'&&<div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="font-semibold">AI 影子审核意见</span><span className="rounded bg-background px-2 py-1 text-xs">{item.aiModeration.verdict==='auto_approve'?'建议通过':item.aiModeration.verdict==='reject'?'建议驳回':'建议人工复核'}</span></div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>置信度：{item.aiModeration.confidence===null?'—':Math.round(item.aiModeration.confidence*100)+'%'}</span><span>质量分：{item.aiModeration.qualityScore??'—'}</span><span>模型：{item.aiModeration.model||'—'}</span></div>
              {!!item.aiModeration.risks.length&&<div className="text-xs">风险标记：{item.aiModeration.risks.join('、')}</div>}
              {!!item.aiModeration.reasons.length&&<ul className="list-disc pl-5 text-xs text-muted-foreground">{item.aiModeration.reasons.slice(0,4).map((reason,i)=><li key={i}>{reason}</li>)}</ul>}
              <p className="text-[11px] text-muted-foreground">仅供参考；当前不会替代人工审核。</p>
            </div>}
            {item.aiModeration?.status==='error'&&<p className="text-xs text-amber-600">AI 审核暂未完成：模型调用失败，候选仍保持待审核。</p>}
            {item.aiModeration?.status==='quota_blocked'&&<p className="text-xs text-amber-600">AI 审核因额度限制跳过，候选仍保持待审核。</p>}
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
