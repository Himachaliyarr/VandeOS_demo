import { X } from 'lucide-react';

export default function Modal({ title, children, onClose, closable = true, size = 'normal' }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose?.()}>
    <section className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><div><p className="eyebrow">VANDE OS</p><h2>{title}</h2></div>{closable && <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>}</div>
      {children}
    </section>
  </div>;
}
