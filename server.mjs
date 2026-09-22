import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {saveMedia,getMedia} from './lib/media.mjs';
import {Engine} from './lib/engine.mjs';
import {check,plain} from './lib/model.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const locationId=createHash('sha256').update(realpathSync(root)).digest('hex');
export async function createStudio({dataDir=process.env.RELAY_DATA_DIR??path.join(os.homedir(),'Library','Application Support','Relay Studio'),credentials,connectors,now,worker=true}={}) {
 const engine=await new Engine({dataDir,credentials,connectors,now}).init(),csrf=randomBytes(32).toString('hex');
 const send=(res,code,payload)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(payload));};
 const server=http.createServer(async(req,res)=>{try{
  check(/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host??''),'ローカル接続のみ利用できます。',403);
  const bridgeRequest=req.url?.startsWith('/api/bridge/'),pairedExtension=engine.state.browser?.extensionId;
  const extensionAllowed=bridgeRequest&&pairedExtension&&req.headers['x-relay-extension']===pairedExtension&&(!req.headers.origin||req.headers.origin===`chrome-extension://${pairedExtension}`)&&req.headers['x-studio-token']===csrf;
  check(extensionAllowed||!req.headers.origin||req.headers.origin===`http://${req.headers.host}`,'このアプリの画面から操作してください。',403);
  check(extensionAllowed||!['cross-site','same-site'].includes(req.headers['sec-fetch-site']),'外部サイトからの接続はできません。',403);
  const url=new URL(req.url,'http://localhost'),route=url.pathname,method=req.method;
  if(route==='/api/health'&&method==='GET')return send(res,200,{product:pkg.name,version:pkg.version,locationId});
  const mediaMatch=/^\/api\/media\/([a-f0-9-]{36})$/.exec(route);
  if(mediaMatch&&method==='GET'){const m=await getMedia(engine.dir,mediaMatch[1]);res.writeHead(200,{'content-type':m.type,'cache-control':'no-store','x-content-type-options':'nosniff'});return res.end(m.bytes);}
  if(route==='/api/state'&&method==='GET')return send(res,200,{...engine.snapshot(),csrf,worker:{intervalSeconds:15,active:worker}});
  if(route.startsWith('/api/')&&method==='POST'){
   check(req.headers['x-studio-token']===csrf,'画面を更新してから操作してください。',403);
   check(req.headers['content-type']?.split(';')[0]==='application/json','JSON形式が必要です。',415);
   let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;check(bytes<=(route==='/api/media'?16*1024*1024:1024*1024),'データが大きすぎます。',413);chunks.push(chunk);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{check(false,'入力データを読み取れません。');}check(plain(body),'入力データが必要です。');
   if(route==='/api/media')return send(res,200,await saveMedia(engine.dir,body));
   if(route==='/api/bridge/pair'){check(!extensionAllowed,'アプリの設定画面から接続してください。',403);return send(res,200,await engine.browser.pair(body));}
   const bridgeAction=/^\/api\/bridge\/(heartbeat|connect|claim|arm|result|feedbackWork|feedbackResult|media)$/.exec(route);
   if(bridgeAction){check(extensionAllowed,'接続済みの拡張機能から操作してください。',403);if(bridgeAction[1]==='media'){const m=await getMedia(engine.dir,body.id);return send(res,200,{base64:m.bytes.toString('base64'),mimeType:m.type,name:'image.'+(m.type==='image/jpeg'?'jpg':m.type.split('/')[1])});}return send(res,200,await engine.browser[bridgeAction[1]](body));}
   if(route==='/api/settings')return send(res,200,await engine.settings(body));
   if(route==='/api/drafts')return send(res,200,await engine.save(body));
   const c=/^\/api\/connections\/(facebook|threads|instagram|x|note|rednote)\/(connect|disconnect)$/.exec(route);
   if(c)return send(res,200,c[2]==='connect'?await engine.connect(c[1],body):await engine.disconnect(c[1]));
   const d=/^\/api\/drafts\/([a-f0-9-]+)\/queue$/.exec(route);if(d)return send(res,200,await engine.enqueue(d[1],body.revision,body.sendNow??false));
   const j=/^\/api\/jobs\/([a-f0-9-]+)\/(cancel|record|feedback|collectNow|reconcile|markDeleted)$/.exec(route);
   if(j)return send(res,200,await engine[j[2]](j[1],body));
  }
  if(method==='GET'&&['/','/index.html','/app.js','/styles.css','/catalog.js','/i18n.js','/messages-zh-TW.js','/favicon.svg','/bridge-client.js','/messages-bridge-zh-TW.js'].includes(route)){
   const file=route==='/'?'index.html':route.slice(1),body=await readFile(path.join(root,'public',file));res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});return res.end(body);
  }
  send(res,404,{error:'画面または操作が見つかりません。'});
 }catch(e){send(res,e.status??500,{error:e.status?e.message:'処理を完了できませんでした。保存状態を再読み込みして確認してください。'});}});
 let busy=false;
 const timer=worker?setInterval(async()=>{if(busy)return;busy=true;try{await engine.tick();}catch{console.error('配信巡回を完了できませんでした。データ保存先を確認してください。');}finally{busy=false;}},15000):null;timer?.unref();
 return {server,engine,close:async()=>{clearInterval(timer);await new Promise(r=>server.close(r));await engine.close();}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const app=await createStudio(),port=Number(process.env.PORT??8792);app.server.listen(port,'127.0.0.1',()=>console.log(`Relay Studio http://127.0.0.1:${port}`));for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await app.close();process.exit(0);});}
