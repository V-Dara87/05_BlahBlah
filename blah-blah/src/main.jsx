import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { applyThemeSettings, loadThemeSettings } from './services/themeSettings'
import { installGlobalScriptErrorHandlers } from './engine/scriptConsole.js'

// Apply the stored accent theme BEFORE the first render: React would otherwise
// paint one default-blue frame and then re-colour it, which reads as a flash.
// useThemeSettings() in App keeps it in sync from here on.
applyThemeSettings(loadThemeSettings())

// Forward errors that escape a user script's try/catch (mainly async onMount
// rejections) to the Console panel. Installed once; the disposer keeps HMR
// from stacking duplicate listeners on every reload.
const disposeScriptErrorHandlers = installGlobalScriptErrorHandlers()
if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeScriptErrorHandlers?.())
}

createRoot(document.getElementById('root')).render(
  <App />,
)
