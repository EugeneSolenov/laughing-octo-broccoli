export default function BrandMark({ className = "", size = 36 }) {
  return (
    <span
      aria-hidden="true"
      className={["brand-mark", className].filter(Boolean).join(" ")}
      style={{ "--brand-mark-size": `${size}px` }}
    >
      <img alt="" className="brand-mark__image" src="/bird_logo_square_no_eye.svg" />
    </span>
  );
}
