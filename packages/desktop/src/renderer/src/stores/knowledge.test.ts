import { beforeEach, expect, it } from "vitest";
import { useKnowledgeStore } from "./knowledge";
import type { KnowledgeFlow } from "@percho/shared";
const flow=(id:string,updatedAt:number):KnowledgeFlow=>({sessionId:id,turnId:'turn',vaultId:'v',bindingRevision:1,vault:'/fixture',project:'p',phase:'navigation',updatedAt,navigation:[],reads:[],search:null,publication:null});
beforeEach(()=>useKnowledgeStore.setState({flows:{},revision:0,dialog:null,notice:null}));
it('retains independent per-session phases',()=>{const s=useKnowledgeStore.getState();s.apply({kind:'flow',flow:flow('A',1)});s.apply({kind:'flow',flow:flow('B',2)});expect(Object.keys(useKnowledgeStore.getState().flows)).toEqual(['A','B']);});
it('older snapshots cannot replace live progress',()=>{const s=useKnowledgeStore.getState();s.apply({kind:'flow',flow:flow('A',10)});s.apply({kind:'flow',flow:{...flow('A',1),phase:'blocked'}});expect(useKnowledgeStore.getState().flows.A?.phase).toBe('navigation');});
it('caps retained sessions and does not update all transcripts',()=>{for(let i=0;i<70;i++)useKnowledgeStore.getState().apply({kind:'flow',flow:flow(String(i),i)});expect(Object.keys(useKnowledgeStore.getState().flows)).toHaveLength(64);expect(useKnowledgeStore.getState().flows['0']).toBeUndefined();});
it('dialog carries the originating project and proposal',()=>{useKnowledgeStore.getState().open({cwd:'/project-a',sessionId:'A',tab:'reviews',id:'proposal'});expect(useKnowledgeStore.getState().dialog?.cwd).toBe('/project-a');useKnowledgeStore.getState().close();expect(useKnowledgeStore.getState().dialog).toBeNull();});
