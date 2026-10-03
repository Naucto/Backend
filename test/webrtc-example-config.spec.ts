import { readFileSync } from 'node:fs';
import path from 'node:path';

import { TurnCredentialsService } from '../src/webrtc/turn-credentials.service';
import { WebRTCService } from '../src/webrtc/webrtc.service';

describe('config/webrtc.example.json', () => {
  it('is a configuration the service accepts and builds an offer from', () => {
    const service = new WebRTCService({
      current: () => undefined,
    } as unknown as TurnCredentialsService);
    const examplePath = path.resolve(__dirname, '../config/webrtc.example.json');

    const accepted = service.applyConfig(
      JSON.parse(readFileSync(examplePath, 'utf-8')),
      examplePath,
    );

    expect(accepted).toBe(true);
    expect(service.buildOffer('ws://localhost:10000').peerOpts.config.iceServers).not.toHaveLength(
      0,
    );
  });
});
