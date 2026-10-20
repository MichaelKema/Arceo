import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  MessageCircle,
  Gamepad2,
  Clapperboard,
  ShoppingBag,
  Globe,
  Folder,
  type LucideIcon,
} from "lucide-react";
import type { Group } from "../types";
const icons: Record<string, LucideIcon> = {
  social: MessageCircle,
  games: Gamepad2,
  entertainment: Clapperboard,
  shopping: ShoppingBag,
  custom: Folder,
};
export function GroupIcon({
  group,
  small = false,
}: {
  group: Pick<Group, "icon" | "color">;
  small?: boolean;
}) {
  const Icon = icons[group.icon] || Globe;
  return (
    <span className={`group-icon ${group.color} ${small ? "small" : ""}`}>
      <Icon size={small ? 16 : 23} strokeWidth={1.7} />
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={onChange}
      disabled={disabled}
    >
      <span />
    </button>
  );
}
export function Empty({
  icon: Icon = Folder,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} strokeWidth={1.4} />
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
