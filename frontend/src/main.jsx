import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
// Grid-layout CSS must load before our overrides in index.css so our
// rules win on specificity ties.
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
