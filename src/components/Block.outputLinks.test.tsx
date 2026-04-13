import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Block } from "./Block";

function renderBlock(props?: Partial<React.ComponentProps<typeof Block>>) {
  return render(
    <Block
      command="echo links"
      output="See https://example.com and src/components/Block.tsx:42"
      exitCode={0}
      startTime={1000}
      endTime={2000}
      isComplete={true}
      isSelected={false}
      isCollapsed={false}
      onClick={vi.fn()}
      onToggleCollapse={vi.fn()}
      {...props}
    />
  );
}

describe("Block output links", () => {
  it("renders detected URLs and file paths as clickable output links", () => {
    renderBlock();

    const outputLinks = document.querySelectorAll("[data-output-link-kind]");
    expect(outputLinks).toHaveLength(2);
    expect(screen.getByText("https://example.com")).toBeTruthy();
    expect(screen.getByText("src/components/Block.tsx:42")).toBeTruthy();
  });

  it("only activates URLs on Cmd+Click", () => {
    const onOutputLinkActivate = vi.fn();
    renderBlock({ onOutputLinkActivate });

    const url = screen.getByText("https://example.com");
    fireEvent.click(url);
    expect(onOutputLinkActivate).not.toHaveBeenCalled();

    fireEvent.click(url, { metaKey: true });
    expect(onOutputLinkActivate).toHaveBeenCalledWith({
      kind: "url",
      target: "https://example.com",
      text: "https://example.com",
      metaKey: true,
    });
  });

  it("activates file paths on regular click", () => {
    const onOutputLinkActivate = vi.fn();
    renderBlock({ onOutputLinkActivate });

    fireEvent.click(screen.getByText("src/components/Block.tsx:42"));

    expect(onOutputLinkActivate).toHaveBeenCalledWith({
      kind: "path",
      target: "src/components/Block.tsx",
      text: "src/components/Block.tsx:42",
      metaKey: false,
    });
  });
});
