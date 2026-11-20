import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick01Icon } from '@hugeicons/core-free-icons';

export type RuntimeOption<T extends string | number> = {
  value: T; label: string;
};

type MenuPosition = { left: number; top: number; width: number; maxHeight: number; above: boolean };

/** A real glass menu must not be nested inside another backdrop-filter root:
 *  portal it beside the panel so the filtered pixels come from the HTML page. */
export default function RuntimeSelect<T extends string | number>({
  label, value, options, onChange,
}: {
  label: string; value: T;
  options: readonly RuntimeOption<T>[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(0);
  const [position, setPosition] = useState<MenuPosition>({
    left: 0, top: 0, width: 0, maxHeight: 240, above: false,
  });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, options.findIndex(option => option.value === value));
  const host = typeof document === 'undefined' ? null
    : document.querySelector<HTMLElement>('.html-play-page');

  function measure(): void {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const desired = Math.min(options.length * 36 + 12, 248, window.innerHeight * .4);
    const below = window.innerHeight - rect.bottom - 9;
    const above = rect.top - 9;
    const opensAbove = below < desired && above > below;
    const maxHeight = Math.max(34, Math.min(desired, opensAbove ? above : below));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
    const top = opensAbove
      ? Math.max(8, rect.top - maxHeight - 5)
      : Math.min(window.innerHeight - maxHeight - 8, rect.bottom + 5);
    setPosition(previous =>
      previous.left === left && previous.top === top &&
      previous.width === rect.width && previous.maxHeight === maxHeight &&
      previous.above === opensAbove
        ? previous
        : { left, top, width: rect.width, maxHeight, above: opensAbove });
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !listbox.current?.contains(target)) {
        setOpen(false);
      }
    };
    // Resize/scroll can move the anchor. Keep its menu attached to it.
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) choices.current[focused]?.focus();
  }, [open, focused]);

  function toggle() {
    if (open) { setOpen(false); return; }
    measure();
    setFocused(selected);
    setOpen(true);
  }
  function choose(next: T) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }
  function handleKey(event: KeyboardEvent<HTMLElement>) {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      toggle();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setFocused(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    }
    if (event.key === 'Home') { event.preventDefault(); setFocused(0); }
    if (event.key === 'End') { event.preventDefault(); setFocused(options.length - 1); }
  }

  const menu = <AnimatePresence>
    {open && <motion.div id={id + '-options'} ref={listbox}
      role="listbox" aria-labelledby={id + '-label'}
      className="html-runtime-options html-runtime-options-portal"
      style={{ left: position.left, top: position.top, width: position.width,
        maxHeight: position.maxHeight }}
      initial={reduce ? false : { opacity: 0, y: position.above ? 5 : -5, scale: .98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0, transition: { duration: 0 } }
        : { opacity: 0, y: position.above ? 3 : -3, scale: .99 }}
      transition={{ duration: reduce ? 0 : .18, ease: [0.22, 1, 0.36, 1] }}
      onKeyDown={handleKey}>
      {options.map((option, index) => <motion.button key={option.value}
        type="button"
        ref={element => { choices.current[index] = element; }}
        role="option" aria-selected={option.value === value}
        className="html-runtime-option" tabIndex={index === focused ? 0 : -1}
        onClick={() => choose(option.value)} onFocus={() => setFocused(index)}
        whileHover={reduce ? undefined : { x: 1 }}
        whileTap={reduce ? undefined : { scale: .985 }}
        transition={{ duration: reduce ? 0 : .12 }}>
        <span>{option.label}</span>
        {option.value === value && <HugeiconsIcon icon={Tick01Icon} size={15} strokeWidth={1.75} />}
      </motion.button>)}
    </motion.div>}
  </AnimatePresence>;

  return <>
    <div className="html-runtime-field" data-open={open} ref={root}>
      <span id={id + '-label'} className="html-runtime-label">{label}</span>
      <motion.button ref={trigger} type="button" className="html-runtime-select-trigger"
        aria-haspopup="listbox" aria-expanded={open}
        aria-labelledby={id + '-label ' + id + '-value'}
        aria-controls={open ? id + '-options' : undefined}
        onClick={toggle} onKeyDown={handleKey}
        whileTap={reduce ? undefined : { scale: .985 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
        <span id={id + '-value'}>{options[selected]?.label}</span>
        <motion.span className="html-runtime-chevron" animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: reduce ? 0 : .18, ease: [0.22, 1, 0.36, 1] }}>
          <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.7} />
        </motion.span>
      </motion.button>
    </div>
    {host && createPortal(menu, host)}
  </>;
}
