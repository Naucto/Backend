import { applyDecorators, Type } from "@nestjs/common";
import { ApiOkResponse, ApiExtraModels, getSchemaPath } from "@nestjs/swagger";

export function ApiPaginatedResponse<TModel extends Type<any>>(model: TModel) {
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        type: "object",
        properties: {
          statusCode: { type: "number", example: 200 },
          message: { type: "string", example: "Success" },
          data: {
            type: "array",
            items: { $ref: getSchemaPath(model) },
          },
          meta: {
            type: "object",
            properties: {
              page: { type: "number", example: 1 },
              limit: { type: "number", example: 10 },
              total: { type: "number", example: 42 },
              totalPages: { type: "number", example: 5 },
            },
          },
        },
      },
    }),
  );
}
