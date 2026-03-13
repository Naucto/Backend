// Extracts the message from an unknown error object, providing a fallback message if necessary.
// "Excerr" = exception + error
export function getExcerrMessage(error: unknown, fallback: string = "Unexpected server error"): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
