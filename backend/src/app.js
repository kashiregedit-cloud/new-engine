const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const webhookRoutes = require('./routes/webhookRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const aiRoutes = require('./routes/aiRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
// We mount the webhook route at /webhook or /api/webhook based on preference
// The user's n8n.json used /webhook
app.use('/webhook', webhookRoutes);
app.use('/whatsapp', whatsappRoutes);
app.use('/api/ai', aiRoutes);

// Serve Frontend Static Files
const frontendPath = path.join(__dirname, '../../dist');
if (fs.existsSync(frontendPath)) {
    console.log('Serving frontend from:', frontendPath);
    app.use(express.static(frontendPath));

    // Catch-all handler for React Router
    app.get('*', (req, res) => {
        // Skip API routes that might have been missed
        if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path.startsWith('/whatsapp')) {
             return res.status(404).json({ error: 'Not Found' });
        }
        res.sendFile(path.join(frontendPath, 'index.html'));
    });
} else {
    // Basic health check fallback if frontend is not built
    app.get('/', (req, res) => {
        res.send('AI Agent Backend Running (Frontend build not found in ../../dist)');
    });
}

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Unhandled Application Error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

module.exports = app;
