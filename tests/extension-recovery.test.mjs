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
test('RedNote identity waits for login, navigates in the worker, then inspects the new document',async t=>{
 const previous={chrome:globalThis.chrome,fetch:globalThis.fetch},events=[],tabs=new Map();let listener,nextId=0,saved;
 const profileId='a'.repeat(24),remoteId='b'.repeat(24),publicURL='https://www.rednote.com/discovery/item/'+remoteId;
 globalThis.chrome={runtime:{id:'a'.repeat(32),getManifest:()=>({version:'0.2.0'}),onMessage:{addListener(fn){listener=fn;}}},storage:{local:{get:async()=>({})},session:{get:async()=>({session:{origin:'http://127.0.0.1:8792',csrf:'b'.repeat(64)}})}},tabs:{create:async opts=>{const tab={id:++nextId,url:opts.url,status:'complete'};tabs.set(tab.id,tab);return tab;},get:async id=>tabs.get(id),update:async(id,opts)=>{events.push('navigate:'+opts.url);Object.assign(tabs.get(id),opts);},remove:async id=>{tabs.delete(id);}},scripting:{executeScript:async opts=>{
  if(opts.world==='MAIN'){events.push('public-link');return [{result:{url:publicURL}}];}
  const action=opts.args[1];events.push(action);
  const results={'creator-ready':{ready:true},'identity-proof':{remoteId,name:'Test account'},author:{profileURL:'https://www.rednote.com/user/profile/'+profileId},'profile-identity':{accountId:'12345',profileId}};
  if(action==='identity-proof')assert.equal(tabs.get(opts.target.tabId).url,'https://creator.rednote.com/new/note-manager');
  return [{result:results[action]}];
 }},alarms:{onAlarm:{addListener(){}}},action:{onClicked:{addListener(){}}}};
 globalThis.fetch=async(url,options)=>{saved=JSON.parse(options.body);return {ok:true,json:async()=>({connected:true})};};t.after(()=>Object.assign(globalThis,previous));
 await import('../extension/background.js?red-navigation');
 const result=await new Promise(resolve=>listener({action:'connect',payload:{platform:'rednote',accountId:'12345'}},{id:'a'.repeat(32),frameId:0,url:'http://127.0.0.1:8792/#settings'},resolve));
 assert.deepEqual(events,['creator-ready','navigate:https://creator.rednote.com/new/note-manager','identity-proof','public-link','author','navigate:https://www.rednote.com/user/profile/'+profileId,'profile-identity']);
 assert.ok(result.value.connected);assert.equal(saved.profileId,profileId);assert.equal(tabs.size,0);
});
