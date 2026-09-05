'use strict';

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query, getConnection } = require('../db');

// ============================================================
// authController.js
// POST /api/auth/register-store  — Create tenant + admin user
// POST /api/auth/login           — Issue JWT
// PUT  /api/auth/stores/:id/color — Update brand color (admin)
// POST /api/auth/forgot-password  — Verify security question
// POST /api/auth/reset-password   — Set new password with temp token
// ============================================================

const SALT_ROUNDS = 12;

// ------ helpers -----------------------------------------------

function signToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '8h',
  });
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/--+/g, '-')
    .slice(0, 80);
}

// ------ controllers --------------------------------------------

/**
 * POST /api/auth/register-store
 * Body: { nombre_tienda, slug?, color_hex?, plan?, nombre_admin, email, password, pregunta_seguridad, respuesta_seguridad }
 */
async function registerStore(req, res, next) {
  const {
    nombre_tienda,
    slug: rawSlug,
    color_hex = '#00F0FF',
    plan      = 'basic',
    nombre_admin,
    email,
    password,
    pregunta_seguridad,
    respuesta_seguridad,
  } = req.body;

  // --- basic validation ---
  if (!nombre_tienda || !nombre_admin || !email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Campos requeridos: nombre_tienda, nombre_admin, email, password.',
    });
  }
  if (password.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'La contraseña debe tener al menos 8 caracteres.',
    });
  }
  if (!pregunta_seguridad || !respuesta_seguridad) {
    return res.status(400).json({
      success: false,
      error: 'Debes elegir una pregunta de seguridad y su respuesta.',
    });
  }

  const slug = slugify(rawSlug || nombre_tienda);

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Check slug uniqueness
    const [existing] = await conn.execute(
      'SELECT id FROM tiendas WHERE slug = ?',
      [slug]
    );
    if (existing.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        error: `El slug "${slug}" ya está en uso. Elige otro nombre de tienda.`,
      });
    }

    // Check email uniqueness
    const [emailCheck] = await conn.execute(
      'SELECT id FROM usuarios WHERE email = ?',
      [email]
    );
    if (emailCheck.length > 0) {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        error: 'El email ya está registrado.',
      });
    }

    const tiendaId  = uuidv4();
    const usuarioId = uuidv4();
    const hash      = await bcrypt.hash(password, SALT_ROUNDS);
    // Hash the security answer (lowercase, trimmed) for safe comparison
    const respHash  = await bcrypt.hash(respuesta_seguridad.trim().toLowerCase(), SALT_ROUNDS);

    // Insert tenant
    await conn.execute(
      `INSERT INTO tiendas (id, nombre, slug, color_hex, plan)
       VALUES (?, ?, ?, ?, ?)`,
      [tiendaId, nombre_tienda, slug, color_hex, plan]
    );

    // Insert admin user with security question
    await conn.execute(
      `INSERT INTO usuarios (id, tienda_id, nombre, email, password_hash, pregunta_seguridad, respuesta_seguridad, rol)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'admin_tienda')`,
      [usuarioId, tiendaId, nombre_admin, email, hash, pregunta_seguridad, respHash]
    );

    await conn.commit();

    const token = signToken({
      id:        usuarioId,
      tienda_id: tiendaId,
      rol:       'admin_tienda',
      nombre:    nombre_admin,
    });

    return res.status(201).json({
      success: true,
      message: `Tienda "${nombre_tienda}" creada exitosamente.`,
      token,
      tienda: { id: tiendaId, nombre: nombre_tienda, slug, color_hex, plan },
    });

  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
async function login(req, res, next) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Email y contraseña son requeridos.',
    });
  }

  try {
    const [rows] = await query(
      `SELECT u.id, u.tienda_id, u.nombre, u.email, u.password_hash, u.rol, u.activo,
              t.nombre AS tienda_nombre, t.slug, t.color_hex, t.plan
       FROM   usuarios u
       LEFT JOIN tiendas t ON t.id = u.tienda_id
       WHERE  u.email = ?
       LIMIT  1`,
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
    }

    const user = rows[0];

    if (!user.activo) {
      return res.status(403).json({ success: false, error: 'Cuenta desactivada. Contacta al administrador.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
    }

    // Update last login timestamp
    await query('UPDATE usuarios SET ultimo_login = NOW() WHERE id = ?', [user.id]);

    const token = signToken({
      id:        user.id,
      tienda_id: user.tienda_id,
      rol:       user.rol,
      nombre:    user.nombre,
    });

    return res.status(200).json({
      success: true,
      token,
      user: {
        id:        user.id,
        nombre:    user.nombre,
        email:     user.email,
        rol:       user.rol,
        tienda_id: user.tienda_id,
        tienda:    user.tienda_id
          ? {
              nombre:    user.tienda_nombre,
              slug:      user.slug,
              color_hex: user.color_hex,
              plan:      user.plan,
            }
          : null,
      },
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/forgot-password
 * Body: { email }             → returns security question
 * Body: { email, respuesta }  → verifies answer, returns reset_token
 */
async function forgotPassword(req, res, next) {
  const { email, respuesta } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, error: 'El email es requerido.' });
  }

  try {
    const [rows] = await query(
      'SELECT id, pregunta_seguridad, respuesta_seguridad FROM usuarios WHERE email = ? AND activo = 1 LIMIT 1',
      [email]
    );

    if (rows.length === 0) {
      // Don't reveal whether the email exists
      return res.status(200).json({
        success: true,
        pregunta: null,
        message: 'Si el email existe, se mostrará la pregunta de seguridad.',
      });
    }

    const user = rows[0];

    if (!user.pregunta_seguridad || !user.respuesta_seguridad) {
      return res.status(400).json({
        success: false,
        error: 'Esta cuenta no tiene pregunta de seguridad configurada.',
      });
    }

    // Step 1: Just return the question
    if (!respuesta) {
      return res.status(200).json({
        success: true,
        pregunta: user.pregunta_seguridad,
      });
    }

    // Step 2: Verify the answer
    const match = await bcrypt.compare(respuesta.trim().toLowerCase(), user.respuesta_seguridad);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Respuesta incorrecta.' });
    }

    // Issue a short-lived token (15 min) for password reset only
    const resetToken = signToken({ id: user.id, purpose: 'password_reset' }, '15m');

    return res.status(200).json({
      success: true,
      reset_token: resetToken,
      message: 'Respuesta correcta. Establece tu nueva contraseña.',
    });

  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/reset-password
 * Body: { reset_token, new_password }
 */
async function resetPassword(req, res, next) {
  const { reset_token, new_password } = req.body;

  if (!reset_token || !new_password) {
    return res.status(400).json({ success: false, error: 'Token y nueva contraseña son requeridos.' });
  }

  if (new_password.length < 8) {
    return res.status(400).json({ success: false, error: 'La contraseña debe tener al menos 8 caracteres.' });
  }

  try {
    const decoded = jwt.verify(reset_token, process.env.JWT_SECRET);

    if (decoded.purpose !== 'password_reset') {
      return res.status(403).json({ success: false, error: 'Token inválido para esta operación.' });
    }

    const hash = await bcrypt.hash(new_password, SALT_ROUNDS);

    const [result] = await query(
      'UPDATE usuarios SET password_hash = ? WHERE id = ? AND activo = 1',
      [hash, decoded.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.',
    });

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'El enlace de recuperación expiró. Intenta de nuevo.' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: 'Token inválido.' });
    }
    next(err);
  }
}

/**
 * PUT /api/auth/stores/:id/color
 * Body: { color_hex }
 */
async function updateColor(req, res, next) {
  const { id } = req.params;
  const { color_hex } = req.body;

  if (!color_hex || !/^#[0-9A-Fa-f]{6}$/.test(color_hex)) {
    return res.status(400).json({
      success: false,
      error: 'color_hex debe ser un color hexadecimal válido (ej: #00F0FF).',
    });
  }

  if (req.user.rol === 'admin_tienda' && req.user.tienda_id !== id) {
    return res.status(403).json({ success: false, error: 'No autorizado para modificar esta tienda.' });
  }

  try {
    const [result] = await query(
      'UPDATE tiendas SET color_hex = ? WHERE id = ?',
      [color_hex, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Tienda no encontrada.' });
    }

    return res.status(200).json({ success: true, color_hex });
  } catch (err) {
    next(err);
  }
}

module.exports = { registerStore, login, updateColor, forgotPassword, resetPassword };
