const nodemailer = require('nodemailer');

let transporter = null;

// Initialize SMTP transporter if env parameters are set
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true' || parseInt(process.env.SMTP_PORT) === 465,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        console.log(`[EMAIL] Nodemailer SMTP transporter initialized for user: ${process.env.SMTP_USER}`);
    } catch (err) {
        console.error(`[EMAIL] Failed to initialize Nodemailer SMTP transporter:`, err);
    }
} else {
    console.log(`[EMAIL] SMTP parameters not fully configured. Operating in SIMULATED console fallback mode.`);
}

/**
 * Sends a 6-digit OTP code to the user's email address
 * @param {string} email - Destination email address
 * @param {string} purpose - Purpose description (e.g. "Registration Verification")
 * @param {string} code - The 6-digit OTP code
 */
async function sendOTP(email, purpose, code) {
    const fromAddress = process.env.SMTP_FROM || '"Kinetic Auth" <no-reply@kineticauth.local>';
    const subject = `[Kinetic Auth] Verification Code: ${code}`;
    const textBody = `Your Kinetic Auth verification code for ${purpose} is: ${code}. This code is valid for 5 minutes.`;
    
    // Clean glassmorphism styling matching the application aesthetic
    const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0d1117; padding: 40px 10px; color: #c9d1d9; text-align: center;">
        <div style="background: rgba(22, 27, 34, 0.8); border: 1px solid #30363d; border-radius: 16px; max-width: 500px; margin: 0 auto; padding: 30px; box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3);">
            <div style="display: inline-block; padding: 10px 20px; background: linear-gradient(135deg, #00f2fe 0%, #4facfe 100%); border-radius: 12px; margin-bottom: 25px; color: #0d1117; font-weight: bold; font-size: 1.1rem; letter-spacing: 1px;">
                KINETIC BIOMETRICS
            </div>
            <h2 style="color: #ffffff; font-weight: 600; margin-bottom: 10px; font-size: 1.4rem;">Verify Your Identity</h2>
            <p style="font-size: 15px; color: #8b949e; line-height: 1.5; margin-bottom: 25px;">You requested a verification code for <strong>${purpose}</strong>.</p>
            
            <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 20px; margin-bottom: 25px;">
                <span style="font-size: 38px; font-weight: 700; letter-spacing: 6px; color: #58a6ff; font-family: monospace; text-shadow: 0 0 10px rgba(88, 166, 255, 0.2);">${code}</span>
            </div>
            
            <p style="font-size: 13px; color: #8b949e; margin-bottom: 0;">This code will expire in <strong style="color: #ffffff;">5 minutes</strong>.</p>
            <div style="border-top: 1px solid #30363d; margin-top: 30px; padding-top: 20px; font-size: 11px; color: #8b949e;">
                This is an automated security notification. Please do not reply.
            </div>
        </div>
    </div>
    `;

    if (transporter) {
        try {
            const info = await transporter.sendMail({
                from: fromAddress,
                to: email,
                subject: subject,
                text: textBody,
                html: htmlBody
            });
            console.log(`[EMAIL] Actual email successfully sent to ${email}. MessageId: ${info.messageId}`);
            console.log(`[EMAIL] [DEV ONLY] Sent OTP code: ${code} to ${email}`);
            return { success: true, messageId: info.messageId };
        } catch (err) {
            console.error(`[EMAIL] Error sending actual email to ${email}, falling back to console logging:`, err);
        }
    }

    // Console logging fallback
    console.log(`
========================================================
📧 SIMULATED EMAIL TO: ${email}
🎯 PURPOSE: ${purpose}
🔑 VERIFICATION CODE: ${code}
⏰ EXPIRES: In 5 minutes
========================================================
    `);
    return { success: true, simulated: true };
}

module.exports = { sendOTP };
