/* =============================================================
 * admin.js — Hydra Systems Admin Panel
 * ============================================================= */

'use strict';

// ── Config ───────────────────────────────────────────────────
const API = 'https://hydrasystems.onrender.com/api';

// ── Security Guard ───────────────────────────────────────────
// This MUST be the first executed block.
// If no valid token exists in localStorage → redirect immediately.
(function securityGuard() {
  const token = localStorage.getItem('hydra_token');
  if (!token) {
    window.location.replace('index.html');
    throw new Error('Redirecting to login.'); // Halt further execution
  }
})();

// ── State ────────────────────────────────────────────────────
let products    = [];
let editingId   = null;
let searchTimer = null;

// ── Auth helpers ─────────────────────────────────────────────
function getToken()  { return localStorage.getItem('hydra_token'); }
function getUser()   { try { return JSON.parse(localStorage.getItem('hydra_user'))  || {}; } catch { return {}; } }
function getTienda() { try { return JSON.parse(localStorage.getItem('hydra_tienda')) || {}; } catch { return {}; } }

function authHeaders() {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${getToken()}`,
  };
}

/** Handle 401 globally — token expired or invalid */
function handleUnauthorized() {
  localStorage.clear();
  window.location.replace('index.html');
}

/** Wrapper around fetch that handles 401 globally */
async function apiFetch(url, options = {}) {
  const resp = await fetch(url, options);
  if (resp.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
  return resp;
}

// ── Toast notifications ──────────────────────────────────────
let toastTimer = null;
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3500);
}

// ── Brand color theming ──────────────────────────────────────
function applyBrandColor(hex) {
  document.documentElement.style.setProperty('--brand-primary', hex);
  document.documentElement.style.setProperty('--cyan-glow', hexToRgba(hex, 0.28));
  document.documentElement.style.setProperty('--cyan-dim',  hexToRgba(hex, 0.12));
  document.getElementById('brandColorHex').textContent = hex.toUpperCase();
  document.getElementById('brandColorPicker').value    = hex;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

document.getElementById('brandColorPicker').addEventListener('input', function () {
  applyBrandColor(this.value);
});

async function saveColor() {
  const tienda = getTienda();
  if (!tienda.id) { showToast('No se encontró la tienda activa.', 'error'); return; }

  const color_hex = document.getElementById('brandColorPicker').value;

  try {
    const resp = await apiFetch(`${API}/auth/stores/${tienda.id}/color`, {
      method:  'PUT',
      headers: authHeaders(),
      body:    JSON.stringify({ color_hex }),
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    // Persist locally
    const t = getTienda();
    t.color_hex = color_hex;
    localStorage.setItem('hydra_tienda', JSON.stringify(t));

    applyBrandColor(color_hex);
    showToast('✅ Color de marca actualizado');
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

// ── Initialize UI ─────────────────────────────────────────────
function initUI() {
  const user   = getUser();
  const tienda = getTienda();

  // User info in sidebar
  const nombre = user.nombre || 'Usuario';
  document.getElementById('userName').textContent  = nombre;
  document.getElementById('userRole').textContent  = rolLabel(user.rol);
  document.getElementById('userAvatar').textContent = nombre.charAt(0).toUpperCase();

  // Store name in sidebar
  document.getElementById('sidebarStoreName').textContent = tienda.nombre || 'Mi Tienda';

  // Vitrina link
  const slug = tienda.slug || tienda.id;
  if (slug) {
    document.getElementById('storeLink').href = `tienda.html?tienda=${slug}`;
  }

  // Apply brand color
  const color = tienda.color_hex || '#00F0FF';
  applyBrandColor(color);
}

function rolLabel(rol) {
  const map = { superadmin: 'Super Admin', admin_tienda: 'Admin Tienda', cajero: 'Cajero' };
  return map[rol] || rol;
}

// ── Section nav ───────────────────────────────────────────────
function showSection(section) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  event.currentTarget.classList.add('active');

  if (section === 'inventory') {
    document.getElementById('topbarTitle').textContent = '📦 Inventario';
    document.getElementById('inventorySection').style.display = '';
    document.getElementById('kpiGrid').style.display           = '';
    const ta = document.querySelector('.topbar-actions');
    ta.style.display = '';
  }
  // Additional sections can be added here (e.g., 'sales')
}

// ── Products CRUD ─────────────────────────────────────────────

async function loadProducts(search = '') {
  const tbody = document.getElementById('productTableBody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Cargando...</td></tr>';

  try {
    const qs   = search ? `?search=${encodeURIComponent(search)}` : '';
    const resp = await apiFetch(`${API}/products${qs}`, { headers: authHeaders() });
    const data = await resp.json();

    if (!data.success) throw new Error(data.error);

    products = data.data;
    renderProducts();
    updateKPIs();

  } catch (err) {
    tbody.innerHTML = `<tr class="loading-row"><td colspan="6" style="color:var(--danger)">❌ ${err.message}</td></tr>`;
  }
}

function renderProducts() {
  const tbody = document.getElementById('productTableBody');
  document.getElementById('productCount').textContent = `${products.length} productos`;

  if (products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state">
            <span class="empty-icon">📦</span>
            <p>No hay productos todavía. ¡Agrega tu primer producto!</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:.75rem;">
          ${p.imagen_url
            ? `<img src="${escHtml(p.imagen_url)}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" onerror="this.style.display='none'" />`
            : `<div style="width:40px;height:40px;border-radius:6px;background:var(--cyan-dim);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:1.25rem;">📦</div>`}
          <div>
            <div style="font-weight:600;">${escHtml(p.nombre)}</div>
            <div style="font-size:.75rem;color:var(--muted);margin-top:.1rem;">${p.descripcion ? escHtml(p.descripcion).slice(0,50) + (p.descripcion.length > 50 ? '…' : '') : ''}</div>
          </div>
        </div>
      </td>
      <td class="td-sku">${escHtml(p.sku)}</td>
      <td class="td-price">$${formatPrice(p.precio)}</td>
      <td class="td-stock ${p.stock < 5 ? 'low' : 'ok'}">${p.stock}</td>
      <td><span class="${p.activo ? 'badge-active' : 'badge-inactive'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <div class="td-actions">
          <button class="btn btn-outline" style="padding:.35rem .75rem;font-size:.75rem;" onclick="openProductModal('${p.id}')">✏️ Editar</button>
          <button class="btn btn-danger"  style="padding:.35rem .75rem;font-size:.75rem;" onclick="deleteProduct('${p.id}', '${escHtml(p.nombre)}')">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function updateKPIs() {
  document.getElementById('kpiTotal').textContent = products.length;
  document.getElementById('kpiLow').textContent   = products.filter(p => p.stock < 5).length;

  const valor = products.reduce((sum, p) => sum + (Number(p.precio) * Number(p.stock)), 0);
  document.getElementById('kpiValue').textContent = '$' + formatPrice(valor);
}

// ── Product Modal ─────────────────────────────────────────────
function openProductModal(id = null) {
  editingId = id;

  const modal = document.getElementById('productModal');
  document.getElementById('modalTitle').textContent = id ? '✏️ Editar Producto' : 'Nuevo Producto';
  document.getElementById('modalError').style.display = 'none';
  document.getElementById('modalSaveBtn').textContent = id ? 'Guardar cambios' : 'Crear producto';

  if (id) {
    const p = products.find(x => x.id === id);
    if (!p) return;
    document.getElementById('f_sku').value         = p.sku         || '';
    document.getElementById('f_nombre').value      = p.nombre      || '';
    document.getElementById('f_descripcion').value = p.descripcion || '';
    document.getElementById('f_precio').value      = p.precio      || 0;
    document.getElementById('f_stock').value       = p.stock       ?? 0;
    document.getElementById('f_imagen').value      = p.imagen_url  || '';
  } else {
    document.getElementById('f_sku').value         = '';
    document.getElementById('f_nombre').value      = '';
    document.getElementById('f_descripcion').value = '';
    document.getElementById('f_precio').value      = '';
    document.getElementById('f_stock').value       = 0;
    document.getElementById('f_imagen').value      = '';
  }

  modal.classList.add('active');
}

function closeProductModal() {
  document.getElementById('productModal').classList.remove('active');
  editingId = null;
}

document.getElementById('productModal').addEventListener('click', function (e) {
  if (e.target === this) closeProductModal();
});

async function saveProduct() {
  const saveBtn = document.getElementById('modalSaveBtn');
  const errorEl = document.getElementById('modalError');
  errorEl.style.display = 'none';

  const payload = {
    sku:         document.getElementById('f_sku').value.trim(),
    nombre:      document.getElementById('f_nombre').value.trim(),
    descripcion: document.getElementById('f_descripcion').value.trim() || null,
    precio:      Number(document.getElementById('f_precio').value),
    stock:       Number(document.getElementById('f_stock').value),
    imagen_url:  document.getElementById('f_imagen').value.trim() || null,
  };

  if (!payload.sku || !payload.nombre || isNaN(payload.precio)) {
    errorEl.textContent    = 'SKU, nombre y precio son obligatorios.';
    errorEl.style.display  = 'block';
    return;
  }

  saveBtn.disabled    = true;
  saveBtn.innerHTML   = '<span class="spinner"></span> Guardando...';

  try {
    let resp;
    if (editingId) {
      resp = await apiFetch(`${API}/products/${editingId}`, {
        method:  'PUT',
        headers: authHeaders(),
        body:    JSON.stringify(payload),
      });
    } else {
      resp = await apiFetch(`${API}/products`, {
        method:  'POST',
        headers: authHeaders(),
        body:    JSON.stringify(payload),
      });
    }

    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    closeProductModal();
    showToast(editingId ? '✅ Producto actualizado' : '✅ Producto creado');
    loadProducts(document.getElementById('searchInput').value);

  } catch (err) {
    errorEl.textContent   = `❌ ${err.message}`;
    errorEl.style.display = 'block';
  } finally {
    saveBtn.disabled    = false;
    saveBtn.textContent = editingId ? 'Guardar cambios' : 'Crear producto';
  }
}

async function deleteProduct(id, nombre) {
  if (!confirm(`¿Eliminar "${nombre}"? Esta acción es irreversible.`)) return;

  try {
    const resp = await apiFetch(`${API}/products/${id}`, {
      method:  'DELETE',
      headers: authHeaders(),
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error);

    showToast(`🗑️ "${nombre}" eliminado`);
    loadProducts(document.getElementById('searchInput').value);
  } catch (err) {
    showToast(`❌ ${err.message}`, 'error');
  }
}

// ── Search with debounce ──────────────────────────────────────
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadProducts(document.getElementById('searchInput').value.trim());
  }, 350);
}

// ── Logout ────────────────────────────────────────────────────
function logout() {
  localStorage.clear();
  window.location.replace('index.html');
}

// ── Utilities ─────────────────────────────────────────────────
function escHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatPrice(n) {
  return Number(n).toLocaleString('es-CL');
}

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initUI();
  loadProducts();
});
