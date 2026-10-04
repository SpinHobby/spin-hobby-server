import { Transform } from 'class-transformer';
import { registerDecorator, ValidateIf, type ValidationOptions } from 'class-validator';
import {
  boolValue,
  email,
  nonNegativeIntOrNull,
  optionalString,
  positiveInteger,
  stringValue,
} from './rules.js';

/**
 * Property decorators for DTO classes. Each one wraps a rule from rules.ts, so a DTO reads as
 * a description of the request and the messages users see stay in one place.
 *
 *   class CreateEventDto {
 *     @Text('name', 160) name!: string;          // required, trimmed, at most 160 characters
 *     @OptionalText(120) city: string | null = null;
 *   }
 *
 * A rule runs twice on purpose: first to clean the value (trim, lowercase, "5" -> 5), then to
 * validate it. When it throws, the value is left as sent and the rule's message is reported.
 */
export function Rule(
  rule: (value: unknown) => unknown,
  options?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) => {
    Transform(({ value }) => {
      try {
        return rule(value);
      } catch {
        return value;
      }
    })(target, propertyKey);
    registerDecorator({
      name: 'rule',
      target: target.constructor,
      propertyName: propertyKey as string,
      options,
      validator: {
        validate: (value: unknown) => {
          try {
            rule(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage: (args) => {
          try {
            rule(args?.value);
          } catch (error) {
            if (error instanceof Error) return error.message;
          }
          return 'Invalid value.';
        },
      },
    });
  };
}

/**
 * For partial updates (PATCH-style bodies): only check this field when the client actually sent it.
 * Put it above the rule: `@Provided() @Text('name', 160) name?: string;`. Leave such properties without
 * an initializer, so "not sent" stays `undefined` and a service can tell it apart from `null`.
 */
export const Provided = () => ValidateIf((_object, value) => value !== undefined);

/** Required text. The message is "<field> is required." */
export const Text = (field: string, max = 500) => Rule((v) => stringValue(v, field, max));

/** Optional text; blank or missing becomes null. Give the property `= null` so a missing field is null too. */
export const OptionalText = (max = 500) => Rule((v) => optionalString(v, max));

/** A whole number from 1 to `max`; accepts numbers and numeric strings. */
export const PositiveInt = (field: string, max = 99) => Rule((v) => positiveInteger(v, field, max));

/** A whole number from 0 up, or null when blank. */
export const NonNegativeInt = (field: string) => Rule((v) => nonNegativeIntOrNull(v, field));

/** A valid email address, lowercased. */
export const EmailAddress = () => Rule((v) => email(v));

/** A real true/false (not "true"). */
export const Flag = (field: string) => Rule((v) => boolValue(v, field));
