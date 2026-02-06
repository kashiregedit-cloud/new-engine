
const normalizeText = (text) => {
    return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
};

const savedText = "Hello World! [ADD_LABEL: admincall]";
const webhookText = "Hello World!";

const dbBody = normalizeText(savedText);
const targetBody = normalizeText(webhookText);

console.log(`Saved Text: "${savedText}" -> Normalized: "${dbBody}"`);
console.log(`Webhook Text: "${webhookText}" -> Normalized: "${targetBody}"`);

if (dbBody === targetBody) {
    console.log("MATCH! Echo Guard works.");
} else {
    console.log("MISMATCH! Echo Guard fails.");
}

const savedTextImage = "Here is the image IMAGE: Product | http://url.com";
const webhookTextImage = "Here is the image";

const dbBodyImage = normalizeText(savedTextImage);
const targetBodyImage = normalizeText(webhookTextImage);

console.log(`\nSaved Text: "${savedTextImage}" -> Normalized: "${dbBodyImage}"`);
console.log(`Webhook Text: "${webhookTextImage}" -> Normalized: "${targetBodyImage}"`);

if (dbBodyImage === targetBodyImage) {
    console.log("MATCH! Echo Guard works.");
} else {
    console.log("MISMATCH! Echo Guard fails.");
}
