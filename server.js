'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const { testConnection } = require('./db');

// --- Route modules ---
const authRoutes    = require('./routes/auth');
const productRoutes = require('./routes/products');
const webpayRoutes  = require('./routes/webpay');
const storeRoutes   = require('./routes/stores');

// ============================================================
// Hydra Systems — Express Application
// ============================================================

const app  = express();
const PORT = Number(process.env.PORT) || 3000;

// --- CORS ----------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server (no Origin header) and allowed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" not allowed.`));
      }
    },
    credentials: true,
  })
);

// --- Body parsers --------------------------------------------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Health check --------------------------------------------
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success:  true,
    service:  'Hydra Systems API',
    version:  '1.0.0',
    env:      process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// --- API Routes ----------------------------------------------
app.use('/api/auth',     authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/webpay',   webpayRoutes);
app.use('/api/stores',   storeRoutes);

// --- 404 handler ---------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Ruta no encontrada.' });
});

// --- Global error handler ------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Unhandled Error]', err);

  // CORS errors
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ success: false, error: err.message });
  }

  const status  = err.status  || err.statusCode || 500;
  const message = err.message || 'Error interno del servidor.';

  res.status(status).json({
    success: false,
    error:   process.env.NODE_ENV === 'production' ? 'Error interno del servidor.' : message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// --- Start ---------------------------------------------------
async function start() {
  try {
    await testConnection();
    app.listen(PORT, () => {
      console.log(`🚀  Hydra Systems API running on http://localhost:${PORT}`);
      console.log(`    Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`    Transbank   : ${process.env.TRANSBANK_ENVIRONMENT || 'integration'}`);
    });
  } catch (err) {
    console.error('❌  Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
