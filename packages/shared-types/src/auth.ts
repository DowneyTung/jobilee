import { z } from "zod";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
/** Deliberately permissive length floor — argon2 handles the rest. */
export const passwordSchema = z.string().min(8).max(200);

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof userSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const authResponseSchema = tokenPairSchema.extend({ user: userSchema });
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const accessTokenResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AccessTokenResponse = z.infer<typeof accessTokenResponseSchema>;

/** JWT claims issued by auth-service and verified at the gateway. */
export const jwtClaimsSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  typ: z.enum(["access", "refresh"]),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtClaims = z.infer<typeof jwtClaimsSchema>;
