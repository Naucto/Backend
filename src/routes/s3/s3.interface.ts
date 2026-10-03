import { Readable } from "stream";

export interface DownloadedFile {
  body: Readable;
  contentType?: string;
  contentLength?: number;
}
