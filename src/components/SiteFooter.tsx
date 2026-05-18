interface SiteFooterProps {
  source?: string;
}

export default function SiteFooter({ source }: SiteFooterProps = {}) {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p className="sf-source">
          {source ?? 'SOURCE: GENERAL APPROPRIATIONS ACT · 40 GROUPS · FY 2020 – 2026'}
        </p>
        <p className="sf-disclaimer">
          <strong>AI-assisted analysis.</strong> The figures, breakdowns, and editorial commentary on
          this site were parsed, aggregated, and drafted by{' '}
          <a href="https://www.anthropic.com/claude" target="_blank" rel="noopener">
            Claude Opus 4.7
          </a>{' '}
          with human oversight. The dataset and its interpretations may contain errors, mis-classifications,
          or stale figures — always verify against the official GAA before citing.
        </p>
        <ul className="sf-links">
          <li>
            <span className="sf-links-label">Data source</span>
            <a
              href="https://www.dbm.gov.ph/index.php/budget"
              target="_blank"
              rel="noopener"
            >
              Department of Budget and Management ↗
            </a>
          </li>
          <li>
            <span className="sf-links-label">Full dataset</span>
            <a
              href="https://data.bettergov.ph"
              target="_blank"
              rel="noopener"
            >
              BetterGov’s Open Data Portal · data.bettergov.ph ↗
            </a>
          </li>
        </ul>
        <p className="sf-credit">
          Site by <a href="https://about.bettergov.ph" target="_blank" rel="noopener">BetterGov</a>
          {' · '}
          Source code{' '}
          <a href="https://github.com/jasontorres/ai-budget/" target="_blank" rel="noopener">
            github.com/jasontorres/ai-budget ↗
          </a>
        </p>
      </div>
    </footer>
  );
}
