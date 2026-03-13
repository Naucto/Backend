export class WebRTCServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class WebRTCServiceOfferError extends WebRTCServiceError {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
