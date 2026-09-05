'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');

// ============================================================
// Database connection pool
// mysql2/promise — async/await native support
// ============================================================

const pool = mysql.createPool({
  host:              process.env.DB_HOST            || '127.0.0.1',
  port:              Number(process.env.DB_PORT)    || 3306,
  user:              process.env.DB_USER,
  password:          process.env.DB_PASSWORD,
  database:          process.env.DB_NAME,
  connectionLimit:   Number(process.env.DB_CONNECTION_LIMIT) || 10,
  waitForConnections: true,
  queueLimit:        0,
  charset:           'utf8mb4',
  timezone:          '+00:00',
  // Keep-alive: re-use idle connections gracefully
  enableKeepAlive:   true,
  keepAliveInitialDelay: 10000,
  ssl: {
    rejectUnauthorized: false
  }
});

/**
 * Execute a parameterized SQL query using the connection pool.
 *
 * @param {string}  sql    - Parameterized SQL string (using ? placeholders)
 * @param {Array}   params - Array of values to bind
 * @returns {Promise<Array>} Resolves with [rows, fields]
 *
 * @example
 * const [rows] = await query('SELECT * FROM tiendas WHERE id = ?', [id]);
 */
async function query(sql, params = []) {
  const [rows, fields] = await pool.execute(sql, params);
  return [rows, fields];
}

/**
 * Get a dedicated connection from the pool for multi-statement transactions.
 * Remember to call connection.release() when done.
 *
 * @returns {Promise<mysql.PoolConnection>}
 *
 * @example
 * const conn = await getConnection();
 * try {
 *   await conn.beginTransaction();
 *   // ... queries ...
 *   await conn.commit();
 * } catch (err) {
 *   await conn.rollback();
 *   throw err;
 * } finally {
 *   conn.release();
 * }
 */
async function getConnection() {
  return pool.getConnection();
}

/**
 * Ping the database to verify connectivity.
 * Called on server startup.
 */
async function testConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  console.log('✅  Database connection pool ready');
}

module.exports = { pool, query, getConnection, testConnection };
