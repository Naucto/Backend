import { BadRequestException, Body, Controller, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter, NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import { AddressInfo } from "node:net";
import { aiJsonParser } from "./ai-body";

@Controller()
class EchoController {
  @Post("auth/register") echo(@Body() body: unknown): unknown { return body; }
  @Post("ai/big") big(@Body() body: { data?: unknown }): { length: number } {
    if (typeof body.data !== "string") throw new BadRequestException("data must be a string");
    return { length: body.data.length };
  }
}
@Module({ controllers: [EchoController] })
class EchoModule {}

describe("AI body parser", () => {
  it("takes large AI bodies without taking the body away from every other route", async () => {
    const server = express();
    server.use("/ai", aiJsonParser);
    const app = await NestFactory.create<NestExpressApplication>(EchoModule, new ExpressAdapter(server), { logger: false });
    await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as AddressInfo;
    try {
      const post = (path: string, body: unknown): Promise<Response> => fetch(`http://127.0.0.1:${port}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(await (await post("auth/register", { email: "a@b.c" })).json()).toEqual({ email: "a@b.c" });
      const large = await post("ai/big", { data: "x".repeat(2 * 1024 * 1024) });
      expect(large.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await large.json()).toEqual({ length: 2 * 1024 * 1024 });

      // A nested object must not turn its `length` property into an HTML response.
      const malformed = await post("ai/big", { data: { length: "<script>alert(1)</script>" } });
      expect(malformed.status).toBe(400);
      expect(malformed.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await malformed.text()).not.toContain("<script>");
    } finally {
      await app.close();
    }
  });
});
