import { Injectable } from "@nestjs/common";

@Injectable()
export class AppConfig {
  private _port?: number;

  setPort(port: number): void {
    if (this._port) {
      return;
    }

    this._port = port;
  }

  getPort(): number | undefined {
    return this._port;
  }
}
