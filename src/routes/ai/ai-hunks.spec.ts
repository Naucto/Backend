import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "@jest/globals";
import * as Y from "yjs";
import { currentText, narrowCodeOperation } from "./ai-hunks";

describe("narrowCodeOperation", () => {
  const before = ["local M = {}", "function start()", "end", "", "function stop()", "end"].join("\n");
  const after = ["local M = {}", "function start()", "  M.run = true", "end", "", "function stop()", "  M.run = false", "end"].join("\n");

  it("reduces a whole-file replacement to the lines chosen", () => {
    // The assistant added a line inside start(). The person wants that, not the one it also added
    // to stop(), so accepting the change wholesale was not an option they had.
    const narrowed = narrowCodeOperation({ kind: "code", fileId: "main", before, after }, { fileId: "main", from: 2, to: 3 }, before);
    // A whole file with the chosen region changed, which is what a `code` commit applies.
    expect(narrowed.before).toBe(before);
    expect(narrowed.after).toBe(
      ["local M = {}", "function start()", "  M.run = true", "end", "", "function stop()", "end"].join("\n"),
    );
  });

  it("changes the block it was aimed at, when the file holds two identical ones", () => {
    // Two blocks with the same body. A `code` operation is validated by exact text, so a hunk whose
    // `before` appears twice could rewrite the wrong one — and nothing downstream would say so, since
    // the text it replaced is genuinely there. The unchanged text on either side is what pins it.
    const before2 = ["f()", "x = 1", "end", "", "f()", "x = 1", "end"].join("\n");
    const after2 = ["f()", "x = 1", "y = 9", "end", "", "f()", "x = 1", "end"].join("\n");
    const narrowed = narrowCodeOperation({ kind: "code", fileId: "m", before: before2, after: after2 }, { fileId: "m", from: 2, to: 3 }, before2);

    // The first block changed and the second, identical one did not.
    expect(narrowed.before).toBe(before2);
    expect(narrowed.after).toBe(after2);
  });

  it("refuses a range that is not in the file as it is now, rather than guessing", () => {
    // A wrong `before` would be caught at commit, but as a "code changed" conflict, which reads as
    // somebody else's edit rather than as the person picking a line that is not there.
    expect(() => narrowCodeOperation({ kind: "code", fileId: "main", before, after }, { fileId: "main", from: 2, to: 3 }, "something else entirely")).toThrow(ConflictException);
  });

  it("refuses a range in a change that changes nothing", () => {
    // A proposal whose replacement is identical to the file has no hunks, so there is nothing a
    // person could be selecting. Refused here, where the range they picked can be named, rather
    // than arriving at commit as a no-op.
    expect(() => narrowCodeOperation({ kind: "code", fileId: "m", before, after: before }, { fileId: "m", from: 2, to: 3 }, before)).toThrow(/no changed lines/);
  });

  it("clamps a range that runs past the end of the proposed text", () => {
    const narrowed = narrowCodeOperation({ kind: "code", fileId: "main", before, after }, { fileId: "main", from: 0, to: 99 }, before);
    expect(narrowed.after.length).toBeGreaterThan(0);
  });
});

describe("currentText", () => {
  it("reads a file out of a document, and says so when it is not there", () => {
    const doc = new Y.Doc();
    const file = new Y.Map<Y.Text>();
    const text = new Y.Text("print(1)");
    doc.transact(() => {
      doc.getMap<Y.Map<Y.Text>>("code.files").set("main", file);
      file.set("text", text);
    });
    expect(currentText(doc, "main")).toBe("print(1)");
    expect(currentText(doc, "absent")).toBeNull();
    doc.destroy();
  });
});
