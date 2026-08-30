import React from "react";
import CustomScrollbars from "./CustomScrollbars";
import { Scrollbars } from "react-custom-scrollbars";

jest.mock("react-custom-scrollbars", () => ({
    Scrollbars: function MockScrollbars() {
        return null;
    },
}), { virtual: true });

const createInstance = (props = {}) => new CustomScrollbars(props);

describe("CustomScrollbars", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it("forwards layout props and selects the correct track renderers", () => {
        const child = <span>content</span>;
        const component = createInstance({
            className: "messages",
            disableVerticalScroll: true,
            disableHorizontalScroll: false,
            "data-purpose": "conversation",
            children: child,
        });

        const element = component.render();

        expect(element.type).toBe(Scrollbars);
        expect(element.props.className).toBe("messages custom-scrollbar");
        expect(element.props.autoHide).toBe(true);
        expect(element.props.autoHideTimeout).toBe(200);
        expect(element.props.hideTracksWhenNotNeeded).toBe(true);
        expect(element.props["data-purpose"]).toBe("conversation");
        expect(element.props.renderTrackHorizontal).toBe(component.renderTrackHorizontal);
        expect(element.props.renderThumbHorizontal).toBe(component.renderThumbHorizontal);
        expect(element.props.renderTrackVertical).toBe(component.renderNone);
        expect(element.props.renderThumbVertical).toBe(component.renderNone);
        expect(element.props.children).toBe(child);

        const plain = createInstance({}).render();
        expect(plain.props.className).toBe("custom-scrollbar");
    });

    it("renders each custom track/thumb and the intentionally empty renderer", () => {
        const component = createInstance();
        const props = { id: "part", style: { opacity: 0.5 } };

        expect(component.renderTrackHorizontal(props)).toEqual(
            <div {...props} className="track-horizontal" />
        );
        expect(component.renderTrackVertical(props)).toEqual(
            <div {...props} className="track-vertical" />
        );
        expect(component.renderThumbHorizontal(props)).toEqual(
            <div {...props} className="thumb-horizontal" />
        );
        expect(component.renderThumbVertical(props)).toEqual(
            <div {...props} className="thumb-vertical" />
        );
        expect(component.renderNone(props)).toEqual(<div />);
    });

    it("exposes the current scroll coordinates and ignores commands before mounting", () => {
        const component = createInstance();
        component.ref.current = {
            getScrollLeft: jest.fn(() => 12),
            getScrollTop: jest.fn(() => 34),
        };
        expect(component.getScrollLeft()).toBe(12);
        expect(component.getScrollTop()).toBe(34);

        component.ref.current = null;
        expect(component.scrollTo(100)).toBeUndefined();
        expect(component.scrollToBottom()).toBeUndefined();
    });

    it("quick-scrolls in thirty deterministic steps and reaches the bottom", () => {
        const component = createInstance({ quickScroll: true });
        const scrollbars = {
            getScrollTop: jest.fn(() => 20),
            getScrollHeight: jest.fn(() => 320),
            scrollTop: jest.fn(),
        };
        component.ref.current = scrollbars;

        component.scrollToBottom();

        expect(scrollbars.getScrollHeight).toHaveBeenCalledTimes(1);
        expect(scrollbars.scrollTop).toHaveBeenCalledTimes(30);
        expect(scrollbars.scrollTop).toHaveBeenNthCalledWith(1, 30);
        expect(scrollbars.scrollTop).toHaveBeenLastCalledWith(320);
    });

    it("animates normal scrolling with timers and stops after thirty steps", () => {
        jest.useFakeTimers();
        const component = createInstance({ quickScroll: false });
        const scrollbars = {
            getScrollTop: jest.fn(() => 0),
            scrollTop: jest.fn(),
        };
        component.ref.current = scrollbars;

        component.scrollTo(300);
        expect(scrollbars.scrollTop).toHaveBeenCalledTimes(1);
        jest.runAllTimers();

        expect(scrollbars.scrollTop).toHaveBeenCalledTimes(30);
        expect(scrollbars.scrollTop).toHaveBeenLastCalledWith(300);
    });
});
