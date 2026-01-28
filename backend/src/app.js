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

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Application Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

module.exports = app;
