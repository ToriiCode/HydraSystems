'use strict';

const express = require('express');
const router  = express.Router();
const { listPublic } = require('../controllers/storeController');

// GET /api/stores/public — Public store directory
router.get('/public', listPublic);

module.exports = router;
