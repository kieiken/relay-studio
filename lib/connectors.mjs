import {createFacebookLiveAdapter,fetchFacebookPageIdentity,fetchFacebookPost} from '../live/facebook.mjs';
import {createThreadsLiveAdapter,fetchThreadsProfile,fetchThreadsPost} from '../live/threads.mjs';
import {createInstagramLiveAdapter,fetchInstagramProfile,fetchInstagramMedia} from '../live/instagram.mjs';
import {check,postText} from './model.mjs';
import {metricKeys} from '../public/catalog.js';
export class Connectors {
 constructor({fetch:fetchImpl=globalThis.fetch}={}){this.fetch=fetchImpl;}
 config(platform,account,token){return {access_token:token,...(platform==='facebook'?{page_id:account}:platform==='threads'?{threads_user_id:account,graph_base_url:'https://graph.threads.com'}:{ig_user_id:account,graph_base_url:'https://graph.instagram.com/v26.0'})};}
 async verify(platform,account,token){
  const options={fetch:this.fetch,config:this.config(platform,account,token)};
  const profile=await ({facebook:fetchFacebookPageIdentity,threads:fetchThreadsProfile,instagram:fetchInstagramProfile}[platform])(options);
  check([profile.id,profile.user_id].map(String).includes(account),'設定したIDと接続先アカウントが一致しません。',409);
  return {id:account,name:String(profile.name||profile.username||profile.id)};
 }
 async inspect(job,token){
  const p=job.platform,options={fetch:this.fetch,config:this.config(p,job.accountId,token)};
  const r=await ({facebook:fetchFacebookPost,threads:fetchThreadsPost,instagram:fetchInstagramMedia}[p])(job.remoteId,options);
  check((r.message??r.text??r.caption)===postText(job.content),'公開本文の照合が完了しませんでした。',409);
  const at=r.created_time??r.timestamp; check(Number.isFinite(Date.parse(at)),'実公開日時を取得できませんでした。',409);
  const permalink=r.permalink_url??r.permalink;
  check(typeof permalink==='string'&&permalink.startsWith('https://'),'公開URLを取得できませんでした。',409);
  return {remoteId:job.remoteId,permalink,publishedAt:new Date(at).toISOString()};
 }
 async publish(job,token,onRemote){
  const p=job.platform,config=this.config(p,job.accountId,token);
  // Verify the target account immediately before any publish request.
  await this.verify(p,job.accountId,token);
  const adapter=({facebook:createFacebookLiveAdapter,threads:createThreadsLiveAdapter,instagram:createInstagramLiveAdapter}[p])({fetch:this.fetch,config,pollIntervalMs:3000,maxPollAttempts:5});
  const r=await adapter.publish({body:postText(job.content),media_url:job.content.mediaUrl,media:[]});
  await onRemote(r.remote_id);
  return this.inspect({...job,remoteId:r.remote_id},token);
 }
 async collect(job,token){
  const p=job.platform,config=this.config(p,job.accountId,token);
  await this.verify(p,job.accountId,token);
  const base=config.graph_base_url??'https://graph.facebook.com/v26.0',id=encodeURIComponent(job.remoteId),metrics={},errors=[];
  const get=async path=>{const r=await this.fetch(`${base}/${path}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000),redirect:'error'}); check(r.ok,`反響APIの取得に失敗しました（HTTP ${r.status}）。`,502); const b=await r.json();check(!b.error,'反響の権限または取得項目を確認してください。',502);return b;};
  const put=(k,v)=>{if(metricKeys[p].includes(k)&&Number.isSafeInteger(v)&&v>=0)metrics[k]=v;};
  const attempt=async f=>{try{await f();}catch(e){errors.push(e.status?e.message:'反響APIに接続できませんでした。');}};
  if(p==='facebook') {
   await attempt(async()=>{const r=await get(`${id}?fields=reactions.limit(0).summary(true),comments.limit(0).summary(true),shares`);put('likes',r.reactions?.summary?.total_count);put('comments',r.comments?.summary?.total_count);put('shares',r.shares?.count);});
   await attempt(async()=>{const r=await get(`${id}/insights?metric=post_media_view`);for(const row of r.data??[])put('views',row.values?.[0]?.value);});
  } else await attempt(async()=>{const names=p==='threads'?'views,likes,replies,reposts,quotes,shares':'views,reach,likes,comments,saved,shares';const r=await get(`${id}/insights?metric=${names}`);for(const row of r.data??[])put(row.name,row.values?.[0]?.value??row.total_value?.value);});
  return {metrics,errors};
 }
}
