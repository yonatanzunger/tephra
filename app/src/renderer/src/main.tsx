import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

// Temporary: the bridge self-check, driven by a flag on the URL.
if (new URLSearchParams(location.search).has('verify')) {
  void import('./verify').then(m => m.runVerify())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
