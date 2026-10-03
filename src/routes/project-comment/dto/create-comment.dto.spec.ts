import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { CreateCommentDto } from "./create-comment.dto";

function violations(content: unknown): string[] {
  const dto = plainToInstance(CreateCommentDto, { content });
  return validateSync(dto).flatMap((error) =>
    Object.keys(error.constraints ?? {})
  );
}

describe("CreateCommentDto", () => {
  it("accepts a paragraph break", () => {
    expect(violations("first\n\nsecond")).toEqual([]);
  });

  it("refuses three line breaks in a row", () => {
    expect(violations("a\n\n\nb")).toEqual(["matches"]);
  });

  it("refuses three line breaks in a row below the first line", () => {
    expect(violations("a\nb\n\n\nc")).toEqual(["matches"]);
  });

  it("counts a Windows line ending as one line break", () => {
    expect(violations("a\r\n\r\nb")).toEqual([]);
    expect(violations("a\nb\r\n\r\n\r\nc")).toEqual(["matches"]);
  });

  it("refuses more line breaks than a comment may hold", () => {
    expect(violations("a\n".repeat(11))).toEqual(["hasMaxLineBreaks"]);
  });

  it("refuses an empty comment", () => {
    expect(violations("")).toEqual(["minLength"]);
  });
});
