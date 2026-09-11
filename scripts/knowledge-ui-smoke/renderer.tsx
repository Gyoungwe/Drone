// Test-only entry: real UI components, real knowledge IPC, no model provider.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {KnowledgePanel} from '../../packages/desktop/src/renderer/src/components/knowledge/KnowledgePanel';
import {KnowledgeUiRoot} from '../../packages/desktop/src/renderer/src/components/knowledge/KnowledgeUiRoot';
import {KnowledgeFlowCard} from '../../packages/desktop/src/renderer/src/components/knowledge/KnowledgeFlowCard';
import {useSessionsStore} from '../../packages/desktop/src/renderer/src/stores/sessions';
const info=await (window as any).knowledgeTest.info();
useSessionsStore.setState({cwd:info.cwd,activeSessionId:'fixture',sessions:[{sessionId:'fixture',cwd:info.cwd,name:'隔离 UI 验收',active:true,messageCount:0,createdAt:Date.now()}]});
createRoot(document.getElementById('root')!).render(<div style={{maxWidth:1080,margin:'0 auto',padding:16}}>
 <div className="mb-3 text-[10px] tracking-wider text-ink-dim">PERCHO / KNOWLEDGE · 隔离测试库，不是用户正式笔记</div>
 <KnowledgeFlowCard sessionId="fixture"/>
 <div className="rounded-2xl border border-border bg-surface p-4"><KnowledgePanel context={{cwd:info.cwd,sessionId:'fixture'}}/></div>
 <KnowledgeUiRoot/>
</div>);
