import { Injectable, UnauthorizedException } from '@nestjs/common';

import { OAuthUserPayload } from '../auth.types';
import { GoogleTokenResponse, GoogleUserInfo } from '../dto/google-auth.dto';
import { OAuthProviderService } from './oauth-provider.base';

export interface GoogleCredential {
  /** Authorization code from the redirect. */
  code: string;
  /** PKCE verifier the browser generated for that code. */
  codeVerifier: string;
}

@Injectable()
export class GoogleAuthService extends OAuthProviderService<GoogleCredential> {
  private readonly clientId!: string;
  private readonly clientSecret!: string;
  private readonly redirectUri!: string;

  constructor() {
    super('Google');

    const config = this.loadConfig([
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_REDIRECT_URI',
    ]);

    if (config) {
      this.clientId = config['GOOGLE_CLIENT_ID']!;
      this.clientSecret = config['GOOGLE_CLIENT_SECRET']!;
      this.redirectUri = config['GOOGLE_REDIRECT_URI']!;
    }
  }

  override async authenticate({ code, codeVerifier }: GoogleCredential): Promise<OAuthUserPayload> {
    this.ensureAvailable();

    const tokens = await this.fetchJson<GoogleTokenResponse>(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
        }),
      },
      { unreachable: 'Google authentication service unavailable' },
    );

    if (tokens.error || !tokens.access_token) {
      this.logger.warn(`Google code exchange failed: ${tokens.error_description ?? tokens.error}`);
      throw new UnauthorizedException('Failed to exchange Google authorization code');
    }

    return this.fetchVerifiedUser(tokens.access_token);
  }

  private async fetchVerifiedUser(accessToken: string): Promise<OAuthUserPayload> {
    const userInfo = await this.fetchJson<GoogleUserInfo>(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
      {
        unreachable: 'Google authentication service unavailable',
        badResponse: 'Invalid Google token',
      },
    );

    if (!userInfo.email_verified) {
      throw new UnauthorizedException('Google email not verified');
    }
    if (!userInfo.email || !userInfo.sub) {
      throw new UnauthorizedException('Google token missing required fields');
    }

    return {
      email: userInfo.email,
      name: userInfo.name ?? userInfo.email.split('@')[0] ?? userInfo.email,
    };
  }
}
