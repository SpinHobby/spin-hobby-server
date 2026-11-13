import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access } from '../auth/access.js';

/** Sample REST API: anyone may read it. */
@ApiTags('Hello')
@Controller('hello')
@Access('public')
export class HelloController {
  @Get()
  hello() {
    return { success: true, message: 'Hello from the API' };
  }
}
