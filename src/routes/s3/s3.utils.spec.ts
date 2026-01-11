import * as crypto from "crypto";
import { base64UrlEncode, createPolicy, rsaSha256Sign, rsaSha1Sign } from "./s3.utils";

jest.mock("crypto", () => ({
  createSign: jest.fn().mockImplementation(() => ({
    update: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    sign: jest.fn().mockImplementation((privateKey, encoding) => {
      if (privateKey && encoding === "base64") {
        return "mock-signature";
      }
      return Buffer.from("mock-signature");
    })
  })),
  createHash: jest.fn(),
  createHmac: jest.fn(),
}));

describe("S3 Utils", () => {
  describe("base64UrlEncode", () => {
    it("should encode string to base64url format", () => {
      const input = "test string";
      const result = base64UrlEncode(input);
      
      expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result).not.toContain("+");
      expect(result).not.toContain("/");
      expect(result).not.toContain("=");
    });

    it("should encode buffer to base64url format", () => {
      const input = Buffer.from("test buffer");
      const result = base64UrlEncode(input);
      
      expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result).not.toContain("+");
      expect(result).not.toContain("/");
      expect(result).not.toContain("=");
    });

    it("should handle empty string", () => {
      const result = base64UrlEncode("");
      expect(result).toBe("");
    });

    it("should handle special characters", () => {
      const input = "test+string/with=special==chars";
      const result = base64UrlEncode(input);
      
      expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(result).not.toContain("+");
      expect(result).not.toContain("/");
      expect(result).not.toContain("=");
    });
  });

  describe("createPolicy", () => {
    it("should create valid policy with resource and expiration", () => {
      const resourceUrl = "https://example.com/resource";
      const expires = Math.floor(Date.now() / 1000) + 3600;
      
      const result = createPolicy(resourceUrl, expires);
      const policy = JSON.parse(result);
      
      expect(policy).toHaveProperty("Statement");
      expect(policy.Statement).toBeInstanceOf(Array);
      expect(policy.Statement[0]).toHaveProperty("Resource", resourceUrl);
      expect(policy.Statement[0]).toHaveProperty("Condition");
      expect(policy.Statement[0].Condition).toHaveProperty("DateLessThan");
      expect(policy.Statement[0].Condition.DateLessThan).toHaveProperty("AWS:EpochTime");
      expect(policy.Statement[0].Condition.DateLessThan["AWS:EpochTime"]).toBe(expires);
    });

    it("should create policy with no extra whitespace", () => {
      const result = createPolicy("https://example.com", 1234567890);
      
      expect(result).not.toContain("\n");
      expect(result).not.toContain("  ");
    });

    it("should handle different resource URLs", () => {
      const complexUrl = "https://s3.amazonaws.com/bucket/path/to/resource?param=value";
      const expires = 9999999999;
      
      const result = createPolicy(complexUrl, expires);
      const policy = JSON.parse(result);
      
      expect(policy.Statement[0].Resource).toBe(complexUrl);
      expect(policy.Statement[0].Condition.DateLessThan["AWS:EpochTime"]).toBe(expires);
    });
  });

  describe("rsaSha256Sign", () => {
    it("should sign policy with RSA-SHA256", () => {
      const privateKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...";
      const policy = JSON.stringify({ test: "policy" });
      
      const result = rsaSha256Sign(privateKey, policy);
      
      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      expect(crypto.createSign).toHaveBeenCalledWith("RSA-SHA256");
    });

    it("should handle different policy strings", () => {
      const privateKey = "test-key";
      const longPolicy = JSON.stringify({
        Statement: [{
          Resource: "https://example.com",
          Condition: {
            DateLessThan: { "AWS:EpochTime": 1234567890 }
          }
        }]
      });
      
      const result = rsaSha256Sign(privateKey, longPolicy);
      
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe("rsaSha1Sign", () => {
    it("should sign policy with RSA-SHA1 and return base64", () => {
      const privateKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...";
      const policy = JSON.stringify({ test: "policy" });
      
      const result = rsaSha1Sign(privateKey, policy);
      
      expect(typeof result).toBe("string");
      expect(result).toBe("mock-signature");
      expect(crypto.createSign).toHaveBeenCalledWith("RSA-SHA1");
    });

    it("should handle empty policy", () => {
      const privateKey = "test-key";
      const emptyPolicy = "{}";
      
      const result = rsaSha1Sign(privateKey, emptyPolicy);
      
      expect(typeof result).toBe("string");
    });

    it("should handle complex policy objects", () => {
      const privateKey = "test-key";
      const complexPolicy = JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "stmt123",
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: "arn:aws:s3:::bucket/*"
          }
        ]
      });
      
      const result = rsaSha1Sign(privateKey, complexPolicy);
      
      expect(typeof result).toBe("string");
    });
  });
});
