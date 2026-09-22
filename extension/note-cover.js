// Scoped to the single upload action. Restore the native click even on failure.
export async function uploadNoteCover(media){
 const visible=e=>e&&e.getBoundingClientRect().width>0;
 const wait=async(fn)=>{for(let n=0;n<100;n++){const v=fn();if(v)return v;await new Promise(r=>setTimeout(r,300));}throw Error('noteの画像アップロードを確認できませんでした。');};
 const buttons=()=>[...document.querySelectorAll('button')].filter(visible);
 let intercepted=false;const original=HTMLInputElement.prototype.click;
 try{
  const add=await wait(()=>buttons().find(b=>b.getAttribute('aria-label')==='画像を追加'||b.querySelector('[aria-label="画像を追加"]')));add.click();
  const upload=await wait(()=>buttons().find(b=>b.innerText.includes('画像をアップロード')));
  HTMLInputElement.prototype.click=function(...args){if(this.type==='file'&&!intercepted){intercepted=true;const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(media.base64),c=>c.charCodeAt(0))],media.name,{type:media.mimeType}));this.files=dt.files;this.dispatchEvent(new Event('change',{bubbles:true}));return;}return original.apply(this,args);};
  upload.click();await wait(()=>intercepted);HTMLInputElement.prototype.click=original;
  const save=await wait(()=>buttons().find(b=>b.innerText.trim()==='保存'));await wait(()=>[...document.querySelectorAll('[role="dialog"] img')].some(i=>visible(i)&&i.complete&&i.naturalWidth>0));save.click();
  await wait(()=>!visible(save));return {uploaded:true};
 }catch(e){return {error:e.message};}finally{HTMLInputElement.prototype.click=original;}
}
