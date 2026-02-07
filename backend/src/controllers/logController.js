const fs = require('fs');
const path = require('path');

function logToFile(message) {
    const logPath = path.join(__dirname, '../../debug.log');
    const timestamp = new Date().toISOString();
    try {
        fs.appendFileSync(logPath, `[${timestamp}] [Frontend Error] ${message}\n`);
    } catch (e) {
        console.error('Log Error:', e);
    }
}

exports.logFrontendError = async (req, res) => {
    try {
        const { message, stack, context, pageName, pageId } = req.body;
        
        let logMsg = `Error in ${context || 'Frontend'}`;
        if (pageName) logMsg += ` (Page: ${pageName})`;
        if (pageId) logMsg += ` (ID: ${pageId})`;
        logMsg += `: ${message}`;
        
        if (stack) {
            logMsg += `\nStack: ${stack}`;
        }

        // 1. Log to console (so it appears in backend terminal/service logs)
        console.error(`[Frontend-Reported] ${logMsg}`);

        // 2. Log to file
        logToFile(logMsg);

        res.status(200).json({ status: 'logged' });
    } catch (error) {
        console.error('Failed to process frontend log:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
