import { Injectable, UnauthorizedException } from "@nestjs/common";
import { OAuth2Client, LoginTicket } from "google-auth-library";
import { GoogleUserPayload } from "./auth.types";

@Injectable()
export class GoogleAuthService {
  private readonly client: OAuth2Client;

  constructor() {
    this.client = new OAuth2Client(process.env["GOOGLE_CLIENT_ID"]);
  }

  async verifyGoogleToken(token: string): Promise<GoogleUserPayload> {
    try {
      const audience = process.env["GOOGLE_CLIENT_ID"] ?? "";

      const ticket: LoginTicket = await this.client.verifyIdToken({
        idToken: token,
        audience,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new UnauthorizedException("Invalid Google token payload");
      }

      return {
        email: payload.email ?? "",
        name: payload.name ?? "",
        picture: payload.picture ?? undefined,
        googleId: payload.sub ?? "",
      };
    } catch {
      throw new UnauthorizedException("Google token verification failed");
    }
  }
}
