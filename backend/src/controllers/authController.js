const axios = require('axios');

exports.exchangeToken = async (req, res) => {
    try {
        const { shortLivedToken } = req.body;

        if (!shortLivedToken) {
            return res.status(400).json({ error: 'Short-lived token is required' });
        }

        const appId = process.env.FACEBOOK_APP_ID;
        const appSecret = process.env.FACEBOOK_APP_SECRET;

        if (!appId || !appSecret) {
            console.error('Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in .env');
            return res.status(500).json({ error: 'Server misconfiguration: Missing App ID/Secret' });
        }

        const url = `https://graph.facebook.com/v19.0/oauth/access_token`;
        const params = {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: shortLivedToken
        };

        console.log('Exchanging token with Facebook...');
        const response = await axios.get(url, { params });

        if (response.data && response.data.access_token) {
            console.log('Token exchanged successfully.');
            return res.json({ 
                access_token: response.data.access_token,
                expires_in: response.data.expires_in 
            });
        } else {
            console.error('Facebook returned unexpected data:', response.data);
            return res.status(502).json({ error: 'Failed to exchange token', details: response.data });
        }

    } catch (error) {
        console.error('Token exchange error:', error.response ? error.response.data : error.message);
        return res.status(502).json({ 
            error: 'Facebook API Error', 
            details: error.response ? error.response.data : error.message 
        });
    }
};
