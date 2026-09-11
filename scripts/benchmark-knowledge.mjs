// Synthetic benchmark: no real Vault, credentials or provider requests.
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { configureObsidian } from '../.pi/lib/obsidian-workbench.mjs';
import { getKnowledgeService, closeKnowledgeServices } from '../.pi/lib/knowledge/service.mjs';
const sizes=process.argv.slice(2).map(Number);
if(!sizes.length)sizes.push(1000,10000);
if(sizes.some(n=>!Number.isSafeInteger(n)||n<1||n>50000))throw new Error('Use sizes from 1 through 50000');
const rows=[];
const original=process.env.PERCHO_KNOWLEDGE_DIR,desktop=process.env.PI_RESEARCH_DESKTOP_CONFIG;
try {
  for(const count of sizes){
    const root=await realpath(await mkdtemp(join(tmpdir(),'percho-kb-bench-')));
    const cwd=join(root,'project'),vault=join(root,'Vault');
    process.env.PERCHO_KNOWLEDGE_DIR=join(root,'app');delete process.env.PI_RESEARCH_DESKTOP_CONFIG;
    try {
      await mkdir(cwd);await configureObsidian({cwd,vault});
      let totalBytes=0;
      const paths=[];
      for(let base=0;base<count;base+=40){
        await Promise.all(Array.from({length:Math.min(40,count-base)},async(_,j)=>{
          const i=base+j,body=`# Synthetic evidence ${i}\n\nmarker${i} 螳蛉 自切 topic${i%64}\n\n`+
            'This is synthetic benchmark material, not a scientific finding.\n'.repeat(12)+
            '\n## Human review\nSynthetic fixture only.\n';
          totalBytes+=Buffer.byteLength(body);
          const path=`Library/Papers/note-${String(i).padStart(6,'0')}.md`;paths.push(path);
          await writeFile(join(vault,path),body);
        }));
      }
      const service=await getKnowledgeService();
      let begin=performance.now();const indexed=await service.request('reconcile');const initialMs=performance.now()-begin;
      const prep=await service.prepare({cwd,project:'benchmark',query:'synthetic evidence'});
      await service.request('reconcile');
      const before=await service.request('status'),latencies=[];
      for(let i=0;i<30;i++){
        begin=performance.now();
        const result=await service.search(prep.ticket,cwd,{query:`marker${Math.floor(i*count/30)}`,limit:5});
        latencies.push(performance.now()-begin);assert(result.hits.length>0);assert.equal(result.complete,true);
      }
      const after=await service.request('status');
      const readBefore=after.stats.bodyReads;begin=performance.now();
      await writeFile(join(vault,paths[0]),'# Incremental update\nuniquedeltatoken\n');
      await service.request('changed',{paths:[paths[0]]});const deltaMs=performance.now()-begin;
      const delta=await service.request('status');
      const found=await service.search(prep.ticket,cwd,{query:'uniquedeltatoken'});assert.equal(found.hits.length,1);
      await service.read(prep.ticket,cwd,{path:found.hits[0].path});
      // Publication latency is measured after indexing has settled, not while the
      // intentional mutation above is still delivering file-watcher events.
      let stable=0;const settleStarted=performance.now();
      while(stable<2&&performance.now()-settleStarted<5000){
        await new Promise(resolve=>setTimeout(resolve,200));
        const status=await service.request('status');
        stable=status.coverage==='ready'&&status.pendingChanges===0&&status.problems.length===0?stable+1:0;
      }
      assert.equal(stable,2,'Synthetic index did not reach a stable publication precondition');
      const refreshed=await service.search(prep.ticket,cwd,{query:'uniquedeltatoken'});assert.equal(refreshed.complete,true);
      const publication=[];
      const publicationBefore=await service.request('status');
      for(let i=0;i<30;i++){
        const start=performance.now();
        const proof=await service.validateAnswer(prep.ticket,cwd,`Fixture statement. [[${found.hits[0].path.slice(0,-3)}]]`);
        assert.equal(proof.status,'ready');publication.push(performance.now()-start);
      }
      const publicationAfter=await service.request('status');publication.sort((a,b)=>a-b);
      latencies.sort((a,b)=>a-b);
      const row={notes:count,syntheticMarkdownBytes:totalBytes,indexedNotes:indexed.noteCount,
        initialIndexMs:+initialMs.toFixed(2),warmSamples:latencies.length,
        warmMedianMs:+latencies[Math.floor(latencies.length/2)].toFixed(2),warmP95Ms:+latencies[Math.ceil(latencies.length*.95)-1].toFixed(2),
        hotBodyReads:after.stats.bodyReads-before.stats.bodyReads,hotFullReconciliations:after.stats.reconciliations-before.stats.reconciliations,
        oneNoteUpdateMs:+deltaMs.toFixed(2),oneNoteBodyReads:delta.stats.bodyReads-readBefore,
        publicationSamples:30,publicationMedianMs:+publication[15].toFixed(2),publicationP95Ms:+publication[28].toFixed(2),
        publicationBodyReads:publicationAfter.stats.bodyReads-publicationBefore.stats.bodyReads,
        publicationFullReconciliations:publicationAfter.stats.reconciliations-publicationBefore.stats.reconciliations};
      rows.push(row);console.error('Completed synthetic fixture:',count);
    } finally {await closeKnowledgeServices();await rm(root,{recursive:true,force:true});}
  }
} finally {
  if(original===undefined)delete process.env.PERCHO_KNOWLEDGE_DIR;else process.env.PERCHO_KNOWLEDGE_DIR=original;
  if(desktop===undefined)delete process.env.PI_RESEARCH_DESKTOP_CONFIG;else process.env.PI_RESEARCH_DESKTOP_CONFIG=desktop;
}
console.log(JSON.stringify({kind:'synthetic-local-only',node:process.version,platform:platform(),arch:arch(),
  measuredAt:new Date().toISOString(),includes:'local index search/navigation revalidation and stable-index one-source publication validation; excludes LLM, network and file-watcher settling time',rows},null,2));
