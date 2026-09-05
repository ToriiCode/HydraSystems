'use strict';

const { v4: uuidv4 } = require('uuid');
const { query, getConnection } = require('../db');

// ============================================================
// productController.js
// Full CRUD for products with multi-tenant row-level security.
// All write operations validate that the product's tienda_id
// matches the authenticated user's tienda_id (or superadmin).
// ============================================================

// --- helpers --------------------------------------------------

/** Returns tienda_id from the JWT payload. */
function tenantId(req) {
  return req.user.tienda_id;
}

/** Enforce row-level security: product must belong to the user's tenant. */
async function assertOwnership(conn, productoId, tiendaId, rol) {
  if (rol === 'superadmin') return; // superadmin bypasses tenant check

  const [rows] = await conn.execute(
    'SELECT tienda_id FROM productos WHERE id = ?',
    [productoId]
  );

  if (rows.length === 0) {
    const err = new Error('Producto no encontrado.');
    err.status = 404;
    throw err;
  }
  if (rows[0].tienda_id !== tiendaId) {
    const err = new Error('No autorizado para modificar este producto.');
    err.status = 403;
    throw err;
  }
}

// --- controllers ----------------------------------------------

/**
 * GET /api/products
 * Returns all active products for the authenticated user's tenant.
 * Supports ?search=term and ?page=1&limit=50 query params.
 */
async function list(req, res, next) {
  try {
    const { search = '', page = 1, limit = 50 } = req.query;
    const offset  = (Number(page) - 1) * Number(limit);
    const searchQ = `%${search}%`;

    const [rows] = await query(
      `SELECT id, sku, nombre, descripcion, precio, stock, imagen_url, activo, created_at, updated_at
       FROM   productos
       WHERE  tienda_id = ?
         AND  activo    = 1
         AND  (nombre LIKE ? OR sku LIKE ?)
       ORDER  BY created_at DESC
       LIMIT  ? OFFSET ?`,
      [tenantId(req), searchQ, searchQ, Number(limit), offset]
    );

    const [[{ total }]] = await query(
      `SELECT COUNT(*) AS total FROM productos
       WHERE tienda_id = ? AND activo = 1 AND (nombre LIKE ? OR sku LIKE ?)`,
      [tenantId(req), searchQ, searchQ]
    );

    return res.status(200).json({
      success: true,
      data:    rows,
      meta:    { total, page: Number(page), limit: Number(limit) },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/products/:id
 * Single product detail — must belong to authenticated tenant.
 */
async function getOne(req, res, next) {
  try {
    const [rows] = await query(
      `SELECT * FROM productos WHERE id = ? AND tienda_id = ? AND activo = 1`,
      [req.params.id, tenantId(req)]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Producto no encontrado.' });
    }

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/products/public/:slug
 * PUBLIC endpoint — no auth required.
 * Returns active products for the given store slug, including store branding.
 */
async function publicList(req, res, next) {
  try {
    const { slug } = req.params;

    const [tiendaRows] = await query(
      'SELECT id, nombre, slug, color_hex, logo_url FROM tiendas WHERE slug = ? AND activa = 1',
      [slug]
    );

    if (tiendaRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tienda no encontrada.' });
    }

    const tienda = tiendaRows[0];

    const [productos] = await query(
      `SELECT id, sku, nombre, descripcion, precio, stock, imagen_url
       FROM   productos
       WHERE  tienda_id = ? AND activo = 1 AND stock > 0
       ORDER  BY nombre ASC`,
      [tienda.id]
    );

    return res.status(200).json({
      success: true,
      tienda,
      data:    productos,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/products
 * Body: { sku, nombre, descripcion?, precio, stock, imagen_url? }
 * Creates a new product scoped to the authenticated user's tenant.
 */
async function create(req, res, next) {
  const { sku, nombre, descripcion = null, precio, stock = 0, imagen_url = null } = req.body;

  if (!sku || !nombre || precio === undefined) {
    return res.status(400).json({
      success: false,
      error: 'Campos requeridos: sku, nombre, precio.',
    });
  }
  if (Number(precio) < 0) {
    return res.status(400).json({ success: false, error: 'El precio no puede ser negativo.' });
  }

  try {
    // Check SKU uniqueness within the tenant
    const [existing] = await query(
      'SELECT id FROM productos WHERE tienda_id = ? AND sku = ?',
      [tenantId(req), sku]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        error: `El SKU "${sku}" ya existe en esta tienda.`,
      });
    }

    const id = uuidv4();
    await query(
      `INSERT INTO productos (id, tienda_id, sku, nombre, descripcion, precio, stock, imagen_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantId(req), sku, nombre, descripcion, Number(precio), Number(stock), imagen_url]
    );

    const [rows] = await query('SELECT * FROM productos WHERE id = ?', [id]);
    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/products/:id
 * Body: { sku?, nombre?, descripcion?, precio?, stock?, imagen_url?, activo? }
 * Partial update — only provided fields are changed.
 * Row-level security enforced.
 */
async function update(req, res, next) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await assertOwnership(conn, req.params.id, tenantId(req), req.user.rol);

    const allowed   = ['sku', 'nombre', 'descripcion', 'precio', 'stock', 'imagen_url', 'activo'];
    const setClauses = [];
    const values    = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        setClauses.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }

    if (setClauses.length === 0) {
      await conn.rollback();
      return res.status(400).json({ success: false, error: 'No se proporcionaron campos para actualizar.' });
    }

    values.push(req.params.id);
    await conn.execute(
      `UPDATE productos SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    const [rows] = await conn.execute('SELECT * FROM productos WHERE id = ?', [req.params.id]);
    await conn.commit();

    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    next(err);
  } finally {
    conn.release();
  }
}

/**
 * DELETE /api/products/:id
 * Soft-delete: sets activo = 0.
 * Row-level security enforced.
 */
async function remove(req, res, next) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    await assertOwnership(conn, req.params.id, tenantId(req), req.user.rol);

    await conn.execute(
      'UPDATE productos SET activo = 0 WHERE id = ?',
      [req.params.id]
    );

    await conn.commit();
    return res.status(200).json({ success: true, message: 'Producto eliminado.' });
  } catch (err) {
    await conn.rollback();
    if (err.status) return res.status(err.status).json({ success: false, error: err.message });
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { list, getOne, publicList, create, update, remove };
