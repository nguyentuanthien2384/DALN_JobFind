import { expect } from 'vitest';
import { createContractValidator } from '../shared/requestContract.js';
import { operationById } from '../shared/contracts/operations.js';
import { responseValidationSchema } from '../shared/contracts/responses.js';

const validators = new Map();
export const expectResponseContract = (id, res) => {
    const operation = operationById[id];
    if (!validators.has(id)) validators.set(id, createContractValidator().compile(responseValidationSchema(operation)));
    const validate = validators.get(id);
    // Test the actual JSON wire shape: Dates/ObjectIds are serialized by Express.
    const valid = validate(JSON.parse(JSON.stringify(res.body)));
    expect(res.statusCode).toBe(operation.status);
    expect(valid, `${id}: ${JSON.stringify(validate.errors)}`).toBe(true);
};
