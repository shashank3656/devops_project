import { useRouter } from 'next/router';
import { persistCostScope } from '../lib/cost';

export default function CostSampleBanner() {
  const router = useRouter();
  const exitPreview = () => {
    const query = { ...router.query };
    delete query.sample;
    persistCostScope(query);
    void router.replace({ pathname: router.pathname, query }, undefined, { shallow: true });
  };
  return (
    <div className="cost-sample" role="status">
      <strong>Sample data</strong>
      <span>Scope: Sample billed window</span>
      <button type="button" className="btn btn-sm btn-secondary" onClick={exitPreview}>Exit preview</button>
    </div>
  );
}
