export type FileEntry = {
  relative_path: string;
  name: string;
  kind: "config" | "test";
  size: number;
};

export type RunResult = {
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
};

export type GitStatus = {
  available: boolean;
  output: string;
};

export type HeaderRow = {
  id: string;
  name: string;
  value: string;
};

export type StepDraft = {
  uid: string;
  type: "request" | "reference";
  referenceName: string;
  collapsed: boolean;
  headersCollapsed: boolean;
  bodyCollapsed: boolean;
  assertionsCollapsed: boolean;
  path: string;
  method: string;
  stepId: string;
  headers: HeaderRow[];
  body: string;
  statusCode: string;
  assertionHeaders: HeaderRow[];
  responseBody: string;
};

export type TestDraft = {
  testName: string;
  setupName: string;
  cleanupName: string;
  steps: StepDraft[];
};

export type ReferenceCatalog = {
  vars: string[];
  urls: string[];
  stepSets: string[];
  outputs: string[];
};
