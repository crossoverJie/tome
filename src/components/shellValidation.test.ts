import { describe, it, expect, vi, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { extractShellTokens, shellValidation } from "./shellValidation";
import { shellLanguage } from "./shellLanguage";
import { shellSyntaxHighlighting } from "./shellHighlight";

// ---------------------------------------------------------------------------
// extractShellTokens — direct text parsing
// ---------------------------------------------------------------------------

describe("extractShellTokens", () => {
  it("extracts a simple command", () => {
    const tokens = extractShellTokens("ls");
    expect(tokens).toEqual([{ type: "command", from: 0, to: 2, value: "ls" }]);
  });

  it("extracts command and skips flags", () => {
    const tokens = extractShellTokens("ls -la");
    // -la is a flag, not validated
    expect(tokens).toEqual([{ type: "command", from: 0, to: 2, value: "ls" }]);
  });

  it("extracts a relative path argument", () => {
    const tokens = extractShellTokens("cat ./file.txt");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ type: "command", from: 0, to: 3, value: "cat" });
    expect(tokens[1]).toEqual({ type: "path", from: 4, to: 14, value: "./file.txt" });
  });

  it("extracts a path containing a slash", () => {
    const tokens = extractShellTokens("cat /etc/hosts");
    expect(tokens).toHaveLength(2);
    expect(tokens[1]).toMatchObject({ type: "path", value: "/etc/hosts" });
  });

  it("does not extract shell keywords as commands", () => {
    const tokens = extractShellTokens("if true; then echo ok; fi");
    const types = tokens.map((t) => t.value);
    expect(types).not.toContain("if");
    expect(types).not.toContain("then");
    expect(types).not.toContain("fi");
  });

  it("extracts command after pipe", () => {
    const tokens = extractShellTokens("ls | grep foo");
    const cmds = tokens.filter((t) => t.type === "command").map((t) => t.value);
    expect(cmds).toContain("ls");
    expect(cmds).toContain("grep");
  });

  it("extracts command after semicolon", () => {
    const tokens = extractShellTokens("echo hi; pwd");
    const cmds = tokens.filter((t) => t.type === "command").map((t) => t.value);
    expect(cmds).toContain("echo");
    expect(cmds).toContain("pwd");
  });

  it("extracts command after &&", () => {
    const tokens = extractShellTokens("make && echo done");
    const cmds = tokens.filter((t) => t.type === "command").map((t) => t.value);
    expect(cmds).toContain("make");
    expect(cmds).toContain("echo");
  });

  it("skips double-quoted strings", () => {
    const tokens = extractShellTokens('echo "hello world"');
    expect(tokens).toEqual([{ type: "command", from: 0, to: 4, value: "echo" }]);
  });

  it("skips single-quoted strings", () => {
    const tokens = extractShellTokens("echo 'hello'");
    expect(tokens).toEqual([{ type: "command", from: 0, to: 4, value: "echo" }]);
  });

  it("skips $VAR variables", () => {
    const tokens = extractShellTokens("echo $HOME");
    expect(tokens).toEqual([{ type: "command", from: 0, to: 4, value: "echo" }]);
  });

  it("skips ${VAR} variables", () => {
    const tokens = extractShellTokens("echo ${HOME}");
    expect(tokens).toEqual([{ type: "command", from: 0, to: 4, value: "echo" }]);
  });

  it("skips comments", () => {
    const tokens = extractShellTokens("# this is a comment");
    expect(tokens).toHaveLength(0);
  });

  it("returns empty for whitespace-only input", () => {
    expect(extractShellTokens("")).toHaveLength(0);
    expect(extractShellTokens("   ")).toHaveLength(0);
  });

  it("does not treat plain arguments (no slash, no dot) as paths", () => {
    const tokens = extractShellTokens("ls Documents");
    // "Documents" has no slash and no dot prefix → not a path token
    expect(tokens.filter((t) => t.type === "path")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// shellValidation extension — async decoration logic
// ---------------------------------------------------------------------------

function createTestView(
  text: string,
  checkCmd: (cmd: string) => Promise<boolean>,
  checkPath: (path: string, cwd: string) => Promise<boolean>,
  getCwd: () => string | null = () => "/tmp",
  withHighlighting = false
): EditorView {
  const extensions = [
    ...(withHighlighting ? [shellLanguage, shellSyntaxHighlighting] : []),
    ...shellValidation(checkCmd, checkPath, getCwd),
    EditorView.updateListener.of(() => {}),
  ];
  const state = EditorState.create({ doc: text, extensions });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ state, parent });
}

describe("shellValidation extension", () => {
  let view: EditorView;

  afterEach(() => {
    view?.destroy();
  });

  it("applies cm-error-token decoration for invalid command", async () => {
    const checkCmd = vi.fn().mockResolvedValue(false); // always invalid
    const checkPath = vi.fn().mockResolvedValue(true);

    view = createTestView("pw", checkCmd, checkPath);

    // Wait for the 300ms debounce + async validation to complete
    await new Promise((r) => setTimeout(r, 400));

    // Verify the validation callback was called with the command token
    expect(checkCmd).toHaveBeenCalledWith("pw");
    // The extension should not have thrown
    expect(view.state.doc.toString()).toBe("pw");
    expect(view.dom.innerHTML).toContain("cm-error-token");
  });

  it("still renders error decoration with syntax highlighting enabled", async () => {
    const checkCmd = vi.fn().mockResolvedValue(false);
    const checkPath = vi.fn().mockResolvedValue(true);

    view = createTestView("pw", checkCmd, checkPath, () => "/tmp", true);
    await new Promise((r) => setTimeout(r, 400));

    expect(checkCmd).toHaveBeenCalledWith("pw");
    expect(view.dom.innerHTML).toContain("cm-error-token");
  });

  it("calls checkCmd with the command token value", async () => {
    const checkCmd = vi.fn().mockResolvedValue(true);
    const checkPath = vi.fn().mockResolvedValue(true);

    view = createTestView("git status", checkCmd, checkPath);
    await new Promise((r) => setTimeout(r, 400));

    expect(checkCmd).toHaveBeenCalledWith("git");
    // "status" is a plain argument (no slash/dot), not sent to checkPath
    expect(checkPath).not.toHaveBeenCalled();
  });

  it("calls checkPath for path tokens", async () => {
    const checkCmd = vi.fn().mockResolvedValue(true);
    const checkPath = vi.fn().mockResolvedValue(true);

    view = createTestView("cat ./README.md", checkCmd, checkPath);
    await new Promise((r) => setTimeout(r, 400));

    expect(checkPath).toHaveBeenCalledWith("./README.md", "/tmp");
  });

  it("does not call validation for empty input", async () => {
    const checkCmd = vi.fn().mockResolvedValue(true);
    const checkPath = vi.fn().mockResolvedValue(true);

    view = createTestView("", checkCmd, checkPath);
    await new Promise((r) => setTimeout(r, 400));

    expect(checkCmd).not.toHaveBeenCalled();
    expect(checkPath).not.toHaveBeenCalled();
  });

  it("treats IPC errors as valid (no decoration)", async () => {
    const checkCmd = vi.fn().mockRejectedValue(new Error("IPC unavailable"));
    const checkPath = vi.fn().mockResolvedValue(true);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // Should not throw
      view = createTestView("pw", checkCmd, checkPath);
      await expect(new Promise((r) => setTimeout(r, 400))).resolves.toBeUndefined();

      expect(checkCmd).toHaveBeenCalledWith("pw");
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("does not validate shell keywords", async () => {
    const checkCmd = vi.fn().mockResolvedValue(false);
    const checkPath = vi.fn().mockResolvedValue(true);

    view = createTestView("if true; then echo ok; fi", checkCmd, checkPath);
    await new Promise((r) => setTimeout(r, 400));

    const calledWith = checkCmd.mock.calls.map((c) => c[0]);
    expect(calledWith).not.toContain("if");
    expect(calledWith).not.toContain("then");
    expect(calledWith).not.toContain("fi");
  });
});
