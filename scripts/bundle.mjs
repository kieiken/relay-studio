import {readdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
export const manifestName='bundle-manifest.json';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function files(root,relative=''){
 const result=[];
 for(const name of (await readdir(path.join(root,relative))).sort()){
  const rel=path.posix.join(relative,name),info=await lstat(path.join(root,rel));
  if(info.isSymbolicLink())throw new Error(`Symbolic links are not allowed: ${rel}`);
  if(name==='.DS_Store'&&info.isFile())continue;
  if(info.isDirectory())result.push(...await files(root,rel));
  else if(info.isFile())result.push(rel);
  else throw new Error(`Unsupported file: ${rel}`);
 }
 return result;
}
export async function makeManifest(root){
 const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8')),entries={};
 for(const name of await files(root))if(name!==manifestName)entries[name]=hash(await readFile(path.join(root,name)));
 const manifest={format:1,product:'relay-social-studio',version:pkg.version,files:entries};
 await writeFile(path.join(root,manifestName),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export async function verifyBundle(root){
 if((await lstat(root)).isSymbolicLink())throw new Error('The bundle must not be a symbolic link.');
 const m=JSON.parse(await readFile(path.join(root,manifestName),'utf8'));
 if(m.format!==1||m.product!=='relay-social-studio'||!m.files||typeof m.files!=='object')throw new Error('Invalid Relay Studio bundle manifest.');
 const actual=(await files(root)).filter(n=>n!==manifestName).sort(),expected=Object.keys(m.files).sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Bundle contains missing or unexpected files.');
 for(const name of expected){if(!/^[a-f0-9]{64}$/.test(m.files[name])||hash(await readFile(path.join(root,name)))!==m.files[name])throw new Error(`Bundle checksum mismatch: ${name}`);}
 const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 if(pkg.name!==m.product||pkg.version!==m.version)throw new Error('Bundle version mismatch.');
 return m;
}
