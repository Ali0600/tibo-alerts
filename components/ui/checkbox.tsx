'use client';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
function Checkbox({
  className,
  checked,
  onCheckedChange,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'checked'> & {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <input
      {...props}
      data-slot="checkbox"
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
      className={cn(
        'size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    />
  );
}
export { Checkbox };
