import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { suggestJobs } from "../../../service/aiSearchService";
import "./JobSearchAutocomplete.css";

const SUGGESTION_DELAY_MS = 300;

const normalizeSearchTerm = (value) => String(value || "").trim().replace(/\s+/g, " ");

const SearchIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
    </svg>
);

const CompleteIcon = () => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 17 17 7M9 7h8v8" />
    </svg>
);

const HighlightedText = ({ text, query }) => {
    const value = String(text || "");
    const matchAt = value.toLocaleLowerCase("vi").indexOf(query.toLocaleLowerCase("vi"));

    if (matchAt < 0) return value;

    const matchEnd = matchAt + query.length;
    return (
        <>
            {value.slice(0, matchAt)}
            <strong>{value.slice(matchAt, matchEnd)}</strong>
            {value.slice(matchEnd)}
        </>
    );
};

const JobSearchAutocomplete = ({ onSearch }) => {
    const [value, setValue] = useState("");
    const [suggestions, setSuggestions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const wrapperRef = useRef(null);
    const inputRef = useRef(null);
    const requestIdRef = useRef(0);
    const isComposingRef = useRef(false);
    const generatedId = useId().replace(/:/g, "");
    const listboxId = `job-search-suggestions-${generatedId}`;
    const normalizedValue = normalizeSearchTerm(value);

    useEffect(() => {
        const requestId = ++requestIdRef.current;
        setActiveIndex(-1);

        if (normalizedValue.length < 2) {
            setSuggestions([]);
            setIsLoading(false);
            return undefined;
        }

        setSuggestions([]);
        setIsLoading(true);
        const timer = window.setTimeout(async () => {
            try {
                const response = await suggestJobs(normalizedValue);
                if (requestIdRef.current !== requestId) return;

                const data = response?.errCode === 0 && Array.isArray(response.data)
                    ? response.data.filter((item) => item && typeof item.name === "string")
                    : [];
                setSuggestions(data);
            } catch {
                if (requestIdRef.current === requestId) setSuggestions([]);
            } finally {
                if (requestIdRef.current === requestId) setIsLoading(false);
            }
        }, SUGGESTION_DELAY_MS);

        return () => {
            window.clearTimeout(timer);
            if (requestIdRef.current === requestId) requestIdRef.current += 1;
        };
    }, [normalizedValue]);

    useEffect(() => {
        const closeOnOutsideClick = (event) => {
            if (!wrapperRef.current?.contains(event.target)) setIsOpen(false);
        };

        document.addEventListener("mousedown", closeOnOutsideClick);
        return () => document.removeEventListener("mousedown", closeOnOutsideClick);
    }, []);

    useEffect(() => {
        if (!isOpen || activeIndex < 0) return;
        const activeOption = document.getElementById(`${listboxId}-option-${activeIndex}`);
        activeOption?.scrollIntoView?.({ block: "nearest" });
    }, [activeIndex, isOpen, listboxId]);

    const options = useMemo(() => {
        if (!normalizedValue) return [];

        return [
            { key: "current-search", kind: "search", searchTerm: normalizedValue },
            ...suggestions.map((item, index) => ({
                key: `job-${item.id ?? "unknown"}-${index}`,
                kind: "job",
                searchTerm: normalizeSearchTerm(item.name),
                job: item,
            })),
        ];
    }, [normalizedValue, suggestions]);

    const submitSearch = (term) => {
        const nextValue = normalizeSearchTerm(term);
        setValue(nextValue);
        setIsOpen(false);
        setActiveIndex(-1);
        onSearch(nextValue);
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        submitSearch(value);
    };

    const handleKeyDown = (event) => {
        if (isComposingRef.current || event.nativeEvent?.isComposing || event.keyCode === 229) {
            return;
        }

        if (event.key === "Escape") {
            setIsOpen(false);
            setActiveIndex(-1);
            return;
        }

        if (!options.length || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;

        if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => (current + 1) % options.length);
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => (current <= 0 ? options.length - 1 : current - 1));
            return;
        }

        if (event.key === "Enter" && isOpen && activeIndex >= 0) {
            event.preventDefault();
            submitSearch(options[activeIndex].searchTerm);
        }
    };

    const handleClear = () => {
        setValue("");
        setSuggestions([]);
        setIsOpen(false);
        setActiveIndex(-1);
        onSearch("");
        inputRef.current?.focus();
    };

    const showDropdown = isOpen && Boolean(normalizedValue);

    return (
        <div
            className="job-search-autocomplete"
            ref={wrapperRef}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    setIsOpen(false);
                    setActiveIndex(-1);
                }
            }}
        >
            <form
                className={`job-search-autocomplete__form${showDropdown ? " job-search-autocomplete__form--open" : ""}`}
                role="search"
                onSubmit={handleSubmit}
            >
                <span className="job-search-autocomplete__leading-icon">
                    <SearchIcon />
                </span>
                <input
                    ref={inputRef}
                    type="search"
                    value={value}
                    placeholder="Nhập từ khóa công việc"
                    aria-label="Tìm kiếm việc làm"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={showDropdown}
                    aria-controls={showDropdown ? listboxId : undefined}
                    aria-activedescendant={showDropdown && activeIndex >= 0
                        ? `${listboxId}-option-${activeIndex}`
                        : undefined}
                    autoComplete="off"
                    onChange={(event) => {
                        const nextValue = event.target.value;
                        const nextSearchTerm = normalizeSearchTerm(nextValue);
                        setValue(nextValue);
                        setIsOpen(Boolean(nextSearchTerm));

                        if (!nextSearchTerm) {
                            setSuggestions([]);
                            setActiveIndex(-1);
                            onSearch("");
                        }
                    }}
                    onFocus={() => {
                        if (normalizedValue) setIsOpen(true);
                    }}
                    onCompositionStart={() => { isComposingRef.current = true; }}
                    onCompositionEnd={() => { isComposingRef.current = false; }}
                    onKeyDown={handleKeyDown}
                />
                {value && (
                    <button
                        type="button"
                        className="job-search-autocomplete__clear"
                        aria-label="Xóa từ khóa"
                        onClick={handleClear}
                    >
                        ×
                    </button>
                )}
                <button type="submit" className="job-search-autocomplete__submit">
                    Tìm kiếm
                </button>
            </form>

            {showDropdown && (
                <div className="job-search-autocomplete__dropdown">
                    <div id={listboxId} role="listbox" aria-label="Gợi ý tìm kiếm">
                        {options.map((option, index) => (
                            <button
                                key={option.key}
                                id={`${listboxId}-option-${index}`}
                                type="button"
                                role="option"
                                aria-selected={activeIndex === index}
                                className={`job-search-autocomplete__option${activeIndex === index ? " job-search-autocomplete__option--active" : ""}`}
                                tabIndex={-1}
                                onMouseDown={(event) => event.preventDefault()}
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => submitSearch(option.searchTerm)}
                            >
                                <span className="job-search-autocomplete__option-icon">
                                    <SearchIcon />
                                </span>
                                {option.kind === "search" ? (
                                    <span className="job-search-autocomplete__option-copy">
                                        <span className="job-search-autocomplete__option-title">
                                            <strong>{option.searchTerm}</strong>
                                            <span className="job-search-autocomplete__search-label"> — Tìm kiếm việc làm</span>
                                        </span>
                                    </span>
                                ) : (
                                    <span className="job-search-autocomplete__option-copy">
                                        <span className="job-search-autocomplete__option-title">
                                            <HighlightedText text={option.job.name} query={normalizedValue} />
                                        </span>
                                        {option.job.companyName && (
                                            <span className="job-search-autocomplete__option-company">
                                                {option.job.companyName}
                                            </span>
                                        )}
                                    </span>
                                )}
                                {option.kind === "job" && (
                                    <span className="job-search-autocomplete__complete-icon">
                                        <CompleteIcon />
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                    {isLoading && (
                        <div className="job-search-autocomplete__loading" role="status">
                            Đang tìm gợi ý phù hợp...
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default JobSearchAutocomplete;
