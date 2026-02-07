import { BACKEND_URL } from '../config';

export const logFrontendError = async (errorDetails: {
    message: string;
    stack?: string;
    context: string;
    pageName?: string;
    pageId?: string;
}) => {
    try {
        // Use BACKEND_URL from config, ensure no double slash if BACKEND_URL ends with /
        const baseUrl = BACKEND_URL.replace(/\/$/, '');
        const response = await fetch(`${baseUrl}/api/log/error`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(errorDetails),
        });
        if (!response.ok) {
            console.warn('Failed to send error log to backend:', response.statusText);
        }
    } catch (e) {
        console.warn('Failed to send error log to backend:', e);
    }
};
