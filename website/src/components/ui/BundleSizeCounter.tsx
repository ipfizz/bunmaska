import { useEffect, useRef, useState } from 'react';

interface BundleCounterProps {
  from?: number;
  to?: number;
  duration?: number;
}

/**
 * The download-size stat. It RESTS at the true value (~16 MB) — SSR, no-JS and
 * post-animation all read correctly — and only when scrolled into view does it
 * replay Electron's 150 MB collapsing down to Bunmaska's 16, once.
 */
export default function BundleCounter({
  from = 150,
  to = 16,
  duration = 1800,
}: BundleCounterProps) {
  const [value, setValue] = useState(to);
  const [progress, setProgress] = useState(1);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const animate = (now: number) => {
          const p = Math.min((now - start) / duration, 1);
          const eased = easeOutCubic(p);
          setProgress(eased);
          setValue(Math.round(from - (from - to) * eased));
          if (p < 1) requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
      },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [from, to, duration]);

  const color = `color-mix(in srgb, var(--danger) ${(1 - progress) * 100}%, var(--accent-text) ${progress * 100}%)`;

  return (
    <p ref={ref} className="stat tabular-nums" style={{ color }}>
      ~{value}&thinsp;MB
    </p>
  );
}
