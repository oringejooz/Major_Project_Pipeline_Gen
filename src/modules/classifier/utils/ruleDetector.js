// utils/ruleDetector.js
export function runRuleDetector(features = {}) {
  const candidates = [];
  const detectedFiles = (features.detectedFiles || []).map((f) => f.toLowerCase());
  const comp = features.composition || {};
  const buildDep = features.build_and_dependency || {};
  const languages = comp.languages || features.languages || {};
  const dominant =
    comp.dominant_language ||
    features.dominant_language ||
    Object.keys(languages)[0] ||
    "";

  const push = (label, conf, reason) => candidates.push({ label, confidence: conf, reason });
  const lowerFiles = new Set(detectedFiles);

  if (lowerFiles.has("package.json")) push("node", 0.99, "package.json present (JS project)");
  if (lowerFiles.has("requirements.txt")) push("python", 0.98, "requirements.txt present");
  if (
    (lowerFiles.has("pom.xml") || lowerFiles.has("build.gradle") || lowerFiles.has("gradlew")) &&
    !lowerFiles.has("package.json")
  )
    push("java", 0.97, "Maven/Gradle build found (no JS indicators)");
  if (lowerFiles.has("go.mod")) push("go", 0.95, "Go project detected");

  const frameworks = (buildDep.frameworks || features.frameworks || []).map((s) =>
    ("" + s).toLowerCase()
  );
  if (frameworks.includes("flask")) push("python", 0.9, "Flask detected");
  if (frameworks.includes("django")) push("python", 0.9, "Django detected");
  if (frameworks.includes("express")) push("node", 0.9, "Express detected");
  if (frameworks.includes("spring")) push("java", 0.9, "Spring detected");

  const summary = [
    features.metadata?.description || features.description || "",
    "Languages: " + JSON.stringify(languages).slice(0, 400),
    "Files: " + detectedFiles.slice(0, 20).join(", "),
  ].join("\n");

  candidates.sort((a, b) => b.confidence - a.confidence);
  return { candidates, summary, detectedFiles, languages };
}
