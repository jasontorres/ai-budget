import type { ReactNode } from 'react';

export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <p className="eyebrow">{children}</p>
);

export const Headline = ({ children, size }: { children: ReactNode; size?: string }) => (
  <h2 className={`headline ${size || ''}`}>{children}</h2>
);

export const Dek = ({ children }: { children: ReactNode }) => <p className="dek">{children}</p>;

export const SectionHead = ({
  eyebrow,
  headline,
  dek,
  right,
  size,
}: {
  eyebrow?: ReactNode;
  headline: ReactNode;
  dek?: ReactNode;
  right?: ReactNode;
  size?: string;
}) => (
  <div className="flex between items-end" style={{ marginBottom: 18 }}>
    <div style={{ maxWidth: 760 }}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Headline size={size}>{headline}</Headline>
      {dek && <Dek>{dek}</Dek>}
    </div>
    {right && <div>{right}</div>}
  </div>
);

export const Pill = ({ children, kind }: { children: ReactNode; kind?: string }) => (
  <span className={`pill ${kind || ''}`}>{children}</span>
);

export interface SparkProps {
  values: number[];
  w?: number;
  h?: number;
  color?: string;
}

export const Spark = ({ values, w = 72, h = 22, color = 'var(--ink)' }: SparkProps) => {
  const clean = values.map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(...clean, 1);
  const min = Math.min(...clean, 0);
  const range = max - min || 1;
  const step = w / Math.max(values.length - 1, 1);
  const pts = clean
    .map((v, i) => {
      const x = i * step;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      {clean.map((v, i) => {
        const x = i * step;
        const y = h - ((v - min) / range) * h;
        return <circle key={i} cx={x} cy={y} r="1.5" fill={color} />;
      })}
    </svg>
  );
};
