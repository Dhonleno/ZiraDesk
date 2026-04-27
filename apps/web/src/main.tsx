import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './lib/i18n'; // deve ser importado antes do App para garantir init síncrono
import './index.css';
import { App } from './App';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root não encontrado');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
