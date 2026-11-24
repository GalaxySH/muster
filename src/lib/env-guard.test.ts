import { describe, it, expect } from "vitest";
import {
  DEV_AUTH_SECRET,
  DEV_ENCRYPTION_KEY,
  findProductionEnvIssues,
} from "./env-guard";

const secure = {
  AUTH_SECRET: "dGVzdC1vbmx5LWF1dGgtc2VjcmV0LW5vdC1yZWFsISE=",
  ENCRYPTION_KEY: "dGVzdC1vbmx5LWVuY3J5cHRpb24ta2V5LW5vdHJlYWw=",
  DEV_LOGIN_ENABLED: "",
  GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "GOCSPX-real-secret",
  NEXTAUTH_URL: "https://muster.hauge.rocks",
  RESEND_API_KEY: "re_test_not_a_real_key",
  EMAIL_FROM: "Scheduling <no-reply@example.edu>",
};

describe("findProductionEnvIssues", () => {
  it("returns no issues for a securely configured production env", () => {
    expect(findProductionEnvIssues(secure, "production")).toEqual([]);
  });

  it("ignores insecure dev defaults outside production", () => {
    const dev = {
      AUTH_SECRET: DEV_AUTH_SECRET,
      ENCRYPTION_KEY: DEV_ENCRYPTION_KEY,
      DEV_LOGIN_ENABLED: "1",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      NEXTAUTH_URL: "http://localhost:3000",
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
    };
    expect(findProductionEnvIssues(dev, "development")).toEqual([]);
    expect(findProductionEnvIssues(dev, "test")).toEqual([]);
    expect(findProductionEnvIssues(dev, undefined)).toEqual([]);
  });

  it("flags the dev AUTH_SECRET default in production", () => {
    const issues = findProductionEnvIssues({ ...secure, AUTH_SECRET: DEV_AUTH_SECRET }, "production");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("AUTH_SECRET");
  });

  it("flags the dev ENCRYPTION_KEY default in production", () => {
    const issues = findProductionEnvIssues(
      { ...secure, ENCRYPTION_KEY: DEV_ENCRYPTION_KEY },
      "production",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("ENCRYPTION_KEY");
  });

  it("flags DEV_LOGIN_ENABLED being set at all in production", () => {
    const issues = findProductionEnvIssues({ ...secure, DEV_LOGIN_ENABLED: "1" }, "production");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("DEV_LOGIN_ENABLED");
  });

  it("flags empty Google OAuth credentials in production", () => {
    const noId = findProductionEnvIssues({ ...secure, GOOGLE_CLIENT_ID: "" }, "production");
    expect(noId).toHaveLength(1);
    expect(noId[0]).toContain("GOOGLE_CLIENT_ID");

    const noSecret = findProductionEnvIssues({ ...secure, GOOGLE_CLIENT_SECRET: "" }, "production");
    expect(noSecret).toHaveLength(1);
    expect(noSecret[0]).toContain("GOOGLE_CLIENT_SECRET");
  });

  it("flags a localhost NEXTAUTH_URL in production", () => {
    for (const url of ["http://localhost:3000", "https://127.0.0.1:3000"]) {
      const issues = findProductionEnvIssues({ ...secure, NEXTAUTH_URL: url }, "production");
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("NEXTAUTH_URL");
    }
  });

  it("accepts a real public NEXTAUTH_URL", () => {
    expect(
      findProductionEnvIssues({ ...secure, NEXTAUTH_URL: "https://muster.hauge.rocks" }, "production"),
    ).toEqual([]);
  });

  it("accumulates all violations", () => {
    const issues = findProductionEnvIssues(
      {
        ...secure,
        AUTH_SECRET: DEV_AUTH_SECRET,
        ENCRYPTION_KEY: DEV_ENCRYPTION_KEY,
        DEV_LOGIN_ENABLED: "true",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        NEXTAUTH_URL: "http://localhost:3000",
        RESEND_API_KEY: "",
        EMAIL_FROM: "",
      },
      "production",
    );
    expect(issues).toHaveLength(8);
  });

  it("flags a missing Resend key in production", () => {
    for (const RESEND_API_KEY of ["", "  "]) {
      const issues = findProductionEnvIssues({ ...secure, RESEND_API_KEY }, "production");
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("RESEND_API_KEY");
    }
  });

  it("accepts a bare or named EMAIL_FROM address", () => {
    for (const EMAIL_FROM of ["no-reply@example.edu", "Scheduling <no-reply@example.edu>"]) {
      expect(findProductionEnvIssues({ ...secure, EMAIL_FROM }, "production")).toEqual([]);
    }
  });

  it("flags a missing or address-less EMAIL_FROM in production", () => {
    for (const EMAIL_FROM of ["", "  ", "Scheduling", "no-reply@", "<@example.edu>"]) {
      const issues = findProductionEnvIssues({ ...secure, EMAIL_FROM }, "production");
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("EMAIL_FROM");
    }
  });
});
