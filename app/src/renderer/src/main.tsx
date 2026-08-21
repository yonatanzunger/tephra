import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import 'katex/dist/katex.min.css'
import './index.css'

// Temporary: the bridge self-check, driven by a flag on the URL.
const scene = new URLSearchParams(location.search).get('verify')
if (scene !== null) {
  void import('./verify').then(m => m.runVerify(scene))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
