import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Tick01Icon } from '@hugeicons/core-free-icons';

export type RuntimeOption<T extends string | number> = {
  value: T; label: string;
};

/** Keyboard-accessible glass listbox. No OS-native select popup, so the entire
 *  surface follows the host HTML's measured light/dark appearance. */
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
  const [above, setAbove] = useState(false);
  const [focused, setFocused] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, options.findIndex(option => option.value === value));

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useEffect(() => {
    if (open) choices.current[focused]?.focus();
  }, [open, focused]);

  function toggle() {
    if (open) { setOpen(false); return; }
    const rect = trigger.current?.getBoundingClientRect();
    const roomBelow = window.innerHeight - (rect?.bottom ?? 0);
    const roomAbove = rect?.top ?? 0;
    setAbove(roomBelow < Math.min(options.length * 37 + 12, 250) && roomAbove > roomBelow);
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
  return <div className="html-runtime-field" data-open={open} ref={root}>
    <span id={id + '-label'} className="html-runtime-label">{label}</span>
    <motion.button ref={trigger} type="button" className="html-runtime-select-trigger"
      aria-haspopup="listbox" aria-expanded={open} aria-labelledby={id + '-label ' + id + '-value'}
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
    <AnimatePresence>
      {open && <motion.div id={id + '-options'}
        role="listbox" aria-labelledby={id + '-label'}
        className={'html-runtime-options' + (above ? ' is-above' : '')}
        initial={reduce ? false : { opacity: 0, y: above ? 5 : -5, scale: .97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: above ? 4 : -4, scale: .98 }}
        transition={{ duration: reduce ? 0 : .19, ease: [0.22, 1, 0.36, 1] }}
        onKeyDown={handleKey}>
        {options.map((option, index) => <motion.button key={option.value} type="button"
          ref={element => { choices.current[index] = element; }}
          role="option" aria-selected={option.value === value}
          className="html-runtime-option"
          tabIndex={index === focused ? 0 : -1}
          onClick={() => choose(option.value)}
          onFocus={() => setFocused(index)}
          whileHover={reduce ? undefined : { x: 1 }}
          whileTap={reduce ? undefined : { scale: .985 }}
          transition={{ duration: reduce ? 0 : .12 }}>
          <span>{option.label}</span>
          {option.value === value && <HugeiconsIcon icon={Tick01Icon} size={15} strokeWidth={1.75} />}
        </motion.button>)}
      </motion.div>}
    </AnimatePresence>
  </div>;
}
