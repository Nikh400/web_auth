# Kinetic | Keystroke Dynamics Biometric Authentication

A modern, glassmorphic single-page web application that registers and authenticates users based on their unique typing rhythm (biometric signature). It measures keystroke hold times (dwell time) and flight times (interval between keys) and uses a Z-score similarity metric for verification.

## 🚀 Render Deployment Guide

This project is fully optimized and configured for seamless deployment to **Render** via its **Blueprints (Infrastructure-as-Code)** feature. It includes persistent storage configuration so that registered biometric profiles are saved across deployments and server restarts.

### Prerequisites
1. A [Render account](https://render.com).
2. A GitHub or GitLab repository containing this code.

### Step-by-Step Deployment
1. Push this project code to your private/public GitHub or GitLab repository.
2. Log in to the [Render Dashboard](https://dashboard.render.com).
3. Click **New** (top right) and select **Blueprint**.
4. Connect your GitHub/GitLab account and select this repository.
5. Render will automatically read the `render.yaml` configuration file and set up:
   - A **Node.js Web Service** called `behavioral-biometrics`.
   - A **1 GB Persistent Disk** mounted at `/var/lib/data` to persist your biometric profiles database.
   - The required environment variables (`DATA_DIR` and `PORT`).
6. Click **Apply** to deploy.

Once deployed, Render will provide a public URL (e.g. `https://behavioral-biometrics.onrender.com`) to access the application.

---

## 🛠️ Local Development

To run the application locally on your machine:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm start
   ```

3. Open your browser and navigate to:
   [http://localhost:3000](http://localhost:3000)

---

## 📂 Project Architecture

```text
├── backend/
│   ├── server.js            # Express server (REST API & static file serving)
│   └── keystrokeModel.js    # Biometric verification model (Z-score similarity)
├── frontend/
│   ├── index.html           # Premium glassmorphic UI
│   ├── style.css            # Responsive styles and micro-animations
│   └── app.js               # Frontend keystroke telemetry & charting logic
├── data/
│   └── user_profile.json    # JSON database template (seeded automatically on Render)
├── package.json             # Project metadata and dependencies
└── render.yaml              # Render blueprint infrastructure configuration
```
