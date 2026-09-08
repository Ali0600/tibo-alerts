'use client';
import { createContext, useContext, useId, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
const Group = createContext({
  name: '',
  value: '',
  change: (_value: string) => {},
});
function RadioGroup({
  className,
  value,
  onValueChange,
  children,
  ...props
}: Omit<ComponentProps<'fieldset'>, 'onChange'> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const name = useId();
  return (
    <Group.Provider value={{ name, value, change: onValueChange }}>
      <fieldset
        data-slot="radio-group"
        className={cn('grid gap-2 w-full', className)}
        {...props}
      >
        {children}
      </fieldset>
    </Group.Provider>
  );
}
function RadioGroupItem({
  className,
  value,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'type'> & { value: string }) {
  const group = useContext(Group);
  return (
    <input
      {...props}
      data-slot="radio-group-item"
      type="radio"
      name={group.name}
      value={value}
      checked={group.value === value}
      onChange={() => group.change(value)}
      className={cn(
        'size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2',
        className,
      )}
    />
  );
}
export { RadioGroup, RadioGroupItem };
