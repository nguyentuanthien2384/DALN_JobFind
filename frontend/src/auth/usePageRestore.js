import { useEffect, useRef } from 'react';

// Browsers keep a page in the back/forward cache while it redirects to an SSO provider,
// so pressing Back shows it again with its "redirecting" state still set.
export default function usePageRestore(onRestore) {
  const latest = useRef(onRestore);
  latest.current = onRestore;
  useEffect(() => {
    const handle = event => { if (event.persisted) latest.current(); };
    window.addEventListener('pageshow', handle);
    return () => window.removeEventListener('pageshow', handle);
  }, []);
}
