const mockInitializeApp = jest.fn();

jest.mock("firebase/compat/app", () => ({
    __esModule: true,
    default: { initializeApp: mockInitializeApp },
}));
jest.mock("firebase/compat/auth", () => ({}));

it("initializes and exports the configured Firebase client", () => {
    const firebase = require("./firebase").default;
    expect(firebase.initializeApp).toBe(mockInitializeApp);
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockInitializeApp).toHaveBeenCalledWith(expect.objectContaining({
        authDomain: "jobfind-e388c.firebaseapp.com",
        projectId: "jobfind-e388c",
        storageBucket: "jobfind-e388c.appspot.com",
    }));
});
