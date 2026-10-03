export class WebRTCServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class WebRTCServerDecoratorError extends WebRTCServerError {}

export class WebRTCServerRuntimeError extends WebRTCServerError {}
