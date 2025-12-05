// utils/ruleDetector.js

/**
 * Rule-based detector:
 * - Uses file signals, languages, frameworks, and derived.recommended_templates
 * - Produces high-confidence hints for the primary pipeline type
 * - DOES NOT call any external services (pure, deterministic)
 */

export function runRuleDetector(features = {}) {
  const rawCandidates = [];

  const comp = features.composition || {};
  const buildDep = features.build_and_dependency || {};
  const derived = features.derived || {};

  const languages = comp.languages || features.languages || {};
  const dominant =
    (comp.dominant_language ||
      features.dominant_language ||
      Object.keys(languages)[0] ||
      ""
    ).toLowerCase();

  // detectedFiles already normalized to lowercase in analyzer, but we re-normalize for safety
  const detectedFilesRaw = [
    ...(features.detectedFiles || []),
    ...Object.keys(comp.file_types_count || {}),
    ...(buildDep.package_managers || []),
  ];
  const detectedFiles = detectedFilesRaw.map((f) => String(f).toLowerCase());

  const frameworks = (buildDep.frameworks || features.frameworks || []).map((s) =>
    s.toLowerCase()
  );

  const hasDockerfile =
    features.containerization_and_deployment?.has_dockerfile ||
    detectedFiles.includes("dockerfile") ||
    Object.keys(languages).some((l) => l.toLowerCase() === "dockerfile");

  const push = (label, conf, reason) =>
    rawCandidates.push({ label, confidence: conf, reason });

  // --- File-based detection (very strong) ---
  if (detectedFiles.includes("package.json")) {
    push("node", 0.95, "package.json present");
  }
  if (detectedFiles.includes("requirements.txt")) {
    push("python", 0.95, "requirements.txt present");
  }
  if (
    detectedFiles.includes("pom.xml") ||
    detectedFiles.includes("build.gradle") ||
    detectedFiles.includes("build.gradle.kts")
  ) {
    push("java", 0.95, "Java build descriptor present");
  }
  if (detectedFiles.includes("go.mod")) {
    push("go", 0.95, "go.mod present");
  }
  if (detectedFiles.some((f) => f.endsWith(".tf"))) {
    push("terraform", 0.9, ".tf files present (Terraform)");
  }

  // Docker is a *very* strong hint when Dockerfile is present
  if (hasDockerfile) {
    push("docker", 0.99, "Dockerfile present");
  }

  // --- Framework detection ---
  if (frameworks.some((f) => f.includes("flask") || f.includes("django") || f.includes("fastapi"))) {
    push("python", 0.9, `Python framework detected: ${frameworks.join(", ")}`);
  }
  if (frameworks.some((f) => f.includes("express") || f.includes("next"))) {
    push("node", 0.9, `Node framework detected: ${frameworks.join(", ")}`);
  }
  if (frameworks.some((f) => f.includes("spring"))) {
    push("java", 0.9, "Spring framework detected");
  }

  // --- Dominant language hints (moderate) ---
  if (dominant) {
    if (dominant.includes("javascript")) {
      push("node", 0.6, `dominant language hint: ${dominant}`);
    } else if (dominant.includes("python")) {
      push("python", 0.6, `dominant language hint: ${dominant}`);
    } else if (dominant.includes("java")) {
      push("java", 0.6, `dominant language hint: ${dominant}`);
    } else if (dominant.includes("go")) {
      push("go", 0.6, `dominant language hint: ${dominant}`);
    } else if (dominant.includes("dockerfile")) {
      push("docker", 0.7, "dominant language is Dockerfile");
    }
  }

  // --- Derived hints from analyzer ---
  const recommended = derived.recommended_templates || [];
  for (const tmpl of recommended) {
    const t = String(tmpl).toLowerCase();
    if (t.includes("docker")) {
      push("docker", 0.8, `derived recommended template: ${tmpl}`);
    } else if (t.includes("node")) {
      push("node", 0.8, `derived recommended template: ${tmpl}`);
    } else if (t.includes("python")) {
      push("python", 0.8, `derived recommended template: ${tmpl}`);
    } else if (t.includes("java")) {
      push("java", 0.8, `derived recommended template: ${tmpl}`);
    } else if (t.includes("ci") || t.includes("workflow")) {
      push("generic", 0.5, `derived recommended template: ${tmpl}`);
    }
  }

  // --- Polyglot detection ---
  const langKeys = Object.keys(languages);
  if (langKeys.length > 1) {
    push("polyglot", 0.5, `multiple languages detected: ${langKeys.join(", ")}`);
  }

  // No signals at all → generic
  if (!rawCandidates.length) {
    push("generic", 0.3, "no strong evidence; fallback to generic");
  }

  // Deduplicate by label: keep the highest confidence
  const candidatesMap = new Map();
  for (const c of rawCandidates) {
    const existing = candidatesMap.get(c.label);
    if (!existing || c.confidence > existing.confidence) {
      candidatesMap.set(c.label, c);
    }
  }

  const candidates = Array.from(candidatesMap.values()).sort(
    (a, b) => b.confidence - a.confidence
  );

  // Summary string for zero-shot classifier (kept compact)
  const summaryParts = [
    `Repo: ${features.repo || "unknown"}`,
    `Dominant language: ${dominant || "unknown"}`,
    `Languages: ${Object.keys(languages).join(", ") || "none"}`,
    `Frameworks: ${frameworks.join(", ") || "none"}`,
    `Has Dockerfile: ${hasDockerfile ? "yes" : "no"}`,
    `Recommended templates: ${(recommended || []).join(", ") || "none"}`,
    `Detected files sample: ${(features.detectedFiles || []).slice(0, 15).join(", ") || "none"}`,
  ];
  const summary = summaryParts.join("\n");

  return { candidates, summary };
}
