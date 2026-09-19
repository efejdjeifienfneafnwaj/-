import { createRoot } from 'react-dom/client'
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import './index.css'
import App from './App.tsx'

// No StrictMode: canvas effects would run twice (see react-dev.md).
createRoot(document.getElementById('root')!).render(<App />)
