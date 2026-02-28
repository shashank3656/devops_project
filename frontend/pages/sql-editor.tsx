import { useState, useRef } from 'react';
import Head from 'next/head';
import AppLayout from '../components/AppLayout';
import { SITE_NAME } from '../lib/site';

const riskColor = (r: string) =>
  ({ LOW: '#00FF9F', MEDIUM: '#FFD700', HIGH: '#FF6B35', CRITICAL: '#FF1744', 'auto-approved': '#00FF9F' }[r] || '#888');
const riskBg = (r: string) =>
  ({ LOW: '#00FF9F18', MEDIUM: '#FFD70018', HIGH: '#FF6B3518', CRITICAL: '#FF174418' }[r] || '#88888818');

interface AnalysisResult {
  risk: string;
  type: string;
  issues: string[];
  suggestion: string;
  affectedRows: string;
  approvalRequired: boolean;
}

export default function SQLEditorPage() {
  const [query, setQuery] = useState(
    "SELECT * FROM users\nWHERE created_at > NOW() - INTERVAL '30 days'\nLIMIT 100;"
  );
  const [selectedDb, setSelectedDb] = useState('prod-postgres');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const analyzeQuery = async () => {
    setAnalyzing(true);
    setAnalysis(null);
    await new Promise((r) => setTimeout(r, 1200));
    const q = query.toLowerCase();
    const isDestructive =
      q.includes('delete') || q.includes('drop') || q.includes('truncate') || q.includes('update');
    const isReadOnly = q.trim().startsWith('select');
    setAnalysis({
      risk: isDestructive ? 'HIGH' : isReadOnly ? 'LOW' : 'MEDIUM',
      type: isDestructive ? 'Destructive DML' : isReadOnly ? 'Read Query' : 'Write DML',
      issues: isDestructive
        ? ['⚠ Destructive operation detected', '⚠ Affects production data', '⚠ Cannot be undone']
        : isReadOnly
        ? ['✓ Read-only, no data modification', '✓ Safe for production']
        : ['⚠ Write operation on production'],
      suggestion: isDestructive
        ? 'Consider using a soft-delete column (is_deleted=true) instead of permanent deletion.'
        : isReadOnly
        ? 'Query looks safe. Auto-approval eligible.'
        : 'Review WHERE clause before execution.',
      affectedRows: isDestructive ? '~2,847 rows' : isReadOnly ? '~143 rows returned' : '~12 rows modified',
      approvalRequired: !isReadOnly,
    });
    setAnalyzing(false);
  };

  const submitRequest = () => {
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setAnalysis(null);
    }, 800);
  };

  return (
    <AppLayout>
      <Head>
        <title>SQL Editor - {SITE_NAME}</title>
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Orbitron:wght@600;700;900&display=swap"
          rel="stylesheet"
        />
      </Head>
      <div className="sql-editor-page">
        <style jsx>{`
          .sql-editor-page {
            font-family: 'JetBrains Mono', 'Fira Code', monospace;
            color: #c8d6e5;
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          .sql-editor-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
          }
          .sql-editor-title {
            font-family: 'Orbitron', monospace;
            font-size: 16px;
            color: #00d9ff;
            letter-spacing: 0.1em;
          }
          .sql-editor-desc {
            font-size: 11px;
            color: #3a6a8a;
            margin-top: 3px;
          }
          .sql-editor-db-select {
            display: flex;
            gap: 8px;
            align-items: center;
          }
          .sql-editor-db-select select {
            background: #0d1420;
            border: 1px solid #1e3a5f;
            color: #c8d6e5;
            padding: 5px 10px;
            font-size: 11px;
            border-radius: 4px;
            font-family: inherit;
          }
          .sql-editor-box {
            background: #040810;
            border: 1px solid #0d2040;
            border-radius: 8px;
            overflow: hidden;
          }
          .sql-editor-tab {
            background: #060c18;
            border-bottom: 1px solid #0d2040;
            padding: 8px 16px;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .sql-editor-tab-dots {
            display: flex;
            gap: 5px;
          }
          .sql-editor-tab-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
          }
          .sql-editor-tab-label {
            font-size: 10px;
            color: #2a4a6a;
            margin-left: 8px;
          }
          .sql-editor-body {
            display: flex;
          }
          .sql-editor-lines {
            padding: 16px 12px;
            border-right: 1px solid #0d2040;
            min-width: 36px;
            text-align: right;
          }
          .sql-editor-line {
            font-size: 11px;
            color: #1e3a5f;
            line-height: 22px;
          }
          .sql-editor-textarea {
            flex: 1;
            background: transparent;
            color: #00d9ff;
            font-size: 13px;
            line-height: 22px;
            padding: 16px;
            font-family: inherit;
            min-height: 160px;
            border: none;
            resize: none;
            outline: none;
            width: 100%;
          }
          .sql-editor-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }
          .sql-editor-btn {
            background: #0d1e35;
            border: 1px solid #1e4a7f;
            color: #00d9ff;
            padding: 9px 20px;
            font-size: 12px;
            border-radius: 5px;
            font-family: inherit;
            letter-spacing: 0.05em;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .sql-editor-btn:disabled {
            opacity: 0.7;
            cursor: not-allowed;
          }
          .sql-editor-btn:hover:not(:disabled) {
            filter: brightness(1.2);
          }
          .sql-editor-btn--approve {
            background: #1a1200;
            border-color: #ffd700;
            color: #ffd700;
          }
          .sql-editor-btn--execute {
            background: #001a0a;
            border-color: #00ff9f;
            color: #00ff9f;
          }
          .sql-editor-analysis {
            border-radius: 8px;
            padding: 16px;
            animation: fadeUp 0.3s ease;
          }
          @keyframes fadeUp {
            from {
              transform: translateY(8px);
              opacity: 0;
            }
            to {
              transform: translateY(0);
              opacity: 1;
            }
          }
          .sql-editor-analysis-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
            flex-wrap: wrap;
          }
          .sql-editor-analysis-risk {
            padding: 2px 10px;
            border-radius: 20px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.1em;
          }
          .sql-editor-analysis-issues {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-bottom: 10px;
          }
          .sql-editor-analysis-suggestion {
            font-size: 11px;
            font-style: italic;
            border-top: 1px solid #0d2040;
            padding-top: 8px;
          }
          .sql-editor-analysis-approval {
            margin-top: 10px;
            padding: 8px 12px;
            background: #0d0800;
            border: 1px solid #2a1800;
            border-radius: 4px;
            font-size: 11px;
            color: #ffd700;
          }
        `}</style>

        <div className="sql-editor-header">
          <div>
            <div className="sql-editor-title">SQL EDITOR</div>
            <div className="sql-editor-desc">All queries are AI-reviewed before execution</div>
          </div>
          <div className="sql-editor-db-select">
            <span style={{ fontSize: 11, color: '#3a6a8a' }}>Database:</span>
            <select
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
            >
              <option value="prod-postgres">prod-postgres</option>
              <option value="staging-mysql">staging-mysql</option>
              <option value="dev-postgres">dev-postgres</option>
            </select>
          </div>
        </div>

        <div className="sql-editor-box">
          <div className="sql-editor-tab">
            <div className="sql-editor-tab-dots">
              {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
                <div key={c} className="sql-editor-tab-dot" style={{ background: c }} />
              ))}
            </div>
            <span className="sql-editor-tab-label">
              {selectedDb} — query.sql
            </span>
          </div>
          <div className="sql-editor-body">
            <div className="sql-editor-lines">
              {query.split('\n').map((_, i) => (
                <div key={i} className="sql-editor-line">
                  {i + 1}
                </div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setAnalysis(null);
              }}
              className="sql-editor-textarea"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="sql-editor-actions">
          <button
            type="button"
            className="sql-editor-btn"
            onClick={analyzeQuery}
            disabled={analyzing || !query.trim()}
          >
            {analyzing ? (
              <>
                <span style={{ animation: 'pulse 1s infinite' }}>◉</span>
                Analyzing...
              </>
            ) : (
              '⬡ AI Analyze'
            )}
          </button>
          {analysis && (
            <button
              type="button"
              className={`sql-editor-btn ${analysis.approvalRequired ? 'sql-editor-btn--approve' : 'sql-editor-btn--execute'}`}
              onClick={submitRequest}
              disabled={submitted}
            >
              {submitted
                ? 'Submitting...'
                : analysis.approvalRequired
                ? '✦ Request Approval'
                : '▶ Execute Query'}
            </button>
          )}
        </div>

        {analysis && (
          <div
            className="sql-editor-analysis"
            style={{
              background: riskBg(analysis.risk),
              border: `1px solid ${riskColor(analysis.risk)}30`,
            }}
          >
            <div className="sql-editor-analysis-header">
              <span
                style={{
                  fontFamily: "'Orbitron'",
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  color: '#4a7fa5',
                }}
              >
                AI ANALYSIS
              </span>
              <span
                className="sql-editor-analysis-risk"
                style={{
                  background: riskBg(analysis.risk),
                  border: `1px solid ${riskColor(analysis.risk)}`,
                  color: riskColor(analysis.risk),
                }}
              >
                {analysis.risk} RISK
              </span>
              <span style={{ fontSize: 11, color: '#4a7fa5' }}>{analysis.type}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#4a7fa5' }}>
                Affected: <span style={{ color: '#c8d6e5' }}>{analysis.affectedRows}</span>
              </span>
            </div>
            <div className="sql-editor-analysis-issues">
              {analysis.issues.map((issue, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    color: issue.startsWith('✓') ? '#00FF9F' : '#FF6B35',
                  }}
                >
                  {issue}
                </div>
              ))}
            </div>
            <div className="sql-editor-analysis-suggestion" style={{ color: '#7aabcc' }}>
              💡 {analysis.suggestion}
            </div>
            {analysis.approvalRequired && (
              <div className="sql-editor-analysis-approval">
                ✦ This query requires DevOps team approval before execution
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
