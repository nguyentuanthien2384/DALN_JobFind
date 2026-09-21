import { useCallback, useState } from 'react';

// URL navigation changes the rendered query before its fetching effect runs.
// Keep retained rows unavailable throughout that gap and any page correction.
export default function useListLoading(requestKey) {
    const [state, setState] = useState({ key: null, pending: true });
    const setLoading = useCallback(pending => {
        setState({ key: requestKey, pending });
    }, [requestKey]);
    return [state.pending || state.key !== requestKey, setLoading];
}
