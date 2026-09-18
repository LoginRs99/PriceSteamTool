import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { CurrencyProvider } from './context/CurrencyContext.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CurrencyProvider>
        <App />
      </CurrencyProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
