import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

/** Liveness and readiness checks for the host and for people debugging a deployment. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
