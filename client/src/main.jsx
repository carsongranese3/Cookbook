import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { disableZoom } from './utils/disableZoom.js';
import './styles.css';

// Disable pinch/double-tap zoom so the installed PWA feels native. See
// utils/disableZoom.js for why the viewport meta tag alone isn't enough
// on iOS Safari.
disableZoom();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
