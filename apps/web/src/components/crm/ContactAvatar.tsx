import type { CSSProperties } from 'react';

export const AVATAR_GRADS = [
  '#667eea,#764ba2', '#f093fb,#f5576c', '#4facfe,#00f2fe', '#43e97b,#38f9d7',
  '#fa709a,#fee140', '#a18cd1,#fbc2eb', '#f7971e,#ffd200', '#5ee7df,#b490ca',
  '#84fab0,#8fd3f4', '#fad0c4,#ffd1ff', '#ee9ca7,#ffdde1', '#fbc2eb,#a6c1ee',
];

export function gradFor(id: string): string {
  const h = id.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0);
  return `linear-gradient(135deg,${AVATAR_GRADS[h % AVATAR_GRADS.length]})`;
}

export function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => (w[0] ?? '').toUpperCase()).join('');
}

interface ContactAvatarProps {
  id: string;
  name: string;
  size?: number;
  style?: CSSProperties;
}

export function ContactAvatar({ id, name, size = 32, style }: ContactAvatarProps) {
  const ini = initials(name);
  const fontSize = Math.max(10, Math.round(size * 0.375));
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: gradFor(id),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 600,
        color: '#fff',
        ...style,
      }}
    >
      {ini}
    </div>
  );
}
