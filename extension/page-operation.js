// Runs only in a tab created by the extension, on an allowlisted official origin.
// All evidence comes from rendered DOM; no cookies, hidden app state or private APIs.
export async function pageOperation(platform,action,payload){
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const visible=e=>!!e&&e.getBoundingClientRect().width>0&&getComputedStyle(e).visibility!=='hidden';
 const all=(s,root=document)=>[...root.querySelectorAll(s)];
 const one=(s,root=document)=>all(s,root).find(visible);
 const text=e=>e?.innerText??'';
 const norm=s=>String(s??'').replace(/\s+/g,' ').trim();
 function renderedText(e){
  if(!e)return '';if(e.nodeType===Node.TEXT_NODE)return e.nodeValue;
  if(e.nodeType!==Node.ELEMENT_NODE)return '';
  if(e.tagName==='IMG')return e.getAttribute('alt')||'';
  if(e.tagName==='BR')return '\n';
  if(e.tagName==='A'){const expanded=e.getAttribute('title');if(expanded&&/^https:\/\//.test(expanded))return expanded;}
  return [...e.childNodes].map(renderedText).join('')+(['DIV','P'].includes(e.tagName)?'\n':'');
 }
 const want=c=>c.body+(c.link?'\n\n'+c.link:'');
 const assert=(v,m)=>{if(!v)throw Error(m);return v;};
 const wait=async(fn,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=fn();if(v)return v;await sleep(350);}throw Error('公式画面の必要な項目を確認できませんでした。画面とログイン状態を確認してください。');};
 const button=(names,root=document)=>all('button,[role="button"]',root).find(e=>visible(e)&&names.includes(norm(e.innerText||e.getAttribute('aria-label'))));
 function setValue(e,value){e.focus();const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
 function setBody(e,value){e.focus();const range=document.createRange();range.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(range);document.execCommand('insertText',false,value);e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));}
 function attach(e,media){assert(e&&media,'画像の入力欄を確認できませんでした。');const bytes=Uint8Array.from(atob(media.base64),c=>c.charCodeAt(0)),dt=new DataTransfer();dt.items.add(new File([bytes],media.name,{type:media.mimeType}));e.files=dt.files;e.dispatchEvent(new Event('change',{bubbles:true}));}
 const titleBox=()=>one('textarea[placeholder*="タイトル"],input[placeholder*="标题"],input[placeholder*="標題"],textarea[placeholder*="标题"]');
 const bodyBox=()=>platform==='x'?one('[data-testid="tweetTextarea_0"][contenteditable="true"]'):one('[contenteditable="true"][role="textbox"],.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"],.ql-editor[contenteditable="true"]');
 async function redManage(){
  await wait(()=>one('.user-info'));
  if(location.pathname!=='/new/note-manager'){const manage=await wait(()=>all('span,div').find(e=>visible(e)&&e.children.length===0&&norm(text(e))==='笔记管理'));manage.click();}
  const published=await wait(()=>all('span,div').find(e=>visible(e)&&e.children.length===0&&norm(text(e))==='已发布'));published.click();
  return await wait(()=>{const cards=redCards();return cards.length?cards:null;});
 }
 function redCards(){return all('.note-card').filter(visible).map(e=>{try{const data=JSON.parse(e.getAttribute('data-impression'));if(data.index?.value?.channelTabName!=='published')return null;const remoteId=data.noteTarget?.value?.noteId;if(!/^[a-z0-9]{16,64}$/i.test(remoteId))return null;const stamp=text(e.querySelector('.note-card__time')).trim();return {element:e,remoteId,title:text(e.querySelector('.note-card__title')),publishedAt:/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp)?stamp.replace(' ','T')+':00+08:00':null};}catch{return null;}}).filter(Boolean);}
 async function identity(){
  let id,name;
  if(platform==='x'){
   const e=await wait(()=>one('[data-testid="SideNav_AccountSwitcher_Button"]'));
   const link=await wait(()=>one('[data-testid="AppTabBar_Profile_Link"]'));
   const url=new URL(link.href);id=url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1];
   // Narrow sidebars show only the avatar. The signed-in navigation's profile
   // link remains available; timeline authors must never supply the identity.
   const shown=text(e).match(/@([A-Za-z0-9_]+)/)?.[1];
   assert(url.origin==='https://x.com'&&id&&(!shown||shown.toLowerCase()===id.toLowerCase()),'Xの本人プロフィールが一致しません。');
   name=text(e).split('\n')[0]||e.querySelector('img[alt]')?.getAttribute('alt')||id;
  }
  else if(platform==='note'){
   const menu=await wait(()=>button(['メニュー']));if(menu.getAttribute('aria-expanded')!=='true')menu.click();
   const link=await wait(()=>all('a').find(e=>visible(e)&&text(e).includes('クリエイターページ')&&/^\/[A-Za-z0-9_-]+$/.test(new URL(e.href).pathname)));
   id=new URL(link.href).pathname.slice(1);name=text(link).replace('クリエイターページ','').trim();
  }else{
   if(location.pathname.includes('login'))throw Error('RedNoteのクリエイター画面でログインしてください。');
   const value=await wait(()=>text(document.body).match(/(?:小红书号|小紅書號|rednote ID|RedNote ID|账号|帳號)\s*[：:]\s*(\d{1,24})(?!\d)/i));id=value[1];name=id;
  }
  assert(id&&id.toLowerCase()===String(payload.accountId).toLowerCase(),'ログイン中のアカウントと設定IDが一致しません。');return {accountId:payload.accountId,name};
 }
 async function checkContent(){
  const c=payload.content,body=await wait(bodyBox);assert(norm(text(body))===norm(want(c)),'投稿本文の全文照合が一致しません。');
  if(platform!=='x')assert(norm(titleBox()?.value)===norm(c.title),'投稿タイトルが一致しません。');
  if(platform==='x')await identity();
  return {ready:true};
 }
 function publicURL(){
  if(platform==='x'){const links=all('[data-testid="toast"] a,[role="alert"] a');return links.map(a=>a.href).find(h=>new RegExp('^https://x\\.com/'+payload.accountId+'/status/\\d+/?$','i').test(h));}
  if(platform==='note')return [location.href,...all('a').filter(visible).map(a=>a.href)].find(h=>new RegExp('^https://note\\.com/'+payload.accountId+'/n/n[0-9a-f]+(?:[?#].*)?$').test(h));
  return [location.href,...all('a').filter(visible).map(a=>a.href)].find(h=>/^https:\/\/www\.rednote\.com\/(explore|discovery\/item)\/[a-z0-9]{16,64}/i.test(h));
 }
 function publicContent(){
  const url=new URL(payload.permalink);
  if(platform==='x'){
   const article=all('article').find(a=>all('a[href]',a).some(link=>new URL(link.href).pathname===url.pathname&&link.querySelector('time')));
   if(!article)return null;
   const body=one('[data-testid="tweetText"]',article),time=one('time[datetime]',article);if(!body||!time)return null;
   return {root:article,body:renderedText(body),title:'',publishedAt:time.getAttribute('datetime')};
  }
  if(platform==='note'){
   const title=one('h1'),body=one('.note-common-styles__textnote-body,.note-common-styles__textnote-body > div'),time=one('time[datetime]');
   return title&&body&&time?{root:document,body:text(body),title:text(title),publishedAt:time.getAttribute('datetime')}:null;
  }
  const title=one('#detail-title'),body=one('#detail-desc'),time=one('time[datetime]');
  if(!title||!body)return null;
  const stamp=payload.creatorPublishedAt||time?.getAttribute('datetime')||text(one('.date')).match(/\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}(?::\d{2})?/)?.[0];
  // Date-only and relative labels cannot support an actual publication timestamp.
  return stamp?{root:document,body:text(body),title:text(title),publishedAt:/T/.test(stamp)?stamp:stamp.replaceAll('/','-').replace(' ','T')+'+08:00'}:null;
 }
 try{
  if(action==='identity-proof'&&platform==='rednote'){
   const cards=await redManage();const card=cards[0];assert(card,'RedNoteの本人照合には公開済みの記事が必要です。');
   return {remoteId:card.remoteId,name:text(one('.user-info'))};
  }
  if(action==='author'&&platform==='rednote'){
   const root=await wait(()=>document.querySelector('#noteContainer'));
   const a=await wait(()=>all('a[href*="/user/profile/"]',root).find(visible));return {profileURL:a.href,profileId:new URL(a.href).pathname.split('/').pop()};
  }
  if(action==='profile-identity'&&platform==='rednote'){
   const match=await wait(()=>text(document.body).match(/(?:小红书号|小紅書號|rednote ID|RedNote ID|レッドノートID|RED ID)\s*[：:]\s*(\d{1,24})(?!\d)/i));
   assert(match[1]===payload.accountId,'ログイン中のアカウントと設定IDが一致しません。');return {accountId:match[1],profileId:location.pathname.split('/').pop()};
  }
  if(action==='red-result'&&platform==='rednote'){
   const cards=await redManage();const candidates=cards.filter(c=>norm(c.title)===norm(payload.content.title)&&c.publishedAt&&Date.parse(c.publishedAt)>=Date.parse(payload.attemptAt)-120000);
   assert(candidates.length===1,'公開済みの対象記事を一意に照合できません。');const card=candidates[0];return {remoteId:card.remoteId,publishedAt:card.publishedAt};
  }
  if(action==='red-feedback'&&platform==='rednote'){
   const cards=await redManage();const card=cards.find(c=>c.remoteId===payload.remoteId);assert(card,'反響取得先が一致しません。');
   const cells=all('.note-card__stat',card.element);assert(cells.length===5,'数値を画面で照合できませんでした。未取得として記録します。');
   const fingerprints=['M7.99902 3.83398','M3.18233 10.985','M3.25611 3.91336','M10.8848 14.2322','M8.28672 5.15797'];assert(cells.every((c,i)=>c.querySelector('svg path')?.getAttribute('d')?.startsWith(fingerprints[i])),'数値を画面で照合できませんでした。未取得として記録します。');
   const metrics={};for(const [i,key] of ['views','comments','likes','saved','shares'].entries()){const raw=text(cells[i]).trim();if(/^\d[\d,]*$/.test(raw))metrics[key]=Number(raw.replaceAll(',',''));}
   assert(Object.keys(metrics).length,'数値を画面で照合できませんでした。未取得として記録します。');return {metrics,evidence:{accountId:payload.accountId,permalink:payload.permalink}};
  }
  if(action==='publishedURL')return {url:await wait(publicURL,10000)};
  if(action==='identity')return await identity();
  if(action==='new'){const link=await wait(()=>all('a').find(e=>visible(e)&&new URL(e.href).pathname==='/notes/new'));return {url:link.href};}
  if(action==='prepare'){
   const c=payload.content;
   if(platform==='rednote'){
    const imageTab=await wait(()=>all('span,div,button').find(e=>visible(e)&&['上传图文','上傳圖文'].includes(norm(text(e)))&&e.children.length===0));imageTab.click();
    await wait(()=>all('input[type="file"]').find(e=>/image|\.jpg|\.png/i.test(e.accept)));attach(all('input[type="file"]').find(e=>/image|\.jpg|\.png/i.test(e.accept)),payload.media);
   }
   const body=await wait(bodyBox,40000);if(platform!=='x')setValue(assert(titleBox(),'タイトル欄を確認してください。'),c.title);setBody(body,want(c));
   if(payload.media&&platform==='x'){attach(document.querySelector('input[data-testid="fileInput"]'),payload.media);await wait(()=>one('[data-testid="attachments"] [data-testid="tweetPhoto"], [data-testid="attachments"] img'),40000);}
   await sleep(500);return await checkContent();
  }
  if(action==='check')return await checkContent();
  if(action==='submit'){
   await checkContent();
   if(platform==='x'){const b=await wait(()=>one('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'));assert(!b.disabled&&b.getAttribute('aria-disabled')!=='true','投稿ボタンが有効ではありません。');b.click();return {url:await wait(publicURL,30000)};}
   if(platform==='note'){
    const next=await wait(()=>button(['公開に進む','公開設定']));next.click();
    const final=await wait(()=>button(['投稿する','公開する']));assert(!final.disabled,'公開ボタンが有効ではありません。');final.click();
    return {url:await wait(publicURL,40000)};
   }
   const final=await wait(()=>button(['发布','立即发布','發佈','立即發佈']));assert(!final.disabled,'公開ボタンが有効ではありません。');final.click();await wait(()=>/发布成功|發布成功|成功发布/.test(text(document.body))||location.pathname==='/new/note-manager',45000);return {submitted:true};
  }
  if(action==='inspect'){
   if(platform==='rednote'){const root=await wait(()=>document.querySelector('#noteContainer'));const authors=all('a[href*="/user/profile/"]',root).filter(visible);assert(authors.some(a=>new URL(a.href).pathname==='/user/profile/'+payload.profileId),'投稿アカウントの照合が一致しません。');}
   assert(location.origin+location.pathname===new URL(payload.permalink).origin+new URL(payload.permalink).pathname,'公開URLが一致しません。');const c=await wait(publicContent,30000);
   assert(norm(c.body)===norm(want(payload.content)),'公開本文の全文照合が一致しません。');if(platform!=='x')assert(norm(c.title)===norm(payload.content.title),'公開タイトルが一致しません。');
   return {accountId:payload.accountId,profileId:payload.profileId,permalink:payload.permalink,body:c.body,title:c.title,publishedAt:c.publishedAt,...(platform==='rednote'?{timePrecision:'minute',timeSource:'creator-visible-time'}:{})};
  }
  if(action==='feedback'){
   assert(location.origin+location.pathname===new URL(payload.permalink).origin+new URL(payload.permalink).pathname,'反響取得先が一致しません。');
   const metrics={};const integer=s=>/^\d[\d,]*$/.test(s?.trim()??'')?Number(s.replaceAll(',','')):undefined;
   if(platform==='x'){
    const c=await wait(publicContent),labels=all('[aria-label]',c.root).map(e=>e.getAttribute('aria-label')).join('、');
    for(const [k,words] of Object.entries({views:'表示|Views?|次查看|次瀏覽',likes:'いいね|Likes?|個喜歡|次赞',replies:'返信|replies|則回覆|条回复',reposts:'リポスト|reposts?|次轉發|次转帖'})){
     const match=labels.match(new RegExp('(?:^|[、,])\\s*([\\d,]+)\\s*(?:件の)?(?:'+words+')','i'));if(match)metrics[k]=integer(match[1]);
    }
   }else if(platform==='note'){
    const b=all('button[aria-label]').find(e=>visible(e)&&/^\d[\d,]*スキ/.test(e.getAttribute('aria-label')));if(b)metrics.likes=integer(b.getAttribute('aria-label').match(/^[\d,]+/)[0]);
   }else{
    for(const [k,sel] of Object.entries({likes:'.like-wrapper .count',saved:'.collect-wrapper .count',comments:'.chat-wrapper .count'})){const e=one(sel),n=integer(text(e));if(n!==undefined)metrics[k]=n;}
   }
   for(const k of Object.keys(metrics))if(metrics[k]===undefined)delete metrics[k];assert(Object.keys(metrics).length,'数値を画面で照合できませんでした。未取得として記録します。');
   return {evidence:{accountId:payload.accountId,permalink:payload.permalink},metrics};
  }
  throw Error('未対応の画面操作です。');
 }catch(e){return {error:e.message};}
}
