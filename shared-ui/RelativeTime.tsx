import { exactTimeTitle, formatRelativeTime } from './time';

export default function RelativeTime({ value }: { value?: string }) {
  const label = formatRelativeTime(value);
  if (!label) return null;
  return (
    <time dateTime={value} title={exactTimeTitle(value)}>
      {label}
    </time>
  );
}
