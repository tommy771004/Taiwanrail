import { useEffect, useRef } from 'react';

interface AdSlotProps {
  slot: string;                     // ad unit id
  format?: 'auto' | 'fluid' | 'rectangle';
  layout?: 'in-article' | 'in-feed';
  className?: string;
  style?: React.CSSProperties;
}

export default function AdSlot({
  slot,
  format = 'auto',
  layout,
  className = '',
  style = { display: 'block' },
}: AdSlotProps) {
  const ref = useRef<HTMLModElement | null>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    try {
      // adsbygoogle is defined on window by the script in index.html
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
      pushed.current = true;
    } catch (err) {
      console.warn('AdSense push failed', err);
    }
  }, []);

  const client = import.meta.env.VITE_ADSENSE_CLIENT;
  if (!client) return null;  // hide in dev / when not configured

  return (
    <ins
      ref={ref}
      className={`adsbygoogle ${className}`}
      style={style}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format={format}
      data-ad-layout={layout}
      data-full-width-responsive="true"
    />
  );
}
