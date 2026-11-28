// A deliberately conservative, bounded Markdown-to-graph compiler. No inferred
// runtime dependencies: edges represent explicit arrows or source hierarchy.
export type ArchNode = { id: string; label: string; detail: string; line: number; depth: number; kind: 'section' | 'folder' | 'node' };
export type ArchEdge = { from: string; to: string; kind: 'contains' | 'flow' };
export type Architecture = { nodes: ArchNode[]; edges: ArchEdge[]; truncated: boolean };
const MAX_NODES = 240;
const MAX_SOURCE = 300_000;
const clean = (value: string) => value.trim().replace(/^\x60+|\x60+$/g, '').replace(/^\*\*(.*?)\*\*$/, '$1');
export function compileArchitecture(markdown: string): Architecture {
  const nodes: ArchNode[] = [], edges: ArchEdge[] = [];
  const headings: { level: number; node: ArchNode }[] = [];
  const stack: { indent: number; node: ArchNode }[] = [];
  const edgeKeys = new Set<string>();
  let truncated = markdown.length > MAX_SOURCE;
  function connect(from: ArchNode | undefined, to: ArchNode, kind: ArchEdge['kind']) {
    if (!from || from.id === to.id) return;
    const key = from.id + ':' + to.id + ':' + kind;
    if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({from:from.id,to:to.id,kind}); }
  }
  function add(label: string, detail: string, line: number, kind: ArchNode['kind'], parent?: ArchNode) {
    if (nodes.length >= MAX_NODES) { truncated = true; return undefined; }
    const n: ArchNode = { id:'n'+nodes.length, label:clean(label).slice(0,180),detail:detail.trim().slice(0,300),line,depth: Math.min(14,parent ? parent.depth+1 : 0),kind };
    if (!n.label) return undefined;
    nodes.push(n); connect(parent,n,'contains'); return n;
  }
  const section = () => headings.at(-1)?.node;
  function hierarchy(raw: string, indent: number, line: number) {
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const split = raw.match(/^(.*?)(?:\s{2,}#\s*|\s+[–—]\s+)(.+)$/);
    const label = split?.[1] ?? raw, detail = split?.[2] ?? '';
    const n = add(label,detail,line,label.trim().endsWith('/')?'folder':'node',stack.at(-1)?.node ?? section());
    if (n) stack.push({indent,node:n});
  }
  function flow(raw: string, line: number) {
    const parts = raw.split(/\s*(?:→|⟶|-->|->|⇒)\s*/).map(clean).filter(Boolean);
    if (parts.length < 2 || parts.length > 20) return false;
    const parent = section();
    let previous: ArchNode | undefined;
    for (const label of parts) {
      // Reuse only nodes at the same section level, not similarly named files in other trees.
      const existing = nodes.find(n => n.kind === 'node' && n.label === label && n.depth === (parent ? parent.depth + 1 : 0) &&
        (parent ? edges.some(e => e.kind === 'contains' && e.from === parent.id && e.to === n.id) : !edges.some(e => e.kind === 'contains' && e.to === n.id)));
      const n = existing ?? add(label,'',line,'node',parent);
      if (n) { connect(previous,n,'flow'); previous=n; }
    }
    stack.length=0; return true;
  }
  const lines = markdown.slice(0,MAX_SOURCE).split(/\r?\n/);
  for (let i=0;i<lines.length;i++) {
    if(nodes.length >= MAX_NODES) {truncated=true;break;}
    const line=lines[i], at=i+1;
    const fence=/^\s{0,3}(\x60{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if(fence) {
      const body: {raw:string;line:number}[]=[];
      const language=fence[2].toLowerCase();
      while(++i<lines.length) {
        const end=lines[i].trim();
        if(end.startsWith(fence[1][0].repeat(fence[1].length)) && new RegExp('^'+fence[1][0]+'{'+fence[1].length+',}$').test(end)) break;
        body.push({raw:lines[i],line:i+1});
      }
      // Do not treat source code as an architecture just because it is indented.
      if(!['','text','plaintext','tree','architecture','diagram','ascii','flow','mermaid'].includes(language)) continue;
      const treeLike=body.some(({raw})=>/^[\s│|]*(?:├──|└──|\|--|\x60--)/.test(raw)||/^\s*[\w@.][\w@./-]*\/(?:\s{2,}#.*)?\s*$/.test(raw));
      const flowLike=body.some(({raw})=>/→|⟶|-->|->|⇒/.test(raw));
      if(!treeLike&&!flowLike)continue;
      stack.length=0;
      for(const {raw,line:sourceLine} of body) {
        if(!raw.trim()||nodes.length>=MAX_NODES)continue;
        if(flowLike&&flow(raw.trim(),sourceLine))continue;
        if(!treeLike)continue;
        const branch=/^([\s│|]*)(?:├──|└──|\|--|\x60--)\s*(.*)$/.exec(raw);
        const indent=branch ? Math.floor(branch[1].replace(/\t/g,'    ').length/4)*4+4 : (raw.match(/^\s*/)?.[0].replace(/\t/g,'    ').length??0);
        const value=branch?.[2]??raw.trim();
        if(value && !/^[│|─\s]+$/.test(value))hierarchy(value,indent,sourceLine);
      }
      stack.length=0; continue;
    }
    const h=/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if(h) {
      stack.length=0;
      while(headings.length&&headings.at(-1)!.level>=h[1].length)headings.pop();
      const n=add(h[2],'',at,'section',section()); if(n)headings.push({level:h[1].length,node:n});continue;
    }
    const item=/^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if(item) {
      if(!flow(item[2],at))hierarchy(item[2],item[1].replace(/\t/g,'    ').length,at);
      continue;
    }
    if(/→|⟶|-->|->|⇒/.test(line)&&line.length<400)flow(line.trim(),at);
    else if(line.trim())stack.length=0;
  }
  return {nodes,edges,truncated};
}
export type PlacedNode = ArchNode & { x:number;y:number;width:number;height:number; lines:string[]; detailLines:string[] };
export function layoutArchitecture(graph: Architecture) {
  const positions: PlacedNode[]=[];
  let y=24;
  const maxDepth=Math.max(0,...graph.nodes.map(n=>n.depth));
  const lane=36, card=330;
  function wrap(text:string,limit:number) {
    if(!text)return [];
    const output:string[]=[]; let row='';
    for(const word of text.split(/\s+/)) {
      if(row&&row.length+word.length+1>limit){output.push(row);row='';}
      // Preserve long paths without letting them exceed card width.
      let rest=word;
      while(rest.length>limit){if(row){output.push(row);row='';}output.push(rest.slice(0,limit));rest=rest.slice(limit);}
      row+=(row?' ':'')+rest;
    }
    if(row)output.push(row);return output;
  }
  for(const n of graph.nodes) {
    const lines=wrap(n.label,34), detailLines=wrap(n.detail,42);
    const height=26+lines.length*19+detailLines.length*16+(detailLines.length?5:0);
    positions.push({...n,x:32+n.depth*lane,y,width:card,height,lines,detailLines});y+=height+22;
  }
  return {nodes:positions,width:Math.max(460,32+maxDepth*lane+card+96),height:y+8};
}
