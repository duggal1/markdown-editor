import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const hover = useRef<HTMLDivElement>(null);
  const suppressFocus = useRef(false);
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
      if (root.current?.contains(document.activeElement)) {
        suppressFocus.current = true;
        trigger.current?.focus({ preventScroll: true });
        suppressFocus.current = false;
      }
      keyboard.current = false;
      touch.current = false;
      setOpen(false);
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
    if (!entries.length) return;
    setActive(activeOutlineIndex(entries, getPosition()));
    setMounted(true);
    setOpen(true);
  };
  const leave = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      if (!keyboard.current && !touch.current) setOpen(false);
    }, 85);
  };
  const moveHighlight = (row: HTMLElement | null) => {
    const indicator = hover.current;
    if (!indicator) return;
    if (!row) { indicator.dataset.visible = 'false'; return; }
    const top = row.offsetTop;
    indicator.style.transform = 'translateY(' + top + 'px)';
    indicator.dataset.visible = 'true';
  };
  useLayoutEffect(() => {
    if (!open) { moveHighlight(null); return; }
    const scroll = list.current;
    const row = scroll?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!scroll || !row) return;
    const top = row.offsetTop;
    if (top < scroll.scrollTop || top + row.offsetHeight > scroll.scrollTop + scroll.clientHeight) {
      scroll.scrollTop = Math.max(0, top - (scroll.clientHeight - row.offsetHeight) / 2);
    }
  }, [open, active]);
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
      aria-label="Show table of contents" aria-expanded={open} aria-controls={mounted ? panelId : undefined}
      onPointerDown={event => { touch.current = event.pointerType === 'touch'; keyboard.current = false; }}
      onFocus={event => {
        if (!suppressFocus.current && event.currentTarget.matches(':focus-visible')) { keyboard.current = true; reveal(); }
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
    {mounted && <div ref={panel} id={panelId} className="page-outline-panel" data-open={open}
      inert={!open} aria-hidden={!open}>
      <div ref={list} className="page-outline-list" onPointerOver={event => {
        if (event.pointerType === 'touch') return;
        moveHighlight(event.target instanceof Element ? event.target.closest<HTMLElement>('.page-outline-item') : null);
      }} onPointerLeave={() => moveHighlight(null)}>
        <div className="page-outline-track">
          <div ref={hover} className="page-outline-hover" data-visible="false" aria-hidden="true" />
        {entries.map((item, index) => <button key={item.line} type="button"
          className="page-outline-item" aria-current={active === index ? 'location' : undefined}
          style={{ paddingInlineStart: 8 + Math.min(item.level - 1, 5) * 9 }}
          title={item.title}
          onFocus={event => moveHighlight(event.currentTarget)}
          onBlur={() => moveHighlight(null)}
          onClick={() => {
            onJump(item.line);
            setActive(index);
            touch.current = false;
            if (keyboard.current) {
              suppressFocus.current = true;
              trigger.current?.focus({ preventScroll: true });
              suppressFocus.current = false;
            }
            keyboard.current = false;
            setOpen(false);
          }}><span>{item.title}</span></button>)}
        </div>
      </div>
    </div>}
  </nav>;
}
