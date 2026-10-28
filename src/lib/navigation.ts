import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Supports the global quick-add menu: navigating to `/clients?nouveau=1` marks
 * the flag, the list page opens its creation dialog on mount, and the flag is
 * removed from the URL so a refresh or back button does not reopen it.
 */
export function useNewRecordFlag(): boolean {
  const [params, setParams] = useSearchParams();
  const [flag] = useState(() => params.get('nouveau') === '1');

  useEffect(() => {
    if (params.has('nouveau')) {
      const next = new URLSearchParams(params);
      next.delete('nouveau');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  return flag;
}
