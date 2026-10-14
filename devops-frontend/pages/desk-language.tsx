import Head from 'next/head';
import { useEffect, useMemo, useState } from 'react';
import DevOpsLayout from '../components/DevOpsLayout';
import { DeskEnvironmentForm, DeskRecordList, DeskStateChip } from '@infragate/ui';
import {
  DESK_STATES,
  deskCanWrite,
  deskErrorText,
  deskSubmitBlock,
  normalizeDeskState,
  visibleDeskRecords,
} from '../shared-ui/deskRules';

const SAMPLE = [
  { key: 'billing', label: 'Billing API', state: 'ready' },
  { key: 'catalog', label: 'Catalog', state: 'stale' },
];

function DeskLanguageScreen({ showTitle }: { showTitle: boolean }) {
  const [role, setRole] = useState('operator');
  const [project, setProject] = useState('this');
  const [environment, setEnvironment] = useState('staging');
  const [notice, setNotice] = useState('');
  const [apiBody, setApiBody] = useState<unknown>(null);
  const canWrite = deskCanWrite(role);
  const hidden = project === 'other';
  const records = useMemo(() => visibleDeskRecords(hidden, SAMPLE), [hidden]);
  const apiError = apiBody ? deskErrorText(apiBody) : '';
  const formMessage = notice || apiError;

  function acceptEnvironment() {
    setApiBody(null);
    setNotice(deskSubmitBlock(canWrite, environment) || 'Environment accepted.');
  }

  function showApiError() {
    setNotice('');
    setApiBody({
      error: 'drift request failed',
      detail: 'password=not-shown',
      environment,
    });
  }

  return (
        <div className="desk-language">
          <header className="desk-landing">
            {showTitle ? <h1>Desk language</h1> : <h2>Desk language</h2>}
            <p>Empty, error, stale, unknown, or ready. Missing data stays unknown.</p>
          </header>

          <section className="desk-language__panel" aria-label="State language">
            <h2>States</h2>
            <div className="desk-language__chips">
              {DESK_STATES.map((state) => (
                <DeskStateChip key={state} value={state} />
              ))}
            </div>
            <div className="desk-language__samples">
              <span className="desk-language__sample">
                Source labeled healthy
                <DeskStateChip value="healthy" />
              </span>
              <span className="desk-language__sample">
                Blank source
                <DeskStateChip value="" />
              </span>
            </div>
            <p className="desk-language__note" data-normalized={normalizeDeskState('healthy')}>
              A source labeled healthy is shown as Unknown.
            </p>
          </section>

          <section className="desk-language__panel" aria-label="Scope">
            <h2>Scope</h2>
            <div className="desk-language__choices" role="group" aria-label="Role">
              <button type="button" className={role === 'operator' ? 'is-selected' : ''} onClick={() => { setRole('operator'); setNotice(''); }}>
                Operator
              </button>
              <button type="button" className={role === 'viewer' ? 'is-selected' : ''} onClick={() => { setRole('viewer'); setNotice(''); setApiBody(null); }}>
                Viewer
              </button>
            </div>
            <div className="desk-language__choices" role="group" aria-label="Project">
              <button type="button" className={project === 'this' ? 'is-selected' : ''} onClick={() => setProject('this')}>
                This project
              </button>
              <button type="button" className={project === 'other' ? 'is-selected' : ''} onClick={() => setProject('other')}>
                Another project
              </button>
            </div>
            <DeskRecordList
              records={records}
              emptyLabel={hidden ? 'Another project shows an empty list.' : 'No records in this project.'}
            />
          </section>

          <section className="desk-language__panel" aria-label="Environment">
            <h2>Environment</h2>
            <p className="desk-language__note">This check is a sample. It does not change the project bar.</p>
            <DeskEnvironmentForm
              environment={environment}
              canWrite={canWrite}
              message={formMessage}
              onEnvironment={(value) => {
                setEnvironment(value);
                setNotice('');
                setApiBody(null);
              }}
              onSubmit={acceptEnvironment}
            >
              <button type="button" className="btn btn-secondary" onClick={showApiError}>
                Show API error
              </button>
            </DeskEnvironmentForm>
          </section>
        </div>
  );
}

export default function DeskLanguagePage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(Boolean(localStorage.getItem('devops_token')));
  }, []);

  const screen = <DeskLanguageScreen showTitle={!signedIn} />;
  return (
    <>
      <Head>
        <title>Desk language · SetuOps</title>
      </Head>
      {signedIn ? <DevOpsLayout>{screen}</DevOpsLayout> : <main className="desk-language-signed-out">{screen}</main>}
    </>
  );
}
