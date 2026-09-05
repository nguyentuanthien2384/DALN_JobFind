import createValidator from './contracts/eventValidator.cjs';
import { eventCatalog } from './contracts/eventCatalog.js';

export const { assertEventPayload, serializeEventPayload } = createValidator(eventCatalog);
