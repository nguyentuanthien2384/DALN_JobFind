import { createContext } from "react";

// Gia tri undefined cho phep cac component duoc render doc lap trong test hoac
// story van fallback ve localStorage. Trong ung dung that, App luon cap danh
// tinh vua duoc dong bo tu /api/auth/me.
const SessionContext = createContext(undefined);

export default SessionContext;
