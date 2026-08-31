import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') {
      setTheme(attr);
    } else {
      setTheme('dark'); // the bootstrap defaults unset visitors to dark
    }
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', next === 'dark' ? '#0c0c0b' : '#fcfcfb');
    try {
      localStorage.setItem('theme', next);
    } catch {
      // localStorage unavailable (private mode) - the toggle still works for the session.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={
        mounted ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme` : 'Toggle color theme'
      }
      aria-pressed={mounted ? theme === 'dark' : undefined}
      title="Toggle theme"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '2.25rem',
        height: '2.25rem',
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border)',
        background: 'transparent',
        color: 'var(--text-muted)',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '1rem', lineHeight: 1 }}>
        {mounted && theme === 'dark' ? '☀' : '☾'}
      </span>
    </button>
  );
}
