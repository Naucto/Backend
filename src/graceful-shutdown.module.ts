import { DynamicModule } from '@nestjs/common';
import {
  GracefulShutdownModule,
  IGracefulShutdownConfigOptions,
} from '@tygra/nestjs-graceful-shutdown';

import { WebRTCModule } from './webrtc/webrtc.module';
import { WebRTCService } from './webrtc/webrtc.service';

/** Closes every `WebRTCServer` before Nest lets the process exit. */
export function gracefulShutdownModule(): DynamicModule {
  return GracefulShutdownModule.forRootAsync({
    imports: [WebRTCModule],
    inject: [WebRTCService],
    useFactory: async (webrtcService: WebRTCService): Promise<IGracefulShutdownConfigOptions> => {
      return {
        cleanup: async (): Promise<void> => webrtcService.shutdownAllServers(),
      };
    },
  });
}
