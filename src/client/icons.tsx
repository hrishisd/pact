// Icons: Lucide (DESIGN.md), in the house style. They draw in currentColor.

import {
  Banknote,
  BookOpen,
  CalendarCheck,
  Camera,
  ChevronLeft,
  ClipboardCheck,
  Layers,
  Luggage,
  MessageSquareText,
  Moon,
  Pencil,
  Plus,
  ScrollText,
  Share,
  type LucideIcon,
} from "lucide-react";

/** One Lucide icon: 24px in the tab bar and rows, 20px inline with text, stroke 1.75. */
function Icon({ icon: I, size = 24, className }: { icon: LucideIcon; size?: 20 | 24; className?: string }) {
  return <I size={size} strokeWidth={1.75} aria-hidden={true} {...(className !== undefined && { className })} />;
}

export const TodayIcon = () => <Icon icon={CalendarCheck} />;

export const PactsIcon = () => <Icon icon={ScrollText} />;

export const ReviewIcon = () => <Icon icon={ClipboardCheck} />;

export const LedgersIcon = () => <Icon icon={BookOpen} />;

/** Safari's Share button, as the setup guide describes it. */
export const ShareIcon = () => <Icon icon={Share} size={20} className="inline-ico" />;

/** Safari's Add to Home Screen row. */
export const AddIcon = () => <Icon icon={Plus} size={20} className="inline-ico" />;

// Lucide has no brand marks, so Google's stays drawn here.
export const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"
    />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
);

export const BackIcon = () => <Icon icon={ChevronLeft} />;

export const CameraIcon = () => <Icon icon={Camera} />;

/** Layers, for Anki: Anki's own icon is a star, which would read as a brand mark. */
export const CardsIcon = () => <Icon icon={Layers} />;

export const SuitcaseIcon = () => <Icon icon={Luggage} />;

/** Oura Ring evidence is a bedtime, so a moon. */
export const RingIcon = () => <Icon icon={Moon} />;

export const DollarIcon = () => <Icon icon={Banknote} />;

export const ExcuseIcon = () => <Icon icon={MessageSquareText} />;

/** The Change kind: a pencil. */
export const PencilIcon = () => <Icon icon={Pencil} />;
