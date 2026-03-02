import { useState, useEffect } from 'react';

interface UseApiDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApiData<T>(
  fetcher: (() => Promise<T>) | null,
): UseApiDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(fetcher !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fetcher) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  return { data, loading, error };
}
