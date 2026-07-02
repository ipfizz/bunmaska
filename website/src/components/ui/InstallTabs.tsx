import { useState } from 'react';

const TABS = [
  { key: 'bun', label: 'bun', cmd: 'bun add bunmaska' },
  { key: 'npm', label: 'npm', cmd: 'npm install bunmaska' },
] as const;

type Key = (typeof TABS)[number]['key'];

export default function InstallTabs() {
  const [active, setActive] = useState<Key>('bun');
  const [copied, setCopied] = useState(false);
  const cmd = (TABS.find((t) => t.key === active) ?? TABS[0]).cmd;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access denied — the copy button is a progressive enhancement.
    }
  };

  return (
    <div className="w-full max-w-132 overflow-hidden rounded-lg border border-border bg-surface text-left">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex gap-1" role="tablist" aria-label="Package manager">
          {TABS.map((t) => {
            const on = active === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setActive(t.key)}
                className={
                  'rounded-sm px-2.5 py-1 text-sm transition-colors ' +
                  (on
                    ? 'bg-bg-subtle font-medium text-text'
                    : 'text-text-faint hover:text-text-muted')
                }
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy install command"
          className={'copy-btn copy-btn--light' + (copied ? ' copied' : '')}
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-3.5 font-mono text-base">
        <span className="select-none text-text-faint" aria-hidden="true">
          $
        </span>
        <span className="text-text">{cmd}</span>
      </div>
    </div>
  );
}
