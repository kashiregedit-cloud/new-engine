require('dotenv').config();
const keyService = require('./src/services/keyService');
const axios = require('axios');

async function test() {
    console.log("Getting Key with model...");
    // Exact same call as in aiService.js
    const model = 'gemini-flash-latest';
    const keyObj = await keyService.getSmartKey('google', model);
    
    if (!keyObj) {
        console.log("No key found via getSmartKey");
        return;
    }

    const apiKey = keyObj.key;
    console.log(`Key found: ${apiKey.substring(0, 10)}...`);
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    console.log(`Testing URL: ${url.replace(apiKey, 'HIDDEN')}`);
    
    try {
        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: "Hello" }]
            }]
        });
        console.log("Success!");
        console.log(response.data.candidates[0].content.parts[0].text);
    } catch (error) {
        console.error("Error Status:", error.response?.status);
        console.error("Error Data:", JSON.stringify(error.response?.data, null, 2));
    }
}

test();
