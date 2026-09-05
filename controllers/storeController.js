'use strict';

const { query } = require('../db');

// ============================================================
// storeController.js
// GET /api/stores/public  — Public store directory listing
// ============================================================

/**
 * GET /api/stores/public
 * Returns all active stores for the public directory.
 * Supports ?search=term
 */
async function listPublic(req, res, next) {
  const { search = '' } = req.query;
  const searchQ = `%${search}%`;

  try {
    const [stores] = await query(
      `SELECT
         t.id, t.nombre, t.slug, t.color_hex, t.logo_url, t.plan, t.created_at,
         COUNT(p.id) AS total_productos
       FROM tiendas t
       LEFT JOIN productos p ON p.tienda_id = t.id AND p.activo = 1 AND p.stock > 0
       WHERE t.activa = 1
         AND (t.nombre LIKE ? OR t.slug LIKE ?)
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [searchQ, searchQ]
    );

    return res.status(200).json({ success: true, data: stores });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPublic };
