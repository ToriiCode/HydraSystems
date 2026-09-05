'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/productController');
const { verifyToken, requireRole } = require('../middleware/auth');

// PUBLIC — Storefront product listing (no auth required)
// GET /api/products/public/:slug
router.get('/public/:slug', ctrl.publicList);

// PROTECTED — All routes below require a valid JWT
router.use(verifyToken);

// GET    /api/products        — List all products for authenticated tenant
router.get('/', ctrl.list);

// GET    /api/products/:id    — Single product detail
router.get('/:id', ctrl.getOne);

// POST   /api/products        — Create product (admin_tienda or superadmin)
router.post('/',
  requireRole('superadmin', 'admin_tienda'),
  ctrl.create
);

// PUT    /api/products/:id    — Update product (admin_tienda or superadmin)
router.put('/:id',
  requireRole('superadmin', 'admin_tienda'),
  ctrl.update
);

// DELETE /api/products/:id    — Soft-delete (admin_tienda or superadmin)
router.delete('/:id',
  requireRole('superadmin', 'admin_tienda'),
  ctrl.remove
);

module.exports = router;
