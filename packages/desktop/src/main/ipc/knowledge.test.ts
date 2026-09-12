import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({handlers:new Map<string,(event:any,input:any)=>any>(),window:{isDestroyed:()=>false,webContents:{send:vi.fn()}},openPath:vi.fn(async()=>''),openExternal:vi.fn(async()=>{}),from:vi.fn()}));
vi.mock('electron',()=>({ipcMain:{handle:(name:string,fn:any)=>mocks.handlers.set(name,fn)},BrowserWindow:{fromWebContents:mocks.from,getAllWindows:()=>[mocks.window]},shell:{openPath:mocks.openPath,openExternal:mocks.openExternal}}));
import { registerKnowledgeIpc } from './knowledge';
import { IpcChannels } from '@percho/shared';
let backend:any;
beforeEach(()=>{mocks.handlers.clear();mocks.from.mockReturnValue(mocks.window);backend={knowledge:{overview:vi.fn(async()=>({bound:false})),setupPreview:vi.fn(),jobs:vi.fn(),reviews:vi.fn(),preview:vi.fn(),decide:vi.fn(),read:vi.fn(),maintain:vi.fn(),openTarget:vi.fn(async()=>({kind:'note',path:'/fixture/Vault/note.md'})),subscribe:vi.fn()},startKnowledgeSetup:vi.fn(),resumeKnowledgeCheck:vi.fn()};registerKnowledgeIpc(backend);});
it('rejects requests from child frames and non-application windows',()=>{const frame={};const handler=mocks.handlers.get(IpcChannels.KnowledgeReviewDecide)!;expect(()=>handler({sender:{mainFrame:frame},senderFrame:{}},{token:'x'})).toThrow('main frame');mocks.from.mockReturnValue(null);expect(()=>handler({sender:{mainFrame:frame},senderFrame:frame},{token:'x'})).toThrow('main frame');expect(backend.knowledge.decide).not.toHaveBeenCalled();});
it('passes the exact preview capability to the host API',async()=>{const frame={},input={cwd:'/fixture',token:'exact-preview',decision:'apply'};await mocks.handlers.get(IpcChannels.KnowledgeReviewDecide)!({sender:{mainFrame:frame},senderFrame:frame},input);expect(backend.knowledge.decide).toHaveBeenCalledWith(input);});
it('opens only backend-resolved knowledge paths',async()=>{const frame={};await mocks.handlers.get(IpcChannels.KnowledgeOpen)!({sender:{mainFrame:frame},senderFrame:frame},{path:'note.md',revision:1});expect(mocks.openExternal).toHaveBeenCalledWith('obsidian://open?path=%2Ffixture%2FVault%2Fnote.md');});

it('specialist mode writes require the same main-frame restriction as approvals',()=>{
 const frame={};const handler=mocks.handlers.get(IpcChannels.KnowledgeSpecialistsSettings)!;
 expect(()=>handler({sender:{mainFrame:frame},senderFrame:{}},{mode:'automatic',revision:0,bindingRevision:1})).toThrow('main frame');
});
it('passes explicit specialist settings and both versions to the human host API',async()=>{
 backend.knowledge.specialistSettings=vi.fn(async()=>({mode:'off',revision:1}));
 const frame={},input={mode:'off',revision:0,bindingRevision:1};
 await mocks.handlers.get(IpcChannels.KnowledgeSpecialistsSettings)!({sender:{mainFrame:frame},senderFrame:frame},input);
 expect(backend.knowledge.specialistSettings).toHaveBeenCalledWith(input);
});
