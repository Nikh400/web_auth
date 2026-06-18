const TARGET_PHRASE = "secure typing";

// Pool of versatile phrases for registration and authentication
const PHRASE_POOL = [
    "secure dynamic authentication pattern",
    "biometric keystroke rhythm detection",
    "identity protection defense system",
    "behavioral analysis verification protocol",
    "advanced pattern typing defense",
    "network security baseline monitor",
    "machine learning profile classification",
    "reliable credential match confirmation",
    "encrypted keystroke telemetry record",
    "continuous user verification flow"
];


/**
 * Extracts hold and flight times from the raw keystrokes (legacy version).
 */
function extractFeatures(keystrokes) {
    const typedPhrase = keystrokes.map(k => k.key.toLowerCase()).join("");
    if (typedPhrase !== TARGET_PHRASE) {
        return null;
    }

    const features = [];
    // Hold Times
    for (let i = 0; i < keystrokes.length; i++) {
        features.push(keystrokes[i].releaseTime - keystrokes[i].pressTime);
    }
    // Flight Times
    for (let i = 0; i < keystrokes.length - 1; i++) {
        features.push(keystrokes[i+1].pressTime - keystrokes[i].releaseTime);
    }
    return features;
}

function extractLegacyFeatures(keystrokes, targetPhrase) {
    const typedPhrase = keystrokes.map(k => k.key.toLowerCase()).join("");
    if (typedPhrase !== targetPhrase.toLowerCase()) {
        return null;
    }

    const features = [];
    // Hold Times
    for (let i = 0; i < keystrokes.length; i++) {
        features.push(keystrokes[i].releaseTime - keystrokes[i].pressTime);
    }
    // Flight Times
    for (let i = 0; i < keystrokes.length - 1; i++) {
        features.push(keystrokes[i+1].pressTime - keystrokes[i].releaseTime);
    }
    return features;
}

/**
 * Computes monograph (holds) and digraph (flights) stats for user profile.
 * @param {Array} attempts List of registration attempts: [ { phrase: string, keystrokes: Array }, ... ]
 * @returns {Object} User profile template
 */
function createProfile(attempts) {
    if (attempts.length < 3) {
        throw new Error("Need at least 3 attempts to establish a baseline profile.");
    }

    const holdsAgg = {};
    const flightsAgg = {};

    attempts.forEach(attempt => {
        const keystrokes = attempt.keystrokes;
        // Extract Holds (monographs)
        for (let i = 0; i < keystrokes.length; i++) {
            const char = keystrokes[i].key.toLowerCase();
            const holdTime = keystrokes[i].releaseTime - keystrokes[i].pressTime;
            if (!holdsAgg[char]) holdsAgg[char] = [];
            holdsAgg[char].push(holdTime);
        }
        // Extract Flights (digraphs)
        for (let i = 0; i < keystrokes.length - 1; i++) {
            const char1 = keystrokes[i].key.toLowerCase();
            const char2 = keystrokes[i+1].key.toLowerCase();
            const digraph = char1 + char2;
            const flightTime = keystrokes[i+1].pressTime - keystrokes[i].releaseTime;
            if (!flightsAgg[digraph]) flightsAgg[digraph] = [];
            flightsAgg[digraph].push(flightTime);
        }
    });

    // Compute means and standard deviations for holds
    const holdsProfile = {};
    for (const char in holdsAgg) {
        const values = holdsAgg[char];
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const varianceSum = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
        const std = values.length > 1 ? Math.sqrt(varianceSum / (values.length - 1)) : 0;
        holdsProfile[char] = { mean, std };
    }

    // Compute means and standard deviations for flights
    const flightsProfile = {};
    for (const digraph in flightsAgg) {
        const values = flightsAgg[digraph];
        const sum = values.reduce((a, b) => a + b, 0);
        const mean = sum / values.length;
        const varianceSum = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
        const std = values.length > 1 ? Math.sqrt(varianceSum / (values.length - 1)) : 0;
        flightsProfile[digraph] = { mean, std };
    }

    return {
        holds: holdsProfile,
        flights: flightsProfile
    };
}

/**
 * Verifies legacy sequential baseline
 */
function verifyLegacyAttempt(profile, features, threshold) {
    const { means, stds } = profile;
    if (features.length !== means.length) {
        return { authenticated: false, score: 0.0, avgZ: 999.0 };
    }

    const epsilon = 10.0;
    let zSum = 0;

    for (let i = 0; i < features.length; i++) {
        const stdBuffered = Math.max(stds[i], epsilon);
        const z = Math.abs(features[i] - means[i]) / stdBuffered;
        zSum += z;
    }

    const avgZ = zSum / features.length;
    const authenticated = avgZ < threshold;
    const score = Math.min(100, Math.max(0, Math.exp(-0.35 * avgZ) * 100));

    return {
        authenticated,
        score: parseFloat(score.toFixed(2)),
        avgZ: parseFloat(avgZ.toFixed(2))
    };
}

/**
 * Verifies attempt using monograph/digraph comparison or sequential fallback.
 * @param {Object} profile User profile template containing holds/flights or legacy means/stds
 * @param {Array} attemptData Timing features array (legacy) or raw keystrokes list (modern)
 * @param {number} threshold Z-score validation threshold (default: 1.8)
 * @returns {Object} { authenticated: boolean, score: number, avgZ: number }
 */
function verifyAttempt(profile, attemptData, threshold = 1.8) {
    // 1. Legacy compatibility check
    if (profile.means && Array.isArray(profile.means)) {
        let features;
        if (Array.isArray(attemptData) && attemptData.length > 0 && typeof attemptData[0] === 'object') {
            features = extractLegacyFeatures(attemptData, profile.phrase || TARGET_PHRASE);
            if (!features) {
                return { authenticated: false, score: 0.0, avgZ: 999.0 };
            }
        } else {
            features = attemptData;
        }
        return verifyLegacyAttempt(profile, features, threshold);
    }

    // 2. Monograph/Digraph verification
    const keystrokes = attemptData;
    if (!Array.isArray(keystrokes) || keystrokes.length === 0 || typeof keystrokes[0] !== 'object') {
        return { authenticated: false, score: 0.0, avgZ: 999.0 };
    }

    const { holds: profileHolds, flights: profileFlights } = profile;
    const epsilon = 15.0; // 15ms minimum standard deviation boundary

    let zSum = 0;
    let matchedCount = 0;

    // Verify holds (monographs)
    for (let i = 0; i < keystrokes.length; i++) {
        const char = keystrokes[i].key.toLowerCase();
        const holdTime = keystrokes[i].releaseTime - keystrokes[i].pressTime;

        if (profileHolds && profileHolds[char]) {
            const { mean, std } = profileHolds[char];
            const stdBuffered = Math.max(std, epsilon);
            const z = Math.abs(holdTime - mean) / stdBuffered;
            zSum += z;
            matchedCount++;
        }
    }

    // Verify flights (digraphs)
    for (let i = 0; i < keystrokes.length - 1; i++) {
        const char1 = keystrokes[i].key.toLowerCase();
        const char2 = keystrokes[i+1].key.toLowerCase();
        const digraph = char1 + char2;
        const flightTime = keystrokes[i+1].pressTime - keystrokes[i].releaseTime;

        if (profileFlights && profileFlights[digraph]) {
            const { mean, std } = profileFlights[digraph];
            const stdBuffered = Math.max(std, epsilon);
            const z = Math.abs(flightTime - mean) / stdBuffered;
            zSum += z;
            matchedCount++;
        }
    }

    if (matchedCount === 0) {
        return { authenticated: false, score: 0.0, avgZ: 999.0 };
    }

    const avgZ = zSum / matchedCount;
    const authenticated = avgZ < threshold;
    const score = Math.min(100, Math.max(0, Math.exp(-0.35 * avgZ) * 100));

    return {
        authenticated,
        score: parseFloat(score.toFixed(2)),
        avgZ: parseFloat(avgZ.toFixed(2))
    };
}

module.exports = {
    TARGET_PHRASE,
    PHRASE_POOL,
    extractFeatures,
    createProfile,
    verifyAttempt
};
