import { useCallback, useEffect, useState } from 'react';

export type Theme = 'warm' | 'midnight';
const KEY = 'buddyTheme';

/** Theme toggle backed by [data-theme] on <html> + localStorage. */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem(KEY) as Theme) || 'warm';
    } catch {
      return 'warm';
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'warm' ? 'midnight' : 'warm')), []);
  return { theme, setTheme, toggle };
}
