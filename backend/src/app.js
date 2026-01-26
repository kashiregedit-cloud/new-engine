const express = require('express');
const cors = require('cors');
const webhookRoutes = require('./routes/webhookRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
// We mount the webhook route at /webhook or /api/webhook based on preference
// The user's n8n.json used /webhook
app.use('/webhook', webhookRoutes);

// Basic health check
app.get('/', (req, res) => {
    res.send('AI Agent Backend Running');
});

module.exports = app;
