import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export default function PasswordInput(props) {
  const [visible, setVisible] = useState(false);

  return <>
    <input {...props} type={visible ? 'text' : 'password'} />
    <button
      className="password-visibility-toggle"
      type="button"
      aria-label={visible ? 'Hide password' : 'Show password'}
      aria-pressed={visible}
      onClick={() => setVisible(value => !value)}
    >
      {visible ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  </>;
}
