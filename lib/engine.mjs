import {mkdir,readFile,writeFile,rename,open,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {platforms} from '../public/catalog.js';
import {check,ids,normalizeDraft,readiness,effective,observation,https} from './model.mjs';
import {getMedia} from './media.mjs';
import {BrowserBridge} from './browser-bridge.mjs';
import {Keychain} from './keychain.mjs';
import {Connectors} from './connectors.mjs';
export class Engine {
 constructor({dataDir,credentials,connectors=new Connectors(),now=()=>new Date()}={}) {this.dir=dataDir;this.file=path.join(dataDir,'studio.json');this.credentials=credentials;this.connectors=connectors;this.now=now;this.tail=Promise.resolve();this.browser=new BrowserBridge(this);}
 async init(){
  await mkdir(this.dir,{recursive:true,mode:0o700});
  try{this.lock=await open(path.join(this.dir,'instance.lock'),'wx',0o600);await this.lock.writeFile(String(process.pid));}catch(e){if(e.code!=='EEXIST')throw e;let pid=Number(await readFile(path.join(this.dir,'instance.lock'),'utf8'));try{process.kill(pid,0);}catch(err){if(err.code==='ESRCH'){await rm(path.join(this.dir,'instance.lock'));return this.init();}}throw new Error('同じデータフォルダを使うスタジオが起動中です。');}
  try{this.state=JSON.parse(await readFile(this.file,'utf8'));check(this.state.version===1,'データのバージョンが対応していません。',500);}catch(e){if(e.code!=='ENOENT')throw e;this.state={version:1,instance:randomUUID(),settings:{onboarded:false,defaults:[...ids],timezone:'Asia/Tokyo',paused:false},connections:{},drafts:[],jobs:[]};}
  this.credentials??=new Keychain(this.state.instance);
  for(const j of this.state.jobs){if(j.status==='sending'){j.status='unknown';j.reason='送信中にアプリが終了しました。公開先を照合してください。';}if(j.feedbackAttempt==='collecting'){j.feedbackAttempt='unavailable';j.feedbackError='取得処理が中断しました。公式画面で確認してください。';this.browser.releaseFeedback(j);}}
  await this.persist();return this;
 }
 async close(){await this.tail;await this.lock?.close();await rm(path.join(this.dir,'instance.lock'),{force:true});}
 async persist(){const tmp=this.file+'.tmp';await writeFile(tmp,JSON.stringify(this.state,null,2)+'\n',{mode:0o600});await rename(tmp,this.file);}
 async exclusive(fn){const task=this.tail.then(fn);this.tail=task.catch(()=>{});return task;}
 snapshot(){return structuredClone(this.state);}
 async settings(input){return this.exclusive(async()=>{check(Array.isArray(input.defaults)&&input.defaults.every(v=>ids.includes(v))&&new Set(input.defaults).size===input.defaults.length,'投稿先を確認してください。');check(typeof input.paused==='boolean'&&typeof input.onboarded==='boolean','設定の形式が正しくありません。');check(typeof input.timezone==='string','タイムゾーンを指定してください。');try{new Intl.DateTimeFormat('ja',{timeZone:input.timezone});}catch{check(false,'タイムゾーンが正しくありません。');}this.state.settings={defaults:input.defaults,paused:input.paused,onboarded:input.onboarded,timezone:input.timezone};await this.persist();return this.snapshot();});}
 async connect(id,input){return this.exclusive(async()=>{check(platforms.find(p=>p.id===id)?.auto,'この媒体は公式画面を使います。');check(typeof input.accountId==='string'&&/^\d{1,40}$/.test(input.accountId),'数字のアカウントIDを入力してください。');
  check(!this.state.jobs.some(j=>j.platform===id&&['queued','sending','unknown'].includes(j.status)),'この媒体の予約・未確認の結果を先に整理してください。',409);
  if(input.token){await this.credentials.set(id,input.token);this.state.connections[id]={accountId:input.accountId,stored:true,verifiedAt:null};await this.persist();}
  const c=this.state.connections[id];check(c?.stored&&c.accountId===input.accountId,'キーを入力して保存してください。');c.verifiedAt=null;await this.persist();
  try{const profile=await this.connectors.verify(id,input.accountId,await this.credentials.get(id));Object.assign(c,{name:profile.name,verifiedAt:this.now().toISOString(),error:null});}catch{c.error='接続できません。ID・トークン・有効期限・権限を確認してください。';await this.persist();check(false,c.error,422);}
  await this.persist();return this.snapshot();});}
 async disconnect(id){return this.exclusive(async()=>{check(ids.includes(id),'媒体が不正です。');check(!this.state.jobs.some(j=>j.platform===id&&['queued','sending','unknown'].includes(j.status)),'予約を取り消し、未確認の結果を整理してから接続解除してください。',409);if(!platforms.find(p=>p.id===id)?.browser)await this.credentials.delete(id);delete this.state.connections[id];await this.persist();return this.snapshot();});}
 async save(input){return this.exclusive(async()=>{const prev=input.id?this.state.drafts.find(d=>d.id===input.id):null;check(!input.id||prev,'下書きが見つかりません。',404);if(prev)check(input.revision===prev.revision,'別の画面で更新されました。一覧から開き直してください。',409);const draft=normalizeDraft(input,prev);this.state.drafts=this.state.drafts.filter(d=>d.id!==draft.id);this.state.drafts.unshift(draft);await this.persist();return draft;});}
 async enqueue(id,revision,sendNow=false){return this.exclusive(async()=>{const d=this.state.drafts.find(d=>d.id===id);check(d&&d.revision===revision,'最新の下書きを保存してから登録してください。',409);check(d.selected.length>0,'投稿先を一つ以上選択してください。');if(d.selected.some(p=>platforms.find(v=>v.id===p).browser))check(this.state.browser?.extensionId&&this.now()-Date.parse(this.state.browser.lastSeenAt)<90000,'Chrome拡張を接続してください。',409);const ready=readiness(d,this.state.connections);check(ready.every(r=>!r.issues.length),'投稿先ごとの要対応項目を解消してください。',409);check(typeof sendNow==='boolean','投稿方法が正しくありません。');
  if(sendNow)check(!this.state.settings.paused||d.selected.every(p=>!platforms.find(v=>v.id===p).auto&&!platforms.find(v=>v.id===p).browser),'自動実行を再開してから今すぐ投稿してください。',409);
  else check(d.scheduledAt&&Date.parse(d.scheduledAt)>this.now().getTime(),'未来の配信時刻を選択してください。');
  const scheduledAt=sendNow?this.now().toISOString():d.scheduledAt;
  check(!this.state.jobs.some(j=>j.draftId===id&&!['cancelled'].includes(j.status)),'この原稿はすでに登録されています。配信一覧から確認してください。',409);
  for(const platform of d.selected){const c=effective(d,platform);if(c.attachmentId)await getMedia(this.dir,c.attachmentId);}
  const jobs=d.selected.map(p=>({id:randomUUID(),draftId:id,revision,platform:p,content:structuredClone(effective(d,p)),accountId:this.state.connections[p]?.accountId??null,...(this.state.connections[p]?.profileId?{profileId:this.state.connections[p].profileId}:{}),scheduledAt,transport:platforms.find(v=>v.id===p).browser?'browser':'api',status:'queued',createdAt:this.now().toISOString(),observations:[]}));this.state.jobs.push(...jobs);await this.persist();return jobs;});}
 async cancel(id){return this.exclusive(async()=>{const j=this.job(id);check(['queued','manual','failed'].includes(j.status),'この状態では取り消せません。公開先の確認が必要です。',409);j.status='cancelled';await this.persist();return this.snapshot();});}
 job(id){const j=this.state.jobs.find(j=>j.id===id);check(j,'配信記録が見つかりません。',404);return j;}
 async record(id,input){return this.exclusive(async()=>{const j=this.job(id);check(['manual','unknown'].includes(j.status),'公開結果を記録できる状態ではありません。',409);check(https(input.permalink),'公開URLを入力してください。');const u=new URL(input.permalink),domains={facebook:['facebook.com'],threads:['threads.net','threads.com'],instagram:['instagram.com'],x:['x.com','twitter.com'],note:['note.com'],rednote:['rednote.com','xiaohongshu.com','xhslink.com']};check(domains[j.platform].some(d=>u.hostname===d||u.hostname.endsWith('.'+d))&&u.pathname!=='/','投稿先に一致する公開URLを入力してください。');check(Number.isFinite(Date.parse(input.publishedAt))&&Date.parse(input.publishedAt)<=this.now().getTime(),'実際の公開日時を入力してください。');check(input.confirmed===true,'本文・アカウント・URLの照合を確認してください。');Object.assign(j,{status:'published',permalink:input.permalink,publishedAt:new Date(input.publishedAt).toISOString(),verifiedBy:'user',reason:null});await this.persist();return this.snapshot();});}
 async markDeleted(id,input){return this.exclusive(async()=>{const j=this.job(id);check(j.status==='published','公開済みの投稿に記録してください。',409);check(j.feedbackAttempt!=='collecting','反響取得中です。',409);check(input.confirmed===true&&input.permalink===j.permalink,'公式画面で削除済みの投稿URLを確認してください。');j.status='deleted';j.deletedAt=this.now().toISOString();j.deletionVerifiedBy='user';delete j.feedbackRequestedAt;await this.persist();return this.snapshot();});}
 async feedback(id,input){return this.exclusive(async()=>{const j=this.job(id);check(j.status==='published','公開済みの投稿に記録してください。',409);j.observations.push(observation(input,j,this.now()));await this.persist();return this.snapshot();});}
 async collectNow(id){return this.exclusive(async()=>{const j=this.job(id);check(j.status==='published','公開済みの投稿に記録してください。',409);check(platforms.find(p=>p.id===j.platform)?.auto||j.transport==='browser','公式画面で確認してください。',409);check(j.feedbackAttempt!=='collecting','反響取得中です。',409);
  if(j.transport==='browser'){check(this.state.browser?.lastSeenAt&&+this.now()-Date.parse(this.state.browser.lastSeenAt)<90000,'Chrome拡張を接続してください。',409);j.feedbackRequestedAt=this.now().toISOString();await this.persist();return this.snapshot();}
  const r=await this.connectors.collect(j,await this.credentials.get(j.platform)),at=this.now(),hours=(at-Date.parse(j.publishedAt))/3600000;j.feedbackError=r.errors.join(' ');if(Object.keys(r.metrics).length)j.observations.push({id:randomUUID(),metrics:r.metrics,source:'official-api',reference:j.permalink,measuredAt:at.toISOString(),elapsedHours:hours,period:hours>=48&&hours<=54?'publication_48h':'current_lifetime'});else j.feedbackError||='公式画面から取得できませんでした。';await this.persist();return this.snapshot();
 });}
 async reconcile(id){return this.exclusive(async()=>{const j=this.job(id);check(j.transport!=='browser'&&j.status==='unknown'&&j.remoteId,'自動照合には公開先IDが必要です。公式画面で確認してください。',409);const r=await this.connectors.inspect(j,await this.credentials.get(j.platform));Object.assign(j,r,{status:'published',verifiedBy:'official-api',reason:null});await this.persist();return this.snapshot();});}
 async tick(){return this.exclusive(async()=>{await this.browser.expireInside();for(const j of this.state.jobs){if(j.transport==='browser'&&j.status==='queued'&&+this.now()-Date.parse(j.scheduledAt)>15*60000){j.status='failed';j.reason='Chrome拡張が予定時刻に接続できなかったため停止しました。';}}await this.persist();if(this.state.settings.paused)return;
  for(const j of this.state.jobs.filter(j=>j.status==='queued'&&j.transport!=='browser'&&Date.parse(j.scheduledAt)<=this.now().getTime()).slice(0,6)){
   if(this.now().getTime()-Date.parse(j.scheduledAt)>15*60000){j.status='failed';j.reason='予定から15分以上経過しました。自動で追い付き配信せず停止しました。';await this.persist();continue;}
   const c=this.state.connections[j.platform];if(!c?.verifiedAt||c.accountId!==j.accountId){j.status='failed';j.reason='接続先を確認してください。';await this.persist();continue;}
   let token;try{token=await this.credentials.get(j.platform);}catch{j.status='failed';j.reason='キーチェーンを読み出せませんでした。';await this.persist();continue;}
   j.status='sending';j.attemptAt=this.now().toISOString();await this.persist();
   try{const r=await this.connectors.publish(j,token,async remoteId=>{j.remoteId=remoteId;await this.persist();});Object.assign(j,r,{status:'published',verifiedBy:'official-api'});}catch(e){j.status=e.result_unknown||j.remoteId||!e.code?'unknown':'failed';j.reason=j.status==='unknown'?'送信結果の照合が必要です。再送は行いません。':'配信を停止しました。アカウントの権限・接続・素材を確認してください。';j.errorCode=e.code??'UNVERIFIED_RESULT';}await this.persist();
  }
  for(const j of this.state.jobs.filter(j=>j.status==='published'&&j.remoteId&&platforms.find(p=>p.id===j.platform)?.auto&&!j.feedbackAttempt&&this.now().getTime()-Date.parse(j.publishedAt)>=48*3600000).slice(0,6)){
   j.feedbackAttempt='collecting';await this.persist();
   try{const r=await this.connectors.collect(j,await this.credentials.get(j.platform)),at=this.now(),hours=(at-Date.parse(j.publishedAt))/3600000;j.feedbackAttempt=Object.keys(r.metrics).length?'collected':'unavailable';j.feedbackError=r.errors.join(' ');if(Object.keys(r.metrics).length)j.observations.push({id:randomUUID(),metrics:r.metrics,source:'official-api',reference:j.permalink,measuredAt:at.toISOString(),elapsedHours:hours,period:hours<=54?'publication_48h':'current_lifetime'});}catch{j.feedbackAttempt='unavailable';j.feedbackError='自動取得できませんでした。公式画面から記録してください。';}await this.persist();
  }
 });}
}
