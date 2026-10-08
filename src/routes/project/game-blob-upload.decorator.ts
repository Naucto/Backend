import { applyDecorators, HttpStatus, ParseFilePipe, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiResponse } from '@nestjs/swagger';

import { PROJECT_BLOB_MAX_BYTES } from './content-size';

/**
 * A route taking a game document as the multipart `file`. Multer stops reading at the blob limit
 * and answers 413 itself, before any pipe runs, so the size is checked here and nowhere else.
 */
export function GameBlobUpload(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseInterceptors(FileInterceptor('file', { limits: { fileSize: PROJECT_BLOB_MAX_BYTES } })),
    ApiConsumes('multipart/form-data'),
    ApiResponse({ status: 413, description: 'File too large' }),
    ApiResponse({ status: 422, description: 'File validation failed' }),
  );
}

/** The `@UploadedFile()` pipe of a game document: a request without a file is a 422. */
export const REQUIRED_GAME_BLOB = new ParseFilePipe({
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
});
