import { useEffect, type ReactNode } from 'react';
import './Modal.css';

interface ModalProps {
  /** Always used as the dialog's accessible name (aria-label), even when hideTitle suppresses the
   * visible heading — a dialog still needs an accessible name for screen readers either way. */
  title: string;
  children: ReactNode;
  onClose: () => void;
  contentClassName?: string;
  /** Rendered before the title text — e.g. a celebratory icon for a more special-purpose modal. */
  icon?: ReactNode;
  centerTitle?: boolean;
  hideTitle?: boolean;
}

export function Modal({ title, children, onClose, contentClassName, icon, centerTitle, hideTitle }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal ${contentClassName ?? ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {!hideTitle && (
          <h3 className={`modal__title ${centerTitle ? 'modal__title--center' : ''}`}>
            {icon && <span className="modal__title-icon">{icon}</span>}
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}
