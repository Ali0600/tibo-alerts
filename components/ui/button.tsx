import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Button({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'button'> & { variant?: 'default' | 'outline' }) {
  return (
    <button
      data-slot="button"
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0',
        variant === 'outline'
          ? 'border-border bg-background hover:bg-muted'
          : 'bg-primary text-primary-foreground hover:opacity-90',
        className,
      )}
      {...props}
    />
  );
}
