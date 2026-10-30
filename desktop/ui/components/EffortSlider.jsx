import { useEffect, useRef, useState } from "react";
import { EFFORT_TERMS } from "../../viewFormat.js";
import { LEVEL_INFO, getLevelNames } from "../lib/effortLevels.js";
import { Wave } from "./Wave.jsx";
import "./EffortSlider.css";

const MAX_LEVEL = LEVEL_INFO.length - 1;
const BURST_MS = 700;

// 노력(Claude)·추론(Codex)을 다섯 칸으로 고르는 슬라이드. 칸마다 이름과 한 줄 설명이 바뀌고, 단계가 오를수록 선과 글자가 검정 → 주황 → 붉은색으로 물든다.
// 맨 끝(Max)에 닿는 순간에만 손잡이에서 고리가 한 번 퍼진다. 그 밖의 움직임은 없다. disabled면(Codex 설정을 따르는 중) 흐리게 잠근다.
const EffortSlider = ({ provider, level, onChange, disabled = false }) => {
    const names = getLevelNames(provider);
    const info = LEVEL_INFO[level];
    const previousLevel = useRef(level);
    const [isBursting, setIsBursting] = useState(false);

    useEffect(() => {
        const isArrival = level === MAX_LEVEL && previousLevel.current !== MAX_LEVEL;

        previousLevel.current = level;

        if (!isArrival) {
            return undefined;
        }

        setIsBursting(true);

        const timer = setTimeout(() => setIsBursting(false), BURST_MS);

        return () => clearTimeout(timer);
    }, [level]);

    return (
        <div className={isBursting ? "slider burst" : "slider"} data-provider={provider} data-level={level} data-off={disabled ? "" : undefined} style={{ "--lv": level }}>
            <div className="slider-top">
                <span className="slider-name">
                    <Wave level={level} />
                    <b>{names[level]}</b>
                </span>
                <span className="slider-tag">{info.tags[provider]}</span>
            </div>
            <div className="slider-area">
                <div className="slider-track">
                    <i className="slider-fill"></i>
                </div>
                <div className="slider-stops" aria-hidden="true">
                    {names.map((name) => (
                        <i key={name}></i>
                    ))}
                </div>
                <div className="slider-thumb" aria-hidden="true">
                    <Wave level={level} />
                </div>
                <input
                    type="range"
                    min={0}
                    max={MAX_LEVEL}
                    step={1}
                    value={level}
                    disabled={disabled}
                    aria-label={EFFORT_TERMS[provider]}
                    aria-valuetext={`${names[level]}, ${info.tags[provider]}`}
                    onChange={(event) => onChange(Number(event.target.value))}
                />
            </div>
            <div className="slider-ticks" aria-hidden="true">
                {names.map((name, index) => (
                    <span key={name} data-on={index === level ? "" : undefined}>
                        {name}
                    </span>
                ))}
            </div>
            <p className="slider-desc">{info.desc}</p>
        </div>
    );
};

export { EffortSlider };
