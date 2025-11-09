import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

export function AtLeastOne(properties: string[], validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'atLeastOne',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions || {},
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          const obj = args.object as Record<string, unknown>;
          return properties.some(prop => obj[prop] !== undefined && obj[prop] !== null && obj[prop] !== '');
        },
        defaultMessage(_args: ValidationArguments) {
          return `At least one of the following fields must be provided: ${properties.join(', ')}`;
        },
      },
    });
  };
}
