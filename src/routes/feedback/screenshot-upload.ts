import { applyDecorators, HttpStatus, ParseFilePipeBuilder, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiResponse } from '@nestjs/swagger';

export const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const SCREENSHOT_TYPES = /^image\/(png|jpeg|webp)$/;

/**
 * A route taking an optional `screenshot` file next to its form fields. Multer stops reading at the
 * limit and answers 413 itself, before any pipe runs.
 */
export function ScreenshotUpload(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseInterceptors(
      FileInterceptor('screenshot', { limits: { fileSize: SCREENSHOT_MAX_BYTES, files: 1 } }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiResponse({ status: 413, description: 'Screenshot larger than 2 MB' }),
    ApiResponse({ status: 422, description: 'Screenshot is not a PNG, JPEG or WebP image' }),
  );
}

/** The screenshot is stored and served under its declared type, so both it and the content count. */
export const OPTIONAL_SCREENSHOT = new ParseFilePipeBuilder()
  .addMaxSizeValidator({ maxSize: SCREENSHOT_MAX_BYTES })
  .addFileTypeValidator({ fileType: SCREENSHOT_TYPES })
  .addFileTypeValidator({ fileType: SCREENSHOT_TYPES, skipMagicNumbersValidation: true })
  .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY, fileIsRequired: false });
