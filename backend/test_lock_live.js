
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const dbService = require('./src/services/dbService');

async function testLock() {
    const sessionName = 'bot_ep21eo';
    const phoneNumber = '124532744531973@lid'; // User ID provided

    console.log(`Testing Lock for Session: ${sessionName}, User: ${phoneNumber}`);

    // 1. Test Toggle Lock (LOCK)
    console.log('\n--- 1. Testing Toggle Lock (LOCK) ---');
    const locked = await dbService.toggleWhatsAppLock(sessionName, phoneNumber, true);
    console.log(`Lock Result: ${locked}`);

    // Verify
    const contactLocked = await dbService.getWhatsAppContact(sessionName, phoneNumber);
    console.log('Contact State:', contactLocked);
    if (contactLocked && contactLocked.is_locked === true) {
        console.log('SUCCESS: Contact is locked in DB.');
    } else {
        console.log('FAILURE: Contact is NOT locked in DB.');
    }

    // 2. Test Check Lock Status
    console.log('\n--- 2. Testing Check Lock Status ---');
    // We can't easily test checkWhatsAppLockStatus (Failure Lock) without fake history
    // But we can test getWhatsAppContact which queueMessage uses.
    if (contactLocked && contactLocked.is_locked) {
         console.log('Handover Check: Locked (Correct)');
    }

    // 3. Test Toggle Lock (UNLOCK)
    console.log('\n--- 3. Testing Toggle Lock (UNLOCK) ---');
    const unlocked = await dbService.toggleWhatsAppLock(sessionName, phoneNumber, false);
    console.log(`Unlock Result: ${unlocked}`);

    // Verify
    const contactUnlocked = await dbService.getWhatsAppContact(sessionName, phoneNumber);
    console.log('Contact State:', contactUnlocked);
    if (contactUnlocked && contactUnlocked.is_locked === false) {
        console.log('SUCCESS: Contact is unlocked in DB.');
    } else {
        console.log('FAILURE: Contact is NOT unlocked in DB.');
    }
    // 4. Test Emoji Config
    console.log('\n--- 4. Testing Emoji Config ---');
    const config = await dbService.getWhatsAppConfig(sessionName);
    console.log('Config:', config);
    if (config && config.lock_emojis && config.lock_emojis.length > 0) {
        console.log(`Lock Emojis: ${config.lock_emojis}`);
    } else {
        console.log('WARNING: No Lock Emojis configured!');
    }
}

testLock().catch(console.error);
