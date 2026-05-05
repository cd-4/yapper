import type { RequestDraft } from "./types";

const indent = (value: string, spaces: number) =>
  value
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n");

const parsePairs = (value: string) => {
  const rows = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length === 0) return "";

  return rows
    .map((row) => {
      const splitAt = row.indexOf(":");
      if (splitAt === -1) return `    ${row}: ""`;
      const key = row.slice(0, splitAt).trim();
      const raw = row.slice(splitAt + 1).trim();
      return `    ${key}: ${raw || '""'}`;
    })
    .join("\n");
};

export function buildTestYaml(draft: RequestDraft) {
  const testName = draft.testName.trim() || "new-api-test";
  const method = draft.method || "GET";
  const stepId = draft.stepId.trim();
  const statusCode = draft.statusCode.trim();
  const path = draft.path.trim() || "/";
  const headers = parsePairs(draft.headers);
  const body = draft.body.trim();

  const lines = [
    `${testName}:`,
    "  steps:",
    `    - path: ${path}`,
    `      method: ${method}`,
  ];

  if (stepId) lines.push(`      id: ${stepId}`);
  if (headers) lines.push("      headers:", indent(headers, 6));
  if (body) lines.push("      data:", indent(body, 8));
  if (statusCode) lines.push("      assert:", `        status-code: ${statusCode}`);

  return `${lines.join("\n")}\n`;
}

export const sampleConfig = `vars:
  base-url: https://api.example.com
  api-token: replace-me

urls:
  api: $base-url

step-sets:
  create-user:
    - path: /api/users
      method: POST
      headers:
        Authorization: Bearer $api-token
      data:
        name: Test User
      assert:
        status-code: 201
`;
