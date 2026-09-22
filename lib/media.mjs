import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {check} from './model.mjs';
export function imageType(bytes){if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';return null;}
export async function saveMedia(dir,input){check(typeof input.base64==='string'&&input.base64.length<15*1024*1024&&/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64),'画像は10MB以内にしてください。');const bytes=Buffer.from(input.base64,'base64'),type=imageType(bytes);check(type&&bytes.length<=10*1024*1024,'JPEG・PNG・WebPの画像を選択してください。');const id=randomUUID(),folder=path.join(dir,'media');await mkdir(folder,{recursive:true,mode:0o700});await writeFile(path.join(folder,id),bytes,{mode:0o600});return {id,type,size:bytes.length};}
export async function getMedia(dir,id){check(/^[a-f0-9-]{36}$/.test(id),'画像IDが正しくありません。');const bytes=await readFile(path.join(dir,'media',id));return {bytes,type:imageType(bytes)};}
