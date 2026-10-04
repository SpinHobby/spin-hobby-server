import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../integrations/supabase/supabase.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { DevLogin } from './dev-login.service.js';
import { SessionService } from './session.service.js';
import { SignInService } from './sign-in.service.js';
import { StagingAdminLogin } from './staging-admin-login.service.js';

/**
 * Who is signed in. AuthService verifies tokens and loads the profile (the global access guard uses it);
 * SignInService handles logging in, signing up and passwords.
 */
@Module({
  imports: [SupabaseModule],
  controllers: [AuthController],
  providers: [AuthService, SessionService, DevLogin, StagingAdminLogin, SignInService],
  exports: [AuthService],
})
export class AuthModule {}
