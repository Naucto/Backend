import { Body, Controller, Module, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter, NestExpressApplication } from "@nestjs/platform-express";
import express from "express";
import { AddressInfo } from "node:net";
import { aiJsonParser } from "./ai-body";

@Controller()
class EchoController {
  @Post("auth/register") echo(@Body() body: unknown): unknown { return body; }
  @Post("ai/big") big(@Body() body: { data: string }): number { return body.data.length; }
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
      expect(await (await post("ai/big", { data: "x".repeat(2 * 1024 * 1024) })).json()).toBe(2 * 1024 * 1024);
    } finally {
      await app.close();
    }
  });
});
