import { AccessPanel } from '../features/access/AccessPanel.tsx';
import type { OperatorIdentity } from '../features/access/operatorIdentity.ts';
import { useOperatorAccess } from '../features/access/useOperatorAccess.ts';
import { ServiceHealthPanel } from '../features/service-health/ServiceHealthPanel.tsx';
import type { AdminConfiguration } from '../shared/config.ts';

type Dependencies = {
  configuration: AdminConfiguration;
  identity: OperatorIdentity | undefined;
};

export function App({ configuration, identity }: Dependencies) {
  const access = useOperatorAccess(configuration.apiBase, identity);
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand" href="./" aria-label="Levelmaxing operations">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <span>levelmaxing<span className="brand-ending">.</span></span>
          </a>
          {configuration.identity.kind === 'local' && <span className="mode-label">Local workspace</span>}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <header className="page-heading">
          <p className="eyebrow">Levelmaxing Console</p>
          <h1>Operations</h1>
        </header>
        <div className="workspace-grid">
          <AccessPanel identity={configuration.identity} flow={access} />
          <ServiceHealthPanel apiBase={configuration.apiBase} />
        </div>
      </main>
    </>
  );
}
