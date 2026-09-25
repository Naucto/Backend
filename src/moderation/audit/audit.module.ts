import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "@ourPrisma/prisma.module";
import { AuditService } from "./audit.service";
import { AuditController } from "./audit.controller";

/**
 * Global so any feature module can record or read moderation history without
 * threading an import through the graph -- the same reason PrismaModule is.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService]
})
export class AuditModule {}
