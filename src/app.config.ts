import { Injectable } from "@nestjs/common";

@Injectable()
export class AppConfig {
  private _port?: number;

  set port(port: number) {
    if (this._port) {
      return;
    }

    this._port = port;
  }

  get port(): number | undefined {
    return this._port;
  }
}
