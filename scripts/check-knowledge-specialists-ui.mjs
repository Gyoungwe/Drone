// Reproducible isolated GUI validation. Does not touch the user Vault or restart Percho.
import { mkdtemp, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { build as bundle } from 'esbuild';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import electron from 'electron';
const repo=resolve(import.meta.dirname,'..');
const root=await realpath(await mkdtemp(join(tmpdir(),'percho-specialists-ui-')));
console.log('Isolated fixture:',root);
await writeFile(join(root,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>`);
await writeFile(join(root,'fixture.css'),`@import ${JSON.stringify(join(repo,'packages/desktop/src/renderer/src/styles/globals.css'))};\n@source ${JSON.stringify(join(repo,'packages/desktop/src/renderer/src'))};\n@source ${JSON.stringify(join(repo,'scripts/knowledge-ui-smoke'))};`);
await writeFile(join(root,'entry.tsx'),`import './fixture.css';\nimport ${JSON.stringify(join(repo,'scripts/knowledge-ui-smoke/renderer.tsx'))};`);
await writeFile(join(root,'preload-entry.ts'),`import ${JSON.stringify(join(repo,'packages/desktop/src/preload/index.ts'))};\nimport {contextBridge,ipcRenderer} from 'electron';contextBridge.exposeInMainWorld('knowledgeTest',{info:()=>ipcRenderer.invoke('knowledge-fixture:info')});`.replaceAll('\\n','\n'));
const alias={'@percho/shared':join(repo,'packages/shared/src/index.ts')};
await bundle({entryPoints:[join(repo,'scripts/knowledge-ui-smoke/main.mjs')],outfile:join(root,'main.mjs'),platform:'node',format:'esm',bundle:true,packages:'external',alias});
await bundle({entryPoints:[join(root,'preload-entry.ts')],outfile:join(root,'preload.cjs'),platform:'node',format:'cjs',bundle:true,packages:'external',alias});
await build({root,configFile:false,base:'./',plugins:[react(),tailwind()],resolve:{alias},build:{target:'esnext',outDir:join(root,'dist'),emptyOutDir:true},logLevel:'warn'});
const output=await new Promise((res,rej)=>{
 const child=spawn(electron,[join(root,'main.mjs')],{env:{...process.env,PERCHO_UI_FIXTURE:root,PERCHO_UI_REPO:repo},stdio:['ignore','pipe','pipe']});
 let text='';child.stdout.on('data',chunk=>{text+=chunk;process.stdout.write(chunk);});child.stderr.on('data',chunk=>{text+=chunk;process.stderr.write(chunk);});
 const timer=setTimeout(()=>{child.kill('SIGTERM');rej(new Error('GUI fixture exceeded 120-second budget'));},120000);
 child.once('error',error=>{clearTimeout(timer);rej(error);});child.once('exit',code=>{clearTimeout(timer);code===0?res(text):rej(new Error(`GUI fixture exited ${code}; inspect ${root}`));});
});
console.log(await readFile(join(root,'validation.json'),'utf8'));
await writeFile('/tmp/percho-specialists-ui-result.json',await readFile(join(root,'validation.json')));
