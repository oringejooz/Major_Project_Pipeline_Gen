// utils/ruleDetector.js
export function runRuleDetector(features = {}) {
  const rawCandidates = [];

  const detectedFilesRaw = [
    ...(features.detectedFiles || []),
    ...Object.keys(features.file_types_count || {}),
    ...((features.build_and_dependency?.package_managers) || []) 
  ];
  const detectedFiles = detectedFilesRaw.map(f => f.toLowerCase());

  const comp = features.composition || {};
  const buildDep = features.build_and_dependency || {};
  const languages = comp.languages || features.languages || {};
  const dominant =
    (comp.dominant_language || features.dominant_language || Object.keys(languages)[0] || "")
      .toLowerCase();

  const push = (label, conf, reason) => rawCandidates.push({ label, confidence: conf, reason });

  // 🔹 File-based detection (highest confidence)
  if (detectedFiles.includes("package.json")) push("node", 0.95, "package.json present");
  if (detectedFiles.includes("requirements.txt")) push("python", 0.95, "requirements.txt present");
  if (detectedFiles.includes("pom.xml") || detectedFiles.includes("build.gradle") || detectedFiles.includes("build.gradle.kts")) {
    push("java", 0.95, "Java build descriptor");
  }
  if (detectedFiles.includes("go.mod")) push("go", 0.95, "Go project detected");
  if (detectedFiles.includes("main.tf")) push("terraform", 0.9, "Terraform detected");
  if (detectedFiles.includes("dockerfile")) push("docker", 0.9, "Dockerfile detected");

  // 🔹 Framework detection
  const frameworks = (buildDep.frameworks || features.frameworks || []).map(s => s.toLowerCase());
  if (frameworks.includes("flask") || frameworks.includes("django")) push("python", 0.9, `Framework detected: ${frameworks.join(", ")}`);
  if (frameworks.includes("express")) push("node", 0.9, "Express framework");
  if (frameworks.includes("spring") || frameworks.includes("springboot")) push("java", 0.9, "Spring framework");

  // 🔹 Dominant language as low-confidence hint only
  if (dominant) {
    if (dominant.includes("javascript")) push("node", 0.6, `dominant language hint: ${dominant}`);
    else if (dominant.includes("python")) push("python", 0.6, `dominant language hint: ${dominant}`);
    else if (dominant.includes("java")) push("java", 0.6, `dominant language hint: ${dominant}`);
    else if (dominant.includes("go")) push("go", 0.6, `dominant language hint: ${dominant}`);
  }

  // 🔹 Polyglot detection if multiple languages
  const langKeys = Object.keys(languages);
  if (langKeys.length > 1) push("polyglot", 0.5, `multiple languages detected: ${langKeys.join(", ")}`);

  if (!rawCandidates.length) push("generic", 0.3, "no strong evidence");

  // 🔹 Deduplicate by label: keep the highest confidence reason
  const candidatesMap = new Map();
  for (const c of rawCandidates) {
    const existing = candidatesMap.get(c.label);
    if (!existing || c.confidence > existing.confidence) {
      candidatesMap.set(c.label, c);
    }
  }

  const candidates = Array.from(candidatesMap.values())
    .sort((a, b) => b.confidence - a.confidence);

  const summary = [
    `Dominant language: ${dominant}`,
    `Languages: ${Object.keys(languages).join(", ")}`,
    `Frameworks: ${frameworks.join(", ")}`,
    `Detected files: ${detectedFiles.slice(0, 10).join(", ")}`,
  ].join("\n");

  return { candidates, summary, detectedFiles, languages };
}
