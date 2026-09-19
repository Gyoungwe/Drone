// Offline Electron regression: real Markdown and message lists, synthetic in-memory conversations.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { createServer } from "vite";

const repo = resolve(".");
const root = await mkdtemp(join(tmpdir(), "percho-report-ui-"));
const desktop = join(repo, "packages/desktop/src");
const modulePath = (path) => JSON.stringify(join(desktop, path));
await mkdir(join(root, "profile"));
await symlink(join(repo, "node_modules"), join(root, "node_modules"), "junction");
await writeFile(
	join(root, "entry.tsx"),
	`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {emptyTranscript} from ${JSON.stringify(join(repo, "packages/shared/src/index.ts"))};
import {MessageList} from ${modulePath("renderer/src/components/chat/MessageList.tsx")};
import {ChatView} from ${modulePath("lan-web/src/components/ChatView.tsx")};
import {useSessionsStore} from ${modulePath("renderer/src/stores/sessions.ts")};
import {useTranscriptStore} from ${modulePath("renderer/src/stores/transcript.ts")};
import {useKnowledgeStore} from ${modulePath("renderer/src/stores/knowledge.ts")};
import {useUiPreferencesStore} from ${modulePath("renderer/src/stores/ui-preferences.ts")};
import {useLanStore} from ${modulePath("lan-web/src/store.ts")};
const lan = location.hash === '#lan';
if (lan) await import(${modulePath("lan-web/src/styles.css")});
else await import('./style.css');
window.pi = {getKnowledgeOverview: async () => ({binding:{revision:1}})};
useSessionsStore.setState({cwd:'/fixture', activeSessionId:'report-ui'});
useUiPreferencesStore.setState({centerOrbEnabled:false});
const source = 'Library/Papers/edger-a-bioconductor-package-for-differential-expression-analysi-ec996d3ae6a33ca7.md';
const user = {kind:'user', id:'user', text:'构思昆虫翅发育基因的比较基因组分析流程', images:[], timestamp:1000};
const body = Array.from({length:32}, (_,i) => '### 阶段 ' + (i+1) + '\\n\\n核对采样、基因注释与系统发育背景，说明假设与交付物。').join('\\n\\n');
const answer = {kind:'assistant',id:'answer',text:body,thinking:'',tools:[],timestamp:2000};
let state = {...emptyTranscript(), messages:[user,answer], agentActive:true};
const publish = () => {
 if(lan) useLanStore.setState({transcripts:{'report-ui':state}, seeded:false});
 else useTranscriptStore.setState({bySession:{'report-ui':{...state,pendingPermissions:[]}}});
};
window.reportFixture = {
 source,
 start(){state = {...emptyTranscript(),messages:[{...user,id:'user-'+Date.now()},answer],agentActive:true};publish();},
 finish(){state={...state,agentActive:false,runEndedAt:65000,messages:[state.messages[0],{...answer,text:body+'\\n\\n**结论**：先明确物种范围，再补充方法原文。 [['+source+']]\\n\\n【有提醒】17 处来源中，已核对 12 处，另外 5 处未逐条核验；内容已完整保留。'}]};publish();},
 clear(){state={...emptyTranscript(),messages:[]}; if(lan)useLanStore.setState({transcripts:{}});},
 opened(){return useKnowledgeStore.getState().dialog?.note;}
};
publish();
createRoot(document.getElementById('root')).render(<div style={{height:'100vh',maxWidth:900,margin:'0 auto',display:'flex',flexDirection:'column'}}>{lan?<ChatView sessionId="report-ui" isDark={false}/>:<MessageList/>}</div>);
`,
);
await writeFile(
	join(root, "style.css"),
	`@import ${modulePath("renderer/src/styles/globals.css")};
@source ${modulePath("renderer/src")};
html,body,#root{margin:0;height:100%;background:var(--color-canvas);color:var(--color-ink);font-family:system-ui}`,
);
await writeFile(
	join(root, "index.html"),
	'<!doctype html><html><head><meta charset="utf-8"><script>localStorage.setItem("pi-desktop.lang","zh")</script></head><body><div id="root"></div><script type="module" src="./entry.tsx"></script></body></html>',
);
const server = await createServer({
	configFile: false,
	root,
	base: "./",
	logLevel: "warn",
	plugins: [react(), tailwind()],
	server: { host: "127.0.0.1", port: 0, hmr: false, watch: null, fs: { allow: [root, repo] } },
	cacheDir: join(repo, "node_modules/.vite/report-ui"),
	optimizeDeps: {
		include: ["react", "react-dom/client", "react/jsx-runtime", "markstream-react", "zustand"],
	},
	resolve: {
		alias: { react: join(repo, "node_modules/react"), "react-dom": join(repo, "node_modules/react-dom") },
	},
});
await server.listen();
const url = server.resolvedUrls.local[0];
await writeFile(
	join(root, "main.cjs"),
	`
const {app,BrowserWindow}=require('electron');
const {writeFileSync}=require('node:fs');
const assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(join(root, "profile"))});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const results=[];
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:960,height:800,show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
 const errors=[];
 win.webContents.on('did-navigate',(_event,url)=>console.log('UI navigation:',url));
 win.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message)});
 const js=async code=>{try{return await win.webContents.executeJavaScript(code,true)}catch(error){console.error('Failed UI expression:',code,errors);throw error}};
 async function until(code){for(let i=0;i<100;i++){if(await js(code))return;await pause(80)}throw Error('UI timeout: '+code)}
 try{
  for(const lan of [false,true]){
   await win.loadURL('about:blank');
   await win.loadURL(${JSON.stringify(url)}+(lan?'#lan':''));
   await pause(2500);
   console.log('Checking surface:',lan?'LAN':'desktop');
   await until('Boolean(window.reportFixture)');
   const selector=lan?'.chat-scroll':'.chat-scrollbar';
   await until('Boolean(document.querySelector('+JSON.stringify(selector)+'))');
   await js('window.scrollNode=document.querySelector('+JSON.stringify(selector)+')');
   await until('scrollNode.scrollHeight>scrollNode.clientHeight+500');
   await js('window.reportFixture.finish()');
   await until('scrollNode.scrollHeight-scrollNode.clientHeight-scrollNode.scrollTop<4');
   const citation='a[href^="#drone-note="]';
   await until('Boolean(document.querySelector('+JSON.stringify(citation)+'))');
   await js('document.querySelector('+JSON.stringify(citation)+').dispatchEvent(new MouseEvent("mouseover",{bubbles:true}))');
   await until('document.querySelector("[role=tooltip]")?.textContent===window.reportFixture.source');
   const link=await js('(()=>{const a=document.querySelector('+JSON.stringify(citation)+');return {text:a.textContent,title:document.querySelector("[role=tooltip]").textContent,href:a.getAttribute("href")}})()');
   await js('document.querySelector('+JSON.stringify(citation)+').dispatchEvent(new MouseEvent("mouseout",{bubbles:true}))');
   assert(link.text.length<=41 && !link.text.includes('ec996d3ae6a33ca7'), 'short source title');
   assert.equal(link.title,await js('window.reportFixture.source'),'full path tooltip');
   assert.equal(decodeURIComponent(link.href.split('=')[1]),link.title,'exact target');
   const inspector=lan?'[data-testid=lan-run-inspector]':'[data-testid=run-inspector]';
   await until('Boolean(document.querySelector('+JSON.stringify(inspector)+'))');
   await js('document.querySelector('+JSON.stringify(inspector+' summary')+').click()');
   assert(await js('document.querySelector('+JSON.stringify(inspector)+').open'),'inspector opens');
   await js('document.querySelector('+JSON.stringify(citation)+').click()');
   if(lan) await until('Boolean(document.querySelector(".citation-detail"))');
   else await until('window.reportFixture.opened()===window.reportFixture.source');
   await js('window.reportFixture.start()');
   await pause(250);
   await js('scrollNode.scrollTop=100;scrollNode.dispatchEvent(new Event("scroll"))');
   await pause(80);
   await js('window.reportFixture.finish()');
   await pause(450);
   assert((await js('scrollNode.scrollTop'))<150,'completion respects scroll-up');
   if(lan){
    await js('window.reportFixture.clear()');await pause(100);
    await js('window.reportFixture.start()');
    await until('Boolean(document.querySelector(".chat-scroll"))');
    await js('window.scrollNode=document.querySelector(".chat-scroll");window.reportFixture.finish()');
    await until('scrollNode.scrollHeight-scrollNode.clientHeight-scrollNode.scrollTop<4');
   } else {
    await js('window.reportFixture.start()');await pause(200);
    await js('window.reportFixture.finish()');
    await until('scrollNode.scrollHeight-scrollNode.clientHeight-scrollNode.scrollTop<4');
   }
   writeFileSync(${JSON.stringify(root)}+'/'+(lan?'lan':'desktop')+'.png',(await win.webContents.capturePage()).toPNG());
   results.push({surface:lan?'lan':'desktop',shortTitle:link.text,tooltip:link.title,completionFollows:true,userScrollPreserved:true,linkClick:true,inspector:true});
  }
  assert.equal(errors.length,0,errors.join('\\n'));
  writeFileSync(${JSON.stringify(join(root, "result.json"))},JSON.stringify({passed:true,results},null,2));
  console.log(JSON.stringify({passed:true,results,root:${JSON.stringify(root)}}));
  win.destroy();app.quit();
 }catch(error){console.error(error.stack,errors);writeFileSync(${JSON.stringify(join(root, "failure.png"))},(await win.webContents.capturePage()).toPNG());app.exit(1)}
});
`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [join(root, "main.cjs")], { env, stdio: "inherit", windowsHide: true });
const watchdog = setTimeout(() => child.kill(), 60_000);
const code = await new Promise((resolve, reject) => {
	child.on("error", reject);
	child.on("exit", resolve);
});
clearTimeout(watchdog);
await server.close();
console.log("UI fixture:", root);
assert.equal(code, 0, "Electron UI smoke exit");
assert.equal(JSON.parse(await readFile(join(root, "result.json"), "utf8")).passed, true);
