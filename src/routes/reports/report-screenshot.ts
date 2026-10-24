import { applyDecorators, HttpStatus, ParseFilePipeBuilder, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiResponse } from '@nestjs/swagger';

export const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const SCREENSHOT_TYPES = /^image\/(png|jpeg|webp)$/;
/** A screenshot belongs with the report it was taken for, so it is taken only soon after. */
export const SCREENSHOT_WINDOW_MS = 60 * 60 * 1000;

const SCREENSHOT_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const screenshotKey = (reportId: number, mime: string): string =>
  `reports/${reportId}/screenshot.${SCREENSHOT_EXTENSIONS[mime] ?? 'bin'}`;

/**
 * A route taking one `screenshot` file. Multer stops reading at the limit and answers 413 itself,
 * before any pipe runs.
 */
export function ScreenshotUpload(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseInterceptors(
      FileInterceptor('screenshot', { limits: { fileSize: SCREENSHOT_MAX_BYTES, files: 1 } }),
    ),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['screenshot'],
        properties: {
          screenshot: { type: 'string', format: 'binary', description: 'PNG, JPEG or WebP, 2 MB' },
        },
      },
    }),
    ApiResponse({ status: HttpStatus.PAYLOAD_TOO_LARGE, description: 'Larger than 2 MB' }),
    ApiResponse({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      description: 'Not a PNG, JPEG or WebP image',
    }),
  );
}

/** The screenshot is stored and served under its declared type, so both it and the content count. */
export const SCREENSHOT_FILE = new ParseFilePipeBuilder()
  .addMaxSizeValidator({ maxSize: SCREENSHOT_MAX_BYTES })
  .addFileTypeValidator({ fileType: SCREENSHOT_TYPES })
  .addFileTypeValidator({ fileType: SCREENSHOT_TYPES, skipMagicNumbersValidation: true })
  .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });
