import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../../common/validation/validation.pipe.js';
import { EventDto } from './event.dto.js';

const pipe = new AppValidationPipe();
const body = (value: unknown) => pipe.transform(value, { type: 'body', metatype: EventDto });

describe('EventDto', () => {
  it('defaults everything but the name', async () => {
    expect(await body({ name: 'Otafest' })).toMatchObject({
      name: 'Otafest',
      city: null,
      startDate: null,
      endDate: null,
      boothInfo: null,
      isVisible: true,
      sortOrder: 0,
    });
  });

  it('keeps well-formed dates and an explicit hidden flag', async () => {
    expect(
      await body({ name: 'x', startDate: '2027-05-15', endDate: '2027-05-17', isVisible: false }),
    ).toMatchObject({
      startDate: '2027-05-15',
      endDate: '2027-05-17',
      isVisible: false,
    });
  });

  it.each(['soon', '2027-5-1', '15/05/2027'])('rejects the date %s', async (startDate) => {
    await expect(body({ name: 'x', startDate })).rejects.toMatchObject({
      message: 'Dates must be YYYY-MM-DD.',
    });
  });

  it('needs a name', async () => {
    await expect(body({})).rejects.toMatchObject({ message: 'name is required.' });
  });
});
