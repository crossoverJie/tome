export interface CompletionItem {
  value: string;
  display: string;
  kind: "command" | "builtin" | "reserved" | "path" | "directory";
}

export interface CompletionResponse {
  replaceFrom: number;
  replaceTo: number;
  commonPrefix: string | null;
  items: CompletionItem[];
}
