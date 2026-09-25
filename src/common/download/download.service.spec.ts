import express from "express";
import request from "supertest";
import { Readable } from "node:stream";
import { NotFoundException } from "@nestjs/common";
import { S3DownloadException } from "@s3/s3.error";
import { DownloadService } from "./download.service";

describe("DownloadService", () => {
  const service = new DownloadService();

  it("streams unknown-length content with inert headers even for an HTML filename", async () => {
    const app = express();
    app.get("/file", (_req, res) => service.send(res, async () => ({
      body: Readable.from([Buffer.from("<script>alert(1)</script>")]),
      contentType: "text/html",
      filename: "checkpoint.html"
    }), "test"));
    const response = await request(app).get("/file").expect(200);
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["content-disposition"]).toContain("attachment;");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.body.toString()).toBe("<script>alert(1)</script>");
  });

  it.each([new S3DownloadException("test", "missing"), new NotFoundException()])(
    "preserves a missing resource as a 404", async (error) => {
      const app = express();
      app.get("/file", (_req, res) => service.send(res, async () => { throw error; }, "test"));
      await request(app).get("/file").expect(404, { message: "File not found" });
    }
  );
});
