import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'
import App from './App'
import { SessionProvider } from './lib/session'
import { persistOptions, queryClient } from './lib/persist'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <SessionProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)
