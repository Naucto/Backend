import { Transform } from "class-transformer";
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

const COMMENT_MAX_LINE_BREAKS = 10;

function HasMaxLineBreaks(max: number, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string): void => {
    const decoratorOptions = {
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
    };

    registerDecorator(decoratorOptions);
  };
}

export class CreateCommentDto {
  @ApiProperty({
    description: "The content of the comment",
    example: "Great game, love the pixel art!",
    minLength: 1,
    maxLength: 500
  })
  @Transform(({ value }) =>
    typeof value === "string" ? value.replace(/\r\n?/g, "\n") : value
  )
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/^(?!.*\n{3,})[\s\S]*$/, {
    message: "Comment cannot contain more than 2 consecutive line breaks",
  })
  @HasMaxLineBreaks(COMMENT_MAX_LINE_BREAKS, {
    message: "Comment cannot contain more than 10 line breaks",
  })
  content!: string;
}
