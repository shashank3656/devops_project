import { useState } from 'react';
import type { PolicyCheckSummary, PolicyFinding } from './types';
import { formatRelativeTime } from './time';

const TOOL_LABELS: Record<string, string> = {
  checkov: 'Checkov',
  tfsec: 'tfsec',
  'trivy-config': 'Trivy',
  opa: 'OPA',
};

const SEVERITY_TONES: Record<PolicyFinding['severity'], string> = {
  critical: 'danger',
  high: 'high',
  medium: 'medium',
  low: 'info',
  info: 'neutral',
  unknown: 'neutral',
};

const COLLAPSED_FINDINGS = 5;

export default function PolicyChecksCard({ summary }: { summary: PolicyCheckSummary | null | undefined }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!summary || summary.state === 'none' || summary.tools.length === 0) {
    return (
      <section className="ig-plan" aria-label="Policy checks">
        <header className="ig-plan__head">
          <span className="ig-eyebrow">Policy checks</span>
        </header>
        <p className="ig-plan__empty">No scan results yet. CI posts Checkov, tfsec or OPA results here after the plan job.</p>
      </section>
    );
  }

  return (
    <section className={`ig-plan${summary.state === 'fail' ? ' ig-plan--blocking' : ''}`} aria-label="Policy checks">
      <header className="ig-plan__head">
        <span className="ig-eyebrow">Policy checks</span>
        {summary.state === 'fail' ? (
          <span className="ig-chip ig-chip--danger">
            {summary.blocking} blocking
          </span>
        ) : summary.state === 'warn' ? (
          <span className="ig-chip ig-chip--medium">{summary.failed} to review</span>
        ) : (
          <span className="ig-chip ig-chip--low">All passed</span>
        )}
      </header>

      {summary.tools.map((tool) => {
        const open = expanded[tool.tool];
        const visible = open ? tool.findings : tool.findings.slice(0, COLLAPSED_FINDINGS);
        return (
          <div key={tool.tool} className="ig-policy__tool">
            <div className="ig-policy__tool-head">
              <strong>{TOOL_LABELS[tool.tool] || tool.tool}</strong>
              <span className="ig-policy__counts">
                {tool.passed} passed · {tool.failed} failed
                {tool.updated_at ? ` · ${formatRelativeTime(tool.updated_at)}` : ''}
              </span>
            </div>
            {visible.length > 0 ? (
              <ul className="ig-policy__findings">
                {visible.map((finding, index) => (
                  <li key={`${finding.rule}:${finding.resource || ''}:${index}`} className="ig-policy__finding">
                    <span className={`ig-chip ig-chip--${SEVERITY_TONES[finding.severity]}`}>{finding.severity}</span>
                    <div className="ig-policy__finding-body">
                      <span>{finding.message || finding.rule}</span>
                      <code className="ig-mono">
                        {finding.rule}
                        {finding.resource ? ` · ${finding.resource}` : ''}
                      </code>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {tool.findings.length > COLLAPSED_FINDINGS ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setExpanded((current) => ({ ...current, [tool.tool]: !open }))}
              >
                {open ? 'Show fewer' : `Show all ${tool.findings.length}${tool.truncated ? '+' : ''}`}
              </button>
            ) : null}
          </div>
        );
      })}

      {summary.state === 'fail' ? (
        <p className="ig-plan__warning">
          Critical and high findings block the merge. Fix them, or suppress one with an inline skip comment that states the reason.
        </p>
      ) : null}
    </section>
  );
}
