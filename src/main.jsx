import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const savedTheme = localStorage.getItem('gamalab-theme') || 'dark'
document.documentElement.classList.toggle('dark', savedTheme === 'dark')
const favicon = document.getElementById('favicon')
if (favicon) {
  favicon.href = savedTheme === 'dark' ? '/logo-white.png' : '/logo-dark.png'
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
