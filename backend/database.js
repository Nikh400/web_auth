const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let mongoose;
let useMongoDB = false;

if (process.env.MONGODB_URI) {
    try {
        mongoose = require('mongoose');
        useMongoDB = true;
    } catch (err) {
        console.warn('[DB] mongoose module could not be loaded, falling back to JSON storage:', err.message);
        useMongoDB = false;
    }
}

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data'));
const JSON_DB_FILE = path.join(DATA_DIR, 'users_db.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ----------------- MONGODB CONFIGURATION & SCHEMAS -----------------
let User;
let isConnected = false;

async function ensureConnection() {
    if (!useMongoDB) return;
    if (isConnected) return;
    try {
        const dbConn = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        isConnected = dbConn.connections[0].readyState === 1;
        console.log('[DB] Connected successfully to MongoDB Atlas');
    } catch (err) {
        console.error('[DB] MongoDB Atlas connection error:', err);
        // Fallback to JSON if connection fails
        useMongoDB = false;
        initializeJSONDatabase();
    }
}

// ----------------- JSON DATABASE INITIALIZATION & OPERATIONS -----------------
let jsonUsers = {};

if (useMongoDB) {
    const userSchema = new mongoose.Schema({
        username: { type: String, unique: true, required: true, lowercase: true },
        name: { type: String, required: true },
        email: { type: String, unique: true, required: true, lowercase: true },
        password_hash: { type: String, required: true },
        password_salt: { type: String, required: true },
        biometric_profile: { type: mongoose.Schema.Types.Mixed, default: null },
        created_at: { type: Date, default: Date.now }
    });

    User = mongoose.models.User || mongoose.model('User', userSchema);
} else {
    initializeJSONDatabase();
}

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

// ----------------- DB INTERFACE EXPORTS -----------------
async function getUserByUsername(username) {
    if (!username) return null;
    const normalizedUser = username.toLowerCase();
    
    if (useMongoDB) {
        try {
            await ensureConnection();
            if (useMongoDB) {
                const user = await User.findOne({ username: normalizedUser }).lean();
                return user;
            }
        } catch (err) {
            console.error('[DB] Error fetching user by username from MongoDB:', err);
        }
    }

    const user = jsonUsers[normalizedUser];
    if (!user) return null;
    return JSON.parse(JSON.stringify(user));
}

async function getUserByEmail(email) {
    if (!email) return null;
    const normalizedEmail = email.toLowerCase();
    
    if (useMongoDB) {
        try {
            await ensureConnection();
            if (useMongoDB) {
                const user = await User.findOne({ email: normalizedEmail }).lean();
                return user;
            }
        } catch (err) {
            console.error('[DB] Error fetching user by email from MongoDB:', err);
        }
    }

    for (const username of Object.keys(jsonUsers)) {
        const user = jsonUsers[username];
        if (user.email.toLowerCase() === normalizedEmail) {
            return JSON.parse(JSON.stringify(user));
        }
    }
    return null;
}

async function getUserByUsernameOrEmail(identifier) {
    if (!identifier) return null;
    const cleanId = identifier.toLowerCase();
    
    if (useMongoDB) {
        try {
            await ensureConnection();
            if (useMongoDB) {
                const user = await User.findOne({
                    $or: [
                        { username: cleanId },
                        { email: cleanId }
                    ]
                }).lean();
                return user;
            }
        } catch (err) {
            console.error('[DB] Error fetching user by username/email from MongoDB:', err);
        }
    }

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

async function registerUser({ username, name, email, password, biometricProfile }) {
    const { salt, hash } = hashPassword(password);
    const normalizedUser = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();

    if (useMongoDB) {
        try {
            await ensureConnection();
            if (useMongoDB) {
                const newUser = new User({
                    username: normalizedUser,
                    name: name,
                    email: normalizedEmail,
                    password_hash: hash,
                    password_salt: salt,
                    biometric_profile: biometricProfile || null
                });
                await newUser.save();
                return await getUserByUsername(normalizedUser);
            }
        } catch (err) {
            console.error('[DB] Error registering user in MongoDB:', err);
            throw err;
        }
    }

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
