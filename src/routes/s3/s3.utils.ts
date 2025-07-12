import * as crypto from "crypto";

export function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function createPolicy(resourceUrl: string, expires: number): string {
  return JSON.stringify({
    Statement: [{
      Resource: resourceUrl,
      Condition: {
        DateLessThan: { "AWS:EpochTime": expires },
      },
    }],
  });
}

export function rsaSha256Sign(privateKey: string, policy: string): Buffer {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(policy);
  signer.end();

  return signer.sign(privateKey);
}
