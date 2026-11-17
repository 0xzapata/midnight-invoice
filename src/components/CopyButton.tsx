import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CopyButtonProps {
  /** Text to copy. Never shown in toasts or announcements (it may be a secret). */
  value: string;
  label: string;
  className?: string;
  variant?: 'outline' | 'ghost';
  showLabel?: boolean;
}

/** Copies `value` to the clipboard and confirms with a short, non-revealing message. */
export function CopyButton({ value, label, className, variant = 'outline', showLabel = true }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  const text = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;
  return (
    <Button type="button" variant={variant} size="sm" onClick={copy} className={cn('shrink-0', className)} aria-label={showLabel ? undefined : text}>
      {state === 'copied' ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
      {showLabel && <span>{text}</span>}
      <span className="sr-only" aria-live="polite">{state === 'idle' ? '' : text}</span>
    </Button>
  );
}
