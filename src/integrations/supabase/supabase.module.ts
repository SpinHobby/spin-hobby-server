import { Module } from '@nestjs/common';
import { SupabaseAuthClient } from './supabase-auth.client.js';

/** The client for Supabase Auth (sign-in, sign-up, password reset). */
@Module({ providers: [SupabaseAuthClient], exports: [SupabaseAuthClient] })
export class SupabaseModule {}
