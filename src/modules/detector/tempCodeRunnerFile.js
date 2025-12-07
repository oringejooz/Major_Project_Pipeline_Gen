
/* Utility helpers
--------------------------------------------------------- */

function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error("❌ Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function countFileTypes(files) {
  const counts = {};
  for (const f of files) {
    const ext = f.includes(".") ? f.split(".").pop().toLowerCase() : "(none)";
    counts[ext] = (counts[ext] || 0) + 1;
  }
  return counts;
}

function detectLanguages(langBytes) {
  const total = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
  const percent = {};
  for (const [lang, bytes] of Object.entries(langBytes)) {
    percent[lang] = ((bytes / total) * 100).toFixed(2);
  }
  const dominant = Object.entries(percent).sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown";
  return { percent, dominant };
}

async function getFileContent(owner, repo, path) {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path });
    return Buffer.from(data.content, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------
    Repo Analyzer
--------------------------------------------------------- */

export async function analyzeRepo(repoUrl, outPath) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  console.log(`🔍 Analyzing ${owner}/${repo} ...`);

  /* ---------------------- Base Repo Info */
  const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo });
  const { data: langBytes } = await octokit.rest.repos.listLanguages({ owner, repo });
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: "HEAD",
    recursive: "true",
  });

  const files = tree.tree.map((t) => t.path);
  const fileTypes = countFileTypes(files);
  const totalFiles = files.length;

  /* ---------------------- Language Composition */
  const { percent: languagePercents, dominant: dominantLang } = detectLanguages(langBytes);

  /* ---------------------- Binary File Detection */
  const binaryPattern = /\.(png|jpg|jpeg|gif|exe|bin|zip|pdf|class|o|wasm)$/i;
  const binaryCount = files.filter((f) => binaryPattern.test(f)).length;
  const binaryRatio = ((binaryCount / totalFiles) * 100).toFixed(2);

  /* ---------------------- Docs & Tests */
  const hasDocs = files.some((f) => /(^docs\/|readme|contributing)/i.test(f));
  const hasTests = files.some((f) => /(test|spec|__tests__)/i.test(f));

  /* ---------------------- Build / Dependency Detection */
  const hasPackageJson = files.includes("package.json");
  const hasLockfile = files.some((f) => /package-lock.json|yarn.lock|pnpm-lock.yaml|poetry.lock|requirements.txt/i.test(f));

  return {
    repoInfo,
    languagePercents,
    dominantLang,
    fileTypes,
    totalFiles,
    binaryCount,
    binaryRatio,
    hasDocs,
    hasTests,
    hasPackageJson,
    hasLockfile,
  };

}