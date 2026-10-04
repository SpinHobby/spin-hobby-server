import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Interactive API documentation at /docs (raw OpenAPI JSON at /docs-json). It is generated from the
 * controllers and DTO classes, so it can't drift from the code: add a DTO and the docs update.
 * Use "Authorize" with a bearer token from POST /auth/login to try the signed-in routes.
 */
export function setupApiDocs(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Spin Hobby API')
    .setDescription(
      'Storefront, checkout and admin API. Errors always look like `{ "success": false, "error": "…", "code"?: "…" }`.',
    )
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs-json',
  });
}
