export function extensionRequest(action,payload={},timeout=90000){return new Promise((resolve,reject)=>{
 const nonce=crypto.randomUUID();const timer=setTimeout(()=>{window.removeEventListener('message',receive);reject(new Error('Chrome拡張を読み込み、この画面をChromeで開いてください。'));},timeout);
 function receive(e){if(e.source!==window||e.origin!==location.origin||e.data?.channel!=='relay-studio-response'||e.data.nonce!==nonce)return;clearTimeout(timer);window.removeEventListener('message',receive);e.data.error?reject(new Error(e.data.error)):resolve(e.data.value);}
 window.addEventListener('message',receive);window.postMessage({channel:'relay-studio-request',nonce,action,payload},location.origin);
});}
