import { Text } from '../../../common/validation/decorators.js';

/** `POST /hello/notes`: one new note. */
export class CreateNoteDto {
  /** The note itself (500 characters at most). Spaces around it are trimmed; blank is refused. */
  @Text('text', 500)
  text!: string;
}
