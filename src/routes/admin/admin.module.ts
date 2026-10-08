import { Module } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { AdminAccountController } from './admin-account.controller';
import { AdminAccountService } from './admin-account.service';
import { AdminAuthController } from './admin-auth.controller';
import { AdminSessionService } from './admin-session.service';
import { TwoFactorService } from './two-factor.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminAuthController, AdminAccountController],
  providers: [AdminSessionService, AdminAccountService, TwoFactorService],
})
export class AdminModule {}
