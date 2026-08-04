import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.ts";
import { AuthService } from "./auth.service.ts";
import { TokensService } from "./tokens.service.ts";

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokensService],
})
export class AuthModule {}
