import { randomUUID } from 'node:crypto';
import twitter from 'twitter-text';
import {platforms,metricKeys} from '../public/catalog.js';
export const ids = platforms.map(p=>p.id);
export function check(ok, message, status=400) { if (!ok) throw Object.assign(new Error(message),{status}); }
export function plain(v) { return v && typeof v==='object' && !Array.isArray(v); }
export function str(v,max=100000) { check(typeof v==='string' && v.length<=max,'入力の形式または長さが正しくありません。'); return v; }
export function https(v) { try { const u=new URL(v); return u.protocol==='https:' && !u.username && !u.password && !u.hash && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[|0\.)/i.test(u.hostname) && !/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname) && u.hostname.includes('.'); } catch {return false;} }
export function content(input={}) {
  check(plain(input),'原稿の形式が正しくありません。');
  const c={}; for(const key of ['title','body','mediaUrl','link']) c[key]=str(input[key]??'',key==='body'?100000:key==='title'?300:3000);
  check(!c.mediaUrl || https(c.mediaUrl),'画像は公開HTTPS URLを入力してください。');
  check(!c.link || https(c.link),'リンクはHTTPS URLを入力してください。'); return c;
}
export function normalizeDraft(input,previous=null) {
  check(plain(input),'投稿データが必要です。');
  check(Array.isArray(input.selected) && input.selected.every(v=>ids.includes(v)) && new Set(input.selected).size===input.selected.length,'投稿先が正しくありません。');
  const overrides={}; for(const id of ids){ const v=input.overrides?.[id]; if(v) {check(plain(v)&&['shared','individual'].includes(v.mode),'切り替えの形式が正しくありません。'); overrides[id]={mode:v.mode,content:content(v.content)};} }
  const date=input.scheduledAt??''; check(typeof date==='string' && (!date || Number.isFinite(Date.parse(date))),'日時が正しくありません。');
  return {id:previous?.id??randomUUID(),revision:(previous?.revision??0)+1,common:content(input.common),selected:[...input.selected],overrides,scheduledAt:date?new Date(date).toISOString():'',updatedAt:new Date().toISOString(),createdAt:previous?.createdAt??new Date().toISOString()};
}
export function effective(draft,id){return draft.overrides[id]?.mode==='individual'?draft.overrides[id].content:draft.common;}
export function postText(c){return c.body+(c.link?'\n\n'+c.link:'');}
export function lengthFor(id,text){return id==='x'?twitter.parseTweet(text).weightedLength:[...text].length;}
export function readiness(draft,connections) {
 return draft.selected.map(id=>{const p=platforms.find(p=>p.id===id),c=effective(draft,id),issues=[],text=postText(c);
 if(!c.body.trim()) issues.push('本文を入力');
 if(lengthFor(id,text)>p.limit) issues.push(`文字数上限 ${p.limit} を超過`);
 if(id==='instagram' && !c.mediaUrl) issues.push('公開JPEG画像のURLが必要');
 if(id==='facebook' && c.mediaUrl) issues.push('初版のFacebook自動配信はテキストのみ。個別原稿で画像URLを外してください');
 if(id==='threads' && c.mediaUrl) issues.push('初版のThreads自動配信はテキストのみ。個別原稿で画像URLを外してください');
 if(['note','rednote'].includes(id)&&!c.title.trim()) issues.push('タイトルを入力');
 if(id==='rednote'&&[...c.title].length>20) issues.push('タイトルは20文字以内');
 if(id==='rednote'&&!c.mediaUrl) issues.push('画像URLを設定。公式画面で素材を添付してください');
 if(p.auto && !connections[id]?.verifiedAt) issues.push('接続テストが必要');
 return {id,mode:p.auto?'auto':'manual',issues,count:lengthFor(id,text),limit:p.limit}; });
}
export function observation(input,job,now=new Date()) {
 check(plain(input.metrics),'反響データが必要です。');
 const metrics={}; for(const [k,v] of Object.entries(input.metrics)) {check(metricKeys[job.platform].includes(k),'未対応の指標です。'); check(Number.isSafeInteger(v)&&v>=0,'反響は0以上の整数です。空欄は未取得です。'); metrics[k]=v;}
 check(Object.keys(metrics).length>0,'取得した指標を一つ以上入力してください。');
 const measuredAt=str(input.measuredAt,100); check(Number.isFinite(Date.parse(measuredAt)) && Date.parse(measuredAt)<=now.getTime() && Date.parse(measuredAt)>=Date.parse(job.publishedAt),'取得日時は公開以降、現在以前を指定してください。');
 check(['current_lifetime','publication_48h'].includes(input.period),'集計期間を選択してください。');
 check(typeof input.reference==='string'&&input.reference.trim().length>0,'確認した画面・取得元を入力してください。');
 const hours=(Date.parse(measuredAt)-Date.parse(job.publishedAt))/3600000;
 check(input.period!=='publication_48h' || hours>=48&&hours<=54,'48時間観測には公開後48〜54時間の実測値が必要です。');
 return {id:randomUUID(),metrics,measuredAt:new Date(measuredAt).toISOString(),period:input.period,source:'official-screen-manual',reference:str(input.reference,2000),elapsedHours:hours};
}
