const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// WAHA Webhook Listener (POST)
// Endpoint: /whatsapp/webhook
router.post('/webhook', whatsappController.handleWebhook);

// Get Sessions
router.get('/sessions', async (req, res) => {
    const whatsappService = require('../services/whatsappService');
    const sessions = await whatsappService.getSessions(true);
    res.json(sessions);
});

module.exports = router;
