import {cp,mkdir,mkdtemp,readFile,rename,rm,lstat,chmod,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyBundle} from './bundle.mjs';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaultData=path.join(os.homedir(),'Library','Application Support','Relay Studio');
const exists=async p=>{try{return await lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
// macOS installations treat case-only aliases as the same destination, including
// on case-sensitive volumes: conservatively keep app and data folders separate.
const comparable=p=>p.normalize('NFC').toLowerCase();
const inside=(a,b)=>comparable(a)===comparable(b)||comparable(a).startsWith(comparable(b)+path.sep);
async function canonical(p){
 let cur=path.resolve(p),tail=[];
 while(!await exists(cur)){tail.unshift(path.basename(cur));cur=path.dirname(cur);}
 return path.join(await realpath(cur),...tail);
}
export function checkRuntime(){
 if(process.platform!=='darwin')throw new Error('This release supports macOS only. / この版はmacOS専用です。');
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js 22 or newer is required.');
}
async function noSymlinkParents(p){for(let cur=p;;cur=path.dirname(cur)){const stat=await exists(cur);if(stat?.isSymbolicLink())throw new Error(`Symbolic-link destination is not supported: ${cur}`);if(cur===path.dirname(cur))break;}}
export async function installBundle({from=source,destination=path.join(os.homedir(),'Applications','Relay Studio'),dataDir=defaultData}={}){
 const src=path.resolve(from),dest=path.resolve(destination),data=await canonical(dataDir);
 await noSymlinkParents(dest);
 const sourcePath=await canonical(src),targetPath=await canonical(dest);
 if(inside(sourcePath,targetPath)||inside(targetPath,sourcePath)||inside(targetPath,data)||inside(data,targetPath)||comparable(targetPath)===comparable(await canonical(os.homedir())))throw new Error('Choose a separate application folder, outside source and user data.');
 const incoming=await verifyBundle(src),current=await exists(dest);
 if(current){
  if(!current.isDirectory())throw new Error('Destination is not a Relay Studio folder.');
  await verifyBundle(dest); // Refuse to overwrite unrelated or locally modified files.
  if((await readFile(path.join(src,'bundle-manifest.json'),'utf8'))===(await readFile(path.join(dest,'bundle-manifest.json'),'utf8')))return {status:'already-installed',version:incoming.version,destination:dest};
  try{const pid=Number(await readFile(path.join(data,'instance.lock'),'utf8'));if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid instance lock; inspect it before updating.');try{process.kill(pid,0);throw new Error('Stop Relay Studio before updating.');}catch(e){if(e.code!=='ESRCH')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 await mkdir(path.dirname(dest),{recursive:true});
 const stage=await mkdtemp(path.join(path.dirname(dest),'.relay-install-'));
 let backup;
 try{
  await cp(src,path.join(stage,'app'),{recursive:true,filter:p=>path.basename(p)!=='.DS_Store'});await verifyBundle(path.join(stage,'app'));
  await chmod(path.join(stage,'app','start.command'),0o755);
  if(current){backup=dest+'.backup-'+new Date().toISOString().replace(/[:.]/g,'-');await rename(dest,backup);}
  try{await rename(path.join(stage,'app'),dest);}catch(e){if(backup)await rename(backup,dest);throw e;}
 }finally{await rm(stage,{recursive:true,force:true});}
 return {status:current?'updated':'installed',version:incoming.version,destination:dest,...(backup?{backup}:{})};
}
async function main(){
 const args=process.argv.slice(2);checkRuntime();
 if(args[0]==='--check'&&args.length===1){const m=await verifyBundle(source);console.log(JSON.stringify({status:'verified',version:m.version,platform:process.platform,arch:process.arch,node:process.versions.node}));return;}
 if(args[0]!=='--install'||!(args.length===1||(args.length===3&&args[1]==='--destination')))throw new Error('Usage: node scripts/install.mjs --check | --install [--destination /absolute/folder]');
 if(args[2]&&!path.isAbsolute(args[2]))throw new Error('Destination must be an absolute path.');
 console.log(JSON.stringify(await installBundle({destination:args[2]}),null,2));
 console.log('Next: node scripts/diagnose.mjs in the installed folder. No accounts, credentials or posts were changed.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
