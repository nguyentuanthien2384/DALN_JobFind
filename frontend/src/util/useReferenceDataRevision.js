import { useSyncExternalStore } from 'react';
import { getReferenceDataRevision, subscribeReferenceDataChanges } from '../service/referenceDataEvents';

export default function useReferenceDataRevision() {
    return useSyncExternalStore(subscribeReferenceDataChanges, getReferenceDataRevision, getReferenceDataRevision);
}
