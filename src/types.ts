export type FileEntry = {
  relative_path: string;
  name: string;
  kind: "config" | "test";
  size: number;
  tests: string[];
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
  optionsCollapsed: boolean;
  url: string;
  waitBefore: string;
  waitAfter: string;
  retry: string;
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

export type VariableDraft = {
  id: string;
  name: string;
  env: string;
  defaultValue: string;
};

export type UrlDraft = {
  id: string;
  name: string;
  value: string;
};

export type OutputDraft = {
  id: string;
  name: string;
  value: string;
};

export type StepSetDraft = {
  id: string;
  name: string;
  once: boolean;
  collapsed: boolean;
  steps: StepDraft[];
  outputs: OutputDraft[];
};

export type ConfigDraft = {
  vars: VariableDraft[];
  urls: UrlDraft[];
  stepSets: StepSetDraft[];
};

export type ReferenceCatalog = {
  vars: string[];
  urls: string[];
  stepSets: string[];
  outputs: string[];
};
