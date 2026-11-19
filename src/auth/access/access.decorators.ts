import { applyDecorators, SetMetadata } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtension,
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { RoleName, USER } from './roles';

export const ACCESS_KEY = 'access';

/**
 * Marks a public operation in the OpenAPI document. A class-level `@RequiresAuth()` gives every one
 * of its operations a 401 and a required bearer that a method cannot take back; the document
 * builder reads this mark to state the public ones as they are.
 */
export const PUBLIC_OPERATION_EXTENSION = 'x-naucto-public';

/** The 401 the access decorators document, told apart from a route's own 401 (bad credentials). */
export const AUTHENTICATION_REQUIRED = 'Authentication required';

/** Every account holds the lowest role, so requiring it is `RequiresAuth`. */
type RequirableRole = Exclude<RoleName, typeof USER>;

/** The 401 a staff route answers a token that did not come from the staff sign-in. */
export const STAFF_SESSION_REQUIRED = 'STAFF_SESSION_REQUIRED';

export type Access =
  | { kind: 'public' }
  | { kind: 'auth' }
  | { kind: 'role'; role: RequirableRole }
  | { kind: 'staff'; role: RequirableRole };

type AccessDecorator = ReturnType<typeof applyDecorators>;

/** Open to anyone; a valid bearer token still identifies the caller, an absent or bad one does not refuse. */
export const Public = (): AccessDecorator =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, { kind: 'public' } satisfies Access),
    ApiExtension(PUBLIC_OPERATION_EXTENSION, true),
  );

/** Open to any signed-in user. */
export const RequiresAuth = (): AccessDecorator =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, { kind: 'auth' } satisfies Access),
    ApiBearerAuth('JWT-auth'),
    ApiUnauthorizedResponse({ description: AUTHENTICATION_REQUIRED }),
  );

/** Open to signed-in users holding `role` or a role ranked above it. */
export const RequiresRole = (role: RequirableRole): AccessDecorator =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, { kind: 'role', role } satisfies Access),
    ApiBearerAuth('JWT-auth'),
    ApiUnauthorizedResponse({ description: AUTHENTICATION_REQUIRED }),
    ApiForbiddenResponse({ description: `${role} role required` }),
  );

/**
 * Open to staff holding `role` or a role ranked above it, signed in through the admin console.
 * The token of an ordinary site sign-in is refused whatever role its account holds.
 */
export const RequiresStaffSession = (role: RequirableRole): AccessDecorator =>
  applyDecorators(
    SetMetadata(ACCESS_KEY, { kind: 'staff', role } satisfies Access),
    ApiBearerAuth('JWT-auth'),
    ApiUnauthorizedResponse({
      description: `${AUTHENTICATION_REQUIRED}, through the staff sign-in (${STAFF_SESSION_REQUIRED})`,
    }),
    ApiForbiddenResponse({ description: `${role} role required` }),
  );
