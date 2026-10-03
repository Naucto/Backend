import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

import { OAuthUserPayload } from '../auth.types';
import { OAuthProviderService } from './oauth-provider.base';

@Injectable()
export class MicrosoftAuthService extends OAuthProviderService<string> {
  private readonly clientId!: string;
  private readonly tenantId!: string;
  private readonly jwksClient!: jwksRsa.JwksClient;

  constructor() {
    super('Microsoft');

    const config = this.loadConfig(['MICROSOFT_CLIENT_ID', 'MICROSOFT_TENANT_ID']);

    if (config) {
      this.clientId = config['MICROSOFT_CLIENT_ID']!;
      this.tenantId = config['MICROSOFT_TENANT_ID']!;
      this.jwksClient = jwksRsa({
        jwksUri: `https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`,
        cache: true,
        cacheMaxAge: 10 * 60 * 1000,
        rateLimit: true,
      });
    }
  }

  /** `idToken` is the ID token the browser obtained from Microsoft. */
  override async authenticate(idToken: string): Promise<OAuthUserPayload> {
    this.ensureAvailable();

    const decoded = jwt.decode(idToken, { complete: true });

    if (!decoded || typeof decoded.payload === 'string') {
      throw new UnauthorizedException('Invalid Microsoft token format');
    }

    let publicKey: string;
    try {
      const key = await this.jwksClient.getSigningKey(decoded.header.kid);
      publicKey = key.getPublicKey();
    } catch {
      throw new UnauthorizedException('Failed to fetch Microsoft signing key');
    }

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        audience: this.clientId,
        issuer: `https://login.microsoftonline.com/${this.tenantId}/v2.0`,
      }) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Microsoft token signature invalid');
    }

    const email = payload['preferred_username'] ?? payload['email'] ?? payload['upn'];

    if (!email) {
      throw new UnauthorizedException('No email found in Microsoft token');
    }

    const name = payload['name'] ?? email.split('@')[0] ?? email;

    return { email, name };
  }
}
