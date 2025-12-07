import { createAppAuth } from "@octokit/auth-app";
import dotenv from "dotenv";
import fs from "fs";
import { Octokit } from "octokit";

dotenv.config();

/**
 * getOctokitForInstallation — returns an Octokit authenticated as the installation.
 * Falls back to PAT (`GITHUB_TOKEN`) if app credentials are not present.
 */
export async function getOctokitForInstallation(installationId) {
  // If PAT available, prefer that for quick local dev
  if (process.env.GITHUB_TOKEN && !process.env.GITHUB_APP_ID && !process.env.GITHUB_PRIVATE_KEY && !process.env.PRIVATE_KEY && !process.env.GITHUB_PRIVATE_KEY_PATH) {
    return new Octokit({ auth: process.env.GITHUB_TOKEN });
  }
  // Support private key provided via multiple sources:
  // 1. PRIVATE_KEY env var (Probot/GitHub App standard)
  // 2. GITHUB_PRIVATE_KEY env var (inline multiline)
  // 3. GITHUB_PRIVATE_KEY_PATH (file path, recommended for local)
  const appId = process.env.GITHUB_APP_ID;
  let privateKey = process.env.PRIVATE_KEY || process.env.GITHUB_PRIVATE_KEY || null;
  const privateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH || null;

  if (!appId) {
    throw new Error("GitHub App ID missing: set GITHUB_APP_ID or provide GITHUB_TOKEN");
  }

  if (!privateKey && privateKeyPath) {
    try {
      privateKey = fs.readFileSync(privateKeyPath, "utf8");
    } catch (err) {
      throw new Error(`Failed to read private key from path ${privateKeyPath}: ${err.message}`);
    }
  }

  if (!privateKey) {
    throw new Error("GitHub App private key missing: set GITHUB_PRIVATE_KEY or GITHUB_PRIVATE_KEY_PATH");
  }

  const auth = createAppAuth({
    appId: Number(appId),
    privateKey,
    installationId,
  });

  const installation = await auth({ type: "installation" });
  return new Octokit({ auth: installation.token });
}

/**
 * getOctokitForPAT — returns Octokit using personal access token (fallback)
 */
export function getOctokitForPAT() {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set");
  return new Octokit({ auth: process.env.GITHUB_TOKEN });
}
