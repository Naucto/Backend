import { HttpException, Injectable, Logger } from "@nestjs/common";
import { Response } from "express";
import { DownloadedFile } from "@s3/s3.interface";
import { S3DownloadException } from "@s3/s3.error";

export interface DownloadOptions {
  filename?: string;
  headers?: Record<string, string | undefined>;
}

@Injectable()
export class DownloadService {
  private readonly logger = new Logger(DownloadService.name);

  async send(
    res: Response,
    load: () => Promise<DownloadedFile & DownloadOptions>,
    context: string
  ): Promise<void> {
    try {
      const file = await load();
      for (const [name, value] of Object.entries(file.headers ?? {})) {
        if (value !== undefined) res.setHeader(name, value);
      }
      res.attachment(file.filename ?? "project-content.bin");
      // Uploaded MIME types and filename extensions must not activate content on the API origin.
      res.set({
        "Content-Type": "application/octet-stream",
        "X-Content-Type-Options": "nosniff"
      });
      if (file.contentLength !== undefined) {
        res.setHeader("Content-Length", String(file.contentLength));
      }
      file.body.once("error", (error) => this.fail(res, error, context));
      res.once("close", () => file.body.destroy());
      file.body.pipe(res);
    } catch (error) {
      this.fail(res, error, context);
    }
  }

  private fail(res: Response, error: unknown, context: string): void {
    const status = error instanceof S3DownloadException ? 404
      : error instanceof HttpException ? error.getStatus() : 500;
    if (status >= 500) this.logger.error(context, error instanceof Error ? error.stack : undefined);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.removeHeader("Content-Length");
    res.removeHeader("Content-Disposition");
    res.status(status).json({ message: status === 404 ? "File not found" : "Download failed" });
  }
}
