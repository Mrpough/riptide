import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/theme.css'
import './styles/app.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root was not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
