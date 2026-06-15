let targetPhrase = "biometric verification";
let currentTab = "register";
let username = "";

// Keystroke Recording State
let regAttempts = []; // stores 5 trials of keystroke logs
let currentKeystrokes = [];
let activePresses = {}; // tracks keydowns by code

// DOM Elements
const usernameInput = document.getElementById("username");
const regInput = document.getElementById("reg-input");
const authInput = document.getElementById("auth-input");
const regStatus = document.getElementById("reg-status");
const authStatus = document.getElementById("auth-status");
const chartBars = document.getElementById("chart-bars");
const lockVisual = document.getElementById("lock-visual");
const lockIcon = document.getElementById("lock-icon");
const lockLabel = document.getElementById("lock-label");

// Telemetry Labels
const telemetryChars = document.getElementById("telemetry-chars");
const telemetryHold = document.getElementById("telemetry-hold");
const telemetryFlight = document.getElementById("telemetry-flight");
const telemetryWpm = document.getElementById("telemetry-wpm");

// Fetch configuration from API on load
async function fetchConfig() {
    try {
        const res = await fetch("/api/config");
        if (res.ok) {
            const data = await res.json();
            targetPhrase = data.targetPhrase || targetPhrase;
            document.getElementById("reg-target-phrase").textContent = targetPhrase;
            document.getElementById("auth-target-phrase").textContent = targetPhrase;
            telemetryChars.textContent = `0 / ${targetPhrase.length}`;
        }
    } catch (e) {
        console.error("Failed to load backend config, using defaults:", e);
    }
}

// Tab switcher
function switchTab(tab) {
    if (tab === currentTab) return;
    currentTab = tab;

    // Toggle Tab button classes
    document.getElementById("tab-register").classList.toggle("active", tab === "register");
    document.getElementById("tab-auth").classList.toggle("active", tab === "auth");

    // Toggle Panel visibility classes
    document.getElementById("panel-register").classList.toggle("active", tab === "register");
    document.getElementById("panel-auth").classList.toggle("active", tab === "auth");

    // Reset current active typing state
    resetTyping(tab === "register" ? regInput : authInput);
    
    // Focus appropriate input if enabled
    if (username.length >= 3) {
        setTimeout(() => {
            if (tab === "register") regInput.focus();
            else authInput.focus();
        }, 100);
    }
}

// Lock/Unlock inputs based on Username
usernameInput.addEventListener("input", (e) => {
    username = e.target.value.trim();
    const disabled = username.length < 3;
    regInput.disabled = disabled;
    authInput.disabled = disabled;

    if (disabled) {
        regStatus.textContent = "Enter your username above to unlock the input box.";
        authStatus.textContent = "Enter your username above to unlock the input box.";
        resetRegistration();
        resetAuthentication();
    } else {
        if (currentTab === "register") {
            regStatus.textContent = `Type the target phrase exactly to start Trial #1.`;
            updateRegDots();
        } else {
            authStatus.textContent = `Ready. Type target phrase to authenticate.`;
        }
    }
});

// Typing Event Listeners
[
    { input: regInput, isReg: true },
    { input: authInput, isReg: false }
].forEach(({ input, isReg }) => {
    input.addEventListener("keydown", (e) => handleKeyDown(e, input, isReg));
    input.addEventListener("keyup", (e) => handleKeyUp(e, input, isReg));
});

function handleKeyDown(event, inputElement, isReg) {
    if (username.length < 3) return;

    // Reject Backspace or deletes to ensure feedforward flow
    if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        showToast("Typos reset the timer. Starting over!", "error");
        resetTyping(inputElement);
        return;
    }

    // Ignore other meta/modifier keys
    if (event.key.length > 1) return;

    const typedSoFar = inputElement.value;
    const nextCharIndex = typedSoFar.length;

    // Check if key matches the expected character of the phrase
    const expectedChar = targetPhrase[nextCharIndex];
    if (event.key.toLowerCase() !== expectedChar) {
        event.preventDefault();
        showToast(`Typo! Expected "${expectedChar}" but pressed "${event.key}". Trial reset.`, "error");
        resetTyping(inputElement);
        return;
    }

    const code = event.code;
    // Store keypress event metadata
    activePresses[code] = {
        key: event.key,
        pressTime: performance.now()
    };

    telemetryChars.textContent = `${nextCharIndex + 1} / ${targetPhrase.length}`;
}

function handleKeyUp(event, inputElement, isReg) {
    const code = event.code;
    if (activePresses[code]) {
        const pressData = activePresses[code];
        const releaseTime = performance.now();
        const holdTime = releaseTime - pressData.pressTime;

        // Calculate Flight Time (Interval) from previous keyup
        let flightTime = 0;
        if (currentKeystrokes.length > 0) {
            const lastKeystroke = currentKeystrokes[currentKeystrokes.length - 1];
            flightTime = pressData.pressTime - lastKeystroke.releaseTime;
        }

        const keystrokeRecord = {
            key: pressData.key,
            pressTime: pressData.pressTime,
            releaseTime: releaseTime,
            holdTime: holdTime,
            flightTime: flightTime
        };

        currentKeystrokes.push(keystrokeRecord);
        delete activePresses[code];

        // Update real-time stats labels
        telemetryHold.textContent = `${Math.round(holdTime)} ms`;
        if (currentKeystrokes.length > 1) {
            telemetryFlight.textContent = `${Math.round(flightTime)} ms`;
        } else {
            telemetryFlight.textContent = `0 ms`;
        }

        // Calculate WPM Estimation
        const totalDuration = (releaseTime - currentKeystrokes[0].pressTime) / 1000;
        const wpm = Math.round((currentKeystrokes.length / 5) / (totalDuration / 60));
        telemetryWpm.textContent = wpm > 0 && isFinite(wpm) ? wpm : "--";

        // Render chart bars
        updateChartBars(currentKeystrokes);

        // Check completion
        if (inputElement.value.toLowerCase() === targetPhrase) {
            // Small timeout to allow input rendering
            setTimeout(() => {
                if (isReg) {
                    processRegistrationTrial(inputElement);
                } else {
                    processAuthenticationAttempt(inputElement);
                }
            }, 150);
        }
    }
}

// Process single registration trial
function processRegistrationTrial(inputElement) {
    // Save current keystroke sequence
    regAttempts.push([...currentKeystrokes]);
    const attemptNum = regAttempts.length;

    showToast(`Trial #${attemptNum} completed!`, "success");

    resetTyping(inputElement);
    updateRegDots();

    if (attemptNum < 5) {
        regStatus.textContent = `Trial #${attemptNum} saved. Please type the phrase again (Trial #${attemptNum + 1}/5).`;
    } else {
        // Enforce training baseline creation
        regStatus.textContent = "Processing and submitting biometric template...";
        submitRegistration();
    }
}

// Send registration to server
async function submitRegistration() {
    try {
        const res = await fetch("/api/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: username,
                attempts: regAttempts
            })
        });

        const data = await res.json();
        if (res.ok) {
            showToast("Biometric baseline profile created!", "success");
            regStatus.innerHTML = `<span style="color: var(--accent-cyan); font-weight: 600;">Registration Complete!</span> You can now switch to the 'Authenticate' tab to test.`;
        } else {
            showToast(data.error || "Registration failed.", "error");
            resetRegistration();
        }
    } catch (e) {
        showToast("Server network error during registration.", "error");
        resetRegistration();
    }
}

// Process Authentication Attempt
async function processAuthenticationAttempt(inputElement) {
    authStatus.textContent = "Verifying biometric signature...";
    
    try {
        const res = await fetch("/api/authenticate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: username,
                keystrokes: currentKeystrokes
            })
        });

        const data = await res.json();
        
        if (res.ok) {
            if (data.success) {
                // Unlock Visual
                lockVisual.className = "lock-visual unlocked";
                lockIcon.className = "fa-solid fa-lock-open";
                lockLabel.textContent = "UNLOCKED";
                
                authStatus.innerHTML = `<span style="color: var(--neon-green); font-weight: bold;">Access Granted!</span> Match Confidence: ${data.score}% (Z-Score: ${data.avgZ})`;
                showToast(`Identity verified successfully (${data.score}% similarity)!`, "success");
            } else {
                // Locked Visual shake
                lockVisual.classList.add("locked");
                lockVisual.style.animation = "shake 0.4s ease";
                setTimeout(() => lockVisual.style.animation = "", 400);

                authStatus.innerHTML = `<span style="color: var(--neon-red); font-weight: bold;">Access Denied!</span> Rhythm mismatch. Match Confidence: ${data.score}% (Z-Score: ${data.avgZ})`;
                showToast(`Verification failed (${data.score}% similarity).`, "error");
            }
        } else {
            showToast(data.error || "Authentication failed.", "error");
            authStatus.textContent = data.error || "Authentication failed.";
        }
    } catch (e) {
        showToast("Server network error during verification.", "error");
        authStatus.textContent = "Network error.";
    }

    resetTyping(inputElement);
}

// Reset typing sequence
function resetTyping(inputElement) {
    if (inputElement) inputElement.value = "";
    currentKeystrokes = [];
    activePresses = {};
    telemetryChars.textContent = `0 / ${targetPhrase.length}`;
}

// Full registration reset
function resetRegistration() {
    regAttempts = [];
    resetTyping(regInput);
    updateRegDots();
}

// Full auth reset
function resetAuthentication() {
    resetTyping(authInput);
    lockVisual.className = "lock-visual locked";
    lockIcon.className = "fa-solid fa-lock";
    lockLabel.textContent = "LOCKED";
}

// Update dots layout on Registration Tab
function updateRegDots() {
    for (let i = 0; i < 5; i++) {
        const dot = document.getElementById(`dot-${i}`);
        dot.className = "step-dot";
        if (i < regAttempts.length) {
            dot.classList.add("completed");
        } else if (i === regAttempts.length && username.length >= 3) {
            dot.classList.add("active");
        }
    }
}

// Draw telemetry hold times chart
function updateChartBars(keystrokes) {
    chartBars.innerHTML = "";
    const maxVal = 250; // Millisecond cap for scaling heights

    keystrokes.forEach(k => {
        const bar = document.createElement("div");
        bar.className = "chart-bar";
        
        const pct = Math.min(100, (k.holdTime / maxVal) * 100);
        bar.style.height = `${pct}%`;
        bar.setAttribute("data-time", Math.round(k.holdTime));
        chartBars.appendChild(bar);
    });
}

// Toast notification helper
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let icon = "fa-info-circle";
    if (type === "success") icon = "fa-check-circle";
    if (type === "error") icon = "fa-triangle-exclamation";
    
    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => toast.classList.add("show"), 10);
    
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 400);
    }, 3200);
}

// Init config fetch on page load
window.addEventListener("DOMContentLoaded", fetchConfig);
