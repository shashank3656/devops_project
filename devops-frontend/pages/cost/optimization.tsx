import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import CollectionStatus, { collectionStateFromSync } from '../../components/CollectionStatus';
import CostAskButton from '../../components/CostAskButton';
import CostDrawer from '../../components/CostDrawer';
import CostSetupFlow from '../../components/CostSetupFlow';
import CostNav from '../../components/CostNav';
import CostSampleBanner from '../../components/CostSampleBanner';
import CostTechnicalDetails from '../../components/CostTechnicalDetails';
import DevOpsLayout from '../../components/DevOpsLayout';
import { useApiUrl } from '../../context/ApiUrlContext';
import { COST_LIFECYCLE_STEPS, CostOptimization, CostRecommendation, costConfidenceLabel, costHref, costLifecycleLabel, costLifecycleStepIndex, costQuery, costRiskLabel, fetchCostJson } from '../../lib/cost';
import { COST_SAMPLE_RECS } from '../../lib/costSample';
import LinkedJiraWork from '../../components/LinkedJiraWork';

export default function CostOptimizationPage() {
  const apiUrl = useApiUrl();
  const router = useRouter();
  const basis = typeof router.query.basis === 'string' && router.query.basis === 'amortized' ? 'amortized' : 'actual';
  const currency = typeof router.query.currency === 'string' && router.query.currency.trim() ? router.query.currency : 'USD';
  const from = typeof router.query.from === 'string' ? router.query.from : '';
  const to = typeof router.query.to === 'string' ? router.query.to : '';
  const calc = typeof router.query.calc === 'string' ? router.query.calc : '';
  const [data, setData] = useState<CostOptimization | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState('');
  const [open, setOpen] = useState<CostRecommendation | null>(null);
  const [changeNumber, setChangeNumber] = useState('');
  const [reason, setReason] = useState('');
  const [reviewBy, setReviewBy] = useState('');
  const [confounders, setConfounders] = useState('');

  const load = () => {
    if (!router.isReady) return;
    setLoading(true);
    fetchCostJson<CostOptimization>(apiUrl, `/api/cost/recommendations${costQuery(basis, currency, { from, to, calc })}`)
      .then((payload) => {
        setData(payload);
        setError('');
        const match = (payload.recommendations || []).find((row) => (open?.calc_id || calc) && row.calc_id === (open?.calc_id || calc));
        setOpen(match || open);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [apiUrl, router.isReady, basis, currency, from, to, calc]);

  const act = async (action: string, extra?: Record<string, string>) => {
    if (!open) return;
    setActing(action);
    setNotice('');
    try {
      const data = await fetchCostJson<{ note?: string; recommendation?: CostRecommendation }>(apiUrl, `/api/cost/recommendations/${encodeURIComponent(open.calc_id)}`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          change_number: changeNumber,
          reason,
          review_by: reviewBy,
          confounders,
          ...(extra || {}),
        }),
      });
      setNotice(data.note || 'Saved. Infrastructure was not changed.');
      if (data.recommendation) setOpen(data.recommendation);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recommendation could not be updated.');
    } finally {
      setActing('');
    }
  };

  const blocked = open?.status === 'blocked' || open?.lifecycle === 'blocked';
  const showSample = router.query.sample === '1' && !loading && !(data?.recommendations || []).length;
  const recommendations = showSample ? COST_SAMPLE_RECS : (data?.recommendations || []);
  const sampleLocked = showSample || Boolean(open?.calc_id?.startsWith('sample'));

  return (
    <DevOpsLayout>
      <Head><title>Optimization</title></Head>
      <div className="portal-page cost-analysis">
        <div className="cost-shell__head">
          <h1 className="portal-page__title">Optimization</h1>
        </div>
        <CostNav current="optimization" sample={showSample} />
        {showSample ? <CostSampleBanner /> : !loading ? (
          <CollectionStatus
            source="CUR 2.0"
            lastSuccess={null}
            state={collectionStateFromSync({
              connected: data?.can_operate !== false,
              failed: Boolean(error),
              empty: !recommendations.length,
            })}
            detail="Estimated savings and measured bill reduction stay separate. Approval does not execute the change."
          />
        ) : null}
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {notice ? <div className="alert alert-info" role="status">{notice}</div> : null}
        {recommendations.length ? <p className="cost-review-note">Recommendations require review before changes.</p> : null}
        {loading ? <div className="empty-state">Loading recommendations…</div> : null}
        {!loading && !recommendations.length ? (
          <CostSetupFlow
            canOperate={data?.can_operate}
            state="none"
            sampleHref={costHref('/cost/optimization', router.query, { sample: '1' })}
          />
        ) : null}
        {!loading && (data?.opportunity_groups || []).length ? (
          <section className="portal-surface portal-surface--table">
            <h2 className="portal-surface__title">Opportunity groups</h2>
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Resource</th>
                  <th>Calculations</th>
                  <th>Capped savings</th>
                </tr>
              </thead>
              <tbody>
                {(data?.opportunity_groups || []).map((row) => (
                  <tr key={row.group_id}>
                    <td>{row.group_id}</td>
                    <td>{row.resource_id}</td>
                    <td>{(row.calc_ids || []).length}</td>
                    <td>{row.savings?.display || 'Unknown'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="portal-surface__subtitle">Mutually exclusive actions share a group. Those dollar amounts are not added together.</p>
            <CostTechnicalDetails>
              {(data?.opportunity_groups || []).map((row) => (
                <p key={row.group_id}>{row.resource_id} · {(row.calc_ids || []).join(', ')}</p>
              ))}
            </CostTechnicalDetails>
          </section>
        ) : null}
        {!loading && recommendations.length ? (
          <section className="portal-surface portal-surface--table">
            <table className="portal-table">
              <thead>
                <tr>
                  <th>Recommendation</th>
                  <th>Estimated savings</th>
                  <th>Measured savings</th>
                  <th>Confidence</th>
                  <th>Operational risk</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recommendations.map((row) => (
                  <tr key={row.calc_id}>
                    <td>
                      {row.finding_type}
                      <div className="portal-surface__subtitle">{row.service || row.resource_id}</div>
                    </td>
                    <td>{row.savings_high?.display || 'Unknown'}</td>
                    <td>{row.bill_reduction?.display || 'Not measured'}</td>
                    <td>{costConfidenceLabel(row.confidence)}</td>
                    <td>{costRiskLabel(row.risk)}{row.impact ? ` · ${row.impact}` : ''}</td>
                    <td>{costLifecycleLabel(row.lifecycle || row.status)}{row.waiting_for ? ` · ${row.waiting_for}` : ''}</td>
                    <td>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(row)}>Review recommendation</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        <CostDrawer
          open={Boolean(open)}
          onClose={() => setOpen(null)}
          resetKey={open?.calc_id}
          eyebrow="Recommendation"
          title={open?.finding_type || 'Recommendation'}
          subtitle={`${costLifecycleLabel(open?.lifecycle || open?.status)} · Risk ${costRiskLabel(open?.risk)}`}
          footer={(
            <div className="portal-page__actions">
              <CostAskButton
                question="Explain this recommendation"
                context={`Finding ${open?.finding_type || 'Unknown'}. Estimated savings ${open?.savings_high?.display || 'Unknown'}. Coverage based on billed window. Source labelled CUR 2.0.`}
              >
                Explain this recommendation
              </CostAskButton>
              <button type="button" className="btn btn-secondary" disabled={!!acting || sampleLocked || data?.can_operate === false} onClick={() => void act('review')}>Investigating</button>
              <button type="button" className="btn btn-primary" disabled={!!acting || blocked || sampleLocked || data?.can_operate === false} onClick={() => void act('accept')}>Approve</button>
            </div>
          )}
        >
          {open ? (
            <>
              <ol className="chg-lifecycle" aria-label="Recommendation workflow">
                {COST_LIFECYCLE_STEPS.map((step, index) => {
                  const current = costLifecycleStepIndex(open.lifecycle || open.status);
                  return (
                    <li key={step} className={`chg-lifecycle__step${index < current ? ' is-done' : ''}${index === current ? ' is-current' : ''}`}>
                      <span className="chg-lifecycle__dot" aria-hidden />
                      <span className="chg-lifecycle__label">{step}</span>
                    </li>
                  );
                })}
              </ol>
              <dl className="sre-meta">
                <div className="sre-meta__item"><dt>Current configuration</dt><dd>{open.evidence}</dd></div>
                <div className="sre-meta__item"><dt>Proposed change</dt><dd>{open.proposed_action}</dd></div>
                <div className="sre-meta__item"><dt>Estimated savings</dt><dd>{open.savings_high?.display || 'Unknown'}</dd></div>
                <div className="sre-meta__item"><dt>Measured savings</dt><dd>{open.bill_reduction?.display || 'Not measured'}</dd></div>
                <div className="sre-meta__item"><dt>Confidence</dt><dd>{costConfidenceLabel(open.confidence)}</dd></div>
                <div className="sre-meta__item"><dt>Operational risk</dt><dd>{costRiskLabel(open.risk)}{open.impact ? ` · ${open.impact}` : ''}</dd></div>
                <div className="sre-meta__item"><dt>Rollback</dt><dd>Link an existing change. This page never resizes, deletes, or applies the change.</dd></div>
                <div className="sre-meta__item"><dt>Verification</dt><dd>{open.verification || 'Not measured'}</dd></div>
                {open.change_id ? <div className="sre-meta__item"><dt>Linked change</dt><dd><Link href={open.change_href || `/changes/${open.change_id}`}>{open.change_number}</Link></dd></div> : null}
                {open.blocked_reason ? <div className="sre-meta__item"><dt>Blocked</dt><dd>{open.blocked_reason}</dd></div> : null}
              </dl>
              <div className="portal-form-grid">
                <label className="label">Existing change number
                  <input className="input" value={changeNumber} onChange={(event) => setChangeNumber(event.target.value)} placeholder="CHG0000001" />
                </label>
                <label className="label">Dismiss reason
                  <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Owner deferred" />
                </label>
                <label className="label">Review date
                  <input className="input" type="date" value={reviewBy} onChange={(event) => setReviewBy(event.target.value)} />
                </label>
                <label className="label">Confounders
                  <input className="input" value={confounders} onChange={(event) => setConfounders(event.target.value)} placeholder="Price change, traffic, commitment" />
                </label>
              </div>
              <div className="portal-page__actions">
                <button type="button" className="btn btn-secondary" disabled={!!acting || blocked || sampleLocked || !changeNumber || data?.can_operate === false} onClick={() => void act('link')}>Link change</button>
                <Link href="/changes/new" className="btn btn-secondary">Open a change</Link>
                <button type="button" className="btn btn-secondary" disabled={!!acting || blocked || sampleLocked || !open.change_id || data?.can_operate === false} onClick={() => void act('implement')}>Mark implemented</button>
                <button type="button" className="btn btn-secondary" disabled={!!acting || blocked || sampleLocked || data?.can_operate === false} onClick={() => void act('verify')}>Verify measured savings</button>
                <button type="button" className="btn btn-secondary" disabled={!!acting || blocked || sampleLocked || data?.can_operate === false} onClick={() => void act('verify', { result: 'inconclusive' })}>Mark Inconclusive</button>
                <button type="button" className="btn btn-secondary" disabled={!!acting || sampleLocked || !reason || !reviewBy || data?.can_operate === false} onClick={() => void act('dismiss')}>Dismiss</button>
              </div>
              <LinkedJiraWork
                apiUrl={apiUrl}
                source={{
                  sourceType: 'cost_recommendation',
                  sourceKey: open.calc_id,
                  defaultSummary: open.finding_type,
                  defaultDescription: open.proposed_action || open.finding_type,
                }}
              />
              <CostTechnicalDetails>
                <p>{open.calc_id}</p>
                <p>{open.calculation}</p>
                <p>Approval does not execute the change. This page does not pause workloads. Overlapping savings are not summed. Jira ticket completion is not verified savings.</p>
              </CostTechnicalDetails>
            </>
          ) : null}
        </CostDrawer>
      </div>
    </DevOpsLayout>
  );
}
