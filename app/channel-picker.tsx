'use client';
import { useId } from 'react';
import { Mail, Smartphone } from './icons';
export function ChannelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const name = useId();
  return (
    <fieldset className="channel-picker">
      <legend className="sr-only">Alert channel</legend>
      {[
        ['email', 'Email'],
        ['push', 'Browser push'],
      ].map(([channel, label]) => (
        <label key={channel}>
          <input
            type="radio"
            name={name}
            value={channel}
            checked={value === channel}
            onChange={() => onChange(channel)}
          />
          <span>
            {channel === 'email' ? (
              <Mail size={16} />
            ) : (
              <Smartphone size={16} />
            )}{' '}
            {label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
