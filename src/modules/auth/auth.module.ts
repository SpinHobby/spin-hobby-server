import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

/** Who is signed in: verifies Supabase tokens, loads the profile and role, and serves the sign-in routes. Exports AuthService for the global access guard. */
@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
