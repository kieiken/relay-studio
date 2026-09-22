// Only the local Relay UI may establish a session. Platform pages have no message bridge.
if (['http://127.0.0.1:8792','http://localhost:8792'].includes(location.origin) && window.top === window) {
 window.addEventListener('message',async event=>{
  const m=event.data;
  if(event.source!==window||event.origin!==location.origin||m?.channel!=='relay-studio-request'||typeof m.nonce!=='string'||!['ping','pair','connect','wake'].includes(m.action))return;
  try{const result=await chrome.runtime.sendMessage({action:m.action,nonce:m.nonce,payload:m.payload});window.postMessage({channel:'relay-studio-response',nonce:m.nonce,...result},location.origin);}
  catch{window.postMessage({channel:'relay-studio-response',nonce:m.nonce,error:'拡張機能を再読み込みしてアプリを更新してください。'},location.origin);}
 });
}
