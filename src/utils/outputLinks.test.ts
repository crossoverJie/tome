import { describe, expect, it } from "vitest";
import { findOutputLinks } from "./outputLinks";

describe("findOutputLinks", () => {
  it("finds http and https links without trailing punctuation", () => {
    expect(findOutputLinks("Docs: https://example.com/guide, http://localhost:3000/test.")).toEqual(
      [
        {
          kind: "url",
          text: "https://example.com/guide",
          target: "https://example.com/guide",
          start: 6,
          end: 31,
        },
        {
          kind: "url",
          text: "http://localhost:3000/test",
          target: "http://localhost:3000/test",
          start: 33,
          end: 59,
        },
      ]
    );
  });

  it("finds absolute, relative, and repo-relative paths", () => {
    expect(
      findOutputLinks(
        "See /tmp/project/file.txt, ./src/App.tsx, ../README.md, and src/components/Block.tsx:120."
      )
    ).toEqual([
      {
        kind: "path",
        text: "/tmp/project/file.txt",
        target: "/tmp/project/file.txt",
        start: 4,
        end: 25,
      },
      {
        kind: "path",
        text: "./src/App.tsx",
        target: "./src/App.tsx",
        start: 27,
        end: 40,
      },
      {
        kind: "path",
        text: "../README.md",
        target: "../README.md",
        start: 42,
        end: 54,
      },
      {
        kind: "path",
        text: "src/components/Block.tsx:120",
        target: "src/components/Block.tsx",
        start: 60,
        end: 88,
      },
    ]);
  });

  it("does not mistake plain words for links", () => {
    expect(findOutputLinks("status ok and no clickable targets here")).toEqual([]);
  });
});
