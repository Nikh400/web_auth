const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'users.db');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error('[DB] Failed to connect to SQLite database:', err);
    } else {
        console.log(`[DB] Connected to SQLite database at: ${DB_FILE}`);
        initializeDatabase();
    }
});

// Wrap DB methods in Promises for async/await support
const dbRun = (query, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

const dbGet = (query, params = []) => {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

async function initializeDatabase() {
    try {
        await dbRun(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                biometric_profile TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('[DB] SQLite users table ready.');
        await migrateExistingJSONData();
    } catch (err) {
        console.error('[DB] Error initializing database schema:', err);
    }
}

async function migrateExistingJSONData() {
    const jsonPath = path.join(DATA_DIR, 'user_profile.json');
    if (fs.existsSync(jsonPath)) {
        try {
            const raw = fs.readFileSync(jsonPath, 'utf8');
            const data = JSON.parse(raw);
            let migratedCount = 0;

            for (const username of Object.keys(data)) {
                const normalizedUser = username.toLowerCase();
                const existing = await getUserByUsername(normalizedUser);
                if (!existing) {
                    const profile = data[username];
                    // Generate a strong random password for migrated users
                    const dummyPassword = crypto.randomBytes(32).toString('hex');
                    const { salt, hash } = hashPassword(dummyPassword);

                    await dbRun(`
                        INSERT INTO users (username, name, email, password_hash, password_salt, biometric_profile)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `, [
                        normalizedUser,
                        username.charAt(0).toUpperCase() + username.slice(1),
                        `${normalizedUser}@migrated.local`,
                        hash,
                        salt,
                        JSON.stringify(profile)
                    ]);
                    migratedCount++;
                }
            }
            if (migratedCount > 0) {
                console.log(`[DB] Successfully migrated ${migratedCount} user(s) from legacy JSON file.`);
            }
        } catch (e) {
            console.error('[DB] Error during legacy JSON migration:', e);
        }
    }
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, hash) {
    const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === checkHash;
}

async function getUserByUsername(username) {
    if (!username) return null;
    const user = await dbGet('SELECT * FROM users WHERE username = ?', [username.toLowerCase()]);
    return parseUserProfile(user);
}

async function getUserByEmail(email) {
    if (!email) return null;
    const user = await dbGet('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    return parseUserProfile(user);
}

async function getUserByUsernameOrEmail(identifier) {
    if (!identifier) return null;
    const cleanId = identifier.toLowerCase();
    const user = await dbGet('SELECT * FROM users WHERE username = ? OR email = ?', [cleanId, cleanId]);
    return parseUserProfile(user);
}

function parseUserProfile(user) {
    if (!user) return null;
    if (user.biometric_profile) {
        try {
            user.biometric_profile = JSON.parse(user.biometric_profile);
        } catch (e) {
            console.error('[DB] Error parsing biometric profile JSON:', e);
        }
    }
    return user;
}

async function registerUser({ username, name, email, password, biometricProfile }) {
    const { salt, hash } = hashPassword(password);
    const normalizedUser = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();

    await dbRun(`
        INSERT INTO users (username, name, email, password_hash, password_salt, biometric_profile)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [
        normalizedUser,
        name,
        normalizedEmail,
        hash,
        salt,
        biometricProfile ? JSON.stringify(biometricProfile) : null
    ]);

    return await getUserByUsername(normalizedUser);
}

async function authenticatePassword(usernameOrEmail, password) {
    if (!usernameOrEmail || !password) return null;
    const user = await getUserByUsernameOrEmail(usernameOrEmail);
    if (!user) return null;

    const isValid = verifyPassword(password, user.password_salt, user.password_hash);
    if (!isValid) return null;

    // Return safe user object (exclude sensitive hash/salt fields)
    const { password_hash, password_salt, ...safeUser } = user;
    return safeUser;
}

module.exports = {
    getUserByUsername,
    getUserByEmail,
    getUserByUsernameOrEmail,
    registerUser,
    authenticatePassword
};
