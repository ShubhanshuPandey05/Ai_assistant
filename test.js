const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
require('dotenv').config();

const config = {
    imap: {
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASS,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 3000
    }
};

(async () => {
    const connection = await imaps.connect(config);
    await connection.openBox('INBOX');

    console.log('📨 Listening for new incoming emails...');

    // Watch for new mails
    connection.imap.on('mail', async () => {
        const searchCriteria = ['UNSEEN'];
        const fetchOptions = {
            bodies: [''],
            markSeen: true
        };

        const newMessages = await connection.search(searchCriteria, fetchOptions);

        for (const msg of newMessages) {
            const all = msg.parts.find(part => part.which === '');
            const parsed = await simpleParser(all.body);

            const from = parsed.from.text;
            const subject = parsed.subject;
            const body = parsed.text;

            console.log(`📥 New Email from ${from}: ${subject}`);

            // Process with AI
            const aiResponse = await processWithAI(body);

            // Send reply
            await sendEmail(from, `Re: ${subject}`, aiResponse);
        }
    });
})();


const nodemailer = require('nodemailer');

async function sendEmail(to, subject, text) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to,
        subject,
        text
    });
}