import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {check} from './model.mjs';
const exec=promisify(execFile);
export class Keychain {
 constructor(instance){this.service=`local.relay-studio.${instance}`;}
 async set(platform,value){
  check(process.platform==='darwin','キーの保存はmacOSキーチェーン対応版をご利用ください。',503);
  check(typeof value==='string' && /^[A-Za-z0-9._~+\/=:-]{8,8192}$/.test(value),'トークンの文字形式を確認してください。');
  // Supply the secret over stdin, never process argv, logs or project files.
  await new Promise((resolve,reject)=>{const child=spawn('/usr/bin/security',['-i'],{stdio:['pipe','ignore','pipe']});let errors='';child.stderr.on('data',b=>{errors+=b.toString();});child.on('error',()=>reject(new Error('キーチェーンにアクセスできません。')));child.on('close',code=>code===0&&!/SecKeychain|error:|failed/i.test(errors)?resolve():reject(new Error('キーチェーン保存に失敗しました。OSの許可を確認してください。')));child.stdin.end(`add-generic-password -U -a "${platform}" -s "${this.service}" -w "${value}"\n`);});
 }
 async get(platform){try{return (await exec('/usr/bin/security',['find-generic-password','-a',platform,'-s',this.service,'-w'])).stdout.trim();}catch{throw new Error('キーが未設定、またはキーチェーンがロックされています。');}}
 async delete(platform){try{await exec('/usr/bin/security',['delete-generic-password','-a',platform,'-s',this.service]);}catch(e){if(e.code!==44)throw new Error('キーチェーンから削除できませんでした。');}}
}
