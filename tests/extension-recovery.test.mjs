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
