import React from 'react'
import ReactDOM from 'react-dom/client'
import Portal from './Portal.jsx'
import '../styles.css'
import './portal.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Portal />
  </React.StrictMode>
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // The worker lives one level up, next to the inventory app, and covers
    // both pages from there.
    navigator.serviceWorker
      .register('../sw.js', { scope: '../' })
      .catch((e) => console.warn('SW registration failed', e))
  })
}
