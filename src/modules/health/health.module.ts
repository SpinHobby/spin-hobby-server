import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/** Liveness and readiness checks for the host and for people debugging a deployment. */
@Module({ controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
