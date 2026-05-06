import type { ConfigDraft, ReferenceCatalog, StepDraft, TestDraft } from "./types";

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
    if (step.url.trim()) lines.push(`      url: ${yamlValue(step.url)}`);
    if (step.waitBefore.trim()) lines.push(`      wait-before: ${step.waitBefore.trim()}`);
    if (step.waitAfter.trim()) lines.push(`      wait-after: ${step.waitAfter.trim()}`);
    if (step.retry.trim()) lines.push(`      retry: ${step.retry.trim()}`);

    if (headers.length > 0) {
      lines.push("      headers:");
      for (const header of headers) {
        if (header.name.trim()) lines.push(`        ${header.name.trim()}: ${yamlValue(header.value)}`);
      }
    }

    if (step.body.trim()) lines.push("      data:", indent(step.body.trim(), 8));

    const assertionHeaders = step.assertionHeaders.filter(
      (header) => header.name.trim() || header.value.trim(),
    );
    const hasAssertions =
      step.statusCode.trim() || assertionHeaders.length > 0 || step.responseBody.trim();

    if (hasAssertions) {
      lines.push("      assert:");
      if (step.statusCode.trim()) lines.push(`        status-code: ${step.statusCode.trim()}`);
      if (assertionHeaders.length > 0) {
        lines.push("        headers:");
        for (const header of assertionHeaders) {
          if (header.name.trim()) lines.push(`          ${header.name.trim()}: ${yamlValue(header.value)}`);
        }
      }
      if (step.responseBody.trim()) lines.push("        body:", indent(step.responseBody.trim(), 10));
    }
  }

  if (validSteps(draft.steps).length === 0) {
    lines.push("    - path: /health", "      method: GET", "      assert:", "        status-code: 200");
  }

  return `${lines.join("\n")}\n`;
}

const stripQuotes = (value: string) => value.trim().replace(/^["']|["']$/g, "");

const yamlPair = (line: string) => {
  const match = line.match(/^\s*-?\s*([^:]+):\s*(.*)$/);
  if (!match) return null;
  return { key: stripQuotes(match[1]), value: stripQuotes(match[2] || "") };
};

const lineIndent = (line: string) => line.match(/^ */)?.[0].length ?? 0;

const stepDraft = (overrides: Partial<StepDraft> = {}): StepDraft => ({
  uid: crypto.randomUUID(),
  type: "request",
  referenceName: "",
  collapsed: false,
  headersCollapsed: false,
  bodyCollapsed: false,
  assertionsCollapsed: false,
  optionsCollapsed: false,
  url: "",
  waitBefore: "",
  waitAfter: "",
  retry: "",
  path: "",
  method: "GET",
  stepId: "",
  headers: [],
  body: "",
  statusCode: "",
  assertionHeaders: [],
  responseBody: "",
  ...overrides,
});

function normalizeBlock(lines: string[], baseIndent: number) {
  return lines.map((line) => (lineIndent(line) >= baseIndent ? line.slice(baseIndent) : line));
}

function findTestBlock(contents: string, testName: string) {
  const lines = contents.split("\n").map((line) => line.replace(/\t/g, "  "));
  const target = stripQuotes(testName);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const pair = yamlPair(trimmed);
    if (lineIndent(line) === 0 && pair?.key === target) {
      const block = [];
      for (const child of lines.slice(index + 1)) {
        if (child.trim() && lineIndent(child) === 0) break;
        block.push(child);
      }
      return normalizeBlock(block, 2);
    }

    if (lineIndent(line) === 0 && (pair?.key === "tests" || pair?.key === "test")) {
      for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
        const child = lines[childIndex];
        if (child.trim() && lineIndent(child) === 0) break;
        if (lineIndent(child) !== 2) continue;

        const childTrimmed = child.trim();
        const listName = childTrimmed.match(/^-\s*name:\s*(.+)$/);
        const keyedList = childTrimmed.match(/^-\s*([^:]+):\s*$/);
        const mapEntry = yamlPair(childTrimmed);
        const foundName = listName?.[1] ?? keyedList?.[1] ?? (!childTrimmed.startsWith("-") ? mapEntry?.key : "");
        if (stripQuotes(foundName || "") !== target) continue;

        const block = [];
        if (listName) block.push(child.replace(/^(\s*)-\s*/, "$1"));
        for (const nested of lines.slice(childIndex + 1)) {
          if (nested.trim() && lineIndent(nested) <= 2) break;
          block.push(nested);
        }
        return normalizeBlock(block, keyedList ? 6 : 4);
      }
    }
  }

  return null;
}

type TestRange =
  | { start: number; end: number; mode: "top" }
  | { start: number; end: number; mode: "tests-map" }
  | { start: number; end: number; mode: "tests-list-name" | "tests-list-key" };

function findTestRange(contents: string, testName: string): TestRange | null {
  const lines = contents.split("\n").map((line) => line.replace(/\t/g, "  "));
  const target = stripQuotes(testName);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const pair = yamlPair(trimmed);
    if (lineIndent(line) === 0 && pair?.key === target) {
      let end = index + 1;
      while (end < lines.length && (!lines[end].trim() || lineIndent(lines[end]) > 0)) end += 1;
      return { start: index, end, mode: "top" };
    }

    if (lineIndent(line) === 0 && (pair?.key === "tests" || pair?.key === "test")) {
      for (let childIndex = index + 1; childIndex < lines.length; childIndex += 1) {
        const child = lines[childIndex];
        if (child.trim() && lineIndent(child) === 0) break;
        if (lineIndent(child) !== 2) continue;

        const childTrimmed = child.trim();
        const listName = childTrimmed.match(/^-\s*name:\s*(.+)$/);
        const keyedList = childTrimmed.match(/^-\s*([^:]+):\s*$/);
        const mapEntry = yamlPair(childTrimmed);
        const foundName = listName?.[1] ?? keyedList?.[1] ?? (!childTrimmed.startsWith("-") ? mapEntry?.key : "");
        if (stripQuotes(foundName || "") !== target) continue;

        let end = childIndex + 1;
        while (end < lines.length && (!lines[end].trim() || lineIndent(lines[end]) > 2)) end += 1;
        if (listName) return { start: childIndex, end, mode: "tests-list-name" };
        if (keyedList) return { start: childIndex, end, mode: "tests-list-key" };
        return { start: childIndex, end, mode: "tests-map" };
      }
    }
  }

  return null;
}

const addIndent = (line: string, spaces: number) => `${" ".repeat(spaces)}${line}`;

export function replaceTestDraft(contents: string, originalTestName: string, draft: TestDraft) {
  const range = findTestRange(contents, originalTestName);
  if (!range) return null;

  const lines = contents.split("\n");
  const draftLines = buildTestYaml(draft).trimEnd().split("\n");
  let replacement: string[];

  if (range.mode === "top") {
    replacement = draftLines;
  } else if (range.mode === "tests-list-name") {
    replacement = [
      `  - name: ${draft.testName.trim() || "new-api-test"}`,
      ...draftLines.slice(1).map((line) => addIndent(line, 2)),
    ];
  } else if (range.mode === "tests-list-key") {
    replacement = [
      `  - ${draft.testName.trim() || "new-api-test"}:`,
      ...draftLines.slice(1).map((line) => addIndent(line, 4)),
    ];
  } else {
    replacement = draftLines.map((line) => addIndent(line, 2));
  }

  return `${[...lines.slice(0, range.start), ...replacement, ...lines.slice(range.end)].join("\n").trimEnd()}\n`;
}

function readNestedBlock(lines: string[], startIndex: number, baseIndent: number) {
  const block = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim() && lineIndent(line) <= baseIndent) break;
    block.push(lineIndent(line) >= baseIndent + 2 ? line.slice(baseIndent + 2) : line);
  }
  return block.join("\n").trim();
}

function parseHeaderBlock(lines: string[], startIndex: number, baseIndent: number) {
  const headers = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim() && lineIndent(line) <= baseIndent) break;
    if (lineIndent(line) !== baseIndent + 2) continue;
    const pair = yamlPair(line.trim());
    if (pair) headers.push({ id: crypto.randomUUID(), name: pair.key, value: pair.value });
  }
  return headers;
}

function parseStep(lines: string[]): StepDraft {
  const first = yamlPair(lines[0]?.trim().replace(/^-\s*/, "") || "");
  if (first?.key === "step-set") {
    return stepDraft({ type: "reference", referenceName: first.value });
  }

  const step = stepDraft();
  if (first?.key === "path") step.path = first.value;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (lineIndent(line) !== 4) continue;
    const pair = yamlPair(line.trim());
    if (!pair) continue;

    if (pair.key === "id") step.stepId = pair.value;
    if (pair.key === "method") step.method = pair.value || "GET";
    if (pair.key === "url") step.url = pair.value;
    if (pair.key === "wait-before") step.waitBefore = pair.value;
    if (pair.key === "wait-after") step.waitAfter = pair.value;
    if (pair.key === "retry") step.retry = pair.value;
    if (pair.key === "path") step.path = pair.value;
    if (pair.key === "headers") step.headers = parseHeaderBlock(lines, index, 4);
    if (pair.key === "data") step.body = readNestedBlock(lines, index, 4);
    if (pair.key === "assert") {
      for (let assertIndex = index + 1; assertIndex < lines.length; assertIndex += 1) {
        const assertLine = lines[assertIndex];
        if (assertLine.trim() && lineIndent(assertLine) <= 4) break;
        if (lineIndent(assertLine) !== 6) continue;
        const assertPair = yamlPair(assertLine.trim());
        if (!assertPair) continue;
        if (assertPair.key === "status-code") step.statusCode = assertPair.value;
        if (assertPair.key === "headers") step.assertionHeaders = parseHeaderBlock(lines, assertIndex, 6);
        if (assertPair.key === "body") step.responseBody = readNestedBlock(lines, assertIndex, 6);
      }
    }
  }

  return step;
}

export function parseTestDraft(contents: string, testName: string): TestDraft | null {
  const block = findTestBlock(contents, testName);
  if (!block) return null;

  const draft: TestDraft = {
    testName,
    setupName: "",
    cleanupName: "",
    steps: [],
  };

  for (let index = 0; index < block.length; index += 1) {
    const line = block[index];
    if (lineIndent(line) !== 0) continue;
    const pair = yamlPair(line.trim());
    if (!pair) continue;

    if (pair.key === "setup") draft.setupName = pair.value;
    if (pair.key === "cleanup" || pair.key === "teardown") draft.cleanupName = pair.value;
    if (pair.key === "steps") {
      for (let stepIndex = index + 1; stepIndex < block.length; stepIndex += 1) {
        const stepLine = block[stepIndex];
        if (stepLine.trim() && lineIndent(stepLine) === 0) break;
        if (lineIndent(stepLine) !== 2 || !stepLine.trim().startsWith("-")) continue;

        const stepLines = [stepLine];
        for (const nested of block.slice(stepIndex + 1)) {
          if (nested.trim() && lineIndent(nested) <= 2) break;
          stepLines.push(nested);
        }
        draft.steps.push(parseStep(stepLines));
      }
    }
  }

  if (draft.steps.length === 0) draft.steps.push(stepDraft({ path: "/health", statusCode: "200" }));
  return draft;
}

export function parseConfigDraft(contents: string): ConfigDraft {
  const lines = contents.split("\n").map((line) => line.replace(/\t/g, "  "));
  const config: ConfigDraft = { vars: [], urls: [], stepSets: [] };
  let section = "";
  let currentVar: ConfigDraft["vars"][number] | null = null;
  let currentStepSet: ConfigDraft["stepSets"][number] | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const pair = yamlPair(trimmed);
    if (!pair) continue;

    if (lineIndent(line) === 0) {
      section = pair.key;
      currentVar = null;
      currentStepSet = null;
      continue;
    }

    if (section === "vars" && lineIndent(line) === 2) {
      currentVar = {
        id: crypto.randomUUID(),
        name: pair.key,
        env: "",
        defaultValue: pair.value,
      };
      config.vars.push(currentVar);
      continue;
    }

    if (section === "vars" && currentVar && lineIndent(line) === 4) {
      if (pair.key === "env") currentVar.env = pair.value;
      if (pair.key === "default") currentVar.defaultValue = pair.value;
      continue;
    }

    if (section === "urls" && lineIndent(line) === 2) {
      config.urls.push({ id: crypto.randomUUID(), name: pair.key, value: pair.value });
      continue;
    }

    if (section === "step-sets" && lineIndent(line) === 2) {
      currentStepSet = {
        id: crypto.randomUUID(),
        name: pair.key,
        once: false,
        collapsed: false,
        steps: [],
        outputs: [],
      };
      config.stepSets.push(currentStepSet);
      continue;
    }

    if (section === "step-sets" && currentStepSet && lineIndent(line) === 4) {
      if (pair.key === "once") {
        currentStepSet.once = pair.value === "true";
        continue;
      }

      if (pair.key === "steps") {
        for (let stepIndex = index + 1; stepIndex < lines.length; stepIndex += 1) {
          const stepLine = lines[stepIndex];
          if (stepLine.trim() && lineIndent(stepLine) <= 4) break;
          if (lineIndent(stepLine) !== 6 || !stepLine.trim().startsWith("-")) continue;

          const stepLines = [stepLine.slice(4)];
          for (const nested of lines.slice(stepIndex + 1)) {
            if (nested.trim() && lineIndent(nested) <= 6) break;
            stepLines.push(lineIndent(nested) >= 4 ? nested.slice(4) : nested);
          }
          currentStepSet.steps.push(parseStep(stepLines));
        }
        continue;
      }

      if (pair.key === "output") {
        for (const outputLine of lines.slice(index + 1)) {
          if (outputLine.trim() && lineIndent(outputLine) <= 4) break;
          if (lineIndent(outputLine) !== 6) continue;
          const outputPair = yamlPair(outputLine.trim());
          if (outputPair) {
            currentStepSet.outputs.push({
              id: crypto.randomUUID(),
              name: outputPair.key,
              value: outputPair.value,
            });
          }
        }
      }
    }
  }

  return config;
}

function stepYamlLines(step: StepDraft, baseIndent: number) {
  const lines: string[] = [];
  const spaces = " ".repeat(baseIndent);

  if (step.type === "reference") {
    lines.push(`${spaces}- step-set: ${step.referenceName.trim()}`);
    return lines;
  }

  lines.push(`${spaces}- path: ${yamlValue(step.path)}`);
  if (step.stepId.trim()) lines.push(`${spaces}  id: ${step.stepId.trim()}`);
  lines.push(`${spaces}  method: ${step.method || "GET"}`);
  if (step.url.trim()) lines.push(`${spaces}  url: ${yamlValue(step.url)}`);
  if (step.waitBefore.trim()) lines.push(`${spaces}  wait-before: ${step.waitBefore.trim()}`);
  if (step.waitAfter.trim()) lines.push(`${spaces}  wait-after: ${step.waitAfter.trim()}`);
  if (step.retry.trim()) lines.push(`${spaces}  retry: ${step.retry.trim()}`);

  const headers = step.headers.filter((header) => header.name.trim() || header.value.trim());
  if (headers.length > 0) {
    lines.push(`${spaces}  headers:`);
    for (const header of headers) {
      if (header.name.trim()) lines.push(`${spaces}    ${header.name.trim()}: ${yamlValue(header.value)}`);
    }
  }

  if (step.body.trim()) lines.push(`${spaces}  data:`, indent(step.body.trim(), baseIndent + 4));

  const assertionHeaders = step.assertionHeaders.filter(
    (header) => header.name.trim() || header.value.trim(),
  );
  const hasAssertions = step.statusCode.trim() || assertionHeaders.length > 0 || step.responseBody.trim();
  if (hasAssertions) {
    lines.push(`${spaces}  assert:`);
    if (step.statusCode.trim()) lines.push(`${spaces}    status-code: ${step.statusCode.trim()}`);
    if (assertionHeaders.length > 0) {
      lines.push(`${spaces}    headers:`);
      for (const header of assertionHeaders) {
        if (header.name.trim()) lines.push(`${spaces}      ${header.name.trim()}: ${yamlValue(header.value)}`);
      }
    }
    if (step.responseBody.trim()) lines.push(`${spaces}    body:`, indent(step.responseBody.trim(), baseIndent + 6));
  }

  return lines;
}

export function buildConfigYaml(config: ConfigDraft) {
  const lines: string[] = [];
  const vars = config.vars.filter((item) => item.name.trim());
  const urls = config.urls.filter((item) => item.name.trim());
  const stepSets = config.stepSets.filter((item) => item.name.trim());

  if (vars.length > 0) {
    lines.push("vars:");
    for (const variable of vars) {
      if (variable.env.trim()) {
        lines.push(`  ${variable.name.trim()}:`, `    env: ${yamlValue(variable.env)}`);
        if (variable.defaultValue.trim()) lines.push(`    default: ${yamlValue(variable.defaultValue)}`);
      } else {
        lines.push(`  ${variable.name.trim()}: ${yamlValue(variable.defaultValue)}`);
      }
    }
    lines.push("");
  }

  if (urls.length > 0) {
    lines.push("urls:");
    for (const url of urls) lines.push(`  ${url.name.trim()}: ${yamlValue(url.value)}`);
    lines.push("");
  }

  if (stepSets.length > 0) {
    lines.push("step-sets:");
    for (const stepSet of stepSets) {
      lines.push(`  ${stepSet.name.trim()}:`);
      if (stepSet.once) lines.push("    once: true");
      lines.push("    steps:");
      const valid = validSteps(stepSet.steps);
      for (const step of valid.length ? valid : [stepDraft({ path: "/health", statusCode: "200" })]) {
        lines.push(...stepYamlLines(step, 6));
      }
      const outputs = stepSet.outputs.filter((output) => output.name.trim() || output.value.trim());
      if (outputs.length > 0) {
        lines.push("    output:");
        for (const output of outputs) {
          if (output.name.trim()) lines.push(`      ${output.name.trim()}: ${yamlValue(output.value)}`);
        }
      }
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
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
  let inStepSetOutput = false;

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = lineIndent(line);
    const pair = yamlPair(trimmed);
    if (!pair) continue;

    if (indent === 0) {
      section = pair.key;
      currentStepSet = "";
      inStepSetOutput = false;
      continue;
    }

    if (section === "vars" && indent === 2) {
      catalog.vars.push(`$vars.${pair.key}`);
      continue;
    }

    if (section === "urls" && indent === 2) {
      catalog.urls.push(`$urls.${pair.key}`);
      continue;
    }

    if (section === "step-sets" && indent === 2) {
      currentStepSet = pair.key;
      inStepSetOutput = false;
      catalog.stepSets.push(currentStepSet);
      continue;
    }

    if (section === "step-sets" && currentStepSet && indent === 4) {
      inStepSetOutput = pair.key === "output";
      continue;
    }

    if (section === "step-sets" && currentStepSet && inStepSetOutput && indent === 6) {
      catalog.outputs.push(`$${currentStepSet}.${pair.key}`);
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
