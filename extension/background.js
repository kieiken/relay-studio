import {uploadNoteCover} from './note-cover.js';
import {pageOperation} from './page-operation.js';
import {allowedURL,localOrigin} from './protocol.js';
const version=chrome.runtime.getManifest().version;
let busy=false;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function session(){const {session}=await chrome.storage.session.get('session');if(!session)throw Error('Relay Studio の設定画面で拡張機能を接続してください。');return session;}
async function api(action,body={}){const s=await session();const r=await fetch(s.origin+'/api/bridge/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':s.csrf,'X-Relay-Extension':chrome.runtime.id},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
async function operation(tabId,platform,action,payload={}){
 const tab=await chrome.tabs.get(tabId);if(!allowedURL(platform,tab.url))throw Error('公式画面以外へ移動したため停止しました。');
 const results=await chrome.scripting.executeScript({target:{tabId},func:pageOperation,args:[platform,action,payload]});
 const result=results[0]?.result;if(!result||result.error)throw Error(result?.error||'画面から結果を取得できませんでした。');return result;
}
async function ready(tabId,platform){for(let n=0;n<40;n++){const tab=await chrome.tabs.get(tabId);if(tab.status==='complete'){if(!allowedURL(platform,tab.url))throw Error('公式画面を確認してください。');return;}await delay(500);}throw Error('公式画面の読み込みが完了しませんでした。');}
const home={x:'https://x.com/home',note:'https://note.com/',rednote:'https://creator.rednote.com/'};
async function identity(platform,accountId){if(!home[platform])throw Error('投稿先を確認してください。');const tab=await chrome.tabs.create({url:home[platform],active:false});try{await ready(tab.id,platform);return await operation(tab.id,platform,'identity',{accountId});}finally{await chrome.tabs.remove(tab.id).catch(()=>{});}}
async function recover(){const {active}=await chrome.storage.local.get('active');if(!active)return;try{await api(active.kind==='feedback'?'feedbackResult':'result',{jobId:active.jobId,lease:active.lease,outcome:'unknown',error:'拡張機能が再起動しました。再送せず公式画面で照合してください。'});}finally{await chrome.storage.local.remove('active');}}
const recovered=recover().catch(()=>{});
async function publish(job){
 let tab;
 // This record survives service-worker termination. Recovery never repeats the final click.
 await chrome.storage.local.set({active:{kind:'publish',jobId:job.id,lease:job.lease}});
 try{
  await identity(job.platform,job.accountId);
  tab=await chrome.tabs.create({url:home[job.platform],active:false});await ready(tab.id,job.platform);
  if(job.platform==='note'){const r=await operation(tab.id,'note','new');await chrome.tabs.update(tab.id,{url:r.url});await ready(tab.id,'note');}
  if(job.platform==='rednote'){await chrome.tabs.update(tab.id,{url:'https://creator.rednote.com/publish/publish'});await ready(tab.id,'rednote');}
  const media=job.content.attachmentId?await api('media',{id:job.content.attachmentId}):null;
  await operation(tab.id,job.platform,'prepare',{content:job.content,media,accountId:job.accountId});
  if(media&&job.platform==='note'){const r=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:uploadNoteCover,args:[media]});if(!r[0]?.result?.uploaded)throw Error(r[0]?.result?.error||'note画像を確認できませんでした。');}
  // Account identity is re-read immediately before authorizing the final operation.
  await identity(job.platform,job.accountId);
  await operation(tab.id,job.platform,'check',{content:job.content,accountId:job.accountId});
  await api('arm',{jobId:job.id,lease:job.lease,accountId:job.accountId,contentHash:job.contentHash});
  let submitted;try{submitted=await operation(tab.id,job.platform,'submit',{accountId:job.accountId,content:job.content});}catch{await ready(tab.id,job.platform);submitted=await operation(tab.id,job.platform,'publishedURL',{accountId:job.accountId});}
  if(!allowedURL(job.platform,submitted.url))throw Error('公開URLを照合できませんでした。');
  await chrome.tabs.update(tab.id,{url:submitted.url});await ready(tab.id,job.platform);
  const evidence=await operation(tab.id,job.platform,'inspect',{content:job.content,accountId:job.accountId,permalink:submitted.url});
  await api('result',{jobId:job.id,lease:job.lease,outcome:'published',evidence});
 }catch(e){await api('result',{jobId:job.id,lease:job.lease,outcome:'failed',error:e.message}).catch(()=>{});}
 finally{await chrome.storage.local.remove('active');}
}
async function feedback(job){
 await chrome.storage.local.set({active:{kind:'feedback',jobId:job.id,lease:job.feedbackLease}});let tab;
 try{await identity(job.platform,job.accountId);tab=await chrome.tabs.create({url:job.permalink,active:false});await ready(tab.id,job.platform);const result=await operation(tab.id,job.platform,'feedback',{accountId:job.accountId,permalink:job.permalink,remoteId:job.remoteId});await api('feedbackResult',{jobId:job.id,lease:job.feedbackLease,...result});}
 catch(e){await api('feedbackResult',{jobId:job.id,lease:job.feedbackLease,error:e.message}).catch(()=>{});}
 finally{await chrome.storage.local.remove('active');if(tab)await chrome.tabs.remove(tab.id).catch(()=>{});}
}
async function wake(){if(busy){await api('heartbeat',{version}).catch(()=>{});return;}busy=true;try{await recovered;const h=await api('heartbeat',{version});if(h.paused)return;for(let i=0;i<6;i++){const j=await api('claim');if(!j)break;await publish(j);}const f=await api('feedbackWork');if(f)await feedback(f);}catch{/* Local app offline: do not replay any operation. */}finally{busy=false;}}
chrome.runtime.onMessage.addListener((m,sender,respond)=>{
 if(!localOrigin(sender.url)||sender.frameId!==0||sender.id!==chrome.runtime.id)return false;
 (async()=>{
  if(m.action==='ping')return {extensionId:chrome.runtime.id,version};
  if(m.action==='pair'){if(!/^[a-f0-9]{64}$/.test(m.payload?.csrf??''))throw Error('アプリを更新してください。');await chrome.storage.session.set({session:{origin:new URL(sender.url).origin,csrf:m.payload.csrf}});await api('heartbeat',{version});await chrome.alarms.create('relay',{periodInMinutes:1});return {connected:true};}
  if(m.action==='connect'){if(busy)throw Error('投稿処理が終わってから接続してください。');busy=true;try{const observed=await identity(m.payload.platform,m.payload.accountId);return await api('connect',{...m.payload,observedAccountId:observed.accountId,name:observed.name,verified:true});}finally{busy=false;}}
  if(m.action==='wake'){void wake();return {accepted:true};}
  throw Error('未対応の操作です。');
 })().then(value=>respond({value}),e=>respond({error:e.message}));return true;
});
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='relay')void wake();});
chrome.action.onClicked.addListener(()=>chrome.tabs.create({url:'http://127.0.0.1:8792/#settings'}));
