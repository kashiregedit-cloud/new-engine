const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');

router.post('/error', logController.logFrontendError);

module.exports = router;
