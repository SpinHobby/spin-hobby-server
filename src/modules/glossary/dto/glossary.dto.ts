import { Text } from '../../../common/validation/decorators.js';

/** `POST /admin/glossary`: one new term. */
export class CreateGlossaryTermDto {
  /** The word or phrase, e.g. "Nendoroid" (80 characters at most). */
  @Text('term', 80)
  term!: string;

  /** What it means, in a sentence or two (1000 characters at most). */
  @Text('meaning', 1000)
  meaning!: string;
}
