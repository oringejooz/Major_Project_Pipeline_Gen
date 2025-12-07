# CI/CD Pipeline Generator (Prototype)

This repository contains a prototype GitHub App that analyzes repositories and generates suggested CI/CD pipelines.

Quick features
- Repository analysis using GitHub API (languages, tree, metadata)
- Rule-based detector for candidate pipeline templates
- Hugging Face zero-shot disambiguation (optional, falls back to heuristics)
- Adaptive parameter extraction (deterministic fallback if no model configured)
- Handlebars-based rendering of CI workflow templates
- Webhook server to process `installation`, `push`, and `repository` events

Getting started (local prototype)
1. Copy `.env.example` to `.env` and fill in `GITHUB_TOKEN` (or App credentials) and optional `HF_TOKEN`.
2. Install dependencies:
```
npm install
```
3. Run the local server (receives webhooks):
```
npm run server
```
4. Or run a local analysis + render for a repo configured in `src/index.js`:
```
npm run analyze
```

Running as a Probot (GitHub App)
1. Preferred: put your App private key in a file (e.g., `secrets/app_private_key.pem`) and add to `.env`:
```
GITHUB_APP_ID=12345
GITHUB_PRIVATE_KEY_PATH=secrets/app_private_key.pem
GITHUB_WEBHOOK_SECRET=your_webhook_secret
```
2. Start the Probot app locally:
```
npm run dev:probot
```
3. Use a tunnel (ngrok) and set the webhook URL in your GitHub App settings to `https://<your-tunnel>/api/webhooks`.

Security notes
- Never commit `.env` or private keys. The repo `.gitignore` includes `secrets/` and `.env`.
- For quick tests you can use a `GITHUB_TOKEN` (PAT), but for production use the GitHub App credentials.

Notes & next steps
- Replace `.env` variables with App credentials for production.
- Add webhook signature verification and use GitHub App JWT auth for full App flows.
- Expand templates in `src/modules/renderer/templates` for more cases (monorepo, polyglot, frontend-backend).
