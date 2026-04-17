import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { InputEditor } from "./InputEditor";

let mockHistory = ["previous-command", "another-command", "pwd"];

vi.mock("../hooks/useCommandHistory", () => ({
  useCommandHistory: () => ({
    history: mockHistory,
    addCommand: vi.fn(),
  }),
}));

describe("InputEditor", () => {
  const onSubmitMock = vi.fn();
  const requestCompletionMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockHistory = ["previous-command", "another-command", "pwd"];
    requestCompletionMock.mockResolvedValue({
      replaceFrom: 0,
      replaceTo: 0,
      commonPrefix: null,
      items: [],
    });
  });

  async function renderEditor(props = {}) {
    const result = render(
      <InputEditor
        onSubmit={onSubmitMock}
        onRequestCompletion={requestCompletionMock}
        disabled={false}
        {...props}
      />
    );
    await waitFor(() => {
      expect(result.container.querySelector(".cm-editor")).toBeTruthy();
    });
    return result;
  }

  function getEditorView(container: HTMLElement) {
    const editorElement = container.querySelector(".cm-editor");
    expect(editorElement).toBeTruthy();
    const view = EditorView.findFromDOM(editorElement as HTMLElement);
    expect(view).toBeTruthy();
    return view as EditorView;
  }

  function setEditorText(container: HTMLElement, text: string, cursor = text.length) {
    const view = getEditorView(container);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: cursor },
    });
  }

  function keyDown(container: HTMLElement, key: string) {
    const cmContent = container.querySelector(".cm-content") as HTMLElement;
    cmContent.focus();
    cmContent.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: key,
        bubbles: true,
        cancelable: true,
      })
    );
  }

  describe("basic rendering", () => {
    it("renders the editor with prompt", async () => {
      const { container } = await renderEditor();
      expect(container.querySelector(".cm-editor")).toBeTruthy();
      expect(container.querySelector(".input-prompt-bar")).toBeTruthy();
    });

    it("displays git branch in prompt when provided", async () => {
      const { container } = await renderEditor({ gitBranch: "main" });
      const promptBar = container.querySelector(".input-prompt-bar");
      expect(promptBar).toBeTruthy();
      expect(promptBar?.textContent).toContain("main");
    });

    it("does not display git branch when null", async () => {
      const { container } = await renderEditor({ gitBranch: null });
      const promptBar = container.querySelector(".input-prompt-bar");
      expect(promptBar).toBeTruthy();
      // Git branch segment should not be rendered when null
      expect(promptBar?.textContent).not.toContain("🌿");
    });

    it("disables editor when disabled prop is true", async () => {
      const { container } = await renderEditor({ disabled: true });
      expect(container.querySelector(".input-editor.disabled")).toBeTruthy();
    });
  });

  describe("command validation styling", () => {
    it("does not mark known commands as cm-error-token", async () => {
      const { container } = await renderEditor({
        onCheckCommandExists: vi.fn().mockResolvedValue(true),
        onCheckPathExists: vi.fn().mockResolvedValue(true),
      });

      setEditorText(container, "claude");

      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(container.querySelector(".cm-error-token")).toBeFalsy();
    });

    it("marks unknown commands as cm-error-token", async () => {
      const { container } = await renderEditor({
        onCheckCommandExists: vi.fn().mockResolvedValue(false),
        onCheckPathExists: vi.fn().mockResolvedValue(true),
      });

      setEditorText(container, "lsx");

      await waitFor(() => {
        expect(container.querySelector(".cm-error-token")).toBeTruthy();
      });
    });
  });

  describe("completion UI", () => {
    it("shows completion menu when items are returned", async () => {
      requestCompletionMock.mockResolvedValue({
        replaceFrom: 0,
        replaceTo: 3,
        commonPrefix: null,
        items: [
          { value: "status", display: "status", kind: "option" },
          { value: "stash", display: "stash", kind: "option" },
        ],
      });

      const { container } = await renderEditor();
      const cmContent = container.querySelector(".cm-content") as HTMLElement;
      cmContent.focus();
      cmContent.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          code: "Tab",
          bubbles: true,
          cancelable: true,
        })
      );

      await waitFor(() => {
        expect(requestCompletionMock).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(container.querySelector(".completion-menu")).toBeTruthy();
      });

      const items = container.querySelectorAll(".completion-menu-item");
      expect(items.length).toBe(2);
    });
  });

  describe("request completion", () => {
    it("calls onRequestCompletion on Tab", async () => {
      const { container } = await renderEditor();
      const cmContent = container.querySelector(".cm-content") as HTMLElement;
      cmContent.focus();

      cmContent.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
      );

      await waitFor(() => {
        expect(requestCompletionMock).toHaveBeenCalled();
      });
    });
  });

  describe("history behavior", () => {
    it("filters history by prefix on ArrowUp and ArrowDown", async () => {
      const { container } = await renderEditor();

      setEditorText(container, "another");
      keyDown(container, "ArrowUp");

      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("another-command");
      });

      keyDown(container, "ArrowDown");

      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("another");
      });
    });

    it("browses full history continuously when ArrowUp starts from empty input", async () => {
      const { container } = await renderEditor();

      keyDown(container, "ArrowUp");

      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("pwd");
      });

      keyDown(container, "ArrowUp");

      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("another-command");
      });

      keyDown(container, "ArrowUp");

      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("previous-command");
      });
    });

    it("returns to the original empty input when browsing history back down", async () => {
      const { container } = await renderEditor();

      keyDown(container, "ArrowUp");
      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("pwd");
      });

      keyDown(container, "ArrowUp");
      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("another-command");
      });

      keyDown(container, "ArrowDown");
      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("pwd");
      });

      keyDown(container, "ArrowDown");
      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("");
      });
    });
  });

  describe("inline history suggestion", () => {
    it("accepts the inline history suggestion with ArrowRight at the line end", async () => {
      const { container } = await renderEditor();

      setEditorText(container, "another");

      await waitFor(() => {
        expect(container.querySelector(".input-inline-suggestion")).toBeTruthy();
      });

      keyDown(container, "ArrowRight");

      await waitFor(() => {
        expect(getEditorView(container).state.doc.toString()).toBe("another-command");
      });
    });

    it("refreshes the inline suggestion when history updates without editing the input", async () => {
      mockHistory = ["pwd"];
      const result = await renderEditor();

      setEditorText(result.container, "ls");

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(result.container.querySelector(".input-inline-suggestion")).toBeFalsy();

      mockHistory = ["pwd", "ls -lrth"];
      result.rerender(
        <InputEditor
          onSubmit={onSubmitMock}
          onRequestCompletion={requestCompletionMock}
          disabled={false}
        />
      );

      await waitFor(() => {
        expect(result.container.querySelector(".input-inline-suggestion")).toBeTruthy();
      });
    });
  });

  describe("submit behavior", () => {
    it("calls onSubmit when Enter is pressed", async () => {
      const { container } = await renderEditor();
      const cmContent = container.querySelector(".cm-content") as HTMLElement;
      cmContent.focus();

      cmContent.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onSubmitMock).toHaveBeenCalled();
    });

    it("keeps the same editor instance across callback updates and uses the latest submit handler", async () => {
      const firstSubmit = vi.fn();
      const secondSubmit = vi.fn();
      const secondRequestCompletion = vi.fn().mockResolvedValue({
        replaceFrom: 0,
        replaceTo: 0,
        commonPrefix: null,
        items: [],
      });

      const result = render(
        <InputEditor
          onSubmit={firstSubmit}
          onRequestCompletion={requestCompletionMock}
          disabled={false}
        />
      );

      await waitFor(() => {
        expect(result.container.querySelector(".cm-editor")).toBeTruthy();
      });

      const initialEditor = result.container.querySelector(".cm-editor");

      result.rerender(
        <InputEditor
          onSubmit={secondSubmit}
          onRequestCompletion={secondRequestCompletion}
          disabled={false}
        />
      );

      await waitFor(() => {
        expect(result.container.querySelector(".cm-editor")).toBe(initialEditor);
      });

      const cmContent = result.container.querySelector(".cm-content") as HTMLElement;
      cmContent.focus();
      cmContent.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(firstSubmit).not.toHaveBeenCalled();
      expect(secondSubmit).toHaveBeenCalled();
    });

    it("does not submit while disabled", async () => {
      const { container } = await renderEditor({ disabled: true });
      const cmContent = container.querySelector(".cm-content") as HTMLElement;
      cmContent.focus();

      cmContent.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true,
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(onSubmitMock).not.toHaveBeenCalled();
    });
  });

  describe("busy state", () => {
    it("renders busy indicator when busy prop is true", async () => {
      const { container } = await renderEditor({ busy: true });
      const busyIndicator = container.querySelector(".input-busy-indicator");
      expect(busyIndicator).toBeTruthy();
      expect(busyIndicator?.textContent).toContain("Command running...");
    });

    it("does not render busy indicator when busy prop is false", async () => {
      const { container } = await renderEditor({ busy: false });
      const busyIndicator = container.querySelector(".input-busy-indicator");
      expect(busyIndicator).toBeFalsy();
    });

    it("adds busy class to input-editor when busy", async () => {
      const { container } = await renderEditor({ busy: true });
      const editor = container.querySelector(".input-editor");
      expect(editor?.classList.contains("busy")).toBe(true);
    });
  });
});
