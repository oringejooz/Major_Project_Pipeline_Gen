// utils/ruleDetector.js
export function runRuleDetector(features = {}) {
  const candidates = [];

  // try multiple sources for filenames
  const detectedFilesRaw = [
    ...(features.detectedFiles || []),
    ...Object.keys(features.file_types_count || {}),
  ];
  const detectedFiles = detectedFilesRaw.map(f => f.toLowerCase());

  const comp = features.composition || {};
  const buildDep = features.build_and_dependency || {};
  const languages = comp.languages || features.languages || {};
  const dominant =
    comp.dominant_language ||
    features.dominant_language ||
    Object.keys(languages)[0] ||
    "";

  const push = (label, conf, reason) => candidates.push({ label, confidence: conf, reason });

  // 🔹 Language / file heuristics
  if (detectedFiles.includes("package.json")) push("node", 0.99, "package.json present");
  if (detectedFiles.includes("requirements.txt")) push("python", 0.98, "requirements.txt present");
  if (detectedFiles.includes("pom.xml") || detectedFiles.includes("build.gradle")) push("java", 0.97, "Java build descriptor");
  if (detectedFiles.includes("go.mod")) push("go", 0.95, "Go project detected");
  if (detectedFiles.includes("main.tf")) push("terraform", 0.9, "Terraform detected");
  if (detectedFiles.includes("dockerfile")) push("docker", 0.9, "Dockerfile detected");

  // 🔹 Framework hints
  const frameworks = (buildDep.frameworks || features.frameworks || []).map(s => s.toLowerCase());
  if (frameworks.includes("flask")) push("python", 0.9, "Flask framework");
  if (frameworks.includes("django")) push("python", 0.9, "Django framework");
  if (frameworks.includes("express")) push("node", 0.9, "Express framework");
  if (frameworks.includes("spring") || frameworks.includes("springboot")) push("java", 0.9, "Spring framework");

  // 🔹 Dominant language
  if (dominant.toLowerCase().includes("javascript")) push("node", 0.8, `dominant language ${dominant}`);
  if (dominant.toLowerCase().includes("python")) push("python", 0.8, `dominant language ${dominant}`);
  if (dominant.toLowerCase().includes("java")) push("java", 0.8, `dominant language ${dominant}`);

  // 🔹 Polyglot detection
  const langKeys = Object.keys(languages);
  if (langKeys.length > 1) push("polyglot", 0.6, `multiple languages: ${langKeys.join(", ")}`);

  if (!candidates.length) push("generic", 0.3, "no strong rule match");

  // Build better summary for HF classifier
  const summary = [
    `Dominant language: ${dominant}`,
    `Languages: ${Object.keys(languages).join(", ")}`,
    `Frameworks: ${frameworks.join(", ")}`,
    `Detected files: ${detectedFiles.slice(0, 10).join(", ")}`,
  ].join("\n");

  candidates.sort((a, b) => b.confidence - a.confidence);
  return { candidates, summary, detectedFiles, languages };
}
