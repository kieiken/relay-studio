import {randomBytes,createHash} from 'node:crypto';
import {check,postText,observation} from './model.mjs';
export const browserPlatforms=['x','note','rednote'];
const normalize=v=>String(v??'').replace(/\r\n?/g,'\n').replace(/\s+/g,' ').trim();
export function validAccount(platform,id){return typeof id==='string'&&(platform==='x'?/^[A-Za-z0-9_]{1,15}$/:platform==='note'?/^[A-Za-z0-9_-]{1,64}$/:/^\d{1,24}$/).test(id);}
export function verifyBrowserEvidence(job,input,now){
 check(input&&input.accountId===job.accountId,'投稿アカウントの照合が一致しません。',409);
 let url;try{url=new URL(input.permalink);}catch{check(false,'公開URLを照合できません。',409);}const m=job.platform==='x'?/^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,24})$/.exec(url.pathname):job.platform==='note'?/^\/([A-Za-z0-9_-]+)\/n\/(n[0-9a-f]+)$/.exec(url.pathname):/^\/(?:explore|discovery\/item)\/([a-z0-9]{16,64})$/i.exec(url.pathname);
 const hosts={x:['x.com'],note:['note.com'],rednote:['www.rednote.com']};
 check(url.protocol==='https:'&&!url.username&&!url.password&&hosts[job.platform].includes(url.hostname)&&m,'公開URLを照合できません。',409);
 if(job.platform==='rednote')check(job.profileId&&input.profileId===job.profileId,'投稿アカウントの照合が一致しません。',409);
 if(job.platform!=='rednote')check(m[1].toLowerCase()===job.accountId.toLowerCase(),'公開URLのアカウントが一致しません。',409);
 check(normalize(input.body)===normalize(postText(job.content)),'公開本文の全文照合が一致しません。',409);
 if(job.platform!=='x')check(normalize(input.title)===normalize(job.content.title),'公開タイトルの照合が一致しません。',409);
 const at=Date.parse(input.publishedAt),started=Date.parse(job.attemptAt??job.createdAt);
 check(Number.isFinite(at)&&at<=now.getTime()+60000&&at>=started-120000,'公開日時を照合できません。',409);
 return {permalink:url.href,remoteId:job.platform==='rednote'?m[1]:m[2],publishedAt:new Date(at).toISOString(),...(job.platform==='rednote'?{timePrecision:'minute',timeSource:'creator-visible-time'}:{}),verifiedBy:'browser-visible-content'};
}
export class BrowserBridge {
 constructor(engine){this.e=engine;}
 get state(){return this.e.state.browser??={extensionId:null,lastSeenAt:null};}
 async pair(input){return this.e.exclusive(async()=>{
  check(/^[a-p]{32}$/.test(input.extensionId??''),'拡張機能IDが正しくありません。');
  check(!this.e.state.jobs.some(j=>j.transport==='browser'&&j.status==='sending'),'ブラウザ投稿の処理中は接続を変更できません。',409);
  if(this.state.extensionId!==input.extensionId){for(const id of browserPlatforms)delete this.e.state.connections[id];}
  Object.assign(this.state,{extensionId:input.extensionId,lastSeenAt:null,version:null});await this.e.persist();return this.e.snapshot();
 });}
 async heartbeat(input){return this.e.exclusive(async()=>{check(typeof input.version==='string'&&input.version.length<30,'拡張機能のバージョンを確認してください。');Object.assign(this.state,{lastSeenAt:this.e.now().toISOString(),version:input.version});await this.expireInside();await this.e.persist();return {paused:this.e.state.settings.paused};});}
 async connect(input){return this.e.exclusive(async()=>{
  check(browserPlatforms.includes(input.platform)&&validAccount(input.platform,input.accountId),'アカウントIDを確認してください。');
  check(!this.e.state.jobs.some(j=>j.platform===input.platform&&['queued','sending','unknown'].includes(j.status)),'予約・未確認の結果を先に整理してください。',409);
  check(input.observedAccountId===input.accountId&&input.verified===true,'ログイン中のアカウントと入力IDが一致しません。',409);
  if(input.platform==='rednote')check(/^[a-f0-9]{24}$/.test(input.profileId??''),'投稿アカウントの照合が一致しません。',409);
  this.e.state.connections[input.platform]={...(input.platform==='rednote'?{profileId:input.profileId}:{}),transport:'browser',accountId:input.accountId,name:String(input.name||input.accountId).slice(0,100),verifiedAt:this.e.now().toISOString()};await this.e.persist();return {connected:true};
 });}
 releaseFeedback(j){if(j.feedbackOnRequest){if(j.feedbackPrevious)j.feedbackAttempt=j.feedbackPrevious;else delete j.feedbackAttempt;}delete j.feedbackPrevious;delete j.feedbackOnRequest;delete j.feedbackLease;delete j.feedbackLeaseUntil;}
 async expireInside(){for(const j of this.e.state.jobs){if(j.feedbackAttempt==='collecting'&&j.feedbackLeaseUntil&&Date.parse(j.feedbackLeaseUntil)<+this.e.now()){j.feedbackAttempt='unavailable';j.feedbackError='反響取得が中断しました。';this.releaseFeedback(j);}}for(const j of this.e.state.jobs){if(j.transport==='browser'&&j.status==='sending'&&Date.parse(j.leaseUntil)<this.e.now().getTime()){j.status='unknown';j.reason='拡張機能の処理が中断しました。公式画面で照合してください。自動再送はしません。';delete j.lease;}}}
 async claim(){return this.e.exclusive(async()=>{
  await this.expireInside();const now=this.e.now();
  if(this.e.state.settings.paused||this.e.state.jobs.some(j=>j.transport==='browser'&&j.status==='sending')){await this.e.persist();return null;}
  const j=this.e.state.jobs.find(j=>j.transport==='browser'&&j.status==='queued'&&Date.parse(j.scheduledAt)<=now.getTime());if(!j){await this.e.persist();return null;}
  if(now-Date.parse(j.scheduledAt)>15*60000){j.status='failed';j.reason='予定時刻から15分以上経過したため停止しました。';await this.e.persist();return null;}
  const c=this.e.state.connections[j.platform];check(c?.verifiedAt&&c.accountId===j.accountId,'接続アカウントを確認してください。',409);
  Object.assign(j,{status:'sending',phase:'preparing',attemptAt:now.toISOString(),leaseUntil:new Date(+now+4*60000).toISOString(),lease:randomBytes(24).toString('hex')});
  j.contentHash=createHash('sha256').update(JSON.stringify(j.content)).digest('hex');await this.e.persist();return structuredClone(j);
 });}
 job(input){const j=this.e.job(input.jobId);check(j.transport==='browser'&&j.status==='sending'&&input.lease===j.lease&&Date.parse(j.leaseUntil)>=this.e.now().getTime(),'ブラウザ投稿の実行権限が失効しました。再送せず結果を照合してください。',409);return j;}
 async arm(input){return this.e.exclusive(async()=>{const j=this.job(input);check(!this.e.state.settings.paused,'自動実行は一時停止中です。',409);check(j.phase==='preparing'&&input.accountId===j.accountId&&input.contentHash===j.contentHash,'公開直前の照合が一致しません。',409);j.phase='final-click';j.finalClickAuthorizedAt=this.e.now().toISOString();j.leaseUntil=new Date(+this.e.now()+4*60000).toISOString();await this.e.persist();return {allowed:true};});}
 async result(input){return this.e.exclusive(async()=>{
  const j=this.job(input);
  if(input.outcome==='published'){check(j.phase==='final-click','公開操作の記録がありません。',409);Object.assign(j,verifyBrowserEvidence(j,input.evidence,this.e.now()),{status:'published',reason:null});}
  else{check(['failed','unknown'].includes(input.outcome),'投稿結果の形式が正しくありません。');j.status=j.phase==='final-click'?'unknown':input.outcome;j.reason=String(input.error??'公式画面で確認してください。').slice(0,500);}
  delete j.lease;await this.e.persist();return {status:j.status};
 });}
 async feedbackWork(){return this.e.exclusive(async()=>{
  if(this.e.state.settings.paused)return null;
  const j=this.e.state.jobs.find(j=>j.transport==='browser'&&j.status==='published'&&j.feedbackAttempt!=='collecting'&&(j.feedbackRequestedAt||!j.feedbackAttempt&&+this.e.now()-Date.parse(j.publishedAt)>=48*3600000+(j.timePrecision==='minute'?60000:0)));
  if(!j)return null;j.feedbackPrevious=j.feedbackAttempt??null;j.feedbackOnRequest=!!j.feedbackRequestedAt;delete j.feedbackRequestedAt;j.feedbackAttempt='collecting';j.feedbackLeaseUntil=new Date(+this.e.now()+4*60000).toISOString();j.feedbackLease=randomBytes(24).toString('hex');await this.e.persist();return structuredClone(j);
 });}
 async feedbackResult(input){return this.e.exclusive(async()=>{
  const j=this.e.job(input.jobId);check(j.feedbackAttempt==='collecting'&&input.lease===j.feedbackLease&&Date.parse(j.feedbackLeaseUntil)>=+this.e.now(),'反響取得の実行権限が失効しました。',409);
  if(input.evidence){check(input.evidence.accountId===j.accountId&&input.evidence.permalink===j.permalink,'反響取得先が一致しません。');const at=this.e.now();const o=observation({metrics:input.metrics,measuredAt:at.toISOString(),period:at-Date.parse(j.publishedAt)>=48*3600000+(j.timePrecision==='minute'?60000:0)&&(at-Date.parse(j.publishedAt))/3600000<=54?'publication_48h':'current_lifetime',reference:j.permalink},j,at);o.source='browser-visible-content';j.observations.push(o);j.feedbackAttempt='collected';}
  else{j.feedbackAttempt='unavailable';j.feedbackError=String(input.error||'公式画面から取得できませんでした。').slice(0,500);}
  this.releaseFeedback(j);await this.e.persist();return {status:'finished'};
 });}
}
