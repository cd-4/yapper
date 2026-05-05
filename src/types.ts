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

export type RequestDraft = {
  testName: string;
  path: string;
  method: string;
  stepId: string;
  headers: string;
  body: string;
  statusCode: string;
};
