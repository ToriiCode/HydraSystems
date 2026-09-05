'use strict';

const jwt = require('jsonwebtoken');

// ============================================================
// auth.js — JWT verification middleware
// ============================================================

/**
 * verifyToken
 * -----------
 * Extracts the Bearer token from the Authorization header,
 * verifies it with JWT_SECRET, and attaches the decoded payload
 * to req.user for downstream handlers.
 *
 * Expected header format:
 *   Authorization: Bearer <signed_jwt>
 *
 * Decoded payload shape:
 *   { id, tienda_id, rol, nombre, iat, exp }
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error:   'No autorizado — token no proporcionado.',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, tienda_id, rol, nombre }
    next();
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      success: false,
      error:   isExpired
        ? 'Sesión expirada — inicia sesión nuevamente.'
        : 'Token inválido.',
    });
  }
}

/**
 * requireRole(...roles)
 * ---------------------
 * Factory that returns a middleware which enforces role-based access.
 * Must be used AFTER verifyToken.
 *
 * @param  {...string} roles - Allowed role values from ENUM
 * @returns {Function} Express middleware
 *
 * @example
 * router.delete('/product/:id',
 *   verifyToken,
 *   requireRole('superadmin', 'admin_tienda'),
 *   productController.remove
 * );
 */
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'No autenticado.' });
    }
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        error:   `Acceso denegado — rol requerido: ${roles.join(' | ')}.`,
      });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };
