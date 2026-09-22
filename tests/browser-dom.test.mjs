import test from 'node:test';
import assert from 'node:assert/strict';
import {pageOperation} from '../extension/page-operation.js';
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
