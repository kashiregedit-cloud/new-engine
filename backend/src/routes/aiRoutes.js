const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');

// Optimize System Prompt (POST /api/ai/optimize-prompt)
router.post('/optimize-prompt', aiController.optimizePrompt);

module.exports = router;
