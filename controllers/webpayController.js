'use strict';

const { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } = require('transbank-sdk');
const { v4: uuidv4 } = require('uuid');
const { query, getConnection } = require('../db');

// ============================================================
// webpayController.js
// POST /api/webpay/create  — Initiate Webpay Plus transaction
// GET  /api/webpay/commit  — Confirm and finalize payment
// ============================================================

// --- Transbank configuration ----------------------------------

const isProduction = process.env.TRANSBANK_ENVIRONMENT === 'production';

const transbankOptions = isProduction
  ? new Options(
      process.env.TRANSBANK_COMMERCE_CODE,
      process.env.TRANSBANK_API_KEY,
      Environment.Production
    )
  : new Options(
      IntegrationCommerceCodes.WEBPAY_PLUS,
      IntegrationApiKeys.WEBPAY,
      Environment.Integration
    );

const tx = new WebpayPlus.Transaction(transbankOptions);

// --- helpers --------------------------------------------------

/** Generate a short unique buy order string (max 26 chars per Transbank spec). */
function generateBuyOrder() {
  return `HYD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// --- controllers ----------------------------------------------

/**
 * POST /api/webpay/create
 * Body: { items: [{ producto_id, cantidad }], tienda_id }
 *
 * 1. Validates cart items against DB stock.
 * 2. Calculates total.
 * 3. Inserts a 'pendiente' sale with line items.
 * 4. Calls Transbank to create the transaction.
 * 5. Returns { url, token } for frontend redirect.
 *
 * Note: This endpoint is PUBLIC (no auth required) so any
 * visitor of a storefront can check out.
 */
async function create(req, res, next) {
  const { 
    items, 
    tienda_id,
    tienda_slug,
    nombre_cliente,
    email_cliente,
    telefono_cliente,
    region,
    ciudad,
    comuna,
    direccion
  } = req.body;

  if (!tienda_id || !tienda_slug || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Se requieren tienda_id y al menos un ítem en el carrito.',
    });
  }

  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Validate each item and fetch current prices
    const lineItems = [];
    let total = 0;

    for (const item of items) {
      const { producto_id, cantidad } = item;

      if (!producto_id || !Number.isInteger(cantidad) || cantidad < 1) {
        await conn.rollback();
        return res.status(400).json({ success: false, error: 'Item inválido en el carrito.' });
      }

      const [rows] = await conn.execute(
        `SELECT id, nombre, precio, stock
         FROM productos
         WHERE id = ? AND tienda_id = ? AND activo = 1`,
        [producto_id, tienda_id]
      );

      if (rows.length === 0) {
        await conn.rollback();
        return res.status(404).json({
          success: false,
          error: `Producto ${producto_id} no encontrado en esta tienda.`,
        });
      }

      const producto = rows[0];

      if (producto.stock < cantidad) {
        await conn.rollback();
        return res.status(409).json({
          success: false,
          error: `Stock insuficiente para "${producto.nombre}". Disponible: ${producto.stock}.`,
        });
      }

      const subtotal = Number(producto.precio) * cantidad;
      total += subtotal;
      lineItems.push({
        producto_id,
        cantidad,
        precio_unitario: Number(producto.precio),
        nombre: producto.nombre,
      });
    }

    // Round total to integer (Transbank requires integer amount in CLP)
    total = Math.round(total);

    const ventaId  = uuidv4();
    const buyOrder = generateBuyOrder();
    const sessionId = `sess-${uuidv4().slice(0, 8)}`;
    // Transbank will automatically append &token_ws=XXXX or &TBK_TOKEN=XXXX
    const returnUrl = `${process.env.FRONTEND_URL}/tienda.html?tienda=${tienda_slug}`;

    // Insert venta header
    await conn.execute(
      `INSERT INTO ventas (
         id, tienda_id, buy_order, total, estado,
         nombre_cliente, email_cliente, telefono_cliente,
         region, ciudad, comuna, direccion
       )
       VALUES (?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?)`,
      [
        ventaId, tienda_id, buyOrder, total,
        nombre_cliente || null, email_cliente || null, telefono_cliente || null,
        region || null, ciudad || null, comuna || null, direccion || null
      ]
    );

    // Insert line items
    for (const line of lineItems) {
      await conn.execute(
        `INSERT INTO detalle_ventas (id, venta_id, producto_id, cantidad, precio_unitario)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), ventaId, line.producto_id, line.cantidad, line.precio_unitario]
      );
    }

    await conn.commit();

    // Call Transbank
    const response = await tx.create(buyOrder, sessionId, total, returnUrl);

    // Save Transbank token in venta
    await query(
      'UPDATE ventas SET token_ws = ? WHERE id = ?',
      [response.token, ventaId]
    );

    return res.status(200).json({
      success:   true,
      url:       response.url,
      token:     response.token,
      venta_id:  ventaId,
      buy_order: buyOrder,
      total,
    });

  } catch (err) {
    await conn.rollback();
    console.error('[Webpay Create Error]', err);
    next(err);
  } finally {
    conn.release();
  }
}

/**
 * GET /api/webpay/commit?token_ws=<token>
 *
 * Called by Transbank's redirect after the user completes (or cancels) payment.
 *
 * 1. Calls tx.commit() to get payment result.
 * 2. If response_code === 0 → marks venta as 'pagado', decrements stock.
 * 3. Otherwise → marks venta as 'fallido' or 'anulado'.
 */
async function commit(req, res, next) {
  const { token_ws } = req.query;

  if (!token_ws) {
    return res.status(400).json({ success: false, error: 'token_ws es requerido.' });
  }

  const conn = await getConnection();
  try {
    // Fetch venta by token
    const [ventaRows] = await query(
      'SELECT * FROM ventas WHERE token_ws = ?',
      [token_ws]
    );

    if (ventaRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Orden no encontrada.' });
    }

    const venta = ventaRows[0];

    if (venta.estado !== 'pendiente') {
      return res.status(409).json({
        success: false,
        error:   `La orden ya fue procesada (estado: ${venta.estado}).`,
        estado:  venta.estado,
      });
    }

    // Call Transbank commit
    const response = await tx.commit(token_ws);
    const paid     = response.response_code === 0 && response.status === 'AUTHORIZED';

    await conn.beginTransaction();

    if (paid) {
      // Update venta to 'pagado'
      await conn.execute(
        `UPDATE ventas
         SET estado = 'pagado', response_code = ?, authorization_code = ?, card_last_four = ?
         WHERE id = ?`,
        [response.response_code, response.authorization_code, response.card_detail?.card_number, venta.id]
      );

      // Decrement stock for each line item
      const [detalles] = await conn.execute(
        'SELECT producto_id, cantidad FROM detalle_ventas WHERE venta_id = ?',
        [venta.id]
      );

      for (const detalle of detalles) {
        await conn.execute(
          `UPDATE productos
           SET stock = GREATEST(0, stock - ?)
           WHERE id = ? AND tienda_id = ?`,
          [detalle.cantidad, detalle.producto_id, venta.tienda_id]
        );
      }

      await conn.commit();

      // --- Send Email Receipt (Mock using Nodemailer) ---
      if (venta.email_cliente && typeof venta.email_cliente === 'string' && venta.email_cliente.includes('@')) {
        try {
          const nodemailer = require('nodemailer');
          // For testing, we use ethereal mail (fake SMTP)
          let testAccount = await nodemailer.createTestAccount();
          let transporter = nodemailer.createTransport({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false, 
            auth: { user: testAccount.user, pass: testAccount.pass },
          });
          
          let info = await transporter.sendMail({
            from: '"Hydra Systems" <no-reply@hydrasystems.io>',
            to: venta.email_cliente,
            subject: `Comprobante de compra - Orden #${venta.buy_order}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
                <h2 style="color: #00F0FF;">¡Gracias por tu compra, ${venta.nombre_cliente || 'Cliente'}!</h2>
                <p>Hemos recibido tu pago exitosamente.</p>
                <ul>
                  <li><b>Orden:</b> ${venta.buy_order}</li>
                  <li><b>Monto:</b> $${venta.total}</li>
                  <li><b>Tarjeta:</b> **** **** **** ${response.card_detail?.card_number || 'N/A'}</li>
                  <li><b>Dirección de envío:</b> ${venta.direccion || 'N/A'}, ${venta.comuna || ''}</li>
                </ul>
                <p>Tu pedido está siendo procesado por la tienda.</p>
              </div>
            `
          });
          console.log("💌 [EMAIL ENVIADO] Comprobante enviado a:", venta.email_cliente);
          console.log("💌 [EMAIL URL] Ver correo de prueba en:", nodemailer.getTestMessageUrl(info));
        } catch (err) {
          console.error("Error al enviar email:", err);
        }
      }
      // --------------------------------------------------

      return res.status(200).json({
        success:            true,
        estado:             'pagado',
        buy_order:          response.buy_order,
        amount:             response.amount,
        authorization_code: response.authorization_code,
        transaction_date:   response.transaction_date,
        card_number:        response.card_detail?.card_number,
      });

    } else {
      // Payment failed or was cancelled
      await conn.execute(
        `UPDATE ventas
         SET estado = 'fallido', response_code = ?
         WHERE id = ?`,
        [response.response_code ?? -1, venta.id]
      );

      await conn.commit();

      return res.status(200).json({
        success:       false,
        estado:        'fallido',
        response_code: response.response_code,
        message:       'El pago no pudo completarse. Ningún cargo fue realizado.',
      });
    }

  } catch (err) {
    await conn.rollback();
    console.error('[Webpay Commit Error]', err);
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { create, commit };
