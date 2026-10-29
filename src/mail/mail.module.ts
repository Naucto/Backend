import { Module } from '@nestjs/common';
import { I18nModule } from 'nestjs-i18n';

import { MailService } from './mail.service';
import { MAIL_I18N_OPTIONS } from './mail-i18n';
import { MailRenderer } from './mail-renderer.service';

/** Imported by every module that sends mail; Nest builds the one transport they all share. */
@Module({
  imports: [I18nModule.forRoot(MAIL_I18N_OPTIONS)],
  providers: [MailService, MailRenderer],
  exports: [MailService, MailRenderer],
})
export class MailModule {}
