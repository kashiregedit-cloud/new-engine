const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// WAHA Webhook Listener (POST)
// Endpoint: /whatsapp/webhook
router.post('/webhook', whatsappController.handleWebhook);

module.exports = router;
