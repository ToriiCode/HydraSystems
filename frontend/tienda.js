/* =============================================================
 * tienda.js — Hydra Systems Public Storefront
 * ============================================================= */

'use strict';

// ── Config ───────────────────────────────────────────────────
const API = 'https://hydrasystems.onrender.com/api';

// ── State ────────────────────────────────────────────────────
let storeData  = null; // { id, nombre, slug, color_hex, logo_url }
let products   = [];
let cart       = []; // [{ producto_id, nombre, precio, imagen_url, cantidad }]
let storeSlug  = null;

// ── URL params ────────────────────────────────────────────────
function getUrlParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

// ── Theming ───────────────────────────────────────────────────
/**
 * Injects the store's brand color into CSS custom properties on :root.
 * This drives all accent colors in the storefront without any framework.
 *
 * @param {string} hex - 6-digit hex color e.g. "#00F0FF"
 */
function applyBrandColor(hex) {
  const root = document.documentElement;
  root.style.setProperty('--brand-primary', hex);

  // Derive rgba variants from the hex
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);

  root.style.setProperty('--brand-dim',    `rgba(${r},${g},${b},0.12)`);
  root.style.setProperty('--brand-glow',   `rgba(${r},${g},${b},0.28)`);
  root.style.setProperty('--brand-border', `rgba(${r},${g},${b},0.25)`);
}

// ── Utilities ─────────────────────────────────────────────────
function esc(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatPrice(n) {
  return Number(n).toLocaleString('es-CL');
}

// ── Fetch store & products ────────────────────────────────────
async function loadStore(slug) {
  try {
    const resp = await fetch(`${API}/products/public/${encodeURIComponent(slug)}`);
    const data = await resp.json();

    if (!resp.ok || !data.success) {
      throw new Error(data.error || 'Tienda no encontrada.');
    }

    storeData = data.tienda;
    products  = data.data;

    // Apply dynamic brand color
    applyBrandColor(storeData.color_hex || '#00F0FF');

    // Update page title & nav
    document.title = `${storeData.nombre} — Hydra Systems`;
    document.getElementById('storeNameHeader').textContent = storeData.nombre;

    // Logo
    if (storeData.logo_url) {
      const img = document.getElementById('storeLogoImg');
      img.src   = storeData.logo_url;
      img.style.display = 'block';
      document.getElementById('storeLogoPlaceholder').style.display = 'none';
      img.onerror = () => {
        img.style.display = 'none';
        document.getElementById('storeLogoPlaceholder').style.display = 'flex';
      };
    }

    renderStore();

  } catch (err) {
    renderError(err.message);
  }
}

// ── Render ────────────────────────────────────────────────────
function renderStore() {
  const main = document.getElementById('storeMain');

  if (products.length === 0) {
    main.innerHTML = `
      <div class="state-container">
        <span class="state-icon">🏪</span>
        <h2>${esc(storeData.nombre)}</h2>
        <p>Esta tienda no tiene productos disponibles todavía. ¡Vuelve pronto!</p>
      </div>`;
    return;
  }

  main.innerHTML = `
    <!-- Hero -->
    <div class="store-hero">
      <h1>${esc(storeData.nombre)}</h1>
      <p>${products.length} producto${products.length !== 1 ? 's' : ''} disponible${products.length !== 1 ? 's' : ''}</p>
    </div>

    <!-- Products grid -->
    <div class="products-section">
      <div class="products-header">
        <h2>Nuestros Productos</h2>
        <span class="products-count">${products.length} artículo${products.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="products-grid" id="productsGrid">
        ${products.map(renderProductCard).join('')}
      </div>
    </div>

    <footer class="store-footer">
      Tienda creada con <a href="index.html" target="_blank">Hydra Systems</a>
    </footer>
  `;
}

function renderProductCard(p) {
  const isLowStock = p.stock <= 5;
  const imgHtml    = p.imagen_url
    ? `<img src="${esc(p.imagen_url)}" alt="${esc(p.nombre)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'product-img-placeholder\\'>📦</div>'" />`
    : `<div class="product-img-placeholder">📦</div>`;

  return `
    <div class="product-card" data-id="${p.id}">
      <div class="product-img">
        ${imgHtml}
        <span class="stock-chip ${isLowStock ? 'low' : 'ok'}">
          ${isLowStock ? `⚠ Solo ${p.stock}` : `✓ ${p.stock} en stock`}
        </span>
      </div>
      <div class="product-info">
        <h3>${esc(p.nombre)}</h3>
        ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : '<p class="desc" style="min-height:2.4rem;"></p>'}
        <div class="product-footer">
          <span class="product-price">$${formatPrice(p.precio)}</span>
          <button
            class="btn-add-cart"
            onclick="addToCart('${p.id}')"
            ${p.stock === 0 ? 'disabled' : ''}
          >
            ${p.stock === 0 ? 'Sin stock' : '+ Agregar'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderError(message) {
  document.getElementById('storeMain').innerHTML = `
    <div class="state-container">
      <span class="state-icon">⚠️</span>
      <h2>Tienda no encontrada</h2>
      <p>${esc(message)}</p>
    </div>`;
}

// ── Cart operations ───────────────────────────────────────────
function addToCart(productoId) {
  const product = products.find(p => p.id === productoId);
  if (!product) return;

  const existing = cart.find(c => c.producto_id === productoId);

  if (existing) {
    if (existing.cantidad >= product.stock) {
      alert(`Stock máximo disponible: ${product.stock} unidades.`);
      return;
    }
    existing.cantidad++;
  } else {
    cart.push({
      producto_id: product.id,
      nombre:      product.nombre,
      precio:      Number(product.precio),
      imagen_url:  product.imagen_url,
      cantidad:    1,
    });
  }

  renderCart();
  updateCartBadge();
  openCart();
}

function updateQuantity(productoId, delta) {
  const item    = cart.find(c => c.producto_id === productoId);
  const product = products.find(p => p.id === productoId);

  if (!item) return;

  item.cantidad += delta;

  if (item.cantidad <= 0) {
    cart = cart.filter(c => c.producto_id !== productoId);
  } else if (product && item.cantidad > product.stock) {
    item.cantidad = product.stock;
  }

  renderCart();
  updateCartBadge();
}

function removeFromCart(productoId) {
  cart = cart.filter(c => c.producto_id !== productoId);
  renderCart();
  updateCartBadge();
}

function updateCartBadge() {
  const total = cart.reduce((sum, c) => sum + c.cantidad, 0);
  document.getElementById('cartCount').textContent = total;
}

function renderCart() {
  const itemsEl  = document.getElementById('cartItems');
  const footerEl = document.getElementById('cartFooter');

  if (cart.length === 0) {
    itemsEl.innerHTML = `
      <div class="cart-empty">
        <span class="icon">🛒</span>
        <p>Tu carrito está vacío.<br>Agrega productos para comenzar.</p>
      </div>`;
    footerEl.style.display = 'none';
    return;
  }

  itemsEl.innerHTML = cart.map(item => {
    const subtotal = item.precio * item.cantidad;
    const imgHtml  = item.imagen_url
      ? `<img class="cart-item-img" src="${esc(item.imagen_url)}" alt="${esc(item.nombre)}" onerror="this.outerHTML='<div class=\\'cart-item-img-ph\\'>📦</div>'" />`
      : `<div class="cart-item-img-ph">📦</div>`;

    return `
      <div class="cart-item">
        ${imgHtml}
        <div class="cart-item-info">
          <div class="cart-item-name">${esc(item.nombre)}</div>
          <div class="cart-item-price">$${formatPrice(item.precio)} c/u</div>
          <div class="cart-item-controls">
            <button class="qty-btn" onclick="updateQuantity('${item.producto_id}', -1)">−</button>
            <span class="qty-value">${item.cantidad}</span>
            <button class="qty-btn" onclick="updateQuantity('${item.producto_id}', 1)">+</button>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.5rem;">
          <span class="cart-item-subtotal">$${formatPrice(subtotal)}</span>
          <button class="cart-remove" onclick="removeFromCart('${item.producto_id}')" title="Eliminar">🗑️</button>
        </div>
      </div>`;
  }).join('');

  // Summary
  const subtotal = cart.reduce((sum, c) => sum + c.precio * c.cantidad, 0);
  const items    = cart.reduce((sum, c) => sum + c.cantidad, 0);
  const iva      = Math.round(subtotal * 0.19);   // IVA 19% informativo

  document.getElementById('cartSummary').innerHTML = `
    <div class="cart-row"><span>${items} artículo${items !== 1 ? 's' : ''}</span><span>$${formatPrice(subtotal)}</span></div>
    <div class="cart-row"><span>IVA incluido (19%)</span><span>$${formatPrice(iva)}</span></div>
    <div class="cart-row total"><span>Total</span><span class="total-val">$${formatPrice(subtotal)}</span></div>
  `;

  footerEl.style.display = 'block';
}

// ── Cart Drawer toggle ────────────────────────────────────────
function openCart() {
  document.getElementById('cartDrawer').classList.add('open');
  document.getElementById('cartOverlay').classList.add('open');
}

function closeCart() {
  document.getElementById('cartDrawer').classList.remove('open');
  document.getElementById('cartOverlay').classList.remove('open');
}

function toggleCart() {
  const isOpen = document.getElementById('cartDrawer').classList.contains('open');
  isOpen ? closeCart() : openCart();
}

// ── Checkout ──────────────────────────────────────────────────
function showCheckoutForm() {
  document.getElementById('checkoutForm').style.display = 'block';
  document.getElementById('startCheckoutBtn').style.display = 'none';
  document.getElementById('checkoutBtn').style.display = 'block';
}

async function checkout() {
  if (cart.length === 0) { alert('El carrito está vacío.'); return; }
  if (!storeData?.id)    { alert('Error: tienda no identificada.'); return; }

  const payload = {
    tienda_id: storeData.id,
    tienda_slug: storeData.slug,
    items:     cart.map(c => ({ producto_id: c.producto_id, cantidad: c.cantidad })),
    nombre_cliente: document.getElementById('chk_nombre').value.trim(),
    email_cliente: document.getElementById('chk_email').value.trim(),
    telefono_cliente: document.getElementById('chk_telefono').value.trim(),
    region: document.getElementById('chk_region').value.trim(),
    ciudad: document.getElementById('chk_ciudad').value.trim(),
    comuna: document.getElementById('chk_comuna').value.trim(),
    direccion: document.getElementById('chk_direccion').value.trim(),
  };

  if (!payload.nombre_cliente || !payload.email_cliente || !payload.direccion) {
    alert('Por favor completa todos los campos obligatorios del envío.');
    return;
  }

  const btn = document.getElementById('checkoutBtn');
  btn.disabled   = true;
  btn.innerHTML  = '⏳ Iniciando pago...';

  try {
    const resp = await fetch(`${API}/webpay/create`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await resp.json();

    if (!resp.ok || !data.success) {
      throw new Error(data.error || 'No se pudo iniciar el pago.');
    }

    // Redirect to Transbank payment page
    // Transbank expects a POST form redirect
    const form = document.createElement('form');
    form.method  = 'POST';
    form.action  = data.url;

    const input = document.createElement('input');
    input.type  = 'hidden';
    input.name  = 'token_ws';
    input.value = data.token;

    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();

  } catch (err) {
    alert(`❌ Error al procesar el pago: ${err.message}`);
    btn.disabled  = false;
    btn.textContent = 'Pagar con Webpay Plus';
  }
}

// ── Payment result (return from Transbank) ────────────────────
async function handlePaymentReturn() {
  const tokenWs = getUrlParam('token_ws');
  const tbkToken = getUrlParam('TBK_TOKEN');
  
  if (!tokenWs && !tbkToken) return false;

  // If TBK_TOKEN is present, the transaction was aborted by the user
  if (tbkToken) {
    const main = document.getElementById('storeMain');
    main.innerHTML = `
      <div style="padding:2rem;">
        <div class="payment-banner error">
          <span class="icon">❌</span>
          <h2>Pago Anulado</h2>
          <p>Cancelaste el pago o hubo un error antes de procesarlo.</p>
          <br/>
          <button onclick="window.location.href=window.location.pathname+'?tienda=${encodeURIComponent(storeSlug)}'"
            style="margin-top:1rem;padding:.75rem 2rem;background:var(--danger);color:var(--bg-void);border:none;border-radius:8px;font-family:var(--font-head);font-size:1rem;font-weight:700;cursor:pointer;">
            Volver a la tienda
          </button>
        </div>
      </div>`;
    return true;
  }

  // Show full-page result instead of product grid
  const main = document.getElementById('storeMain');
  main.innerHTML = `<div class="page-spinner"><div class="spinner-ring"></div><span>Verificando pago...</span></div>`;

  try {
    const resp = await fetch(`${API}/webpay/commit?token_ws=${encodeURIComponent(tokenWs)}`);
    const data = await resp.json();

    if (data.success && data.estado === 'pagado') {
      main.innerHTML = `
        <div style="padding:2rem;">
          <div class="payment-banner success">
            <span class="icon">✅</span>
            <h2>¡Pago exitoso!</h2>
            <p>Tu orden ha sido confirmada. Gracias por tu compra.</p>
            <div class="detail">
              <strong>Orden:</strong> ${esc(data.buy_order || '')}<br/>
              <strong>Monto:</strong> $${formatPrice(data.amount || 0)}<br/>
              <strong>Código de autorización:</strong> ${esc(data.authorization_code || '')}<br/>
              <strong>Tarjeta:</strong> **** **** **** ${esc(data.card_number || '****')}
            </div>
            <br/>
            <button onclick="window.location.href=window.location.pathname+'?tienda=${encodeURIComponent(storeSlug)}'"
              style="margin-top:1rem;padding:.75rem 2rem;background:var(--brand-primary);color:var(--bg-void);border:none;border-radius:8px;font-family:var(--font-head);font-size:1rem;font-weight:700;cursor:pointer;">
              Seguir comprando →
            </button>
          </div>
        </div>`;
    } else {
      main.innerHTML = `
        <div style="padding:2rem;">
          <div class="payment-banner error">
            <span class="icon">❌</span>
            <h2>Pago no completado</h2>
            <p>El pago fue rechazado o cancelado. No se realizó ningún cargo.</p>
            <div class="detail">Código: ${data.response_code ?? 'N/A'}</div>
            <br/>
            <button onclick="window.location.href=window.location.pathname+'?tienda=${encodeURIComponent(storeSlug)}'"
              style="margin-top:1rem;padding:.75rem 2rem;background:var(--danger);color:var(--bg-void);border:none;border-radius:8px;font-family:var(--font-head);font-size:1rem;font-weight:700;cursor:pointer;">
              Volver a la tienda
            </button>
          </div>
        </div>`;
    }
  } catch (err) {
    main.innerHTML = `<div class="state-container"><span class="state-icon">⚠️</span><h2>Error al verificar el pago</h2><p>${esc(err.message)}</p></div>`;
  }

  return true; // Handled — don't load products
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  storeSlug = getUrlParam('tienda');

  // Check if returning from Transbank payment
  const isPaymentReturn = await handlePaymentReturn();
  if (isPaymentReturn) return;

  if (!storeSlug) {
    renderError('No se especificó ninguna tienda. Agrega ?tienda=mi-tienda a la URL.');
    document.getElementById('storeMain').innerHTML = `
      <div class="state-container">
        <span class="state-icon">🔗</span>
        <h2>Parámetro faltante</h2>
        <p>La URL debe incluir el parámetro <code>?tienda=nombre-de-tienda</code></p>
        <p style="margin-top:.5rem;"><a href="index.html" style="color:var(--brand-primary);">← Volver al inicio</a></p>
      </div>`;
    return;
  }

  await loadStore(storeSlug);
});
