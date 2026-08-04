import { Injectable } from "@nestjs/common";
import type {
  AccessTokenResponse,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  User,
} from "@jobilee/shared-types";
import { hash, verify } from "@node-rs/argon2";
import { Prisma, type User as UserRow } from "../../generated/prisma/index.js";
import { AppError } from "@jobilee/service-kit";
import { PrismaService } from "../prisma/prisma.service.ts";
import { TokensService } from "./tokens.service.ts";

/**
 * OWASP's argon2id baseline: 19 MiB, 2 iterations, 1 lane. Tuned for ~100ms on
 * commodity hardware — high enough to make offline cracking expensive, low
 * enough that a login doesn't stall the event loop noticeably.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  async register(body: RegisterRequest): Promise<AuthResponse> {
    const passwordHash = await hash(body.password, ARGON2_OPTIONS);

    let user: UserRow;
    try {
      user = await this.prisma.user.create({
        data: { email: body.email, passwordHash },
      });
    } catch (error) {
      // Let the unique index decide, rather than checking first and racing.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError("CONFLICT", "an account with that email already exists");
      }
      throw error;
    }

    return this.issueSession(user);
  }

  async login(body: LoginRequest): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });

    // Same generic message and a real hash comparison either way, so response
    // content and timing don't reveal whether the account exists.
    if (!user) {
      await this.burnTime(body.password);
      throw new AppError("UNAUTHORIZED", "invalid email or password");
    }
    if (!(await verify(user.passwordHash, body.password))) {
      throw new AppError("UNAUTHORIZED", "invalid email or password");
    }

    return this.issueSession(user);
  }

  async refresh(refreshToken: string): Promise<AccessTokenResponse> {
    const claims = await this.tokens.verify(refreshToken, "refresh");

    // The token may outlive the account it names.
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user) {
      throw new AppError("UNAUTHORIZED", "invalid or expired token");
    }

    return {
      accessToken: await this.tokens.issueAccessToken(user.id, user.email),
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  async me(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError("NOT_FOUND", "user not found");
    }
    return toUser(user);
  }

  private async issueSession(user: UserRow): Promise<AuthResponse> {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.issueAccessToken(user.id, user.email),
      this.tokens.issueRefreshToken(user.id, user.email),
    ]);
    return {
      user: toUser(user),
      accessToken,
      refreshToken,
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  /** Equalizes the cost of a miss against the cost of a hit. */
  private async burnTime(password: string): Promise<void> {
    await hash(password, ARGON2_OPTIONS);
  }
}

/** Never let `passwordHash` reach a response body. */
function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, createdAt: row.createdAt };
}
