import {cp,mkdir,mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {makeManifest} from './bundle.mjs';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const staging=await mkdtemp(path.join(os.tmpdir(),'relay-package-')),name=`Relay-Studio-${pkg.version}-alpha`,folder=path.join(staging,name),dist=path.join(root,'dist');
await mkdir(folder);await mkdir(dist,{recursive:true});
try{
 for(const entry of ['public','lib','live','node_modules','server.mjs','package.json','package-lock.json','README.md','DESIGN-REVIEW.md','INSTALL_WITH_AI.md','RELEASE-NOTES.md','start.command'])await cp(path.join(root,entry),path.join(folder,entry),{recursive:true});
 await mkdir(path.join(folder,'tests'));await mkdir(path.join(folder,'scripts'));
 for(const test of ['studio.test.mjs','connectors.test.mjs','i18n.test.mjs','install.test.mjs'])await cp(path.join(root,'tests',test),path.join(folder,'tests',test));
 for(const script of ['package.mjs','bundle.mjs','install.mjs','diagnose.mjs'])await cp(path.join(root,'scripts',script),path.join(folder,'scripts',script));
 await makeManifest(folder);
 const entries=await readdir(folder);if(entries.some(n=>['data','reviews','.local','studio.json','.env'].includes(n)))throw new Error('Private files must not be packaged');
 const zip=path.join(dist,name+'.zip');await rm(zip,{force:true});await exec('/usr/bin/zip',['-qr',zip,name],{cwd:staging});
 const hash=createHash('sha256').update(await readFile(zip)).digest('hex');await writeFile(zip+'.sha256',`${hash}  ${name}.zip\n`);console.log(zip);console.log(`SHA256 ${hash}`);
}finally{await rm(staging,{recursive:true,force:true});}
