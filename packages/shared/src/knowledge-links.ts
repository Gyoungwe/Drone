/** Display-only conversion: never change saved content or code examples. */
const PREFIX = "#percho-note=";
export function parseKnowledgeHref(href:string):string|null {
 if(!href.startsWith(PREFIX))return null;
 try {const path=decodeURIComponent(href.slice(PREFIX.length));
  return /^(?:Wiki|Library|Projects|Inbox|Indexes)\//.test(path)&&!path.split('/').some(p=>p==='..'||p==='.'||p.startsWith('.'))&&!/[\\\x00-\x1f]/.test(path)?path:null;
 } catch {return null;}
}
export function knowledgeLinksForDisplay(markdown:string):string {
 // Consume fenced/inline code before recognizing a Vault link.
 return markdown.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*|$)|(`+)[\s\S]*?\2|\[\[([^\]\n]+)\]\]/g,
  (whole,_fence,_inline,inner:string|undefined)=>{
   if(!inner)return whole;
   const [target,...labels]=inner.split('|'),raw=(target||'').split('#')[0]?.trim()||'';
   if(!/^(?:Wiki|Library|Projects|Inbox|Indexes)\//.test(raw))return whole;
   const path=raw.endsWith('.md')?raw:raw+'.md',href=PREFIX+encodeURIComponent(path);
   if(!parseKnowledgeHref(href))return whole;
   const label=(labels.join('|')||raw.replace(/\.md$/,'')).replace(/[\[\]<>]/g,'');
   return `[${label}](${href})`;
  });
}
