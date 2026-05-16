import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eyebrow, SectionHead } from '../components/shared';
import SiteFooter from '../components/SiteFooter';
import SiteHeader from '../components/SiteHeader';
import type { NationalIndex } from '../lib/types';
import * as fmt from '../lib/format';

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

export default function National() {
  const [idx, setIdx] = useState<NationalIndex | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/data/national/index.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load national index (HTTP ${r.status}). Run \`npm run build:index\`.`);
        return r.json();
      })
      .then(setIdx)
      .catch((e) => setErr(String(e?.message || e)));
  }, []);

  if (err) {
    return (
      <main style={{ maxWidth: 1000, margin: '60px auto', padding: '0 32px', fontFamily: 'var(--font-mono)' }}>
        <p style={{ color: 'var(--accent)' }}>{err}</p>
        <p style={{ color: 'var(--ink-3)' }}>
          You can still browse individual departments directly: <Link to="/d/01">/d/01 — Congress</Link>,
          {' '}<Link to="/d/02">/d/02</Link>, <Link to="/d/03">/d/03</Link>, <Link to="/d/04">/d/04</Link>.
        </p>
      </main>
    );
  }

  if (!idx) {
    return (
      <main style={{ padding: 80, textAlign: 'center', fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>
        Loading national overview…
      </main>
    );
  }

  const latestYear = idx.years[idx.years.length - 1];
  const prevYear = idx.years[idx.years.length - 2];
  const totalLatest = idx.national_yearly.find((y) => y.year === latestYear)?.amount || 0;
  const totalPrev = idx.national_yearly.find((y) => y.year === prevYear)?.amount || 0;
  const yoy = totalPrev ? (totalLatest - totalPrev) / totalPrev : 0;
  const total2020 = idx.national_yearly[0]?.amount || 0;
  const growth = total2020 ? (totalLatest - total2020) / total2020 : 0;

  const depts = [...idx.departments].sort((a, b) => {
    const av = a.years[latestYear]?.amount || 0;
    const bv = b.years[latestYear]?.amount || 0;
    return bv - av;
  });
  const maxDept = Math.max(...depts.map((d) => d.years[latestYear]?.amount || 0));

  return (
    <>
      <SiteHeader
        compiledMeta={`Compiled · FY${latestYear} · ₱${fmt.shortPhp(totalLatest, 'T').replace('₱', '')}`}
      />

      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 32px 80px' }}>
        <div className="page-headline">
          <p className="page-eyebrow">National overview</p>
          <h1 className="page-title">Philippines GAA Budget Portal</h1>
          <p className="page-dek">
            All 40 national departments, FY {idx.years[0]} – {latestYear}. Click any department to drill in.
          </p>
        </div>
        <div className="kpi-strip">
          <div className="kpi-cell">
            <div className="kpi-label">FY {latestYear} appropriation</div>
            <div className="kpi-value">{fmt.shortPhp(totalLatest, 'T')}</div>
            <div className="kpi-sub">national, all departments</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">YoY change · {prevYear} → {latestYear}</div>
            <div className="kpi-value" style={{ color: yoy >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
              {(yoy * 100).toFixed(1)}%
            </div>
            <div className="kpi-sub">{fmt.shortPhp(totalLatest - totalPrev, 'B')}</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">7-yr growth · {idx.years[0]} → {latestYear}</div>
            <div className="kpi-value">{(growth * 100).toFixed(0)}%</div>
            <div className="kpi-sub">nominal</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label">Departments tracked</div>
            <div className="kpi-value">{depts.length}</div>
            <div className="kpi-sub">{depts.filter((d) => d.has_data).length} with line-item data</div>
          </div>
        </div>

        <div style={{ marginBottom: 14, marginTop: 28 }}>
          <Eyebrow>National appropriation, FY {idx.years[0]} – {latestYear}</Eyebrow>
        </div>
        <NationalTrend yearly={idx.national_yearly} />

        <div id="departments" style={{ marginTop: 40, scrollMarginTop: 220 }}>
          <SectionHead
            eyebrow="Ranking · FY 2026"
            headline="All departments, sorted by latest appropriation"
            dek="Click any row to drill into that department’s hierarchy."
          />
        </div>

        <table className="hier-table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th style={{ width: 60 }}>ID</th>
              <th>Department</th>
              <th style={{ width: 220 }}>FY {latestYear}</th>
              <th style={{ width: 100, textAlign: 'right' }}>vs {prevYear}</th>
              <th style={{ width: 100, textAlign: 'right' }}></th>
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => {
              const curr = d.years[latestYear]?.amount || 0;
              const prev = d.years[prevYear]?.amount || 0;
              const dpct = prev ? ((curr - prev) / prev) * 100 : null;
              const pct = maxDept ? (curr / maxDept) * 100 : 0;
              return (
                <tr key={d.id}>
                  <td className="mono">{d.id}</td>
                  <td className="name">
                    <Link to={`/d/${d.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                      {d.description}
                    </Link>
                  </td>
                  <td className="bar-cell">
                    <div className="bar-h accent">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <span className="bar-val">{fmt.shortPhp(curr, curr >= 1e12 ? 'T' : 'B')}</span>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: dpct == null ? 'var(--ink-mute)' : dpct >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                    {dpct == null ? '—' : `${dpct >= 0 ? '+' : ''}${dpct.toFixed(1)}%`}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link to={`/d/${d.id}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      Open →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="note-block" style={{ marginTop: 32 }}>
          <strong>Note.</strong> Figures are appropriations under the General Appropriations Act, in pesos.
          Source data is published in thousands; values are converted to full pesos. The GAA is the legal
          authority to spend — not actual obligations or disbursements. See the{' '}
          <Link to="/methodology">Methodology</Link> page for data-quality caveats including UACS recoding
          (2025→2026), program renames, and items that moved off-GAA.
        </p>
      </main>

      <SiteFooter />
    </>
  );
}

function NationalTrend({ yearly }: { yearly: { year: number; amount: number }[] }) {
  const w = 1200;
  const h = 260;
  const pad = { l: 60, r: 20, t: 20, b: 30 };
  const maxV = Math.max(...yearly.map((y) => y.amount)) * 1.1;
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, yearly.length - 1);
  const y = (v: number) => pad.t + (h - pad.t - pad.b) - (v / maxV) * (h - pad.t - pad.b);
  const pts = yearly.map((d, i) => `${x(i)},${y(d.amount)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => maxV * t);

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={10} fontFamily="var(--font-mono)" fill="var(--ink-mute)">
              {fmt.shortPhp(t, 'T')}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="var(--accent)" strokeWidth={2} points={pts} />
        {yearly.map((d, i) => (
          <g key={d.year}>
            <circle cx={x(i)} cy={y(d.amount)} r={4} fill="var(--accent)" />
            <text x={x(i)} y={h - 10} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--ink-2)">
              {d.year}
            </text>
            <text x={x(i)} y={y(d.amount) - 10} textAnchor="middle" fontSize={11} fontFamily="var(--font-mono)" fill="var(--ink)">
              {fmt.shortPhp(d.amount, 'T')}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
