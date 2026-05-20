import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { dataUrl } from '../lib/data-url';
import './report-view.css';

interface ReportViewProps {
  deptId: string;
}

export default function ReportView({ deptId }: ReportViewProps) {
  const [md, setMd] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl(`${deptId}/REPORT.md`))
      .then((r) => {
        if (!r.ok) throw new Error(`No report available (HTTP ${r.status}).`);
        return r.text();
      })
      .then((text) => {
        if (!cancelled) setMd(stripLeadingH1(text));
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [deptId]);

  if (err) {
    return (
      <div className="dept-report-error">
        <p>Couldn't load the AI report for this group.</p>
        <p className="dept-report-error-detail">{err}</p>
      </div>
    );
  }

  if (md == null) {
    return (
      <div className="dept-report-loader">
        <p className="dept-report-loader-title">Loading AI report…</p>
        <div className="loading-bar" aria-hidden="true" />
      </div>
    );
  }

  return (
    <article className="dept-report">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
    </article>
  );
}

// Drop the report's opening H1 — the Portal page-headline already names the
// department, so showing both stacks two near-identical titles on top of each
// other.
function stripLeadingH1(text: string): string {
  return text.replace(/^\s*#\s+[^\n]*\n+/, '');
}
