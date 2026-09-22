import test from 'node:test';
import assert from 'node:assert/strict';
import {t,ui,setLocale,getLocale,dateLocale} from '../public/i18n.js';
import messages from '../public/messages-zh-TW.js';

test('Japanese and Taiwan Traditional Chinese: UI, attributes, backend messages',()=>{
 setLocale('zh-TW');
 assert.equal(getLocale(),'zh-TW');assert.equal(dateLocale(),'zh-TW');
 assert.equal(t('下書き保存'),'儲存草稿');
 assert.equal(t('<input placeholder="数字のIDを入力" aria-label="投稿本文">'),'<input placeholder="輸入數字 ID" aria-label="貼文內文">');
 assert.equal(t('別の画面で更新されました。一覧から開き直してください。'),'內容已在其他畫面更新，請從清單重新開啟。');
 assert.equal(t('未取得は空欄。実際に0件なら0を入力してください。前回値を自動で引き継ぎません。'),messages['未取得は空欄。実際に0件なら0を入力してください。前回値を自動で引き継ぎません。']);
 setLocale('ja');assert.equal(t('下書き保存'),'下書き保存');assert.equal(dateLocale(),'ja-JP');assert.throws(()=>setLocale('zh-CN'));assert.equal(getLocale(),'ja');
});
test('interpolated manuscript, account names, credentials and links are not translated',()=>{
 setLocale('zh-TW');
 const user='下書き保存・未設定・本文',name='保存',url='https://example.com/本文';
 assert.equal(ui`本文：${user} タイトル：${name} リンク：${url}`,`內文：${user} 標題：${name} 連結：${url}`);
 assert.equal(ui`<textarea aria-label="投稿本文">${user}</textarea>`,`<textarea aria-label="貼文內文">${user}</textarea>`);
 setLocale('ja');
});
