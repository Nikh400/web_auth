const TARGET_PHRASE = "biometric verification";

/**
 * Extracts hold and flight times from the raw keystrokes.
 * @param {Array} keystrokes List of objects: { key: string, pressTime: number, releaseTime: number }
 * @returns {Array|null} Array of feature values, or null if validation fails.
 */
function extractFeatures(keystrokes) {
    // 1. Verify phrase characters match the target phrase
    const typedPhrase = keystrokes.map(k => k.key.toLowerCase()).join("");
    if (typedPhrase !== TARGET_PHRASE) {
        return null;
    }

    const features = [];

    // 2. Extract Hold (Dwell) Times
    for (let i = 0; i < keystrokes.length; i++) {
        const holdTime = keystrokes[i].releaseTime - keystrokes[i].pressTime;
        features.push(holdTime);
    }

    // 3. Extract Flight Times (Release-to-Press)
    for (let i = 0; i < keystrokes.length - 1; i++) {
        const flightTime = keystrokes[i+1].pressTime - keystrokes[i].releaseTime;
        features.push(flightTime);
    }

    return features;
}

/**
 * Computes mean and standard deviation for each feature over 5 attempts.
 * @param {Array} attemptsFeatures Array of feature arrays (shape: [attempts, features])
 * @returns {Object} User profile template
 */
function createProfile(attemptsFeatures) {
    if (attemptsFeatures.length < 3) {
        throw new Error("Need at least 3 attempts to establish a baseline profile.");
    }

    const numFeatures = attemptsFeatures[0].length;
    const numAttempts = attemptsFeatures.length;

    const means = [];
    const stds = [];

    for (let f = 0; f < numFeatures; f++) {
        // Gather feature f across all attempts
        const values = [];
        for (let a = 0; a < numAttempts; a++) {
            values.push(attemptsFeatures[a][f]);
        }

        // Calculate mean
        const sum = values.reduce((acc, val) => acc + val, 0);
        const mean = sum / numAttempts;
        means.push(mean);

        // Calculate sample standard deviation
        const varianceSum = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
        const std = numAttempts > 1 ? Math.sqrt(varianceSum / (numAttempts - 1)) : 0;
        stds.push(std);
    }

    return {
        phrase: TARGET_PHRASE,
        means,
        stds,
        numFeatures
    };
}

/**
 * Verifies an authentication attempt features vector against a user profile using Z-score similarity.
 * @param {Object} profile User profile template containing means and stds
 * @param {Array} attemptFeatures Timing features of the authentication attempt
 * @param {number} threshold Z-score validation threshold (default: 1.8)
 * @returns {Object} { authenticated: boolean, score: number, avgZ: number }
 */
function verifyAttempt(profile, attemptFeatures, threshold = 1.8) {
    const { means, stds } = profile;

    if (attemptFeatures.length !== means.length) {
        return { authenticated: false, score: 0.0, avgZ: 999.0 };
    }

    // Standard deviation buffer to prevent division by zero (minimum standard deviation of 10ms)
    const epsilon = 10.0;
    let zSum = 0;

    for (let i = 0; i < attemptFeatures.length; i++) {
        const stdBuffered = Math.max(stds[i], epsilon);
        const z = Math.abs(attemptFeatures[i] - means[i]) / stdBuffered;
        zSum += z;
    }

    const avgZ = zSum / attemptFeatures.length;
    const authenticated = avgZ < threshold;

    // Convert average Z-score to a similarity percentage (exponential scale)
    const score = Math.min(100, Math.max(0, Math.exp(-0.35 * avgZ) * 100));

    return {
        authenticated,
        score: parseFloat(score.toFixed(2)),
        avgZ: parseFloat(avgZ.toFixed(2))
    };
}

module.exports = {
    TARGET_PHRASE,
    extractFeatures,
    createProfile,
    verifyAttempt
};
