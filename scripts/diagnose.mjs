// Runs only against temporary empty data, with no worker, secrets or remote I/O.
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createStudio} from '../server.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'relay-diagnose-'));
let app;
try{
 const forbidden=async()=>{throw new Error('External operations are disabled during diagnosis.');};
 app=await createStudio({dataDir:dir,worker:false,credentials:{get:forbidden,set:forbidden,delete:forbidden},connectors:{verify:forbidden,publish:forbidden,collect:forbidden,inspect:forbidden}});
 await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const state=await(await fetch(base+'/api/state')).json();
 const page=await(await fetch(base+'/')).text();
 if(state.worker.active||state.jobs.length||state.drafts.length||Object.keys(state.connections).length||state.settings.defaults.length!==6||!page.includes('Relay'))throw new Error('Unexpected diagnostic state.');
 console.log('DIAGNOSIS_OK: local UI and API ready; 6 defaults; worker disabled; no credentials; no posts.');
}catch(e){console.error('DIAGNOSIS_FAILED: '+e.message);process.exitCode=1;}
finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}
