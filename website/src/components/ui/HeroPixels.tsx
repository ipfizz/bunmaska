import { useEffect, useState } from 'react';
import PixelBlast from './PixelBlast';

/** The pixel yellow per theme - a step brighter/yellower than the accent gold. */
const PIXEL_YELLOW = { light: '#c2870d', dark: '#d1a23e' } as const;

const readTheme = (): 'light' | 'dark' =>
  document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

/** The hero's PixelBlast layer, tuned for Maska Gold and recoloured when data-theme flips. */
export default function HeroPixels() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const update = () => setTheme(readTheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  if (!theme) return null;

  return (
    <PixelBlast
      variant="square"
      color={PIXEL_YELLOW[theme]}
      pixelSize={4}
      patternScale={2.5}
      patternDensity={0.85}
      pixelSizeJitter={0.3}
      speed={0.35}
      edgeFade={0.22}
      rippleThickness={0.11}
      rippleSpeed={0.35}
      transparent
    />
  );
}
