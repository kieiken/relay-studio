import test from 'node:test';
import assert from 'node:assert/strict';
import {pageOperation} from '../extension/page-operation.js';
import {redCardLink} from '../extension/red-link.js';
function element(tag,attrs={},children=[]){return {nodeType:1,tagName:tag,childNodes:children,innerText:attrs.text??'',href:attrs.href,getBoundingClientRect:()=>({width:100}),getAttribute:k=>attrs[k]??null,querySelector:s=>s==='time'?attrs.time:null,querySelectorAll:()=>[]};}
const text=value=>({nodeType:3,nodeValue:value});
function environment(t,document,location){const previous=new Map();for(const [k,v] of Object.entries({document,location,Node:{TEXT_NODE:3,ELEMENT_NODE:1},getComputedStyle:()=>({visibility:'visible'})})){previous.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{value:v,configurable:true});}t.after(()=>{for(const [k,d] of previous)d?Object.defineProperty(globalThis,k,d):delete globalThis[k];});}
test('X inspection preserves emoji alt text and expanded link instead of accepting a truncated visible URL',async t=>{
 const url='https://x.com/tester/status/123',date='2026-09-22T00:00:00Z';
 const time=element('TIME',{datetime:date});const anchor=element('A',{href:url,time});
 const body=element('DIV',{},[text('Hello '),element('IMG',{alt:'🌿'}),element('BR'),element('A',{title:'https://example.com/long/path'},[text('example.com/…')])]);
 const article=element('ARTICLE');article.querySelectorAll=s=>({'a[href]':[anchor],'[data-testid="tweetText"]':[body],'time[datetime]':[time]}[s]??[]);
 environment(t,{querySelectorAll:s=>s==='article'?[article]:[]},{origin:'https://x.com',pathname:'/tester/status/123'});
 const r=await pageOperation('x','inspect',{accountId:'tester',permalink:url,content:{body:'Hello 🌿',link:'https://example.com/long/path'}});assert.equal(r.publishedAt,date);assert.ok(r.body.includes('🌿'));assert.ok(r.body.includes('https://example.com/long/path'));
 body.childNodes[3].getAttribute=()=>null;const bad=await pageOperation('x','inspect',{accountId:'tester',permalink:url,content:{body:'Hello 🌿',link:'https://example.com/long/path'}});assert.ok(bad.error);
});
test('note public URL can be the current document, without a redundant self link',async t=>{environment(t,{querySelectorAll:()=>[]},{href:'https://note.com/tester/n/n123abcd'});const r=await pageOperation('note','publishedURL',{accountId:'tester'});assert.equal(r.url,'https://note.com/tester/n/n123abcd');});
test('X identity uses signed-in profile navigation on a collapsed sidebar and rejects mismatches',async t=>{
 const switcher=element('BUTTON'),link=element('A',{href:'https://x.com/tester'});
 environment(t,{querySelectorAll:s=>({'[data-testid="SideNav_AccountSwitcher_Button"]':[switcher],'[data-testid="AppTabBar_Profile_Link"]':[link]}[s]??[])},{origin:'https://x.com'});
 assert.equal((await pageOperation('x','identity',{accountId:'tester'})).accountId,'tester');
 assert.ok((await pageOperation('x','identity',{accountId:'someone_else'})).error);
 switcher.innerText='Other account\n@someone_else';assert.ok((await pageOperation('x','identity',{accountId:'tester'})).error);
});
test('RedNote opens the media child and restores window.open after capturing only the matching official link',async t=>{
 const remoteId='a'.repeat(24),opened=[];const original=url=>opened.push(url),win={open:original};
 const prior=Object.getOwnPropertyDescriptor(globalThis,'window');Object.defineProperty(globalThis,'window',{value:win,configurable:true});t.after(()=>{if(prior)Object.defineProperty(globalThis,'window',prior);else delete globalThis.window;});
 const target={click(){win.open('https://example.com/'+remoteId);win.open('https://www.rednote.com/discovery/item/'+remoteId+'?source=creator');}};
 const card={getAttribute:()=>JSON.stringify({noteTarget:{value:{noteId:remoteId}}}),querySelector:s=>s==='.note-card__cover img.content'?target:null};
 environment(t,{querySelectorAll:()=>[card]},{href:'https://creator.rednote.com/new/note-manager'});
 const result=await redCardLink(remoteId);assert.equal(result.url,'https://www.rednote.com/discovery/item/'+remoteId+'?source=creator');assert.deepEqual(opened,['https://example.com/'+remoteId]);assert.equal(win.open,original);
 const missing=await redCardLink('b'.repeat(24));assert.ok(missing.error);assert.equal(win.open,original);
});

test('X preparation emits native input once, rather than doubling a controlled editor body',async t=>{
 const previousWindow=globalThis.window,previousTimeout=globalThis.setTimeout;
 const body=element('DIV');body.focus=()=>{};body.dispatchEvent=()=>{throw Error('Synthetic input would double text');};
 const profile=element('A',{href:'https://x.com/tester'}),switcher=element('BUTTON');let insertions=0;
 environment(t,{createRange:()=>({selectNodeContents(){}}),execCommand:(_cmd,_ui,value)=>{insertions++;body.innerText=value;return true;},querySelectorAll:s=>({'[data-testid="tweetTextarea_0"][contenteditable="true"]':[body],'[data-testid="SideNav_AccountSwitcher_Button"]':[switcher],'[data-testid="AppTabBar_Profile_Link"]':[profile]}[s]??[])},{origin:'https://x.com'});
 globalThis.window={getSelection:()=>({removeAllRanges(){},addRange(){}})};globalThis.setTimeout=fn=>{queueMicrotask(fn);return 1;};t.after(()=>{globalThis.window=previousWindow;globalThis.setTimeout=previousTimeout;});
 const result=await pageOperation('x','prepare',{accountId:'tester',content:{body:'Exact one-time test 🌿'}});
 assert.equal(result.ready,true);assert.equal(body.innerText,'Exact one-time test 🌿');assert.equal(insertions,1);
});
test('note completion modal supplies exact editor article URL without a public link',async t=>{
 const heading=element('H2',{text:'記事が公開されました'});
 environment(t,{querySelectorAll:s=>s==='h1,h2,h3,[role="heading"]'?[heading]:[]},{href:'https://editor.note.com/notes/n123abcd/edit/'});
 assert.equal((await pageOperation('note','publishedURL',{accountId:'tester'})).url,'https://note.com/tester/n/n123abcd');
 // An editor URL alone must never be treated as publication success.
 heading.innerText='公開設定';const oldNow=Date.now;let clock=0;Date.now=()=>clock+=20000;t.after(()=>{Date.now=oldNow;});
 assert.ok((await pageOperation('note','publishedURL',{accountId:'tester'})).error);
});
test('note dashboard records the four article-list columns and keeps dashes unrecorded',async t=>{
 const url='https://note.com/tester/n/n123abcd',link=element('A',{href:url});
 const headers=['タイトル','インプレッション','ページビュー','スキ','コメント','売上'].map(value=>element('TH',{text:value}));
 const cells=[element('TD'),element('TD',{text:'1,204'}),element('TD',{text:'88'}),element('TD',{text:'3'}),element('TD',{text:'-'}),element('TD',{text:'-'})];
 const row=element('TR');row.querySelectorAll=s=>s==='a[href]'?[link]:s==='td'?cells:[];
 const table=element('TABLE',{text:'記事一覧 インプレッション ページビュー スキ コメント'});table.querySelectorAll=s=>s==='th'?headers:s==='tr'?[row]:[];
 environment(t,{querySelectorAll:s=>s==='table'?[table]:[]},{origin:'https://note.com',pathname:'/dashboard'});
 const result=await pageOperation('note','feedback',{accountId:'tester',permalink:url});
 assert.deepEqual(result.metrics,{impressions:1204,views:88,likes:3});assert.equal(result.reference,'https://note.com/dashboard');
});
test('RedNote preflight checks the closed-root public button and decoded image before arm',async t=>{
 const body=element('DIV',{text:'test body'}),title={...element('INPUT'),value:'test title'},img={...element('IMG'),complete:true,naturalWidth:600};
 let disabled=false;const publish=element('BUTTON',{text:'发布'}),host=element('XHS-PUBLISH-BTN');host.getAttribute=k=>k==='submit-disabled'?String(disabled):null;
 const root={querySelectorAll:()=>[publish]},oldChrome=globalThis.chrome;globalThis.chrome={dom:{openOrClosedShadowRoot:e=>e===host?root:null}};t.after(()=>{globalThis.chrome=oldChrome;});
 environment(t,{querySelectorAll:s=>s==='xhs-publish-btn'?[host]:s==='img.img.preview'?[img]:s.includes('contenteditable')?[body]:s.includes('textarea[placeholder')?[title]:[]},{});
 const payload={content:{title:'test title',body:'test body'}};
 assert.equal((await pageOperation('rednote','check',payload)).ready,true);
 img.naturalWidth=0;assert.match((await pageOperation('rednote','check',payload)).error,/画像/);
 img.naturalWidth=600;disabled=true;assert.match((await pageOperation('rednote','check',payload)).error,/公開ボタン/);
});
