import test from 'node:test';
import assert from 'node:assert/strict';

test('service worker recovery reports uncertainty and never opens a publish tab or executes a script',async t=>{
 const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch,requests=[];let removed=false,scriptCalls=0,tabCalls=0;
 globalThis.chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.2.0'}),onMessage:{addListener(){}}},storage:{session:{get:async()=>({session:{origin:'http://127.0.0.1:8792',csrf:'b'.repeat(64)}})},local:{get:async()=>({active:{kind:'publish',jobId:'interrupted',lease:'old'}}),remove:async()=>{removed=true;}}},scripting:{executeScript:async()=>{scriptCalls++;}},tabs:{create:async()=>{tabCalls++;}},alarms:{onAlarm:{addListener(){}}},action:{onClicked:{addListener(){}}}};
 globalThis.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({status:'unknown'})};};
 t.after(()=>{globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;});
 await import('../extension/background.js');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith('/result'));assert.equal(requests[0].body.outcome,'unknown');assert.equal(scriptCalls,0);assert.equal(tabCalls,0);assert.ok(removed);
});
test('identity timeout closes its tab and cannot save an account or start publication',async t=>{
 const previous={chrome:globalThis.chrome,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};let listener;const closed=[],requests=[];
 globalThis.chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.2.0'}),onMessage:{addListener(fn){listener=fn;}}},storage:{local:{get:async()=>({})},session:{get:async()=>({session:{origin:'http://127.0.0.1:8792',csrf:'b'.repeat(64)}})}},tabs:{create:async()=>({id:71}),get:async()=>({url:'https://creator.rednote.com/new/note-manager',status:'complete'}),remove:async id=>closed.push(id)},scripting:{executeScript:()=>new Promise(()=>{})},alarms:{onAlarm:{addListener(){}}},action:{onClicked:{addListener(){}}}};
 globalThis.fetch=async url=>{requests.push(url);return {ok:true,json:async()=>({})};};
 globalThis.setTimeout=fn=>{queueMicrotask(fn);return 1;};globalThis.clearTimeout=()=>{};
 t.after(()=>Object.assign(globalThis,previous));
 await import('../extension/background.js?identity-timeout');
 const result=await new Promise(resolve=>listener({action:'connect',payload:{platform:'rednote',accountId:'12345'}},{id:'a'.repeat(32),frameId:0,url:'http://127.0.0.1:8792/#settings'},resolve));
 assert.ok(result.error);assert.deepEqual(closed,[71]);assert.equal(requests.length,0);
});
