import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok' as const,
      service: 'gwi-api',
      timestamp: new Date().toISOString(),
    };
  }
}
