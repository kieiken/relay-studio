import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {makeManifest,verifyBundle} from '../scripts/bundle.mjs';
import {installBundle} from '../scripts/install.mjs';
async function setup(t){
 const dir=await mkdtemp(path.join(await realpath(os.tmpdir()),'relay-install-test-')),from=path.join(dir,'source'),destination=path.join(dir,'Applications','Relay Studio'),dataDir=path.join(dir,'data');
 t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(from);await mkdir(dataDir);
 await writeFile(path.join(from,'package.json'),JSON.stringify({name:'relay-social-studio',version:'test-1'}));
 await writeFile(path.join(from,'start.command'),'#!/bin/zsh\n');await writeFile(path.join(dataDir,'studio.json'),'private-existing-data');await makeManifest(from);
 return {dir,from,destination,dataDir};
}
test('install, repeat, update with backup preserve existing data and previous binary',async t=>{
 const f=await setup(t);await writeFile(path.join(f.from,'.DS_Store'),'Finder metadata');assert.equal((await installBundle(f)).status,'installed');assert.equal((await installBundle(f)).status,'already-installed');await assert.rejects(access(path.join(f.destination,'.DS_Store')));
 await writeFile(path.join(f.from,'package.json'),JSON.stringify({name:'relay-social-studio',version:'test-2'}));await makeManifest(f.from);
 const r=await installBundle(f);assert.equal(r.status,'updated');assert.equal((await verifyBundle(r.backup)).version,'test-1');assert.equal((await verifyBundle(f.destination)).version,'test-2');
 assert.equal(await readFile(path.join(f.dataDir,'studio.json'),'utf8'),'private-existing-data');
});
test('tampering and unexpected files stop installation without replacing current app',async t=>{
 const f=await setup(t);await installBundle(f);await writeFile(path.join(f.from,'start.command'),'tampered');await assert.rejects(installBundle(f),/checksum/);
 assert.equal((await verifyBundle(f.destination)).version,'test-1');await makeManifest(f.from);await writeFile(path.join(f.from,'private-secret.txt'),'secret');await assert.rejects(installBundle(f),/unexpected/);
});
test('unrelated destination, modified install, symlinks, data overlap and running instance stop safely',async t=>{
 const f=await setup(t);await mkdir(f.destination,{recursive:true});await writeFile(path.join(f.destination,'keep.txt'),'keep');await assert.rejects(installBundle(f));assert.equal(await readFile(path.join(f.destination,'keep.txt'),'utf8'),'keep');await rm(f.destination,{recursive:true});
 await installBundle(f);await writeFile(path.join(f.dataDir,'instance.lock'),String(process.pid));
 assert.equal((await installBundle(f)).status,'already-installed');
 await writeFile(path.join(f.from,'package.json'),JSON.stringify({name:'relay-social-studio',version:'test-2'}));await makeManifest(f.from);
 await assert.rejects(installBundle(f),/Stop Relay/);await rm(path.join(f.dataDir,'instance.lock'));
 await assert.rejects(installBundle({...f,destination:f.dataDir}),/separate/);
 const link=path.join(f.dir,'linked');await symlink(path.dirname(f.destination),link);await assert.rejects(installBundle({...f,destination:path.join(link,'new')}),/Symbolic/);
 await writeFile(path.join(f.destination,'start.command'),'user edit');await assert.rejects(installBundle(f),/checksum/);assert.equal(await readFile(path.join(f.destination,'start.command'),'utf8'),'user edit');
 await symlink('/etc/hosts',path.join(f.from,'linked-secret'));await assert.rejects(verifyBundle(f.from),/Symbolic/);
 await access(path.join(f.dataDir,'studio.json'));
});

test('case-only destination aliases cannot overlap data, source or home',async t=>{
 const f=await setup(t);
 await assert.rejects(installBundle({...f,destination:path.join(f.dir,'DATA','application')}),/separate/);
 await assert.rejects(installBundle({...f,destination:path.join(f.dir,'SOURCE','application')}),/separate/);
 await assert.rejects(installBundle({...f,destination:os.homedir().toUpperCase()}),/separate/);
 assert.equal(await readFile(path.join(f.dataDir,'studio.json'),'utf8'),'private-existing-data');
});
