import type { ReferenceCatalog, StepDraft, TestDraft } from "./types";

const indent = (value: string, spaces: number) =>
  value
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n");

const yamlValue = (value: string) => {
  const trimmed = value.trim();
  return trimmed || '""';
};

const validSteps = (steps: StepDraft[]) =>
  steps.filter(
    (step) =>
      (step.type === "request" && step.path.trim()) ||
      (step.type === "reference" && step.referenceName.trim()),
  );

export function buildTestYaml(draft: TestDraft) {
  const testName = draft.testName.trim() || "new-api-test";

  const lines = [`${testName}:`];
  if (draft.setupName.trim()) lines.push(`  setup: ${draft.setupName.trim()}`);
  if (draft.cleanupName.trim()) lines.push(`  cleanup: ${draft.cleanupName.trim()}`);
  lines.push("  steps:");

  for (const step of validSteps(draft.steps)) {
    if (step.type === "reference") {
      lines.push(`    - step-set: ${step.referenceName.trim()}`);
      continue;
    }

    const headers = step.headers.filter((header) => header.name.trim() || header.value.trim());

    lines.push(`    - path: ${yamlValue(step.path)}`);
    if (step.stepId.trim()) lines.push(`      id: ${step.stepId.trim()}`);
    lines.push(`      method: ${step.method || "GET"}`);

    if (headers.length > 0) {
      lines.push("      headers:");
      for (const header of headers) {
        if (header.name.trim()) lines.push(`        ${header.name.trim()}: ${yamlValue(header.value)}`);
      }
    }

    if (step.body.trim()) lines.push("      data:", indent(step.body.trim(), 8));
    if (step.statusCode.trim()) lines.push("      assert:", `        status-code: ${step.statusCode.trim()}`);
  }

  if (validSteps(draft.steps).length === 0) {
    lines.push("    - path: /health", "      method: GET", "      assert:", "        status-code: 200");
  }

  return `${lines.join("\n")}\n`;
}

export function extractReferenceCatalog(contents: string): ReferenceCatalog {
  const catalog: ReferenceCatalog = {
    vars: [],
    urls: [],
    stepSets: [],
    outputs: [],
  };

  let section = "";
  let currentStepSet = "";

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.replace(/\t/g, "  ");
    const top = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (top) {
      section = top[1];
      currentStepSet = "";
      continue;
    }

    const output = line.match(/^      ([A-Za-z0-9_-]+):/);
    if (section === "step-sets" && currentStepSet && output) {
      catalog.outputs.push(`$${currentStepSet}.${output[1]}`);
      continue;
    }

    const secondLevel = line.match(/^  ([A-Za-z0-9_-]+):/);
    if (!secondLevel) continue;

    if (section === "vars") catalog.vars.push(`$vars.${secondLevel[1]}`);
    if (section === "urls") catalog.urls.push(`$urls.${secondLevel[1]}`);
    if (section === "step-sets") {
      currentStepSet = secondLevel[1];
      catalog.stepSets.push(currentStepSet);
    }
  }

  return dedupeCatalog(catalog);
}

export function mergeCatalogs(catalogs: ReferenceCatalog[]) {
  return dedupeCatalog({
    vars: catalogs.flatMap((catalog) => catalog.vars),
    urls: catalogs.flatMap((catalog) => catalog.urls),
    stepSets: catalogs.flatMap((catalog) => catalog.stepSets),
    outputs: catalogs.flatMap((catalog) => catalog.outputs),
  });
}

function dedupeCatalog(catalog: ReferenceCatalog): ReferenceCatalog {
  return {
    vars: [...new Set(catalog.vars)].sort(),
    urls: [...new Set(catalog.urls)].sort(),
    stepSets: [...new Set(catalog.stepSets)].sort(),
    outputs: [...new Set(catalog.outputs)].sort(),
  };
}

export const sampleConfig = `vars:
  default-url:
    env: BASE_URL
    default: https://api.example.com
  api-token:
    env: API_TOKEN
    default: replace-me

urls:
  base: $vars.default-url

step-sets:
  create-user:
    once: true
    steps:
      - id: create-user
        path: /api/users
        method: POST
        headers:
          Authorization: Bearer $vars.api-token
        data:
          name: Test User
        assert:
          status-code: 201
    output:
      token: $create-user.response.token
      user-id: $create-user.response.id
`;
