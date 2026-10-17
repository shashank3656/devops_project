import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';

const LEAVE_MESSAGE = 'You have unsaved changes. Leave this page and discard them?';
const DIRTY_KEY = 'opstrellis-form-dirty';

/**
 * Warns before the tab closes or the user navigates away while `dirty` is true.
 * Call `allowLeave()` right before a successful submit redirects.
 */
export function useUnsavedChanges(dirty: boolean) {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  const bypassRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (dirty && !bypassRef.current) sessionStorage.setItem(DIRTY_KEY, '1');
    else sessionStorage.removeItem(DIRTY_KEY);
    return () => sessionStorage.removeItem(DIRTY_KEY);
  }, [dirty]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current || bypassRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onRouteChangeStart = (url: string) => {
      if (!dirtyRef.current || bypassRef.current) return;
      if (url === router.asPath) return;
      if (window.confirm(LEAVE_MESSAGE)) return;
      router.events.emit('routeChangeError');
      throw 'Route change cancelled because of unsaved changes.';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    router.events.on('routeChangeStart', onRouteChangeStart);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      router.events.off('routeChangeStart', onRouteChangeStart);
    };
  }, [router]);

  return {
    allowLeave: () => {
      bypassRef.current = true;
      sessionStorage.removeItem(DIRTY_KEY);
    },
  };
}
