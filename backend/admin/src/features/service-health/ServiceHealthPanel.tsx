import { useServiceHealth } from './useServiceHealth.ts';

export function ServiceHealthPanel({ apiBase }: { apiBase: string }) {
  const { observation, refresh } = useServiceHealth(apiBase);
  const healthLabel = { checking: 'Checking', unavailable: 'Unreachable', reachable: 'Reachable' }[observation.kind];

  return (
    <section className="surface" id="service" aria-labelledby="service-heading">
      <div className="panel-title">
        <span className="panel-icon" aria-hidden="true">◎</span>
        <h2 id="service-heading">Service status</h2>
      </div>
      <dl className="service-dl">
        <div>
          <dt>Levelmaxing API</dt>
          <dd>
            <span className={`health-state health-${observation.kind}`} role="status">
              <span className="health-dot" aria-hidden="true" />
              {healthLabel}
            </span>
          </dd>
        </div>
        <div>
          <dt>Last checked</dt>
          <dd>
            {observation.kind === 'checking'
              ? 'In progress'
              : <time dateTime={observation.at}>{new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(observation.at))}</time>}
          </dd>
        </div>
      </dl>
      <p className="supporting">This check measures whether the API responds.</p>
      <button type="button" onClick={refresh} disabled={observation.kind === 'checking' || !apiBase}>Check again</button>
    </section>
  );
}
