import { Inject, Injectable } from "@nestjs/common";
import { jwtClaimsSchema, type JwtClaims } from "@jobilee/shared-types";
import { SignJWT, jwtVerify } from "jose";
import { CONFIG, type Config } from "../config.ts";
import { AppError } from "../common/errors.ts";

const ISSUER = "jobilee-auth";
const AUDIENCE = "jobilee";

/**
 * Access and refresh tokens are both HS256 JWTs distinguished by a `typ`
 * claim, signed with the same secret the gateway verifies with.
 *
 * Refresh tokens are stateless, matching the data model in ARCHITECTURE.md
 * (auth-service owns only `users`). The trade-off: a refresh token cannot be
 * revoked before it expires. Adding a `refresh_tokens` table with a stored
 * hash is the upgrade path if that ever matters.
 */
@Injectable()
export class TokensService {
  private readonly secret: Uint8Array;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.secret = new TextEncoder().encode(config.JWT_SECRET);
  }

  get accessTtlSeconds(): number {
    return this.config.JWT_ACCESS_TTL;
  }

  async issueAccessToken(userId: string, email: string): Promise<string> {
    return this.sign(userId, email, "access", this.config.JWT_ACCESS_TTL);
  }

  async issueRefreshToken(userId: string, email: string): Promise<string> {
    return this.sign(userId, email, "refresh", this.config.JWT_REFRESH_TTL);
  }

  /** Verifies signature, expiry, issuer/audience, and the expected `typ`. */
  async verify(token: string, expected: JwtClaims["typ"]): Promise<JwtClaims> {
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
      }));
    } catch {
      throw new AppError("UNAUTHORIZED", "invalid or expired token");
    }

    const claims = jwtClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new AppError("UNAUTHORIZED", "malformed token claims");
    }
    // A refresh token must never be accepted where an access token is required.
    if (claims.data.typ !== expected) {
      throw new AppError("UNAUTHORIZED", `expected a ${expected} token`);
    }
    return claims.data;
  }

  private async sign(
    userId: string,
    email: string,
    typ: JwtClaims["typ"],
    ttlSeconds: number,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email, typ })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + ttlSeconds)
      .sign(this.secret);
  }
}
