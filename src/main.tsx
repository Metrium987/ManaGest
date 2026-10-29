import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import './styles.css';
import App from './App';
import { queryClient } from '@/lib/query';
import { SessionProvider } from '@/lib/session';
import { setLanguage } from '@/lib/i18n';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/Modal';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

/**
 * The interface language is a workspace setting (T-010). It is read from a
 * public endpoint before the first render so the sign-in and setup screens are
 * translated too; a network failure simply keeps the French default.
 */
async function bootstrapLanguage(): Promise<void> {
  try {
    const response = await fetch('/api/public/language', { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const data = (await response.json()) as { language?: string };
    setLanguage(data.language);
  } catch {
    // Offline first paint: French is the documented default.
  }
}

async function start(): Promise<void> {
  await bootstrapLanguage();
  createRoot(root!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ToastProvider>
            <ConfirmProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ConfirmProvider>
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void start();
