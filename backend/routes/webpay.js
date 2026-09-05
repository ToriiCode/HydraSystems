'use strict';

const express = require('express');
const router  = express.Router();
const { create, commit } = require('../controllers/webpayController');

// POST /api/webpay/create  — Initiate Webpay Plus transaction (public)
router.post('/create', create);

// GET  /api/webpay/commit  — Receive Transbank callback (public)
router.get('/commit', commit);

module.exports = router;
