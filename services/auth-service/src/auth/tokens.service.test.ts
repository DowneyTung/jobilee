import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "@jobilee/service-kit";
import { decodeJwt } from "jose";
import type { Config } from "../config.ts";
import { TokensService } from "./tokens.service.ts";

const config = {
  JWT_SECRET: "test-secret-at-least-16-chars-long",
  JWT_ACCESS_TTL: 900,
  JWT_REFRESH_TTL: 604_800,
} as Config;

const USER = "11111111-1111-4111-8111-111111111111";
const EMAIL = "ada@example.com";

const tokens = new TokensService(config);

test("access tokens carry the user id, email, and a short expiry", async () => {
  const token = await tokens.issueAccessToken(USER, EMAIL);
  const claims = decodeJwt(token);

  assert.equal(claims.sub, USER);
  assert.equal(claims["email"], EMAIL);
  assert.equal(claims["typ"], "access");
  assert.equal(claims.iss, "jobilee-auth");
  assert.equal(claims.aud, "jobilee");
  assert.equal((claims.exp ?? 0) - (claims.iat ?? 0), 900);
});

test("refresh tokens live far longer than access tokens", async () => {
  const refresh = decodeJwt(await tokens.issueRefreshToken(USER, EMAIL));
  assert.equal(refresh["typ"], "refresh");
  assert.equal((refresh.exp ?? 0) - (refresh.iat ?? 0), 604_800);
});

test("a valid token verifies and returns its claims", async () => {
  const claims = await tokens.verify(await tokens.issueAccessToken(USER, EMAIL), "access");
  assert.equal(claims.sub, USER);
  assert.equal(claims.typ, "access");
});

test("SECURITY: a refresh token is rejected where an access token is expected", async () => {
  const refresh = await tokens.issueRefreshToken(USER, EMAIL);

  await assert.rejects(
    () => tokens.verify(refresh, "access"),
    (error: AppError) => {
      assert.equal(error.code, "UNAUTHORIZED");
      assert.match(error.message, /expected an access token/);
      return true;
    },
  );
});

test("SECURITY: an access token is rejected where a refresh token is expected", async () => {
  const access = await tokens.issueAccessToken(USER, EMAIL);
  await assert.rejects(() => tokens.verify(access, "refresh"), AppError);
});

test("SECURITY: a token signed with a different secret is rejected", async () => {
  const other = new TokensService({ ...config, JWT_SECRET: "a-totally-different-secret-key" });
  const foreign = await other.issueAccessToken(USER, EMAIL);

  await assert.rejects(
    () => tokens.verify(foreign, "access"),
    (error: AppError) => error.code === "UNAUTHORIZED",
  );
});

test("SECURITY: an expired token is rejected", async () => {
  const shortLived = new TokensService({ ...config, JWT_ACCESS_TTL: 1 });
  const token = await shortLived.issueAccessToken(USER, EMAIL);

  await new Promise((resolve) => setTimeout(resolve, 1_500));

  await assert.rejects(() => shortLived.verify(token, "access"), AppError);
});

test("garbage is rejected without leaking why", async () => {
  for (const junk of ["", "not-a-jwt", "a.b.c", "Bearer something"]) {
    await assert.rejects(
      () => tokens.verify(junk, "access"),
      (error: AppError) => {
        // One generic message: never a parser detail that helps an attacker.
        assert.equal(error.message, "invalid or expired token");
        return true;
      },
    );
  }
});

test("accessTtlSeconds reports what clients should plan a refresh around", () => {
  assert.equal(tokens.accessTtlSeconds, 900);
});
