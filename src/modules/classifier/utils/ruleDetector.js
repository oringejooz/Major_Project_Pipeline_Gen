// utils/ruleDetector.js
export function runRuleDetector(features = {}) {
  const candidates = [];

  const detectedFiles = (features.detectedFiles || []).map(f => f.toLowerCase());
  const comp = features.composition || {};
  const buildDep = features.build_and_dependency || {};
  const languages = comp.languages || features.languages || {};
  const dominant =
    comp.dominant_language ||
    features.dominant_language ||
    Object.keys(languages)[0] ||
    "";

  const push = (label, conf, reason) => candidates.push({ label, confidence: conf, reason });

  // Flatten file type keys for robust detection
  const typeKeys = Object.keys(features.file_types_count || {}).map(k =>
    k.toLowerCase().split("/").pop()
  );
  const lowerFiles = new Set([...detectedFiles, ...typeKeys]);

  // --- Language and framework heuristics ---
  if (lowerFiles.has("package.json")) push("node", 0.98, "package.json present");
  if (lowerFiles.has("requirements.txt")) push("python", 0.98, "requirements.txt present");
  if (
    lowerFiles.has("pom.xml") ||
    lowerFiles.has("build.gradle") ||
    lowerFiles.has("gradlew") ||
    lowerFiles.has("mvnw")
  )
    push("java", 0.97, "maven/gradle build descriptors found");
  if (lowerFiles.has("go.mod")) push("go", 0.95, "go.mod found");
  if (lowerFiles.has("main.tf") || lowerFiles.has("terraform.tf")) push("terraform", 0.9, "Terraform IaC detected");
  if (
    (features.containerization_and_deployment &&
      features.containerization_and_deployment.has_dockerfile) ||
    lowerFiles.has("dockerfile")
  )
    push("docker", 0.9, "Dockerfile present");

  // --- Node lockfiles ---
  if (lowerFiles.has("yarn.lock") || lowerFiles.has("pnpm-lock.yaml"))
    push("node", 0.9, "Node package lockfile detected");

  // --- Framework hints ---
  const frameworks = (buildDep.frameworks || features.frameworks || []).map(s =>
    ("" + s).toLowerCase()
  );
  if (frameworks.includes("flask")) push("python", 0.9, "Flask framework detected");
  if (frameworks.includes("django")) push("python", 0.9, "Django framework detected");
  if (frameworks.includes("express")) push("node", 0.9, "Express framework detected");
  if (frameworks.includes("spring") || frameworks.includes("springboot"))
    push("java", 0.9, "Spring Boot framework detected");
  if (frameworks.includes("react") || frameworks.includes("vue") || frameworks.includes("angular"))
    push("node", 0.85, "Frontend framework detected");

  // --- CI/CD config presence ---
  if (lowerFiles.has(".github/workflows")) push("github-actions", 0.8, "GitHub Actions workflow detected");
  if (lowerFiles.has(".gitlab-ci.yml")) push("gitlab-ci", 0.8, "GitLab CI detected");
  if (lowerFiles.has("circleci/config.yml")) push("circleci", 0.8, "CircleCI config detected");

  // --- Language dominance ---
  if (dominant) {
    const d = dominant.toLowerCase();
    if (d.includes("python")) push("python", 0.6, `dominant language ${dominant}`);
    if (d.includes("javascript") || d.includes("html") || d.includes("typescript"))
      push("node", 0.6, `dominant ${dominant}`);
    if (d.includes("java")) push("java", 0.6, `dominant ${dominant}`);
    if (d.includes("go")) push("go", 0.6, `dominant ${dominant}`);
  }

  // --- Polyglot detection ---
  const langKeys = Object.keys(languages);
  if (langKeys.length > 1) {
    const total = Object.values(languages)
      .map(v => parseFloat(v))
      .filter(v => !isNaN(v))
      .reduce((a, b) => a + b, 0);
    const multi = langKeys.filter(k => parseFloat(languages[k]) > 20);
    if (multi.length > 1) push("polyglot", 0.75, `Multiple major languages: ${multi.join(", ")}`);
  }

  // --- Monorepo heuristic ---
  const filesText = (features.detectedFiles || []).join(", ").toLowerCase();
  if (
    filesText.includes("packages/") ||
    filesText.includes("services/") ||
    (features.composition && features.composition.total_files > 200)
  )
    push("monorepo", 0.7, "monorepo-like structure");

  if (!candidates.length) push("generic", 0.3, "no strong rule match");

  // --- Summary for LLM ---
  const summary = [
    features.metadata?.description || features.description || "",
    "Top languages: " + JSON.stringify(languages).slice(0, 400),
    "Frameworks: " + frameworks.join(", "),
    "Files: " +
      ((features.detectedFiles &&
        features.detectedFiles.slice(0, 30).join(", ")) ||
        Object.keys(features.file_types_count || {})
          .slice(0, 30)
          .join(", "))
  ].join("\n");

  candidates.sort((a, b) => b.confidence - a.confidence);
  return { candidates, summary, detectedFiles, languages };
}
