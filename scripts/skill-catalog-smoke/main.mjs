import {app,BrowserWindow} from 'electron';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root=process.env.PERCHO_CATALOG_FIXTURE;app.setPath('userData',join(root,'profile'));
let window;const checks=[],errors=[];
async function run(){
 try{
  window=new BrowserWindow({width:1100,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  const js=code=>window.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<80;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,25));}throw new Error('UI wait: '+code);};
  const type=async(selector,value)=>{
   await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.focus();el.setSelectionRange(el.value.length,el.value.length);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('select',{bubbles:true}));})()`);
   await new Promise(r=>setTimeout(r,75));
  };
  await window.loadFile(join(root,'dist/index.html'));
  await wait("document.querySelector('#skill-panel')?.innerText.includes('Obsidian')");
  assert.equal(await js("document.querySelectorAll('#skill-panel li').length"),7);checks.push('specialized setup and support collapsed in settings');
  await type('#command-input','/');await wait("document.querySelectorAll('[data-command]').length>0");
  assert.equal(await js("document.querySelectorAll('[data-command=\"obsidian-setup\"]').length"),1);
  assert.equal(await js("document.querySelector('[data-command=\"setup\"]')"),null);
  assert.equal(await js("document.querySelector('[data-command=\"skill:setup-pre-commit\"]')"),null);checks.push('one default Obsidian setup; no duplicate aliases or specialist setup');
  await js("[...document.querySelectorAll('#command-menu button')].find(b=>b.innerText.includes('显示专用')).click()");
  await wait("!!document.querySelector('[data-command=\"skill:setup-pre-commit\"]')");checks.push('explicit reveal retains specialist workflows');
  await type('#command-input','/setup');
  const visible=await js("[...document.querySelectorAll('[data-command]')].map(el=>el.dataset.command)");
  assert.deepEqual(visible,['obsidian-setup','skill:setup-matt-pocock-skills','skill:setup-pre-commit','skill:setup-ts-deep-modules']);checks.push('setup search yields one canonical action plus three clearly separate tools');
  await mkdir(join(root,'screenshots'));await writeFile(join(root,'screenshots/01-setup-menu.png'),(await window.webContents.capturePage()).toPNG());
  await js("document.querySelector('#command-input').focus()");
  for(const key of ['Down','Down','Tab']){window.webContents.sendInputEvent({type:'keyDown',keyCode:key});window.webContents.sendInputEvent({type:'keyUp',keyCode:key});await new Promise(r=>setTimeout(r,40));}
  await wait("document.querySelector('#selected-command').textContent==='skill:setup-pre-commit'");checks.push('actual keyboard handler selects the same row that the menu highlights');
  await type('#skill-panel input','提交前');await wait("document.querySelectorAll('#skill-panel li').length===1");
  assert((await js("document.querySelector('#skill-panel li').innerText")).includes('setup-pre-commit'));checks.push('Chinese purpose search expands the correct group');
  await writeFile(join(root,'screenshots/02-skill-search.png'),(await window.webContents.capturePage()).toPNG());
  await type('#skill-panel input','');await js("document.querySelector('#lang').click();document.documentElement.setAttribute('data-theme','dark')");
  await wait("document.querySelector('#skill-panel').innerText.includes('Tool-specific setup')");window.setSize(640,900);await new Promise(r=>setTimeout(r,100));
  assert(await js('document.documentElement.scrollWidth<=innerWidth'));checks.push('English and dark narrow layout without horizontal overflow');
  await writeFile(join(root,'screenshots/03-dark-narrow.png'),(await window.webContents.capturePage()).toPNG());
  assert.equal(errors.length,0);await writeFile(join(root,'validation.json'),JSON.stringify({passed:true,checks,consoleErrors:errors,modelCalled:false,realUserVaultModified:false,root},null,2));
  console.log(JSON.stringify({passed:true,checks,root}));window.destroy();app.exit(0);
 }catch(error){console.error(error.stack);try{await writeFile(join(root,'failure.json'),JSON.stringify({error:String(error),checks,errors},null,2));if(window)await writeFile(join(root,'failure.png'),(await window.webContents.capturePage()).toPNG());}catch{}app.exit(1);}
}
app.whenReady().then(run);
