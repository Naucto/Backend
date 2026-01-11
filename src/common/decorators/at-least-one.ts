import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, registerDecorator, ValidationOptions } from "class-validator";

@ValidatorConstraint({ name: "atLeastOne", async: false })
export class AtLeastOneConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const obj = args.object as Record<string, unknown>;
    const properties = args.constraints[0] as string[];
    
    return properties.some(prop => {
      const value = obj[prop];
      return value !== undefined && value !== null && value !== "";
    });
  }

  defaultMessage(args: ValidationArguments): string {
    const properties = args.constraints[0] as string[];
    return `At least one of the following fields must be provided: ${properties.join(", ")}`;
  }
}

export function AtLeastOne(properties: string[], validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions || {},
      constraints: [properties],
      validator: AtLeastOneConstraint,
    });
  };
}
