import { useEffect, useRef, useState } from "react";

interface BundleCounterProps {
  from?: number;
  to?: number;
  duration?: number;
}

export default function BundleCounter({
  from = 150,
  to = 16,
  duration = 2400,
}: BundleCounterProps) {
  const [value, setValue] = useState(from);
  const [progress, setProgress] = useState(0);

  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;

        observer.disconnect();

        // Respect reduced-motion: jump straight to the final value, no animation.
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          setProgress(1);
          setValue(to);
          return;
        }

        const start = performance.now();

        const animate = (now: number) => {
          const p = Math.min((now - start) / duration, 1);

          const eased = easeOutCubic(p);

          setProgress(eased);

          setValue(Math.round(from - (from - to) * eased));

          if (p < 1) {
            requestAnimationFrame(animate);
          }
        };

        requestAnimationFrame(animate);
      },
      { threshold: 0.5 },
    );

    observer.observe(ref.current);

    return () => observer.disconnect();
  }, [from, to, duration]);

  // Red -> current text color
  const color = `color-mix(
    in srgb,
    #ef4444 ${(1 - progress) * 100}%,
    var(--text) ${progress * 100}%
  )`;

  return (
    <p
      ref={ref}
      className="stat mt-4 text-5xl font-bold tabular-nums"
      style={{ color }}
    >
      ~{value}MB
    </p>
  );
}
