import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';

import { withEnv } from '../../../test/env';
import { MicrosoftAuthService } from './microsoft-auth.service';

const FULL_CONFIG = {
  MICROSOFT_CLIENT_ID: 'client-id',
  MICROSOFT_TENANT_ID: 'tenant-id',
};

const KEY_ID = 'signing-key';
const ISSUER = `https://login.microsoftonline.com/${FULL_CONFIG.MICROSOFT_TENANT_ID}/v2.0`;

describe('MicrosoftAuthService', () => {
  it('disables itself (no throw) when configuration is missing', async () => {
    withEnv({ MICROSOFT_CLIENT_ID: undefined, MICROSOFT_TENANT_ID: undefined });
    const service = new MicrosoftAuthService();

    expect(service.isAvailable).toBe(false);
    await expect(service.authenticate('id-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('is available when fully configured', () => {
    withEnv(FULL_CONFIG);
    expect(new MicrosoftAuthService().isAvailable).toBe(true);
  });

  describe('authenticate', () => {
    const tenantKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicPem = tenantKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const idToken = (
      claims: Record<string, unknown>,
      options: jwt.SignOptions = {},
      signingKey = tenantKey.privateKey,
    ): string =>
      jwt.sign(claims, signingKey, {
        algorithm: 'RS256',
        keyid: KEY_ID,
        audience: FULL_CONFIG.MICROSOFT_CLIENT_ID,
        issuer: ISSUER,
        ...options,
      });

    /** A service whose key set holds the tenant's one key, so no request leaves the process. */
    const serviceWithTenantKey = (): MicrosoftAuthService => {
      withEnv(FULL_CONFIG);
      const service = new MicrosoftAuthService();
      const keySet = (service as unknown as { jwksClient: { getSigningKey: unknown } }).jwksClient;

      keySet.getSigningKey = async (kid: string): Promise<{ getPublicKey: () => string }> => {
        if (kid !== KEY_ID) {
          throw new Error(`Unable to find a signing key that matches '${kid}'`);
        }

        return { getPublicKey: () => publicPem };
      };

      return service;
    };

    it('reads the account out of a token the tenant signed for this application', async () => {
      const token = idToken({ preferred_username: 'ada@example.com', name: 'Ada' });

      await expect(serviceWithTenantKey().authenticate(token)).resolves.toEqual({
        email: 'ada@example.com',
        name: 'Ada',
      });
    });

    it('names the account after its mailbox when the token carries no name', async () => {
      const token = idToken({ email: 'ada@example.com' });

      await expect(serviceWithTenantKey().authenticate(token)).resolves.toEqual({
        email: 'ada@example.com',
        name: 'ada',
      });
    });

    it.each([
      ['a token minted for another application', { audience: 'someone-else' }],
      [
        'a token minted by another tenant',
        { issuer: 'https://login.microsoftonline.com/other/v2.0' },
      ],
      ['a token signed by a key the tenant does not publish', { keyid: 'unknown-key' }],
      ['a token that has expired', { expiresIn: -60 }],
    ])('refuses %s', async (_case, options) => {
      const token = idToken({ preferred_username: 'ada@example.com' }, options);

      await expect(serviceWithTenantKey().authenticate(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("refuses a token whose signature is not the tenant's", async () => {
      const forger = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const token = idToken({ preferred_username: 'ada@example.com' }, {}, forger.privateKey);

      await expect(serviceWithTenantKey().authenticate(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuses a token that names nobody', async () => {
      const token = idToken({ name: 'Ada' });

      await expect(serviceWithTenantKey().authenticate(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuses what is not a token at all', async () => {
      await expect(serviceWithTenantKey().authenticate('not-a-jwt')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
