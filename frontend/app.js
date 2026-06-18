let targetPhrase = "";
let currentTab = "register";
let authMode = "biometric"; // "biometric" or "password"

// Registration Form State
let regName = "";
let regEmail = "";
let regUsername = "";
let regPassword = "";

// Dynamic Registration/Auth Phrases State
let registrationPhrases = [];
let defaultRedirectUrl = "";

// Keystroke Recording State
let regAttempts = []; // stores 3 trials of keystroke logs: [ { phrase, keystrokes }, ... ]
let currentKeystrokes = [];
let activeKeyPress = null; // tracks current active keypress timing: { index: number, pressTime: number }

// DOM Elements
const authUsernameInput = document.getElementById("auth-username");
const authPasswordInput = document.getElementById("auth-password");
const regInput = document.getElementById("reg-input");
const authInput = document.getElementById("auth-input");
const regStatus = document.getElementById("reg-status");
const authStatus = document.getElementById("auth-status");
const chartBars = document.getElementById("chart-bars");
const lockVisual = document.getElementById("lock-visual");
const lockIcon = document.getElementById("lock-icon");
const lockLabel = document.getElementById("lock-label");

// Registration Panels
const regFormSection = document.getElementById("reg-form-section");
const regOtpSection = document.getElementById("reg-otp-section");
const regOtpCodeInput = document.getElementById("reg-otp-code");
const regEnrollmentSection = document.getElementById("reg-enrollment-section");

// Auth Sections
const authBiometricSection = document.getElementById("auth-biometric-section");
const authFallbackSection = document.getElementById("auth-fallback-section");
const authFallbackPasswordInput = document.getElementById("auth-fallback-password");
const authFallbackOtpInput = document.getElementById("auth-fallback-otp");
const toggleAuthModeLink = document.getElementById("toggle-auth-mode");

// Telemetry Labels
const telemetryChars = document.getElementById("telemetry-chars");
const telemetryHold = document.getElementById("telemetry-hold");
const telemetryFlight = document.getElementById("telemetry-flight");
const telemetryWpm = document.getElementById("telemetry-wpm");

// Fetch configuration and initial phrase from API on load
async function fetchConfig() {
    try {
        const res = await fetch("/api/config");
        if (res.ok) {
            const data = await res.json();
            defaultRedirectUrl = data.defaultRedirect || "";
        }
        await loadAuthenticationPhrase();
    } catch (e) {
        console.error("Failed to load backend config, using defaults:", e);
        // Fallback target phrase
        targetPhrase = "kinetic";
        document.getElementById("auth-target-phrase").textContent = targetPhrase;
        telemetryChars.textContent = `0 / ${targetPhrase.length}`;
    }
}

// Fetch a random authentication phrase
async function loadAuthenticationPhrase() {
    try {
        const res = await fetch("/api/phrases?count=1");
        if (res.ok) {
            const data = await res.json();
            targetPhrase = data.phrases[0];
            document.getElementById("auth-target-phrase").textContent = targetPhrase;
            telemetryChars.textContent = `0 / ${targetPhrase.length}`;
            resetTyping(authInput);
        }
    } catch (e) {
        console.error("Failed to load authentication phrase:", e);
    }
}

// Fetch a random registration phrase to rotate on mistake
async function rotateRegistrationPhrase() {
    try {
        const res = await fetch("/api/phrases?count=1");
        if (res.ok) {
            const data = await res.json();
            const newPhrase = data.phrases[0];
            const currentAttemptIdx = regAttempts.length;
            if (currentAttemptIdx < registrationPhrases.length) {
                registrationPhrases[currentAttemptIdx] = newPhrase;
            } else {
                registrationPhrases.push(newPhrase);
            }
            targetPhrase = newPhrase;
            document.getElementById("reg-target-phrase").textContent = targetPhrase;
            resetTyping(regInput);
        }
    } catch (e) {
        console.error("Failed to rotate registration phrase:", e);
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

    // Reset current active typing states
    resetTyping(tab === "register" ? regInput : authInput);
    
    // Hide any open OTP / fallback states and switch
    if (tab === "register") {
        regOtpSection.style.display = "none";
        regEnrollmentSection.style.display = "none";
        regFormSection.style.display = "block";
        document.getElementById("reg-fullname").focus();
    } else {
        authFallbackSection.style.display = "none";
        toggleAuthModeLink.style.display = "inline-flex";
        authBiometricSection.style.display = "block";
        authUsernameInput.focus();
        loadAuthenticationPhrase();
        
        // Clear password explicitly on tab switch to prevent auto-fill
        authPasswordInput.value = "";
        const markerIcon = document.getElementById("password-status-icon");
        if (markerIcon) {
            markerIcon.style.display = "none";
            markerIcon.className = "";
        }
        updateAlertBanner("info", "Please enter your password to start biometric verification.");
        
        updateAuthInputState();
    }
}

// Helper to update custom alert banner styles and text
function updateAlertBanner(status, text) {
    const banner = document.getElementById("auth-alert-banner");
    const bannerText = document.getElementById("auth-alert-text");
    if (!banner || !bannerText) return;

    banner.style.display = "flex";
    bannerText.textContent = text;

    if (status === "success") {
        banner.style.background = "rgba(57, 255, 20, 0.08)";
        banner.style.borderColor = "rgba(57, 255, 20, 0.3)";
        banner.style.color = "var(--neon-green)";
        const icon = banner.querySelector('i');
        if (icon) icon.className = "fa-solid fa-circle-check";
    } else if (status === "error") {
        banner.style.background = "rgba(255, 56, 56, 0.08)";
        banner.style.borderColor = "rgba(255, 56, 56, 0.3)";
        banner.style.color = "var(--neon-red)";
        const icon = banner.querySelector('i');
        if (icon) icon.className = "fa-solid fa-circle-xmark";
    } else {
        banner.style.background = "rgba(0, 242, 254, 0.08)";
        banner.style.borderColor = "rgba(0, 242, 254, 0.3)";
        banner.style.color = "var(--accent-cyan)";
        const icon = banner.querySelector('i');
        if (icon) icon.className = "fa-solid fa-circle-info";
    }
}
// Lock/Unlock biometric auth input based on Username and Password
function updateAuthInputState() {
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value;
    const disabled = username.length < 3 || password.length < 1;
    authInput.disabled = disabled;

    if (disabled) {
        authStatus.textContent = "Enter your username/email and password above to unlock.";
        resetAuthentication();
    } else {
        authStatus.textContent = "Ready. Type target phrase to authenticate.";
    }
}

let passwordVerifyTimeout = null;

async function verifyPasswordOnInput() {
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value;
    const markerIcon = document.getElementById("password-status-icon");

    if (passwordVerifyTimeout) {
        clearTimeout(passwordVerifyTimeout);
    }

    if (!username || username.length < 3 || !password) {
        markerIcon.style.display = "none";
        markerIcon.className = "";
        updateAlertBanner("info", "Please enter your password to start biometric verification.");
        return;
    }

    passwordVerifyTimeout = setTimeout(async () => {
        try {
            const res = await fetch("/api/verify-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    markerIcon.style.display = "block";
                    markerIcon.className = "fa-solid fa-circle-check";
                    markerIcon.style.color = "var(--neon-green)";
                    updateAlertBanner("success", "Password verified! Please type the target phrase below to unlock.");
                } else {
                    markerIcon.style.display = "block";
                    markerIcon.className = "fa-solid fa-circle-xmark";
                    markerIcon.style.color = "var(--neon-red)";
                    updateAlertBanner("error", "Incorrect password. Please enter your correct password.");
                }
            } else {
                markerIcon.style.display = "none";
            }
        } catch (e) {
            console.error("Error verifying password:", e);
            markerIcon.style.display = "none";
        }
    }, 500);
}

async function triggerImmediatePasswordVerify() {
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value;
    const markerIcon = document.getElementById("password-status-icon");

    if (passwordVerifyTimeout) {
        clearTimeout(passwordVerifyTimeout);
    }

    if (!username || username.length < 3 || !password) {
        markerIcon.style.display = "none";
        markerIcon.className = "";
        updateAlertBanner("info", "Please enter your password to start biometric verification.");
        return;
    }

    try {
        const res = await fetch("/api/verify-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                markerIcon.style.display = "block";
                markerIcon.className = "fa-solid fa-circle-check";
                markerIcon.style.color = "var(--neon-green)";
                updateAlertBanner("success", "Password verified! Please type the target phrase below to unlock.");
            } else {
                markerIcon.style.display = "block";
                markerIcon.className = "fa-solid fa-circle-xmark";
                markerIcon.style.color = "var(--neon-red)";
                updateAlertBanner("error", "Incorrect password. Please enter your correct password.");
            }
        } else {
            markerIcon.style.display = "none";
        }
    } catch (e) {
        console.error("Error verifying password:", e);
        markerIcon.style.display = "none";
    }
}

authUsernameInput.addEventListener("input", () => {
    updateAuthInputState();
    verifyPasswordOnInput();
});
authPasswordInput.addEventListener("input", () => {
    updateAuthInputState();
    verifyPasswordOnInput();
});
authPasswordInput.addEventListener("blur", triggerImmediatePasswordVerify);

// Fallback helper in case keyup was lost or delayed
function recordPreviousKeyIfUnfinished() {
    if (activeKeyPress !== null) {
        const releaseTime = performance.now();
        const holdTime = Math.max(10, releaseTime - activeKeyPress.pressTime - 5);
        let flightTime = 0;
        if (currentKeystrokes.length > 0) {
            flightTime = activeKeyPress.pressTime - currentKeystrokes[currentKeystrokes.length - 1].releaseTime;
        }
        currentKeystrokes.push({
            key: targetPhrase[activeKeyPress.index] || "?",
            pressTime: activeKeyPress.pressTime,
            releaseTime: releaseTime,
            holdTime: holdTime,
            flightTime: flightTime
        });
        activeKeyPress = null;
    }
}

// Typing Event Listeners
[
    { input: regInput, isReg: true },
    { input: authInput, isReg: false }
].forEach(({ input, isReg }) => {
    input.addEventListener("keydown", (e) => handleKeyDown(e, input, isReg));
    input.addEventListener("beforeinput", (e) => handleBeforeInput(e, input, isReg));
    input.addEventListener("keyup", (e) => handleKeyUp(e, input, isReg));
});

function handleKeyDown(event, inputElement, isReg) {
    const currentUsername = isReg ? regUsername : authUsernameInput.value.trim();
    if (currentUsername.length < 3) return;

    // Catch Backspace or deletes early on desktop
    if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        showToast("Typos reset the timer. Starting over!", "error");
        resetTyping(inputElement);
        return;
    }

    // Record the start time of the press immediately
    const nextIndex = inputElement.value.length;
    
    if (activeKeyPress === null || activeKeyPress.index !== nextIndex) {
        recordPreviousKeyIfUnfinished();
        activeKeyPress = {
            index: nextIndex,
            pressTime: performance.now()
        };
    }
}

function handleBeforeInput(event, inputElement, isReg) {
    const currentUsername = isReg ? regUsername : authUsernameInput.value.trim();
    if (currentUsername.length < 3) return;

    const inputType = event.inputType;

    // Catch Backspace / Delete or pasting on mobile and desktop
    if (inputType && (inputType.startsWith("delete") || inputType === "insertFromPaste" || inputType === "insertReplacementText")) {
        event.preventDefault();
        showToast("Typos / pasting reset the timer. Starting over!", "error");
        resetTyping(inputElement);
        return;
    }

    const char = event.data;
    if (!char) return; // composition events might have empty data temporarily

    const typedSoFar = inputElement.value;
    const nextCharIndex = typedSoFar.length;

    // Check if key matches the expected character of the phrase
    const expectedChar = targetPhrase[nextCharIndex];
    if (char.toLowerCase() !== expectedChar) {
        event.preventDefault();
        showToast(`Typo! Expected "${expectedChar}" but pressed "${char}". Trial reset.`, "error");
        resetTyping(inputElement);
        return;
    }

    // Update character tracking UI early
    telemetryChars.textContent = `${nextCharIndex + 1} / ${targetPhrase.length}`;
}

function handleKeyUp(event, inputElement, isReg) {
    const currentUsername = isReg ? regUsername : authUsernameInput.value.trim();
    if (currentUsername.length < 3) return;

    // If keyup is backspace/delete, it was already handled, just return
    if (event.key === "Backspace" || event.key === "Delete") {
        return;
    }

    // Finalize the active keypress timing if it exists and matches the index
    const typedLength = inputElement.value.length;
    
    if (activeKeyPress !== null && activeKeyPress.index === typedLength - 1) {
        const releaseTime = performance.now();
        const holdTime = releaseTime - activeKeyPress.pressTime;

        // Calculate Flight Time (Interval) from previous keyup
        let flightTime = 0;
        if (currentKeystrokes.length > 0) {
            const lastKeystroke = currentKeystrokes[currentKeystrokes.length - 1];
            flightTime = activeKeyPress.pressTime - lastKeystroke.releaseTime;
        }

        const keystrokeRecord = {
            key: targetPhrase[activeKeyPress.index],
            pressTime: activeKeyPress.pressTime,
            releaseTime: releaseTime,
            holdTime: holdTime,
            flightTime: flightTime
        };

        currentKeystrokes.push(keystrokeRecord);
        activeKeyPress = null;

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
        if (inputElement.value.length >= targetPhrase.length) {
            if (inputElement.value.toLowerCase() === targetPhrase) {
                // Small timeout to allow input rendering
                setTimeout(() => {
                    if (isReg) {
                        processRegistrationTrial(inputElement);
                    } else {
                        processAuthenticationAttempt(inputElement);
                    }
                }, 150);
            } else {
                // Mismatch / typo detected! Rotate phrase
                setTimeout(() => {
                    showToast("Phrase mismatch! Rotating target phrase.", "error");
                    if (isReg) {
                        rotateRegistrationPhrase();
                    } else {
                        loadAuthenticationPhrase();
                    }
                }, 150);
            }
        }
    }
}

// Process single registration trial
function processRegistrationTrial(inputElement) {
    regAttempts.push({
        phrase: targetPhrase,
        keystrokes: [...currentKeystrokes]
    });
    const attemptNum = regAttempts.length;

    showToast(`Trial #${attemptNum} completed!`, "success");

    resetTyping(inputElement);
    updateRegDots();

    if (attemptNum < 3) {
        // Advance to next target phrase
        targetPhrase = registrationPhrases[attemptNum];
        document.getElementById("reg-target-phrase").textContent = targetPhrase;
        telemetryChars.textContent = `0 / ${targetPhrase.length}`;
        regStatus.textContent = `Trial #${attemptNum} saved. Please type the next phrase (Trial #${attemptNum + 1}/3).`;
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
                username: regUsername,
                name: regName,
                email: regEmail,
                password: regPassword,
                attempts: regAttempts
            })
        });

        const data = await res.json();
        if (res.ok) {
            showToast("Biometric baseline profile created!", "success");
            regStatus.innerHTML = `<span style="color: var(--accent-cyan); font-weight: 600;">Registration Complete!</span> Pre-filling username for authentication.`;
            
            // Clear form and auto switch to authenticate tab
            setTimeout(() => {
                document.getElementById("reg-fullname").value = "";
                document.getElementById("reg-email").value = "";
                document.getElementById("reg-username").value = "";
                document.getElementById("reg-password").value = "";
                document.getElementById("reg-confirm-password").value = "";
                resetRegistration();
                
                regEnrollmentSection.style.display = "none";
                regFormSection.style.display = "block";
                
                switchTab('auth');
                authUsernameInput.value = regUsername;
                authPasswordInput.value = ""; // Clear password explicitly to prevent browser autofill
                
                // Show registration successful message in the alert banner
                updateAlertBanner("info", "Profile baseline created successfully! Please enter your password to start biometric verification.");
                
                authInput.disabled = true; // Keep target phrase input locked until password is verified
                authStatus.textContent = "Enter your username/email and password above to unlock.";
            }, 2000);
        } else {
            showToast(data.error || "Registration failed.", "error");
            resetRegistration();
        }
    } catch (e) {
        showToast("Server network error during registration.", "error");
        resetRegistration();
    }
}

// Handle login success with dynamic redirection logic
function handleLoginSuccess(user, token) {
    // Store user details in sessionStorage
    sessionStorage.setItem("currentUser", JSON.stringify(user));
    if (token) {
        sessionStorage.setItem("authToken", token);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const redirectParam = urlParams.get('redirect') || urlParams.get('redirect_uri') || defaultRedirectUrl;

    if (redirectParam) {
        try {
            let redirectStr = redirectParam.trim();
            if (!redirectStr.startsWith("http://") && !redirectStr.startsWith("https://") && !redirectStr.startsWith("/")) {
                redirectStr = "https://" + redirectStr;
            }
            const baseUrl = redirectStr.startsWith("/") ? window.location.origin : undefined;
            const redirectUrl = baseUrl ? new URL(redirectStr, baseUrl) : new URL(redirectStr);

            redirectUrl.searchParams.set("status", "success");
            redirectUrl.searchParams.set("username", user.username);
            redirectUrl.searchParams.set("name", user.name);
            redirectUrl.searchParams.set("email", user.email);
            if (token) {
                redirectUrl.searchParams.set("token", token);
            }
            
            authStatus.innerHTML = `<span style="color: var(--neon-green); font-weight: bold;">Access Granted!</span> Redirecting to partner application in 3 seconds...`;
            
            setTimeout(() => {
                window.location.href = redirectUrl.toString();
            }, 3000);
        } catch (err) {
            console.error("Invalid redirect URL format, falling back to dashboard:", err);
            authStatus.innerHTML = `<span style="color: var(--neon-green); font-weight: bold;">Access Granted!</span> Redirecting to dashboard in 3 seconds...`;
            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 3000);
        }
    } else {
        authStatus.innerHTML = `<span style="color: var(--neon-green); font-weight: bold;">Access Granted!</span> Redirecting to dashboard in 3 seconds...`;
        setTimeout(() => {
            window.location.href = "dashboard.html";
        }, 3000);
    }
}

// Process Authentication Attempt
async function processAuthenticationAttempt(inputElement) {
    authStatus.textContent = "Verifying credentials and biometric signature...";
    const currentUsername = authUsernameInput.value.trim();
    
    try {
        const res = await fetch("/api/authenticate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: currentUsername,
                password: authPasswordInput.value,
                keystrokes: currentKeystrokes,
                phrase: targetPhrase
            })
        });

        const data = await res.json();
        
        if (res.ok) {
            if (data.success) {
                lockVisual.className = "lock-visual unlocked";
                lockIcon.className = "fa-solid fa-lock-open";
                lockLabel.textContent = "UNLOCKED";
                
                authStatus.innerHTML = `<span style="color: var(--neon-green); font-weight: bold;">Access Granted!</span> Match Confidence: ${data.score}% (Z-Score: ${data.avgZ})`;
                showToast(`Identity verified successfully (${data.score}% similarity)!`, "success");

                handleLoginSuccess(data.user, data.token);
            } else if (data.fallbackRequired) {
                lockVisual.classList.add("locked");
                lockVisual.style.animation = "shake 0.4s ease";
                setTimeout(() => lockVisual.style.animation = "", 400);

                authStatus.innerHTML = `<span style="color: var(--neon-red); font-weight: bold;">Biometric Mismatch!</span> 2FA verification required.`;
                showToast("Biometric mismatch. Verification code sent to email.", "warning");

                // Transition UI to 2FA fallback inputs
                authBiometricSection.style.display = "none";
                toggleAuthModeLink.style.display = "none";

                authFallbackSection.style.display = "block";
                authFallbackPasswordInput.value = authPasswordInput.value;
                authFallbackOtpInput.value = "";
                setTimeout(() => authFallbackOtpInput.focus(), 150);
            } else {
                lockVisual.classList.add("locked");
                lockVisual.style.animation = "shake 0.4s ease";
                setTimeout(() => lockVisual.style.animation = "", 400);

                authStatus.innerHTML = `<span style="color: var(--neon-red); font-weight: bold;">Rhythm Mismatch!</span> ${data.message || "Match Confidence: " + data.score + "%"}`;
                showToast(data.message || `Verification failed (${data.score}% similarity).`, "error");
                
                // Change the phrase on failure so they try a different one
                loadAuthenticationPhrase();
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
    activeKeyPress = null;
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
    for (let i = 0; i < 3; i++) {
        const dot = document.getElementById(`dot-${i}`);
        if (!dot) continue;
        dot.className = "step-dot";
        if (i < regAttempts.length) {
            dot.classList.add("completed");
        } else if (i === regAttempts.length) {
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

// Start email verification flow
async function startBiometricEnrollment() {
    regName = document.getElementById("reg-fullname").value.trim();
    regEmail = document.getElementById("reg-email").value.trim();
    regUsername = document.getElementById("reg-username").value.trim();
    regPassword = document.getElementById("reg-password").value;
    const regConfirmPassword = document.getElementById("reg-confirm-password").value;

    if (!regName || regName.length < 3) {
        showToast("Full Name must be at least 3 characters long.", "error");
        return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(regEmail)) {
        showToast("Please enter a valid email address.", "error");
        return;
    }

    if (!regUsername || regUsername.length < 3) {
        showToast("Username must be at least 3 characters long.", "error");
        return;
    }

    if (!regPassword || regPassword.length < 6) {
        showToast("Password must be at least 6 characters long.", "error");
        return;
    }

    if (regPassword !== regConfirmPassword) {
        showToast("Passwords do not match.", "error");
        return;
    }

    try {
        const res = await fetch("/api/send-registration-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: regUsername, email: regEmail })
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || "Email OTP request failed.", "error");
            return;
        }

        showToast("Verification code sent to your email!", "success");
        regFormSection.style.display = "none";
        regOtpSection.style.display = "block";
        regOtpCodeInput.value = "";
        setTimeout(() => regOtpCodeInput.focus(), 150);

    } catch (e) {
        console.error("Check user error:", e);
        showToast("Network error verifying user credentials.", "error");
    }
}

function backToDetails() {
    regOtpSection.style.display = "none";
    regFormSection.style.display = "block";
}

// Submit 6-digit registration OTP code to verify email address
async function submitRegistrationOTP() {
    const code = regOtpCodeInput.value.trim();
    if (code.length !== 6) {
        showToast("Verification code must be exactly 6 digits.", "error");
        return;
    }

    try {
        const res = await fetch("/api/verify-registration-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: regEmail, code })
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || "Verification failed.", "error");
            return;
        }

        showToast("Email successfully verified!", "success");

        // Fetch enrollment phrases
        const phraseRes = await fetch("/api/phrases?count=3");
        if (phraseRes.ok) {
            const phraseData = await phraseRes.json();
            registrationPhrases = phraseData.phrases;
        } else {
            registrationPhrases = [
                "secure",
                "pattern",
                "defense"
            ];
        }

        // Set the initial enrollment phrase
        targetPhrase = registrationPhrases[0];
        document.getElementById("reg-target-phrase").textContent = targetPhrase;
        telemetryChars.textContent = `0 / ${targetPhrase.length}`;

        // Go to Enrollment panel
        regOtpSection.style.display = "none";
        regEnrollmentSection.style.display = "block";

        regInput.disabled = false;
        resetRegistration();
        setTimeout(() => regInput.focus(), 150);
    } catch (e) {
        console.error("Verification code submit error:", e);
        showToast("Network error during verification.", "error");
    }
}

function backToRegistrationForm() {
    regEnrollmentSection.style.display = "none";
    regFormSection.style.display = "block";
}

// Skip biometric verification and trigger Email OTP 2FA flow directly
async function skipTo2FA(event) {
    if (event) event.preventDefault();
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value;

    if (!username || username.length < 3) {
        showToast("Please enter your username or email.", "error");
        return;
    }

    if (!password) {
        showToast("Please enter your password.", "error");
        return;
    }

    authStatus.textContent = "Verifying password & sending 2FA code...";

    try {
        const res = await fetch("/api/authenticate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: username,
                password: password,
                keystrokes: null,
                phrase: null
            })
        });

        const data = await res.json();

        if (res.ok) {
            if (data.fallbackRequired) {
                authStatus.innerHTML = `<span style="color: var(--accent-cyan); font-weight: bold;">Password Verified!</span> 2FA verification required.`;
                showToast("Verification code sent to email.", "warning");

                // Transition UI to 2FA fallback inputs
                authBiometricSection.style.display = "none";
                toggleAuthModeLink.style.display = "none";

                authFallbackSection.style.display = "block";
                authFallbackPasswordInput.value = password;
                authFallbackOtpInput.value = "";
                setTimeout(() => authFallbackOtpInput.focus(), 150);
            } else if (data.success) {
                handleLoginSuccess(data.user, data.token);
            } else {
                showToast(data.message || "Failed to trigger 2FA.", "error");
                authStatus.textContent = data.message || "Failed to trigger 2FA.";
            }
        } else {
            showToast(data.error || "Authentication failed.", "error");
            authStatus.textContent = data.error || "Authentication failed.";
        }
    } catch (e) {
        console.error("Skip to 2FA error:", e);
        showToast("Server network error during authentication.", "error");
        authStatus.textContent = "Network error.";
    }
}

// Submit password + OTP fallback (2FA) credentials
async function submitFallbackAuth() {
    const username = authUsernameInput.value.trim();
    const password = authFallbackPasswordInput.value;
    const otp = authFallbackOtpInput.value.trim();

    if (!password) {
        showToast("Please enter your password.", "error");
        return;
    }

    if (otp.length !== 6) {
        showToast("Please enter the 6-digit verification code.", "error");
        return;
    }

    authStatus.textContent = "Verifying 2FA credentials...";

    try {
        const res = await fetch("/api/authenticate-fallback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, otp })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            lockVisual.className = "lock-visual unlocked";
            lockIcon.className = "fa-solid fa-lock-open";
            lockLabel.textContent = "UNLOCKED";
            
            showToast("Two-factor credentials verified!", "success");
            
            handleLoginSuccess(data.user, data.token);
        } else {
            showToast(data.error || "2FA verification failed.", "error");
            authStatus.textContent = data.error || "2FA verification failed.";
        }
    } catch (e) {
        console.error("Fallback auth network error:", e);
        showToast("Server network error during fallback authentication.", "error");
        authStatus.textContent = "Network error.";
    }
}

function cancelFallbackAuth() {
    authFallbackSection.style.display = "none";
    toggleAuthModeLink.style.display = "inline-flex";
    authBiometricSection.style.display = "block";
    updateAuthInputState();
    setTimeout(() => {
        if (!authInput.disabled) {
            authInput.focus();
        } else {
            authPasswordInput.focus();
        }
    }, 150);
}

// Init config fetch on page load
window.addEventListener("DOMContentLoaded", fetchConfig);
