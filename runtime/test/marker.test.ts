import { describe, expect, test } from "bun:test";
import { readMarker } from "../src/marker";

describe("readMarker", () => {
  test("present: reads the kind from the marker immediately after the H1", () => {
    const text = [
      "# Issue tracker: GitHub",
      "",
      "<!-- factory:tracker kind=github -->",
      "",
      "Issues and PRDs for this repo live as GitHub issues.",
    ].join("\n");

    expect(readMarker(text)).toEqual({ kind: "github" });
  });

  test("present: linear kind", () => {
    const text = "# Issue tracker: Linear\n\n<!-- factory:tracker kind=linear -->\n";

    expect(readMarker(text)).toEqual({ kind: "linear" });
  });

  test("absent: a doc with no marker at all reports missing-marker", () => {
    const text = "# Issue tracker: GitHub\n\nNo marker here, just prose.\n";

    expect(readMarker(text)).toBe("missing-marker");
  });

  test("absent: an empty file reports missing-marker", () => {
    expect(readMarker("")).toBe("missing-marker");
  });

  test("mangled: a marker with no kind attribute reports missing-marker", () => {
    const text = "# Issue tracker: GitHub\n\n<!-- factory:tracker -->\n";

    expect(readMarker(text)).toBe("missing-marker");
  });

  test("mangled: a marker misspelled by a maintainer edit reports missing-marker", () => {
    const text = "# Issue tracker: GitHub\n\n<!-- factory:tracker knd=github -->\n";

    expect(readMarker(text)).toBe("missing-marker");
  });

  test("survives maintainer prose edits elsewhere in the file", () => {
    const text = [
      "# Issue tracker: GitHub",
      "",
      "<!-- factory:tracker kind=github -->",
      "",
      "A maintainer rewrote this whole paragraph and added a new section",
      "below, but never touched the marker line above.",
      "",
      "## A brand new section a maintainer added",
      "",
      "Some more prose that has nothing to do with the marker.",
    ].join("\n");

    expect(readMarker(text)).toEqual({ kind: "github" });
  });

  test("survives the marker not being the very first line (e.g. a blank line before the H1)", () => {
    const text = "\n# Issue tracker: GitHub\n\n<!-- factory:tracker kind=github -->\n";

    expect(readMarker(text)).toEqual({ kind: "github" });
  });
});
