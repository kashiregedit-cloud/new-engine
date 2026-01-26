const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Facebook Webhook Verification (GET)
router.get('/', webhookController.verifyWebhook);

// Facebook Webhook Event Listener (POST)
router.post('/', webhookController.handleWebhook);

module.exports = router;
