import { useEffect, useState } from 'react';
import { browserTimeZoneLabel } from '@infragate/ui';

export function useBrowserTimeZoneLabel(): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    setLabel(browserTimeZoneLabel());
  }, []);
  return label;
}
