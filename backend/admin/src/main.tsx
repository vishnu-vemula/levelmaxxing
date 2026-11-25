import { palette } from '@levelmaxing/design-tokens';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { createFirebaseIdentity } from './features/access/identity.ts';
import { readConfiguration } from './shared/config.ts';
import './styles.css';

for (const theme of ['light', 'dark'] as const) {
  for (const [name, value] of Object.entries(palette[theme])) {
    document.documentElement.style.setProperty(`--lm-${theme}-${name}`, value);
  }
}

const configuration = readConfiguration(import.meta.env);
const identity = configuration.identity.kind === 'firebase' ? createFirebaseIdentity(configuration.identity) : undefined;
const element = document.getElementById('root');
if (!element) throw new Error('Missing application root');

createRoot(element).render(
  <StrictMode>
    <App configuration={configuration} identity={identity} />
  </StrictMode>,
);
