import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { ConfigService } from "@nestjs/config";

class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      "DATABASE_URL is missing. Configure it in your environment before starting the backend."
    );
    this.name = "MissingDatabaseUrlError";
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService) {
    const connectionString = configService.get<string>("DATABASE_URL");
    if (!connectionString) {
      throw new MissingDatabaseUrlError();
    }

    super({
      adapter: new PrismaPg(new Pool({ connectionString })),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
