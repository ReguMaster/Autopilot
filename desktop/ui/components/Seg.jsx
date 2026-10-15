// 라디오로 하나를 고르는 알약 묶음. options는 [{ value, label, disabled }]이다(styles/schedule.css의 .seg).
const Seg = ({ name, label, options, value, onChange }) => {
    return (
        <div className="seg" role="radiogroup" aria-label={label}>
            {options.map((option) => (
                <label key={option.value} className="seg-option">
                    <input type="radio" name={name} value={option.value} checked={String(value) === String(option.value)} disabled={option.disabled} onChange={() => onChange(option.value)} />
                    <span>{option.label}</span>
                </label>
            ))}
        </div>
    );
};

export { Seg };
