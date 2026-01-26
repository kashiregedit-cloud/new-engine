const axios = require('axios');

async function testWebhook() {
    const url = 'http://localhost:3001/webhook'; // Ensure your backend is running on this port
    
    // Simulate a user message
    const payload = {
        object: 'page',
        entry: [
            {
                id: '102149466332999', // Replace with your Page ID
                time: Date.now(),
                messaging: [
                    {
                        sender: { id: '716076464402660' }, // Replace with a Tester Sender ID
                        recipient: { id: '102149466332999' },
                        timestamp: Date.now(),
                        message: {
                            mid: `mid.${Date.now()}`,
                            text: 'Hello AI, how are you?'
                        }
                    }
                ]
            }
        ]
    };

    try {
        console.log('Sending Test Webhook...');
        const response = await axios.post(url, payload);
        console.log('Response Status:', response.status);
        console.log('Response Data:', response.data);
    } catch (error) {
        console.error('Error sending webhook:', error.message);
        if (error.response) {
            console.error('Response Data:', error.response.data);
        }
    }
}

testWebhook();