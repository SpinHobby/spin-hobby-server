import { Text } from '../../../common/validation/decorators.js';

/** `POST /notes`: one new note on a product. */
export class CreateNoteDto {
  /** The product the note is about (80 characters at most). */
  @Text('productId', 80)
  productId!: string;

  /** The note itself (300 characters at most). */
  @Text('note', 300)
  note!: string;
}
