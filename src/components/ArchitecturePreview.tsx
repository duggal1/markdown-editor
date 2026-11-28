import { Component, memo, useDeferredValue, useId, useMemo, useState, type ReactNode } from 'react';
import { compileArchitecture, layoutArchitecture } from '../lib/architecture';
type Style='sketch'|'standard';
type Palette='blue'|'multi';
function preference<T extends string>(key:string, choices:readonly T[], fallback:T):T {
  try { const v=localStorage.getItem(key); return choices.includes(v as T)?v as T:fallback; } catch{return fallback;}
}
function persist(key:string,value:string) { try{localStorage.setItem(key,value);}catch{/* optional */} }
class DiagramBoundary extends Component<{children:ReactNode;onFallback:()=>void},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<div className="architecture-empty" role="alert"><strong>Could not render this architecture.</strong><button onClick={()=>this.setState({failed:false})}>Retry</button><button onClick={this.props.onFallback}>View Markdown</button></div>:this.props.children;}
}
const inks=['var(--arch-blue)','var(--arch-green)','var(--arch-orange)','var(--arch-violet)','var(--arch-red)'];
function Diagram({markdown,style,palette,onFallback}:{markdown:string;style:Style;palette:Palette;onFallback:()=>void}) {
  const graph=useMemo(()=>compileArchitecture(markdown),[markdown]);
  const layout=useMemo(()=>layoutArchitecture(graph),[graph]);
  const byId=useMemo(()=>new Map(layout.nodes.map(n=>[n.id,n])),[layout.nodes]);
  const marker=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  if(!graph.nodes.length)return <div className="architecture-empty"><strong>No architecture structure found</strong><p>Use a folder tree, nested Markdown lists, headings or explicit A → B connections.</p><button onClick={onFallback}>View Markdown</button></div>;
  return <>
    <div className="architecture-summary"><span>{graph.nodes.length} nodes · {graph.edges.length} connections</span><span>Local rendering · source-backed</span></div>
    {graph.truncated&&<p className="architecture-limit" role="status">Showing the first supported section of this large document (up to 240 nodes). Your Markdown is unchanged.</p>}
    <div className="architecture-canvas" tabIndex={0} aria-label="Scrollable architecture diagram">
      <svg width={layout.width} height={layout.height} viewBox={'0 0 '+layout.width+' '+layout.height} role="img" aria-label="Architecture diagram" className={'architecture-svg '+style}>
        <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1L6 4L1 7" fill="none" stroke="var(--arch-blue)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></marker></defs>
        {graph.edges.map((e,i)=>{
          const a=byId.get(e.from),b=byId.get(e.to);if(!a||!b)return null;
          const y1=a.y+a.height/2,y2=b.y+b.height/2;
          const lane=e.kind==='flow'?layout.width-24-(i%6)*9:Math.min(a.x,b.x)-16;
          const start=e.kind==='flow'?a.x+a.width:a.x, end=e.kind==='flow'?b.x+b.width:b.x;
          const d=style==='sketch'?'M'+start+' '+y1+' Q'+lane+' '+y1+' '+lane+' '+(y1+(y2-y1)*.12)+' L'+lane+' '+(y2-(y2-y1)*.12)+' Q'+lane+' '+y2+' '+end+' '+y2:'M'+start+' '+y1+' H'+lane+' V'+y2+' H'+end;
          return <path key={e.from+':'+e.to+':'+e.kind} d={d} fill="none" stroke={e.kind==='flow'?'var(--arch-blue)':'var(--arch-line)'} strokeWidth={style==='sketch'?1.65:1.25} strokeLinecap="round" strokeLinejoin="round" markerEnd={e.kind==='flow'?'url(#'+marker+')':undefined}/>;
        })}
        {layout.nodes.map(n=>{
          const color=palette==='multi'?inks[(n.depth+(n.kind==='folder'?1:0))%inks.length]:inks[0];
          const w=n.width,h=n.height;
          const d='M 8 1 Q '+(w*.5)+' -2 '+(w-8)+' 2 Q '+w+' 2 '+(w-1)+' 10 L '+(w-2)+' '+(h-8)+' Q '+w+' '+h+' '+(w-10)+' '+(h-1)+' L 9 '+h+' Q -1 '+h+' 1 '+(h-9)+' L 2 10 Q 0 1 8 1 Z';
          return <g key={n.id} transform={'translate('+n.x+' '+n.y+')'}><title>{n.label+(n.detail?' — '+n.detail:'')+' (line '+n.line+')'}</title>
            {style==='sketch'?<><path d={d} fill="var(--arch-card)" stroke={color} strokeWidth="1.5"/><path d={d} fill="none" stroke={color} strokeWidth=".65" opacity=".32" transform="translate(1.2 -0.7)"/></>:<rect width={w} height={h} rx="9" fill="var(--arch-card)" stroke={color} strokeWidth="1.2"/>}
            {n.kind==='folder'?<path d="M15 15h7l3 3h9v11H15z" fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>:<circle cx="24" cy="23" r={n.kind==='section'?4:3} fill={color}/>}
            <text x="43" y="25" fill="var(--arch-ink)" fontSize="13.5" fontWeight={n.kind==='section'?500:450}>{n.lines.map((line,i)=><tspan key={i} x="43" dy={i?19:0}>{line}</tspan>)}</text>
            {n.detailLines.length>0&&<text x="43" y={25+(n.lines.length-1)*19+21} fill="var(--arch-muted)" fontSize="11.5">{n.detailLines.map((line,i)=><tspan key={i} x="43" dy={i?16:0}>{line}</tspan>)}</text>}
          </g>;
        })}
      </svg>
    </div>
    <div className="architecture-legend"><span>Line: hierarchy</span><span>Arrow: explicit flow</span></div>
  </>;
}
function ArchitecturePreview({markdown,onFallback}:{markdown:string;onFallback:()=>void}){
  const [style,setStyle]=useState<Style>(()=>preference('flow.architecture.style',['sketch','standard'],'sketch'));
  const [palette,setPalette]=useState<Palette>(()=>preference('flow.architecture.palette',['blue','multi'],'blue'));
  const value=useDeferredValue(markdown);
  return <article className="architecture-preview">
    <div className="architecture-toolbar"><div role="group" aria-label="Architecture style">{(['sketch','standard'] as const).map(s=><button key={s} type="button" aria-pressed={style===s} onClick={()=>{setStyle(s);persist('flow.architecture.style',s);}}>{s==='sketch'?'Sketch':'Standard'}</button>)}</div>
      <div role="group" aria-label="Architecture palette">{(['blue','multi'] as const).map(p=><button key={p} type="button" aria-pressed={palette===p} onClick={()=>{setPalette(p);persist('flow.architecture.palette',p);}}>{p==='blue'?'Blue':'Multicolor'}</button>)}</div></div>
    <DiagramBoundary onFallback={onFallback}><Diagram markdown={value} style={style} palette={palette} onFallback={onFallback}/></DiagramBoundary>
  </article>;
}
export default memo(ArchitecturePreview);
