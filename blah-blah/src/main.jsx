import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyThemeSettings, loadThemeSettings } from './services/themeSettings'

// Apply the stored accent theme BEFORE the first render: React would otherwise
// paint one default-blue frame and then re-colour it, which reads as a flash.
// useThemeSettings() in App keeps it in sync from here on.
applyThemeSettings(loadThemeSettings())

createRoot(document.getElementById('root')).render(
  <App />,
)
