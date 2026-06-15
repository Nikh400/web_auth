const express = require('express');
const path = require('path');
const fs = require('fs');
const { extractFeatures, createProfile, verifyAttempt, TARGET_PHRASE } = require('./keystrokeModel');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Path to data file
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PROFILE_FILE = path.join(DATA_DIR, 'user_profile.json');

// Auto-seed profile if the PROFILE_FILE does not exist in DATA_DIR, 
// but we have a default profile template in the codebase.
function seedProfileIfMissing() {
    const defaultProfilePath = path.join(__dirname, '..', 'data', 'user_profile.json');
    if (!fs.existsSync(PROFILE_FILE)) {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        if (fs.existsSync(defaultProfilePath) && path.resolve(defaultProfilePath) !== path.resolve(PROFILE_FILE)) {
            try {
                fs.copyFileSync(defaultProfilePath, PROFILE_FILE);
                console.log(`[SERVER] Seeded default user profile DB to: ${PROFILE_FILE}`);
            } catch (err) {
                console.error("[SERVER] Failed to seed default user profile DB:", err);
            }
        }
    }
}
seedProfileIfMissing();

// Helper functions for reading/writing profile JSON db
function loadProfileDB() {
    if (!fs.existsSync(PROFILE_FILE)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(PROFILE_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error("Error reading profile DB:", e);
        return {};
    }
}

function saveProfileDB(db) {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    try {
        fs.writeFileSync(PROFILE_FILE, JSON.stringify(db, null, 4), 'utf8');
        return true;
    } catch (e) {
        console.error("Error writing profile DB:", e);
        return false;
    }
}

// REST API routes

// GET target phrase config
app.get('/api/config', (req, res) => {
    res.json({ targetPhrase: TARGET_PHRASE });
});

// POST register user profile
app.post('/api/register', (req, res) => {
    const { username, attempts } = req.body;

    if (!username || !attempts || !Array.isArray(attempts) || attempts.length < 5) {
        return res.status(400).json({ error: "Username and at least 5 typing trials are required." });
    }

    try {
        const attemptsFeatures = [];

        // Extract features from each trial
        for (let i = 0; i < attempts.length; i++) {
            const features = extractFeatures(attempts[i]);
            if (!features) {
                return res.status(400).json({ 
                    error: `Trial #${i + 1} typing was invalid. Ensure it exactly matches the phrase: "${TARGET_PHRASE}" without typos.` 
                });
            }
            attemptsFeatures.push(features);
        }

        // Create profile
        const profile = createProfile(attemptsFeatures);

        // Load DB and save
        const db = loadProfileDB();
        db[username.toLowerCase()] = profile;
        saveProfileDB(db);

        console.log(`[SERVER] Registered keystroke profile for user: ${username}`);
        res.json({ success: true, message: `Keystroke profile registered successfully for "${username}".` });
    } catch (err) {
        console.error("Registration error:", err);
        res.status(500).json({ error: "Failed to generate user profile: " + err.message });
    }
});

// POST authenticate user
app.post('/api/authenticate', (req, res) => {
    const { username, keystrokes } = req.body;

    if (!username || !keystrokes || !Array.isArray(keystrokes)) {
        return res.status(400).json({ error: "Username and keystroke recording are required." });
    }

    const db = loadProfileDB();
    const profile = db[username.toLowerCase()];

    if (!profile) {
        return res.status(404).json({ error: `No registered profile found for user "${username}".` });
    }

    const attemptFeatures = extractFeatures(keystrokes);
    if (!attemptFeatures) {
        return res.status(400).json({ 
            error: `Typing did not match the target phrase: "${TARGET_PHRASE}" exactly.` 
        });
    }

    const verification = verifyAttempt(profile, attemptFeatures);
    
    console.log(`[SERVER] Auth attempt for: ${username}. Result: ${verification.authenticated} (Score: ${verification.score}%, Z: ${verification.avgZ})`);
    
    res.json({
        success: verification.authenticated,
        score: verification.score,
        avgZ: verification.avgZ
    });
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Fallback to index.html for single-page app behavior
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(`🚀 Keystroke Biometrics server running at http://localhost:${PORT}`);
    console.log(`========================================================`);
});
