import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import {
  loginRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  type AccessTokenResponse,
  type AuthResponse,
  type LoginRequest,
  type RefreshRequest,
  type RegisterRequest,
  type User,
} from "@jobilee/shared-types";
import { UserId, ZodValidationPipe } from "@jobilee/service-kit";
import { AuthService } from "./auth.service.ts";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
  ): Promise<AuthResponse> {
    return this.auth.register(body);
  }

  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest): Promise<AuthResponse> {
    return this.auth.login(body);
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
  ): Promise<AccessTokenResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * Identity comes from the gateway-injected header, not from a bearer token —
   * this service never parses Authorization. One place verifies JWTs.
   */
  @Get("me")
  async me(@UserId() userId: string): Promise<{ user: User }> {
    return { user: await this.auth.me(userId) };
  }
}
