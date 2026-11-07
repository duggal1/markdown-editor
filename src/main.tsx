import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { readPrefs } from './lib/store';
import { applyAccentTheme } from './lib/accentTheme';

// Apply the saved appearance before either Flow or Draw mounts.
const savedAppearance = readPrefs();
applyAccentTheme(savedAppearance.accentTheme);
document.documentElement.dataset.theme = savedAppearance.theme === 'light' ? 'light' : 'dark';

const App = React.lazy(() => import('./App'));
const DrawPage = React.lazy(() => import('./draw/DrawPage'));
const SharedPage = React.lazy(() => import('./components/SharedPage'));
const route = window.location.pathname.replace(/\/+$/, '') || '/';
const Page = route === '/draw' ? DrawPage : route.startsWith('/s/') ? SharedPage : App;

// A rendering exception in Draw must never leave an unexplained white screen.
class DrawErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('Flow Draw could not render:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="boot" role="alert">
      Draw could not open.
      <button type="button" onClick={() => window.location.reload()}>Reload Draw</button>
    </div>;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DrawErrorBoundary>
      <React.Suspense fallback={<div className="boot">Loading…</div>}>
        <Page />
      </React.Suspense>
    </DrawErrorBoundary>
  </React.StrictMode>,
);
