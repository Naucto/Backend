import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from "class-validator";

export const COMMENT_MAX_LENGTH = 500;
export const COMMENT_MAX_LINE_BREAKS = 10;
export const COMMENT_MAX_CONSECUTIVE_LINE_BREAKS = 2;

export function normalizeCommentContent(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function hasMaxLineBreaks(
  max: number,
  validationOptions?: ValidationOptions
) {
  return (object: object, propertyName: string): void => {
    registerDecorator({
      name: "hasMaxLineBreaks",
      target: object.constructor,
      propertyName,
      constraints: [max],
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== "string") {
            return false;
          }

          const [maxLineBreaks] = args.constraints as [number];
          return (value.match(/\n/g) ?? []).length <= maxLineBreaks;
        },
      },
      ...(validationOptions ? { options: validationOptions } : {}),
    });
  };
}