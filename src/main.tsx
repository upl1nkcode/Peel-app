import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { captureInstallPrompt } from './services/install'
import { watchForUpdate } from './services/update'
import './index.css'

// Both start before the first render: Chrome fires `beforeinstallprompt`
// early, and the service worker registers at once (spec 0013).
const install = captureInstallPrompt(window)
const update = watchForUpdate(registerSW)

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root not found')

createRoot(root).render(
  <StrictMode>
    <App install={install} update={update} />
  </StrictMode>,
)
