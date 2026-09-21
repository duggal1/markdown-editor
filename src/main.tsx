import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const App = React.lazy(() => import('./App'));
const DrawPage = React.lazy(() => import('./draw/DrawPage'));
const route = window.location.pathname.replace(/\/+$/, '') || '/';
const Page = route === '/draw' ? DrawPage : App;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<div className="boot">Loading…</div>}>
      <Page />
    </React.Suspense>
  </React.StrictMode>,
);
