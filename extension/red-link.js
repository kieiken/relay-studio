// Capture the destination produced by the official card's own open action.
// No account state, cookies or private endpoints are inspected.
export async function redCardLink(remoteId){
 const original=window.open;let captured;
 try{
  const card=[...document.querySelectorAll('.note-card')].find(e=>{try{return JSON.parse(e.getAttribute('data-impression')).noteTarget.value.noteId===remoteId;}catch{return false;}});
  if(!card)throw Error('公開URLを照合できません。');
  window.open=function(url,...args){try{const u=new URL(url,location.href);if(u.origin==='https://www.rednote.com'&&u.pathname.endsWith('/'+remoteId)){captured=u.href;return null;}}catch{}return original.call(window,url,...args);};
  // The card wrapper is decorative; the media child owns the open handler.
  const target=card.querySelector('.note-card__cover img.content');
  if(!target)throw Error('公開URLを照合できません。');target.click();
  for(let n=0;n<50&&!captured;n++)await new Promise(r=>setTimeout(r,300));
  if(!captured)throw Error('公開URLを照合できません。');return {url:captured};
 }catch(e){return {error:e.message};}finally{window.open=original;}
}
