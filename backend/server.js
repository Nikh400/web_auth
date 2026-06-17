// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { extractFeatures, createProfile, verifyAttempt, TARGET_PHRASE, PHRASE_POOL } = require('./keystrokeModel');
const { sendOTP } = require('./emailService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// SQLite Database Manager
const dbManager = require('./database');

// In-Memory OTP Cache
const otpCache = new Map(); // key -> { code, expiresAt, verified }
const biometricAttempts = new Map(); // key -> failed attempts count

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit code
}

// REST API routes

// GET config details
app.get('/api/config', (req, res) => {
    const defaultRedirect = process.env.REDIRECT_URL || "";
    res.json({ 
        targetPhrase: TARGET_PHRASE,
        defaultRedirect: defaultRedirect
    });
});

// GET pool of dynamic phrases
app.get('/api/phrases', (req, res) => {
    const count = parseInt(req.query.count) || 3;
    const shuffled = [...PHRASE_POOL].sort(() => 0.5 - Math.random());
    res.json({ phrases: shuffled.slice(0, count) });
});

// POST check user availability (username & email)
app.post('/api/check-user', async (req, res) => {
    const { username, email } = req.body;
    if (!username || !email) {
        return res.status(400).json({ error: "Username and email are required." });
    }
    try {
        const userByName = await dbManager.getUserByUsername(username);
        if (userByName) {
            return res.status(400).json({ error: "Username is already taken." });
        }
        const userByEmail = await dbManager.getUserByEmail(email);
        if (userByEmail) {
            return res.status(400).json({ error: "Email is already registered." });
        }
        res.json({ available: true });
    } catch (err) {
        console.error("[SERVER] Error checking user availability:", err);
        res.status(500).json({ error: "Server database error." });
    }
});

// POST send registration OTP email
app.post('/api/send-registration-otp', async (req, res) => {
    const { username, email } = req.body;
    if (!username || !email) {
        return res.status(400).json({ error: "Username and email are required." });
    }

    try {
        // Double check availability
        const userByName = await dbManager.getUserByUsername(username);
        if (userByName) {
            return res.status(400).json({ error: "Username is already taken." });
        }
        const userByEmail = await dbManager.getUserByEmail(email);
        if (userByEmail) {
            return res.status(400).json({ error: "Email is already registered." });
        }

        const code = generateOTP();
        otpCache.set(email.toLowerCase(), {
            code,
            expiresAt: Date.now() + 5 * 60 * 1000, // 5 min expiry
            verified: false
        });

        await sendOTP(email, "Registration Verification", code);
        res.json({ success: true, message: "Verification code sent to your email." });
    } catch (err) {
        console.error("[SERVER] Send registration OTP error:", err);
        res.status(500).json({ error: "Failed to send verification code." });
    }
});

// POST verify registration OTP code
app.post('/api/verify-registration-otp', (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) {
        return res.status(400).json({ error: "Email and verification code are required." });
    }

    const emailClean = email.toLowerCase();
    const record = otpCache.get(emailClean);

    if (!record) {
        return res.status(400).json({ error: "No verification code requested for this email." });
    }

    if (record.expiresAt < Date.now()) {
        otpCache.delete(emailClean);
        return res.status(400).json({ error: "Verification code has expired." });
    }

    if (record.code !== code.trim()) {
        return res.status(400).json({ error: "Invalid verification code." });
    }

    record.verified = true;
    res.json({ success: true, message: "Email successfully verified!" });
});

// POST register user profile
app.post('/api/register', async (req, res) => {
    const { username, name, email, password, attempts } = req.body;

    if (!username || !name || !email || !password || !attempts || !Array.isArray(attempts) || attempts.length < 3) {
        return res.status(400).json({ error: "All fields and at least 3 typing trials are required." });
    }

    const emailClean = email.toLowerCase();

    // Enforce OTP verification before registration
    const record = otpCache.get(emailClean);
    if (!record || !record.verified) {
        return res.status(400).json({ error: "Email verification is required before finalizing registration." });
    }

    try {
        // Double check uniqueness in database
        const userByName = await dbManager.getUserByUsername(username);
        if (userByName) {
            return res.status(400).json({ error: "Username is already taken." });
        }
        const userByEmail = await dbManager.getUserByEmail(email);
        if (userByEmail) {
            return res.status(400).json({ error: "Email is already registered." });
        }

        // Validate each attempt's typing matches its expected phrase
        for (let i = 0; i < attempts.length; i++) {
            const { phrase, keystrokes } = attempts[i];
            if (!phrase || !keystrokes || !Array.isArray(keystrokes)) {
                return res.status(400).json({ error: `Trial #${i + 1} is missing expected phrase or keystrokes.` });
            }
            const typedPhrase = keystrokes.map(k => k.key.toLowerCase()).join("");
            if (typedPhrase !== phrase.toLowerCase()) {
                return res.status(400).json({ 
                    error: `Trial #${i + 1} typing was invalid. Expected: "${phrase}", but got: "${typedPhrase}"` 
                });
            }
        }

        // Create profile
        const profile = createProfile(attempts);

        // Register user in database
        const newUser = await dbManager.registerUser({
            username,
            name,
            email,
            password,
            biometricProfile: profile
        });

        console.log(`[SERVER] Registered user: ${username}`);
        
        // Clean up OTP cache
        otpCache.delete(emailClean);

        // Return safe user object (omit sensitive fields)
        const { password_hash, password_salt, ...safeUser } = newUser;
        res.json({ success: true, user: safeUser });
    } catch (err) {
        console.error("[SERVER] Registration error:", err);
        res.status(500).json({ error: "Registration failed: " + err.message });
    }
});

// POST authenticate user via biometrics
app.post('/api/authenticate', async (req, res) => {
    const { username, keystrokes, phrase } = req.body;

    if (!username || !keystrokes || !Array.isArray(keystrokes)) {
        return res.status(400).json({ error: "Username and keystroke recording are required." });
    }

    try {
        const user = await dbManager.getUserByUsernameOrEmail(username);

        if (!user) {
            return res.status(404).json({ error: `No registered profile found for user "${username}".` });
        }

        if (!user.biometric_profile) {
            return res.status(400).json({ error: `User "${username}" does not have a biometric profile registered.` });
        }

        // Validate typed phrase matches expected phrase
        const expectedPhrase = phrase || TARGET_PHRASE;
        const typedPhrase = keystrokes.map(k => k.key.toLowerCase()).join("");
        if (typedPhrase !== expectedPhrase.toLowerCase()) {
            return res.status(400).json({ 
                error: `Typing did not match the target phrase: "${expectedPhrase}" exactly.` 
            });
        }

        const verification = verifyAttempt(user.biometric_profile, keystrokes);
        
        const { password_hash, password_salt, ...safeUser } = user;

        const usernameClean = user.username.toLowerCase();

        if (verification.authenticated) {
            console.log(`[SERVER] Biometric auth successful for: ${user.username} (Score: ${verification.score}%)`);
            biometricAttempts.delete(usernameClean);
            const token = crypto.createHmac('sha256', 'kinetic-secret-key')
                          .update(JSON.stringify({ username: user.username, timestamp: Date.now() }))
                          .digest('hex');

            res.json({
                success: true,
                score: verification.score,
                avgZ: verification.avgZ,
                token: token,
                user: safeUser
            });
        } else {
            let failedAttempts = (biometricAttempts.get(usernameClean) || 0) + 1;
            console.log(`[SERVER] Biometric auth failed for: ${user.username} (Score: ${verification.score}%). Attempt ${failedAttempts}/3`);

            if (failedAttempts >= 3) {
                biometricAttempts.delete(usernameClean);
                console.log(`[SERVER] Max biometric attempts reached for: ${user.username}. Triggering 2FA OTP.`);
                
                // Auto generate 2FA OTP for fallback authentication
                const code = generateOTP();
                otpCache.set(usernameClean, {
                    code,
                    expiresAt: Date.now() + 5 * 60 * 1000,
                    verified: false
                });

                await sendOTP(user.email, "Biometric Verification Failure 2FA Fallback", code);

                res.json({
                    success: false,
                    score: verification.score,
                    avgZ: verification.avgZ,
                    attempts: failedAttempts,
                    fallbackRequired: true,
                    message: "Biometric rhythm mismatched. Verification code sent to your registered email."
                });
            } else {
                biometricAttempts.set(usernameClean, failedAttempts);
                res.json({
                    success: false,
                    score: verification.score,
                    avgZ: verification.avgZ,
                    attempts: failedAttempts,
                    fallbackRequired: false,
                    message: `Biometric rhythm mismatched. Attempt ${failedAttempts}/3 failed. Please try again.`
                });
            }
        }
    } catch (err) {
        console.error("Authentication error:", err);
        res.status(500).json({ error: "Authentication failed: " + err.message });
    }
});

// POST authenticate user via backup password
app.post('/api/authenticate-password', async (req, res) => {
    const { usernameOrEmail, password } = req.body;

    if (!usernameOrEmail || !password) {
        return res.status(400).json({ error: "Username/email and backup password are required." });
    }

    try {
        const user = await dbManager.authenticatePassword(usernameOrEmail, password);
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials or backup password." });
        }

        // Generate dynamic token
        const token = crypto.createHmac('sha256', 'kinetic-secret-key')
                            .update(JSON.stringify({ username: user.username, timestamp: Date.now() }))
                            .digest('hex');

        console.log(`[SERVER] Password authentication successful for user: ${user.username}`);
        res.json({
            success: true,
            token: token,
            user: user
        });
    } catch (err) {
        console.error("Password authentication error:", err);
        res.status(500).json({ error: "Password verification failed." });
    }
});

// POST authenticate user via backup password + OTP fallback (2FA)
app.post('/api/authenticate-fallback', async (req, res) => {
    const { username, password, otp } = req.body;

    if (!username || !password || !otp) {
        return res.status(400).json({ error: "Username, backup password, and 2FA verification code are required." });
    }

    try {
        const user = await dbManager.getUserByUsernameOrEmail(username);
        if (!user) {
            return res.status(404).json({ error: "User account not found." });
        }

        // 1. Verify backup password
        const passwordCheck = await dbManager.authenticatePassword(user.username, password);
        if (!passwordCheck) {
            return res.status(401).json({ error: "Invalid backup password." });
        }

        // 2. Verify OTP
        const usernameClean = user.username.toLowerCase();
        const record = otpCache.get(usernameClean);

        if (!record) {
            return res.status(400).json({ error: "No 2FA verification code requested for this user." });
        }

        if (record.expiresAt < Date.now()) {
            otpCache.delete(usernameClean);
            return res.status(400).json({ error: "Verification code has expired." });
        }

        if (record.code !== otp.trim()) {
            return res.status(400).json({ error: "Invalid verification code." });
        }

        // Successfully verified both! Clean cache
        otpCache.delete(usernameClean);

        // Generate token
        const token = crypto.createHmac('sha256', 'kinetic-secret-key')
                            .update(JSON.stringify({ username: user.username, timestamp: Date.now() }))
                            .digest('hex');

        console.log(`[SERVER] Fallback 2FA password+OTP successful for user: ${user.username}`);
        const { password_hash, password_salt, ...safeUser } = user;
        res.json({
            success: true,
            token: token,
            user: safeUser
        });
    } catch (err) {
        console.error("Fallback 2FA authentication error:", err);
        res.status(500).json({ error: "Two-factor verification failed." });
    }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Fallback to index.html for single-page app behavior
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Start Server (only if not running on Vercel serverless environment)
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`========================================================`);
        console.log(`🚀 Keystroke Biometrics server running at http://localhost:${PORT}`);
        console.log(`========================================================`);
    });
}

// Export the Express app for Vercel Serverless
module.exports = app;
