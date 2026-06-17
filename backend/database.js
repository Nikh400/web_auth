const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let sqlite3;
let useSQLite = true;

try {
    sqlite3 = require('sqlite3').verbose();
} catch (err) {
    console.warn('[DB] sqlite3 module could not be loaded. Falling back to JSON-based storage for Serverless compatibility:', err.message);
    useSQLite = false;
}

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'users.db');
const JSON_DB_FILE = path.join(DATA_DIR, 'users_db.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ----------------- SQLITE DATABASE INITIALIZATION -----------------
let db;
if (useSQLite) {
    db = new sqlite3.Database(DB_FILE, (err) => {
        if (err) {
            console.error('[DB] Failed to connect to SQLite database:', err);
            console.warn('[DB] Falling back to JSON-based storage.');
            useSQLite = false;
            initializeJSONDatabase();
        } else {
            console.log(`[DB] Connected to SQLite database at: ${DB_FILE}`);
            initializeDatabase();
        }
    });
} else {
    initializeJSONDatabase();
}

// Wrap DB methods in Promises for async/await support
const dbRun = (query, params = []) => {
    return new Promise((resolve, reject) => {
        if (!useSQLite) {
            reject(new Error("SQLite is not active."));
            return;
        }
        db.run(query, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

const dbGet = (query, params = []) => {
    return new Promise((resolve, reject) => {
        if (!useSQLite) {
            reject(new Error("SQLite is not active."));
            return;
        }
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

// ----------------- JSON DATABASE INITIALIZATION & OPERATIONS -----------------
let jsonUsers = {};

function initializeJSONDatabase() {
    console.log(`[DB] Initializing JSON database at: ${JSON_DB_FILE}`);
    if (fs.existsSync(JSON_DB_FILE)) {
        try {
            const raw = fs.readFileSync(JSON_DB_FILE, 'utf8');
            jsonUsers = JSON.parse(raw);
            console.log(`[DB] Loaded ${Object.keys(jsonUsers).length} user(s) from JSON database.`);
        } catch (e) {
            console.error('[DB] Error reading JSON database, starting with empty database:', e);
            jsonUsers = {};
        }
    } else {
        jsonUsers = {};
    }
    // Also try to migrate from old user_profile.json template if users is empty
    migrateLegacyJSONToJSON();
}

function saveJSONDatabase() {
    try {
        fs.writeFileSync(JSON_DB_FILE, JSON.stringify(jsonUsers, null, 4), 'utf8');
        return true;
    } catch (e) {
        console.error('[DB] Error writing JSON database:', e);
        return false;
    }
}

function migrateLegacyJSONToJSON() {
    if (Object.keys(jsonUsers).length > 0) return;
    const jsonPath = path.join(DATA_DIR, 'user_profile.json');
    const backupPath = path.join(DATA_DIR, 'user_profile.json.bak');
    const srcPath = fs.existsSync(jsonPath) ? jsonPath : (fs.existsSync(backupPath) ? backupPath : null);
    
    if (srcPath) {
        try {
            const raw = fs.readFileSync(srcPath, 'utf8');
            const data = JSON.parse(raw);
            let migratedCount = 0;

            for (const username of Object.keys(data)) {
                const normalizedUser = username.toLowerCase();
                const profile = data[username];
                // Generate a strong random password for migrated users
                const dummyPassword = crypto.randomBytes(32).toString('hex');
                const { salt, hash } = hashPassword(dummyPassword);

                jsonUsers[normalizedUser] = {
                    username: normalizedUser,
                    name: username.charAt(0).toUpperCase() + username.slice(1),
                    email: `${normalizedUser}@migrated.local`,
                    password_hash: hash,
                    password_salt: salt,
                    biometric_profile: profile
                };
                migratedCount++;
            }
            if (migratedCount > 0) {
                saveJSONDatabase();
                console.log(`[DB] Successfully migrated ${migratedCount} user(s) from legacy JSON file to JSON DB.`);
            }
        } catch (e) {
            console.error('[DB] Error during legacy JSON to JSON migration:', e);
        }
    }
}

// ----------------- COMMON HELPER METHODS -----------------
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, hash) {
    const checkHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === checkHash;
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

// ----------------- DB INTERFACE EXPORTS -----------------
async function getUserByUsername(username) {
    if (!username) return null;
    const normalizedUser = username.toLowerCase();
    
    if (useSQLite) {
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [normalizedUser]);
        return parseUserProfile(user);
    } else {
        const user = jsonUsers[normalizedUser];
        if (!user) return null;
        return JSON.parse(JSON.stringify(user));
    }
}

async function getUserByEmail(email) {
    if (!email) return null;
    const normalizedEmail = email.toLowerCase();
    
    if (useSQLite) {
        const user = await dbGet('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
        return parseUserProfile(user);
    } else {
        for (const username of Object.keys(jsonUsers)) {
            const user = jsonUsers[username];
            if (user.email.toLowerCase() === normalizedEmail) {
                return JSON.parse(JSON.stringify(user));
            }
        }
        return null;
    }
}

async function getUserByUsernameOrEmail(identifier) {
    if (!identifier) return null;
    const cleanId = identifier.toLowerCase();
    
    if (useSQLite) {
        const user = await dbGet('SELECT * FROM users WHERE username = ? OR email = ?', [cleanId, cleanId]);
        return parseUserProfile(user);
    } else {
        const byUsername = jsonUsers[cleanId];
        if (byUsername) {
            return JSON.parse(JSON.stringify(byUsername));
        }
        for (const username of Object.keys(jsonUsers)) {
            const user = jsonUsers[username];
            if (user.email.toLowerCase() === cleanId) {
                return JSON.parse(JSON.stringify(user));
            }
        }
        return null;
    }
}

async function registerUser({ username, name, email, password, biometricProfile }) {
    const { salt, hash } = hashPassword(password);
    const normalizedUser = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();

    if (useSQLite) {
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
    } else {
        jsonUsers[normalizedUser] = {
            username: normalizedUser,
            name: name,
            email: normalizedEmail,
            password_hash: hash,
            password_salt: salt,
            biometric_profile: biometricProfile || null
        };
        saveJSONDatabase();
        return JSON.parse(JSON.stringify(jsonUsers[normalizedUser]));
    }
}

async function authenticatePassword(usernameOrEmail, password) {
    if (!usernameOrEmail || !password) return null;
    const user = await getUserByUsernameOrEmail(usernameOrEmail);
    if (!user) return null;

    const isValid = verifyPassword(password, user.password_salt, user.password_hash);
    if (!isValid) return null;

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
