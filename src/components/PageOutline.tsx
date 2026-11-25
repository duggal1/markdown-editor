import { useEffect, useId, useRef, useState } from 'react';
import { documentOutline, activeOutlineIndex, outlineMarkers, type OutlineEntry } from '../lib/outline';
import { detectRawCode } from '../lib/code';

type Props = {
  documentId: string;
  getSource: () => string;
  getPosition: () => number;
  onJump: (line: number) => void;
};

export default function PageOutline({ documentId, getSource, getPosition, onJump }: Props) {
  const panelId = useId();
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const closeTimer = useRef<number | undefined>(undefined);
  const keyboard = useRef(false);
  const touch = useRef(false);
  const cached = useRef<{ source: string; entries: OutlineEntry[] } | null>(null);
  const refresh = () => {
    const source = getSource();
    if (cached.current?.source === source) return cached.current.entries;
    const next = detectRawCode(source.slice(0, 12000)) ? [] : documentOutline(source);
    cached.current = { source, entries: next };
    setEntries(next);
    return next;
  };
  useEffect(() => {
    let timer: number | undefined;
    const update = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== documentId) return;
      clearTimeout(timer);
      timer = window.setTimeout(refresh, 180);
    };
    refresh();
    window.addEventListener('flow-outline-change', update);
    return () => {
      clearTimeout(timer);
      clearTimeout(closeTimer.current);
      window.removeEventListener('flow-outline-change', update);
    };
  // The source accessor is stable; only the document identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, getSource]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      if (root.current?.contains(document.activeElement)) trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const reveal = () => {
    clearTimeout(closeTimer.current);
    const next = refresh();
    if (!next.length) return;
    setActive(activeOutlineIndex(next, getPosition()));
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (!keyboard.current && !touch.current) setOpen(false);
    }, 100);
  };
  if (!entries.length) return null;
  return <nav ref={root} className="page-outline-rail" aria-label="Table of contents"
    onPointerEnter={event => { if (event.pointerType !== 'touch') reveal(); }}
    onPointerLeave={leave}
    onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        keyboard.current = false;
        touch.current = false;
        setOpen(false);
      }
    }}>
    <button ref={trigger} type="button" className="page-outline-trigger"
      aria-label="Show table of contents" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onPointerDown={event => { touch.current = event.pointerType === 'touch'; keyboard.current = false; }}
      onFocus={event => {
        if (event.currentTarget.matches(':focus-visible')) { keyboard.current = true; reveal(); }
      }}
      onClick={event => {
        if (touch.current || event.detail === 0) {
          if (open && touch.current) { touch.current = false; setOpen(false); }
          else reveal();
        } else reveal();
      }}>
      {outlineMarkers(entries).map(item => <span key={item.line} aria-hidden="true"
        className="page-outline-mark" style={{ width: Math.max(6, 20 - (item.level - 1) * 3) }} />)}
    </button>
    {open && <div id={panelId} className="page-outline-panel">
      <div className="page-outline-list">
        {entries.map((item, index) => <button key={item.line} type="button"
          className="page-outline-item" aria-current={active === index ? 'location' : undefined}
          style={{ paddingInlineStart: 8 + Math.min(item.level - 1, 5) * 9 }}
          title={item.title}
          onClick={() => {
            onJump(item.line);
            setActive(index);
            touch.current = false;
            if (keyboard.current) trigger.current?.focus();
            keyboard.current = false;
            setOpen(false);
          }}><span>{item.title}</span></button>)}
      </div>
    </div>}
  </nav>;
}
