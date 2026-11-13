import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access } from '../auth/access.js';

/** Sample REST API: anyone may read it. */
@ApiTags('Hello')
@Controller('hello')
@Access('public')
export class HelloController {
  private readonly logger = new Logger(HelloController.name);

  @Get()
  hello() {
    this.logger.log('hello world from the back end');
    return { success: true, message: 'Hello from the API' };
  }
}
