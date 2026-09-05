'use strict';

const express = require('express');
const router  = express.Router();
const { registerStore, login, updateColor, forgotPassword, resetPassword } = require('../controllers/authController');
const { verifyToken, requireRole }          = require('../middleware/auth');

// POST /api/auth/register-store
router.post('/register-store', registerStore);

// POST /api/auth/login
router.post('/login', login);

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPassword);

// POST /api/auth/reset-password
router.post('/reset-password', resetPassword);

// PUT /api/auth/stores/:id/color   — Protected
router.put(
  '/stores/:id/color',
  verifyToken,
  requireRole('superadmin', 'admin_tienda'),
  updateColor
);

module.exports = router;
