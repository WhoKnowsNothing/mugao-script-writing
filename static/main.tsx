import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ScriptEditor } from '@/components/script-editor';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ScriptEditor homeHref="/#mugao" />
  </StrictMode>,
);
